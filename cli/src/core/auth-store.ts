/**
 * ~/.hypercli/auth.json — persisted OpenClaw device/pairing artifacts.
 *
 * WHAT IS IN THIS FILE (secret-bearing — treat like ~/.hypercli/config):
 *   - device: the ed25519 device identity (deviceId + public/private key)
 *     the OpenClaw gateway handshake pairs and signs with.
 *   - agents[<agentId>]: the gateway-issued device token for that agent,
 *     its role/scopes/gatewayUrl, and any in-flight (pending) pairing record.
 *
 * WHAT IS NOT IN THIS FILE:
 *   - the account API key (that stays in ~/.hypercli/config, see `hyper configure`),
 *   - OpenClaw gateway tokens (those live server-side as per-agent secrets and
 *     are minted by the start dance in commands/agents.ts),
 *   - chat content or session keys.
 *
 * Why this exists: in Node, the SDK's device-auth store falls back to a
 * per-process in-memory map (ts-sdk openclaw/gateway.ts getStorage reads
 * globalThis.localStorage; no localStorage in Node => pairing artifacts die
 * with the process and every chat re-pairs). installOpenClawAuthBridge()
 * installs a file-backed implementation of the exact duck-typed StorageLike
 * the SDK reads, so pairing survives across CLI invocations. Nothing in the
 * SDK is patched; the bridge only answers the two StorageLike methods
 * (getItem/setItem) the gateway module calls.
 *
 * The SDK store is a single flat object (one device identity, tokens keyed
 * `<agentId>|<role>`); this file keeps the same information in the
 * user-inspectable layout: one top-level `device`, one entry per agent id.
 * The bridge translates between the two shapes on every read/write, so the
 * file and the SDK can never disagree.
 */

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** ts-sdk/src/openclaw/gateway.ts:1455 — the only storage key the gateway uses. */
const SDK_STORAGE_KEY = 'openclaw.device.auth.v1';

export interface AuthStoreDevice {
  deviceId: string;
  publicKey: string;
  privateKey: string;
  createdAtMs?: number;
}

export interface AuthStoreAgentEntry {
  deviceToken?: string;
  role?: string;
  scopes?: string[];
  gatewayUrl?: string;
  updatedAtMs?: number;
  pendingPairing?: Record<string, unknown>;
}

export interface AuthStoreFile {
  version: 1;
  device?: AuthStoreDevice;
  agents?: Record<string, AuthStoreAgentEntry>;
}

/** The SDK's internal flat shape (openclaw/gateway.ts DeviceAuthStore). */
interface SdkDeviceAuthStore {
  version: 1;
  deviceId?: string;
  publicKey?: string;
  privateKey?: string;
  createdAtMs?: number;
  tokens?: Record<
    string,
    { token: string; role: string; scopes: string[]; updatedAtMs: number; gatewayUrl?: string }
  >;
  pendingPairings?: Record<string, Record<string, unknown>>;
}

export function authStorePath(): string {
  return join(homedir(), '.hypercli', 'auth.json');
}

/**
 * Read the store. A missing file is an empty store; a corrupt file is moved
 * aside to `<path>.corrupt-<epoch>` (best-effort) so a bad write can never
 * wedge every later chat, and reading starts empty.
 */
export function readAuthStore(path = authStorePath()): AuthStoreFile {
  if (!existsSync(path)) return { version: 1 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    try {
      copyFileSync(path, `${path}.corrupt-${Date.now()}`);
    } catch {
      // Best-effort backup only; an unreadable file just means an empty store.
    }
    return { version: 1 };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { version: 1 };
  const record = parsed as Partial<AuthStoreFile>;
  return {
    version: 1,
    ...(record.device && typeof record.device === 'object' ? { device: record.device } : {}),
    ...(record.agents && typeof record.agents === 'object' && !Array.isArray(record.agents)
      ? { agents: record.agents }
      : {}),
  };
}

/**
 * Write the store atomically (tmp file + rename) with 0600 perms, mirroring
 * ts-sdk/src/config.ts saveConfig (chmodSync errors ignored — Windows).
 */
export function writeAuthStore(store: AuthStoreFile, path = authStorePath()): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    // Ignore permission errors (Windows doesn't support chmod).
  }
}

/** Merge one agent's entry read-modify-write style. */
export function updateAuthStoreAgent(
  agentId: string,
  patch: AuthStoreAgentEntry,
  path = authStorePath(),
): AuthStoreFile {
  const store = readAuthStore(path);
  const agents = { ...(store.agents ?? {}) };
  agents[agentId] = { ...(agents[agentId] ?? {}), ...patch };
  const next: AuthStoreFile = { ...store, agents };
  writeAuthStore(next, path);
  return next;
}

// ---------------------------------------------------------------------------
// auth.json <-> SDK DeviceAuthStore translation
// ---------------------------------------------------------------------------

function tokenScopeAgent(scopeKey: string): string {
  // SDK token keys are `${scope}|${role}` where scope is the deployment id.
  const pipe = scopeKey.lastIndexOf('|');
  return pipe < 0 ? scopeKey : scopeKey.slice(0, pipe);
}

function sdkStoreToFile(store: SdkDeviceAuthStore): AuthStoreFile {
  const file: AuthStoreFile = { version: 1 };
  if (store.deviceId && store.publicKey && store.privateKey) {
    file.device = {
      deviceId: store.deviceId,
      publicKey: store.publicKey,
      privateKey: store.privateKey,
      ...(typeof store.createdAtMs === 'number' ? { createdAtMs: store.createdAtMs } : {}),
    };
  }
  const agents: Record<string, AuthStoreAgentEntry> = {};
  for (const [scopeKey, entry] of Object.entries(store.tokens ?? {})) {
    agents[tokenScopeAgent(scopeKey)] = {
      deviceToken: entry.token,
      role: entry.role,
      scopes: entry.scopes,
      updatedAtMs: entry.updatedAtMs,
      ...(entry.gatewayUrl ? { gatewayUrl: entry.gatewayUrl } : {}),
    };
  }
  for (const [scopeKey, pairing] of Object.entries(store.pendingPairings ?? {})) {
    const agentId = tokenScopeAgent(scopeKey);
    agents[agentId] = { ...(agents[agentId] ?? {}), pendingPairing: pairing };
  }
  if (Object.keys(agents).length > 0) file.agents = agents;
  return file;
}

function fileToSdkStore(file: AuthStoreFile): SdkDeviceAuthStore {
  const store: SdkDeviceAuthStore = { version: 1 };
  if (file.device) {
    store.deviceId = file.device.deviceId;
    store.publicKey = file.device.publicKey;
    store.privateKey = file.device.privateKey;
    if (typeof file.device.createdAtMs === 'number') store.createdAtMs = file.device.createdAtMs;
  }
  const tokens: SdkDeviceAuthStore['tokens'] = {};
  const pendingPairings: SdkDeviceAuthStore['pendingPairings'] = {};
  for (const [agentId, entry] of Object.entries(file.agents ?? {})) {
    const role = entry.role ?? 'operator';
    const scopeKey = `${agentId}|${role}`;
    if (typeof entry.deviceToken === 'string' && entry.deviceToken) {
      tokens[scopeKey] = {
        token: entry.deviceToken,
        role,
        scopes: entry.scopes ?? [],
        updatedAtMs: entry.updatedAtMs ?? 0,
        ...(entry.gatewayUrl ? { gatewayUrl: entry.gatewayUrl } : {}),
      };
    }
    if (entry.pendingPairing) pendingPairings[scopeKey] = entry.pendingPairing;
  }
  if (Object.keys(tokens).length > 0) store.tokens = tokens;
  if (Object.keys(pendingPairings).length > 0) store.pendingPairings = pendingPairings;
  return store;
}

// ---------------------------------------------------------------------------
// the bridge
// ---------------------------------------------------------------------------

const BRIDGE_MARKER = Symbol.for('hypercli.openclawAuthBridge');
const strayKeys = new Map<string, string>();

/**
 * Install the file-backed StorageLike the SDK's openclaw gateway reads via
 * globalThis.localStorage (its declared storage seam). Idempotent process-wide.
 * Only the SDK's auth key is persisted to ~/.hypercli/auth.json; any other key
 * a future SDK writes stays in memory (mirroring today's Node behavior).
 */
export function installOpenClawAuthBridge(path = authStorePath()): void {
  // The SDK reads a minimal duck-typed StorageLike off the global
  // (gateway.ts:2732); the DOM `Storage` type of globalThis.localStorage is
  // wider, so the assignment goes through unknown.
  const globalStore = globalThis as typeof globalThis & {
    [BRIDGE_MARKER]?: string;
  };
  // Idempotent per backing path: same path is a no-op, a different path
  // (tests with a redirected HOME) re-points the bridge.
  if (globalStore[BRIDGE_MARKER] === path) return;
  const storageLike = {
    getItem(key: string): string | null {
      if (key !== SDK_STORAGE_KEY) return strayKeys.get(key) ?? null;
      const file = readAuthStore(path);
      if (!file.device && !file.agents) return null;
      return JSON.stringify(fileToSdkStore(file));
    },
    setItem(key: string, value: string): void {
      if (key !== SDK_STORAGE_KEY) {
        strayKeys.set(key, value);
        return;
      }
      let parsed: SdkDeviceAuthStore;
      try {
        parsed = JSON.parse(value) as SdkDeviceAuthStore;
      } catch {
        return; // Never let a malformed SDK write destroy the file.
      }
      writeAuthStore(sdkStoreToFile(parsed), path);
    },
  };
  (globalThis as unknown as { localStorage: typeof storageLike }).localStorage = storageLike;
  globalStore[BRIDGE_MARKER] = path;
}
