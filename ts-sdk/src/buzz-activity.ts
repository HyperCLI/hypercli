/**
 * Buzz-activity transport: subscribe to a Buzz-backed agent's observer
 * telemetry directly from its Nostr relay.
 *
 * Buzz-backed HyperCLI deployments run `buzz-acp`, which publishes observer
 * frames as kind-24200 events signed by the agent key, with the content
 * NIP-44-v2-encrypted to the owner pubkey. The SDK subscribes to the relay
 * over a plain WebSocket and decrypts locally; no backend round-trips are
 * involved beyond revealing the agent key.
 *
 * NIP-44 conversation keys are symmetric:
 * `getConversationKey(ownerSecret, agentPub) === getConversationKey(agentSecret, ownerPub)`,
 * so decryption works with either the owner's nsec or the agent's
 * `BUZZ_PRIVATE_KEY` secret.
 */
import NodeWebSocket from 'ws';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { extract as hkdfExtract, expand as hkdfExpand } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { chacha20 } from '@noble/ciphers/chacha.js';
import { equalBytes } from '@noble/ciphers/utils.js';
import { base64, bech32 } from '@scure/base';
import type { Agent, Deployments } from './agents.js';

export const BUZZ_OBSERVER_EVENT_KIND = 24200;

const NIP44_MIN_PAYLOAD_LEN = 99;
const NIP44_MAX_PAYLOAD_LEN = 87_472;
const NIP44_EXTENDED_PREFIX_THRESHOLD = 0x1_00_00;
const DEDUP_CAP = 4_096;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000];

export interface BuzzObserverFrame {
  seq: number;
  timestamp: string;
  kind: string;
  agentIndex: number | null;
  channelId: string | null;
  sessionId: string | null;
  turnId: string | null;
  startedAt?: string;
  payload: unknown;
}

export interface BuzzActivitySubscription {
  close(): void;
}

export interface BuzzActivityHandlers {
  onFrame(frame: BuzzObserverFrame): void;
  onHistoryEnd?(): void;
  onClose?(event: { code: number; reason: string }): void;
  onError?(error: Error): void;
  signal?: AbortSignal;
  /**
   * Owner key as nsec/hex string or raw bytes; omit to use the agent secret.
   * SECURITY: never pass an owner key in browser/webview contexts — the owner
   * identity is not throwaway like the per-agent key. This option exists for
   * trusted local clients (e.g. a desktop keychain) where the key never
   * leaves the device; it is used only for local key derivation and is never
   * transmitted, persisted, or logged.
   */
  ownerSecretKey?: string | Uint8Array;
  /** Relay history lookback in seconds; default 86400. */
  sinceSeconds?: number;
  /** REQ limit; default 500. */
  limit?: number;
}

export interface BuzzEnvConfig {
  relayUrl: string;
  ownerPubHex: string;
}

type BuzzDeploymentsClient = Pick<Deployments, 'get' | 'secret'>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHex64(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

/**
 * Decode an agent/owner secret given as an nsec bech32 string, a 64-char hex
 * string, or a raw 32-byte array. Throws on anything else.
 */
export function decodeBuzzSecret(nsecOrHex: string | Uint8Array): Uint8Array {
  let bytes: Uint8Array;
  if (nsecOrHex instanceof Uint8Array) {
    bytes = nsecOrHex;
  } else if (typeof nsecOrHex === 'string') {
    const trimmed = nsecOrHex.trim();
    if (isHex64(trimmed)) {
      bytes = hexToBytes(trimmed);
    } else if (trimmed.startsWith('nsec1')) {
      let decoded: { prefix: string; words: number[] };
      try {
        decoded = bech32.decode(trimmed as `${string}1${string}`, 1_000) as { prefix: string; words: number[] };
      } catch (error) {
        throw new Error(`invalid nsec bech32: ${(error as Error).message}`);
      }
      if (decoded.prefix !== 'nsec') {
        throw new Error(`expected an nsec bech32 string, got prefix "${decoded.prefix}"`);
      }
      bytes = new Uint8Array(bech32.fromWords(decoded.words));
    } else {
      throw new Error('secret key must be an nsec bech32 string or 64-char hex');
    }
  } else {
    throw new Error('secret key must be an nsec/hex string or raw bytes');
  }
  if (bytes.length !== 32 || !secp256k1.utils.isValidPrivateKey(bytes)) {
    throw new Error('secret key must be a valid 32-byte secp256k1 scalar');
  }
  return bytes;
}

/** Derive the x-only hex pubkey for a 32-byte secret key. */
export function buzzPublicKeyHex(secretKey: Uint8Array): string {
  return bytesToHex(secp256k1.getPublicKey(secretKey, true).subarray(1, 33));
}

/**
 * NIP-44 v2 conversation key: HKDF-extract(salt "nip44-v2", ECDH shared x).
 * Symmetric across the (owner, agent) pair.
 */
export function buzzConversationKey(secretKey: Uint8Array, peerPubHex: string): Uint8Array {
  if (!isHex64(peerPubHex)) {
    throw new Error('peer pubkey must be 64-char hex');
  }
  const sharedX = secp256k1.getSharedSecret(secretKey, hexToBytes(`02${peerPubHex}`), true).subarray(1, 33);
  return hkdfExtract(sha256, sharedX, utf8ToBytes('nip44-v2'));
}

function nip44MessageKeys(conversationKey: Uint8Array, nonce: Uint8Array): {
  chachaKey: Uint8Array;
  chachaNonce: Uint8Array;
  hmacKey: Uint8Array;
} {
  const keys = hkdfExpand(sha256, conversationKey, nonce, 76);
  return {
    chachaKey: keys.subarray(0, 32),
    chachaNonce: keys.subarray(32, 44),
    hmacKey: keys.subarray(44, 76),
  };
}

function calcPaddedLen(len: number): number {
  if (!Number.isSafeInteger(len) || len < 1) throw new Error('expected positive integer');
  if (len <= 32) return 32;
  const nextPower = 2 ** (Math.floor(Math.log2(len - 1)) + 1);
  const chunk = nextPower <= 256 ? 32 : nextPower / 8;
  return chunk * (Math.floor((len - 1) / chunk) + 1);
}

function unpadNip44(padded: Uint8Array): Uint8Array {
  if (padded.length < 2) throw new Error('invalid padding');
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  const firstTwo = view.getUint16(0);
  let unpaddedLen: number;
  let prefixLen: number;
  if (firstTwo === 0) {
    unpaddedLen = view.getUint32(2);
    if (unpaddedLen < NIP44_EXTENDED_PREFIX_THRESHOLD) throw new Error('invalid padding');
    prefixLen = 6;
  } else {
    unpaddedLen = firstTwo;
    prefixLen = 2;
  }
  const unpadded = padded.subarray(prefixLen, prefixLen + unpaddedLen);
  if (
    unpadded.length !== unpaddedLen
    || padded.length !== prefixLen + calcPaddedLen(unpaddedLen)
  ) {
    throw new Error('invalid padding');
  }
  return unpadded;
}

/**
 * Decrypt a NIP-44 v2 payload: base64 of [version=2][nonce32][ciphertext][mac32].
 * Rejects non-v2 versions, bad MACs, bad lengths, and malformed padding.
 */
export function decryptBuzzPayload(conversationKey: Uint8Array, payload: string): string {
  if (typeof payload !== 'string') throw new Error('payload must be a string');
  let data: Uint8Array;
  try {
    data = base64.decode(payload);
  } catch (error) {
    throw new Error(`invalid base64 payload: ${(error as Error).message}`);
  }
  if (data.length < NIP44_MIN_PAYLOAD_LEN || data.length > NIP44_MAX_PAYLOAD_LEN) {
    throw new Error(`invalid payload length: ${data.length}`);
  }
  if (data[0] !== 2) {
    throw new Error(`unsupported payload version: ${data[0]}`);
  }
  const nonce = data.subarray(1, 33);
  const ciphertext = data.subarray(33, data.length - 32);
  const mac = data.subarray(data.length - 32);
  const { chachaKey, chachaNonce, hmacKey } = nip44MessageKeys(conversationKey, nonce);
  const expectedMac = hmac(sha256, hmacKey, concatBytes(nonce, ciphertext));
  if (!equalBytes(expectedMac, mac)) {
    throw new Error('invalid MAC');
  }
  const padded = chacha20(chachaKey, chachaNonce, ciphertext);
  return new TextDecoder().decode(unpadNip44(padded));
}

function readEnvString(env: Record<string, unknown>, key: string): string | null {
  const value = env[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function ownerFromAuthTag(authTag: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(authTag);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length < 2 || parsed[0] !== 'auth') return null;
  const candidate = parsed[1];
  return typeof candidate === 'string' && isHex64(candidate) ? candidate : null;
}

/**
 * Resolve the Buzz relay URL and owner pubkey from a launch-config env map.
 * Owner comes from `BUZZ_AUTH_TAG` (JSON `["auth", owner_pubkey_hex, ...]`,
 * element [1]) with `BUZZ_ACP_AGENT_OWNER` (bare 64-hex) as fallback.
 * Throws a clear "not Buzz-backed" error when no relay URL is present.
 */
export function resolveBuzzOwnerFromEnv(env: Record<string, unknown>): BuzzEnvConfig {
  const relayUrl = readEnvString(env, 'BUZZ_RELAY_URL');
  if (!relayUrl) {
    throw new Error(
      'Agent is not Buzz-backed: launchConfig env has no BUZZ_RELAY_URL; ' +
        'observer activity is only published by Buzz deployments running buzz-acp',
    );
  }
  const authTag = readEnvString(env, 'BUZZ_AUTH_TAG');
  const fromTag = authTag ? ownerFromAuthTag(authTag) : null;
  const fallback = readEnvString(env, 'BUZZ_ACP_AGENT_OWNER');
  const ownerPubHex = fromTag ?? (fallback && isHex64(fallback) ? fallback : null);
  if (!ownerPubHex) {
    throw new Error(
      'Buzz owner pubkey not found: BUZZ_AUTH_TAG is missing/malformed and ' +
        'BUZZ_ACP_AGENT_OWNER is not a 64-char hex pubkey',
    );
  }
  return { relayUrl, ownerPubHex };
}

function launchConfigEnv(launchConfig: unknown): Record<string, unknown> {
  if (!isPlainRecord(launchConfig)) return {};
  const env = launchConfig.env;
  return isPlainRecord(env) ? env : {};
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function toObserverFrame(value: unknown): BuzzObserverFrame | null {
  if (!isPlainRecord(value)) return null;
  const seq = value.seq;
  const timestamp = value.timestamp;
  const kind = value.kind;
  if (typeof seq !== 'number' || !Number.isFinite(seq)) return null;
  if (typeof timestamp !== 'string' || timestamp.length === 0) return null;
  if (typeof kind !== 'string' || kind.length === 0) return null;
  const agentIndex = value.agentIndex ?? value.agent_index;
  const frame: BuzzObserverFrame = {
    seq,
    timestamp,
    kind,
    agentIndex: typeof agentIndex === 'number' && Number.isInteger(agentIndex) ? agentIndex : null,
    channelId: optionalString(value.channelId ?? value.channel_id),
    sessionId: optionalString(value.sessionId ?? value.session_id),
    turnId: optionalString(value.turnId ?? value.turn_id),
    payload: value.payload,
  };
  const startedAt = optionalString(value.startedAt ?? value.started_at);
  if (startedAt !== null) frame.startedAt = startedAt;
  return frame;
}

function hasTag(tags: unknown, name: string, value: string): boolean {
  if (!Array.isArray(tags)) return false;
  return tags.some(
    (tag) => Array.isArray(tag) && tag[0] === name && tag[1] === value,
  );
}

/**
 * Shared deduper for both transports: drop frames already seen, keyed on
 * (timestamp, seq). Bounded memory — the oldest key is evicted past
 * DEDUP_CAP. Replay/live overlap happens on every (re)connect, so this is
 * load-bearing, not defensive.
 */
function createBuzzActivityDeduper(): (frame: BuzzObserverFrame) => boolean {
  const seen = new Map<string, true>();
  return (frame: BuzzObserverFrame): boolean => {
    const dedupKey = `${frame.timestamp.length}:${frame.timestamp}:${frame.seq}`;
    if (seen.has(dedupKey)) return false;
    seen.set(dedupKey, true);
    if (seen.size > DEDUP_CAP) {
      const oldest = seen.keys().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    return true;
  };
}

/**
 * Shared frame tolerance: unwrap `batch` envelopes, drop (but never fail on)
 * unparseable frames. Used by the relay transport after decryption and by the
 * route transport after JSON.parse — the payloads are the same shape.
 */
function emitObserverPayload(
  parsed: unknown,
  deliver: (frame: BuzzObserverFrame) => void,
  countDrop: () => void,
): void {
  const frame = toObserverFrame(parsed);
  const payload = frame?.payload;
  if (frame?.kind === 'batch' && isPlainRecord(payload) && Array.isArray(payload.events)) {
    // Batch envelope: unwrap each inner event. A malformed batch (no events
    // array) falls through and is emitted as-is.
    for (const inner of payload.events as unknown[]) {
      const innerFrame = toObserverFrame(inner);
      if (!innerFrame) {
        countDrop();
        continue;
      }
      deliver(innerFrame);
    }
    return;
  }
  if (!frame) {
    countDrop();
    return;
  }
  deliver(frame);
}

/**
 * Subscribe to a Buzz-backed agent's observer telemetry stream.
 *
 * Resolves the agent, reads `BUZZ_RELAY_URL`/owner pubkey from its
 * launch-config env, reveals the agent `BUZZ_PRIVATE_KEY`, then REQ-subscribes
 * the relay for kind-24200 frames and decrypts them locally. Reconnects with
 * bounded backoff (1s/2s/4s) resuming from the last accepted frame; gives up
 * via `onClose`.
 */
export async function subscribeBuzzActivity(
  deployments: BuzzDeploymentsClient,
  agentIdOrName: string,
  handlers: BuzzActivityHandlers,
): Promise<BuzzActivitySubscription> {
  const agent: Agent = await deployments.get(agentIdOrName);
  const env = launchConfigEnv(agent.launchConfig);
  const { relayUrl, ownerPubHex } = resolveBuzzOwnerFromEnv(env);

  // The agent secret is revealed in both modes: even when the caller supplies
  // an owner key for decryption, the agent pubkey is required for the REQ
  // `authors` filter and for per-event sender validation.
  const agentSecretResponse = await deployments.secret(agentIdOrName, 'BUZZ_PRIVATE_KEY');
  const agentSecret = decodeBuzzSecret(agentSecretResponse.value);
  const agentPubHex = buzzPublicKeyHex(agentSecret);

  const conversationKey = handlers.ownerSecretKey !== undefined
    ? buzzConversationKey(decodeBuzzSecret(handlers.ownerSecretKey), agentPubHex)
    : buzzConversationKey(agentSecret, ownerPubHex);

  const sinceSeconds = handlers.sinceSeconds ?? 86_400;
  const limit = handlers.limit ?? 500;

  let closed = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let historyEndFired = false;
  let lastFrameSince: number | null = null;
  let connectionCounter = 0;
  const isNewFrame = createBuzzActivityDeduper();

  const onAbort = () => close();

  function close(): void {
    if (closed) return;
    closed = true;
    handlers.signal?.removeEventListener('abort', onAbort);
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    const current = ws;
    ws = null;
    if (current) {
      current.onopen = null;
      current.onmessage = null;
      current.onerror = null;
      current.onclose = null;
      try {
        current.close();
      } catch {
        // A socket already closed by the peer needs no local close.
      }
    }
  }

  function deliver(frame: BuzzObserverFrame): void {
    if (!isNewFrame(frame)) return;
    const parsed = Date.parse(frame.timestamp);
    if (!Number.isNaN(parsed)) {
      const seconds = Math.floor(parsed / 1_000);
      if (lastFrameSince === null || seconds > lastFrameSince) lastFrameSince = seconds;
    }
    handlers.onFrame(frame);
  }

  function emitDecrypted(plaintext: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(plaintext);
    } catch {
      // Unparseable plaintext drops silently; it never kills the subscription.
      return;
    }
    emitObserverPayload(parsed, deliver, () => {
      // Unparseable observer frames drop silently, matching the route
      // transport; malformed frames never kill the subscription.
    });
  }

  function handleEvent(envelope: unknown[], subId: string): void {
    if (envelope[1] !== subId) return;
    const event = envelope[2];
    if (!isPlainRecord(event)) return;
    if (event.kind !== BUZZ_OBSERVER_EVENT_KIND) return;
    if (event.pubkey !== agentPubHex) return;
    if (typeof event.content !== 'string') return;
    if (!hasTag(event.tags, 'agent', agentPubHex)) return;
    if (!hasTag(event.tags, 'frame', 'telemetry')) return;
    let plaintext: string;
    try {
      plaintext = decryptBuzzPayload(conversationKey, event.content);
    } catch {
      // Decryption failures skip the frame; they never kill the subscription.
      return;
    }
    emitDecrypted(plaintext);
  }

  function connect(): void {
    if (closed) return;
    connectionCounter += 1;
    const subId = `buzz-activity-${connectionCounter}`;
    const WebSocketImpl = globalThis.WebSocket ?? NodeWebSocket;
    const socket = new WebSocketImpl(relayUrl);
    ws = socket as WebSocket;

    socket.onopen = () => {
      const since = lastFrameSince ?? Math.floor(Date.now() / 1_000) - sinceSeconds;
      const filter = {
        kinds: [BUZZ_OBSERVER_EVENT_KIND],
        authors: [agentPubHex],
        '#p': [ownerPubHex],
        since,
        limit,
      };
      socket.send(JSON.stringify(['REQ', subId, filter]));
    };

    socket.onmessage = (message: { data: unknown }) => {
      const raw = typeof message.data === 'string'
        ? message.data
        : message.data instanceof Uint8Array
          ? new TextDecoder().decode(message.data)
          : '';
      if (!raw) return;
      let envelope: unknown;
      try {
        envelope = JSON.parse(raw);
      } catch {
        return;
      }
      if (!Array.isArray(envelope)) return;
      switch (envelope[0]) {
        case 'EVENT':
          handleEvent(envelope, subId);
          return;
        case 'EOSE':
          // A relay that served history is healthy; reset the backoff budget.
          failures = 0;
          if (!historyEndFired) {
            historyEndFired = true;
            handlers.onHistoryEnd?.();
          }
          return;
        case 'NOTICE':
          handlers.onError?.(new Error(`Buzz relay notice: ${String(envelope[1] ?? '')}`));
          return;
        default:
          return;
      }
    };

    socket.onerror = () => {
      handlers.onError?.(new Error('Buzz relay WebSocket error'));
    };

    socket.onclose = (event: { code?: number; reason?: string }) => {
      if (closed) return;
      ws = null;
      const code = event?.code ?? 1006;
      const reason = event?.reason ?? '';
      if (failures >= RECONNECT_DELAYS_MS.length) {
        close();
        handlers.onClose?.({ code, reason });
        return;
      }
      const delay = RECONNECT_DELAYS_MS[failures];
      failures += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };
  }

  if (handlers.signal?.aborted) {
    return { close };
  }
  handlers.signal?.addEventListener('abort', onAbort, { once: true });

  connect();
  return { close };
}

export type { BuzzDeploymentsClient };

// ── Route transport: hyper-acp WS route serving the buzz activity stream, ──
// ── app-level token auth ──

/**
 * Pinned route name for the hyper-acp introspection listener. Deployments
 * launched with the provider's `buzz_activity` option carry
 * `routes['hyper-acp'] = { port: 7799, auth: false }` — the edge does no
 * auth; the stream is authenticated in-band (see
 * {@link subscribeBuzzActivityRoute}).
 */
export const HYPER_ACP_ROUTE_NAME = 'hyper-acp';

/** Thrown when the agent's launch config has no `hyper-acp` edge route. */
export class BuzzActivityRouteUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuzzActivityRouteUnavailableError';
  }
}

/**
 * Soft-signal error emitted via `onError` when the in-pod stream skipped a
 * lagging client ahead. Transient by definition — the subscription is alive.
 */
export class BuzzActivityGapError extends Error {
  public readonly dropped: number;
  constructor(dropped: number) {
    super(`buzz activity stream skipped ${dropped} events after client lag`);
    this.name = 'BuzzActivityGapError';
    this.dropped = dropped;
  }
}

/**
 * Handler contract identical to the relay transport. No NIP-44 / owner
 * resolution here: the deployment-provisioned app token replaces it.
 */
export interface BuzzActivityRouteHandlers {
  onFrame(frame: BuzzObserverFrame): void;
  onHistoryEnd?(): void;
  onClose?(event: { code: number; reason: string }): void;
  onError?(error: Error): void;
  signal?: AbortSignal;
}

export interface BuzzActivityRouteTarget {
  /** Fully derived edge WebSocket URL, for example `wss://hyper-acp-foo.agents.example/`. */
  wsUrl: string;
  /** In-pod port the route forwards to (the pinned 7799 today). */
  port: number;
}

type BuzzRouteDeploymentsClient = Pick<Deployments, 'get' | 'secret'>;

/**
 * Deployment env/secret that provisions the app-level introspection token.
 * buzz-acp binds via HYPER_ACP_WS_LISTEN: when the token is set it accepts
 * any bind address (the SDK provisions `0.0.0.0:7799` for edge forwarding);
 * with the token unset it is loopback-only (desktop-local) and no auth
 * frames are exchanged at all. With a token, auth is either a Bearer header
 * presented pre-upgrade OR the client's first text frame in-band
 * (`{"type":"auth","token":...}`, what this SDK sends). Replay history comes
 * from the server's session log at the SDK-pinned HYPER_ACP_LOG path.
 */
const BUZZ_ACTIVITY_WS_TOKEN_SECRET = 'HYPER_ACP_WS_TOKEN';

/**
 * Resolve the `hyper-acp` edge URL from an already-loaded Agent model.
 * Host derivation mirrors the platform contract: prefix defaults to the route
 * name on both sides, so `prefix` is `${prefix}-${agent.hostname}` and a bare
 * prefix is the root host itself. Returns null when the route is absent or
 * the agent hostname is not ready — callers use that to select the relay
 * transport instead.
 */
export function resolveBuzzActivityRouteTarget(
  agent: Pick<Agent, 'routes' | 'hostname'>,
): BuzzActivityRouteTarget | null {
  const route = agent.routes?.[HYPER_ACP_ROUTE_NAME];
  if (!route || typeof route.port !== 'number') return null;
  const hostname = String(agent.hostname ?? '').trim().replace(/\.$/, '');
  if (!hostname) return null;
  const prefix = String(route.prefix ?? HYPER_ACP_ROUTE_NAME).trim();
  const host = prefix ? `${prefix}-${hostname}` : hostname;
  return { wsUrl: `wss://${host}/`, port: route.port };
}

/**
 * Open the route WebSocket. Uniform in every runtime: the app token travels
 * in-band as the client's first text frame after the upgrade, so neither
 * browser cookies nor ws-package request headers are involved. (The bare
 * `ws`-constructor URL also sidesteps Node-undici's WebSocket quirks.)
 */
function openBuzzActivityRouteSocket(wsUrl: string): WebSocket {
  const WebSocketImpl = globalThis.WebSocket ?? NodeWebSocket;
  return new WebSocketImpl(wsUrl) as WebSocket;
}

/**
 * Subscribe to a Buzz-backed agent's observer stream through the agent's
 * `hyper-acp` WS route (serving the buzz activity stream) — the raw,
 * unpaced, untrimmed in-pod stream (one `ObserverEvent` JSON per frame),
 * preceded by the server's session log (a full-boot-session replay from
 * disk; live frames are unchanged) and exactly one `{"type":"replay_end"}`
 * marker, which maps to `onHistoryEnd`.
 *
 * Auth is app-level and entirely in-band: the route is `auth: false` at the
 * edge, so no platform JWT, cookie priming, or header tricks are involved.
 * The token is the deployment-provisioned `HYPER_ACP_WS_TOKEN`; a value
 * retained on the agent object (present on creation-result Agents — the SDK
 * owns provisioning on direct buzz launches) is used as-is, otherwise each
 * connect attempt reveals the secret through the OpenClaw-style per-secret
 * endpoint — fresh per attempt, with a launch-epoch freshness guard
 * mirroring the OpenClaw gateway flow. After the WebSocket upgrade the client's FIRST text
 * frame is exactly `{"type":"auth","token":...}`; the server answers exactly
 * one `{"type":"auth_ok"}` text frame and then replays. A close with code
 * 4401 before `auth_ok` means the token was rejected: terminal for the
 * subscription — the retry loop is skipped and `onClose` fires immediately
 * with that code/reason (consumers treat 4401 as no-reconnect).
 *
 * Token-fetch failures on the FIRST attempt (empty value, stale launch
 * epoch, or a `secret()` APIError 401/403/404) reject this promise as-is —
 * they are never converted to {@link BuzzActivityRouteUnavailableError}. On
 * a mid-life reconnect they surface via `onError` and end the subscription
 * with a terminal `onClose`.
 *
 * A recognizable protocol message (`replay_end`, `replay_gap`, or an
 * observer-shaped frame) arriving BEFORE `auth_ok` is a protocol violation
 * — the signature of a skewed deployment (backend secret present, pod
 * missing the token). It surfaces exactly one `onError` per subscription
 * and never touches the retry budget, history-end, or dedup state (so a
 * wedged stream cannot look healthy); the socket stays open so a healed pod
 * recovers on its own.
 *
 * Reconnects with bounded backoff (1s/2s/4s). The server's session log
 * re-plays from disk on reconnect; overlap dedup on (timestamp, seq) makes
 * duplicates a no-op. A served `replay_end` also resets the retry budget,
 * the route analogue of the relay transport's EOSE reset. A
 * `{"type":"replay_gap"}` frame surfaces as a soft
 * {@link BuzzActivityGapError}; the stream stays alive.
 */
export async function subscribeBuzzActivityRoute(
  deployments: BuzzRouteDeploymentsClient,
  agentIdOrName: string,
  handlers: BuzzActivityRouteHandlers,
): Promise<BuzzActivitySubscription> {
  const agent = await deployments.get(agentIdOrName);
  const target = resolveBuzzActivityRouteTarget(agent);
  if (!target) {
    throw new BuzzActivityRouteUnavailableError(
      `agent has no ${HYPER_ACP_ROUTE_NAME} route`,
    );
  }
  // Hoisted function declarations below lose control-flow narrowing, so bind
  // the post-guard values to fresh consts.
  const targetWsUrl = target.wsUrl;
  const agentId = String((agent as { id?: string }).id ?? agentIdOrName);
  // Launch-epoch freshness guard for the ws token: a 0/missing epoch on the
  // agent side means "unknown", which disables the guard rather than failing
  // it.
  const agentLaunchEpoch = Number((agent as { launchEpoch?: number }).launchEpoch ?? 0);
  // Token retained on a creation-result Agent (first-class ownership,
  // mirroring the OpenClaw gatewayToken flow); fresh backend hydrations
  // carry null and fall through to the Secret reveal.
  const retainedWsToken = String(
    (agent as { hyperAcpWsToken?: string | null }).hyperAcpWsToken ?? '',
  ).trim() || null;

  let closed = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let historyEndFired = false;
  // One-shot latch for the pre-auth protocol-violation notice (per
  // subscription, so reconnects don't re-report the wedge).
  let preAuthProtocolNoticeFired = false;
  let connectionCounter = 0;
  const isNewFrame = createBuzzActivityDeduper();

  const onAbort = () => close();

  function close(): void {
    if (closed) return;
    closed = true;
    handlers.signal?.removeEventListener('abort', onAbort);
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    const current = ws;
    ws = null;
    if (current) {
      current.onopen = null;
      current.onmessage = null;
      current.onerror = null;
      current.onclose = null;
      try {
        current.close();
      } catch {
        // A socket already closed by the peer needs no local close.
      }
    }
  }

  function deliver(frame: BuzzObserverFrame): void {
    if (!isNewFrame(frame)) return;
    handlers.onFrame(frame);
  }

  function handleMessage(
    data: unknown,
    handshake: { complete(): boolean; markAuthed(): void },
  ): void {
    const raw = typeof data === 'string'
      ? data
      : data instanceof Uint8Array
        ? new TextDecoder().decode(data)
        : '';
    if (!raw) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Malformed wire frames drop silently; they never kill the subscription.
      return;
    }
    if (isPlainRecord(parsed) && parsed.type === 'auth_ok') {
      // First-frame auth accepted; replay follows. Nothing to surface.
      handshake.markAuthed();
      return;
    }
    if (!handshake.complete()) {
      // Before auth_ok a healthy server sends NOTHING. A recognizable
      // protocol message here (replay_end/replay_gap envelope or an
      // observer-shaped frame) is a protocol violation — the signature of a
      // skewed deployment (backend secret present, pod missing the token).
      // Surface exactly one error per subscription; never reset the retry
      // budget, never fire onHistoryEnd, never feed the deduper from this
      // state (so an identical frame arriving post-handshake still
      // delivers, and a wedged stream cannot look healthy via budget
      // resets). The socket stays open: if the pod heals, the stream
      // recovers on its own. Unrecognizable pre-auth noise (non-JSON,
      // unknown JSON) drops silently as before. This is dedup/state
      // hygiene, not client auth enforcement, which the server owns.
      const recognizable = isPlainRecord(parsed) && (
        parsed.type === 'replay_end'
        || parsed.type === 'replay_gap'
        || (typeof parsed.seq === 'number' && typeof parsed.timestamp === 'string')
      );
      if (recognizable && !preAuthProtocolNoticeFired) {
        preAuthProtocolNoticeFired = true;
        handlers.onError?.(
          new Error('hyper-acp endpoint spoke before completing the auth handshake'),
        );
      }
      return;
    }
    if (isPlainRecord(parsed)) {
      if (parsed.type === 'replay_end') {
        // A route that served history is healthy; reset the backoff budget
        // (route analogue of the relay transport's EOSE reset).
        failures = 0;
        if (!historyEndFired) {
          historyEndFired = true;
          handlers.onHistoryEnd?.();
        }
        return;
      }
      if (parsed.type === 'replay_gap') {
        const dropped = typeof parsed.dropped === 'number' ? parsed.dropped : 0;
        handlers.onError?.(new BuzzActivityGapError(dropped));
        return;
      }
    }
    emitObserverPayload(parsed, deliver, () => {
      // Unparseable observer frames drop silently, matching the relay
      // transport; the counter was removed with the old auth flow.
    });
  }

  async function fetchWsToken(): Promise<string> {
    // Prefer the token retained on the already-fetched agent object (the
    // creation result): authoritative, needs no reveal and no epoch guard.
    if (retainedWsToken) return retainedWsToken;
    // Fresh reveal per attempt, no caching: a rotated token is honored
    // without resubscribing. `secret()` APIError (401/403/404) propagates
    // untouched.
    const secretData = await deployments.secret(agentId, BUZZ_ACTIVITY_WS_TOKEN_SECRET);
    const token = String(secretData?.value ?? '').trim();
    if (!token) throw new Error('activity ws token secret is empty');
    if (
      agentLaunchEpoch > 0
      && Number(secretData?.launch_epoch ?? 0) < agentLaunchEpoch
    ) {
      throw new Error('activity ws token belongs to an older launch epoch');
    }
    return token;
  }

  async function connect(): Promise<void> {
    if (closed) return;
    connectionCounter += 1;
    const connection = connectionCounter;

    let token: string;
    try {
      token = await fetchWsToken();
    } catch (error) {
      if (closed || connection !== connectionCounter) return;
      const surfaced = error instanceof Error
        ? error
        : new Error('activity ws token request failed');
      if (connection === 1) {
        // Pre-first-connect: the subscribe promise rejects.
        throw surfaced;
      }
      // Mid-life reconnect: surface, then terminate without retrying.
      handlers.onError?.(surfaced);
      close();
      handlers.onClose?.({ code: 1006, reason: surfaced.message });
      return;
    }
    if (closed || connection !== connectionCounter) return;

    const socket = openBuzzActivityRouteSocket(targetWsUrl);
    ws = socket;
    // Per-connection handshake completion; a 4401 close is terminal only
    // before `auth_ok` (after it, 4401 cannot legitimately arrive).
    let authed = false;

    socket.onopen = () => {
      if (closed || connection !== connectionCounter) return;
      // The first text frame must be the auth frame, within the server's
      // 3s window; the shape is pinned by the wire contract.
      socket.send(JSON.stringify({ type: 'auth', token }));
    };
    socket.onmessage = (message: { data: unknown }) => {
      if (closed || connection !== connectionCounter) return;
      handleMessage(message.data, {
        complete: () => authed,
        markAuthed: () => {
          authed = true;
        },
      });
    };
    socket.onerror = () => {
      if (closed || connection !== connectionCounter) return;
      handlers.onError?.(new Error('Buzz activity route WebSocket error'));
    };
    socket.onclose = (event: { code?: number; reason?: string }) => {
      if (closed || connection !== connectionCounter) return;
      ws = null;
      const code = event?.code ?? 1006;
      const reason = event?.reason ?? '';
      if (code === 4401 && !authed) {
        // The server rejected the token. Terminal: skip the retry loop and
        // report immediately.
        close();
        handlers.onClose?.({ code, reason });
        return;
      }
      fail(code, reason);
    };

    function fail(code?: number, reason = ''): void {
      if (failures >= RECONNECT_DELAYS_MS.length) {
        close();
        handlers.onClose?.({ code: code ?? 1006, reason });
        return;
      }
      const delay = RECONNECT_DELAYS_MS[failures];
      failures += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, delay);
    }
  }

  if (handlers.signal?.aborted) {
    return { close };
  }
  handlers.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    // Await the first attempt's token fetch so empty/404/stale-epoch secrets
    // reject the subscribe promise; everything after the token resolves into
    // the socket retry loop.
    await connect();
  } catch (error) {
    close();
    throw error;
  }
  return { close };
}

export type { BuzzRouteDeploymentsClient };
