import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { extract as hkdfExtract, expand as hkdfExpand } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { chacha20 } from '@noble/ciphers/chacha.js';
import { base64, bech32 } from '@scure/base';
import {
  subscribeBuzzActivity,
  resolveBuzzOwnerFromEnv,
  buzzConversationKey,
  buzzPublicKeyHex,
  decodeBuzzSecret,
  decryptBuzzPayload,
  BUZZ_OBSERVER_EVENT_KIND,
  type BuzzObserverFrame,
} from '../src/buzz-activity.js';
import type { Deployments } from '../src/agents.js';

/**
 * Test-side NIP-44 v2 encryption, mirroring src/buzz-activity.ts primitives.
 * Only the 2-byte-prefix path: observer frames are small JSON.
 */
function calcPaddedLen(len: number): number {
  if (len <= 32) return 32;
  const nextPower = 2 ** (Math.floor(Math.log2(len - 1)) + 1);
  const chunk = nextPower <= 256 ? 32 : nextPower / 8;
  return chunk * (Math.floor((len - 1) / chunk) + 1);
}

function _encryptForTest(
  conversationKey: Uint8Array,
  plaintext: string,
  nonce: Uint8Array = secp256k1.utils.randomSecretKey(),
): string {
  const encoded = utf8ToBytes(plaintext);
  const prefix = new Uint8Array(2);
  new DataView(prefix.buffer).setUint16(0, encoded.length, false);
  const padded = concatBytes(prefix, encoded, new Uint8Array(calcPaddedLen(encoded.length) - encoded.length));
  const keys = hkdfExpand(sha256, conversationKey, nonce, 76);
  const ciphertext = chacha20(keys.subarray(0, 32), keys.subarray(32, 44), padded);
  const mac = hmac(sha256, keys.subarray(44, 76), concatBytes(nonce, ciphertext));
  return base64.encode(concatBytes(new Uint8Array([2]), nonce, ciphertext, mac));
}

function nsecEncode(secret: Uint8Array): string {
  return bech32.encode('nsec', bech32.toWords(secret));
}

const OWNER_SECRET_HEX = '11'.repeat(32);
const AGENT_SECRET_HEX = '22'.repeat(32);
const OWNER_SECRET = hexToBytes(OWNER_SECRET_HEX);
const AGENT_SECRET = hexToBytes(AGENT_SECRET_HEX);
const OWNER_PUB_HEX = buzzPublicKeyHex(OWNER_SECRET);
const AGENT_PUB_HEX = buzzPublicKeyHex(AGENT_SECRET);

function conversationKey(): Uint8Array {
  return buzzConversationKey(AGENT_SECRET, OWNER_PUB_HEX);
}

function buzzEvent(content: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '00'.repeat(32),
    pubkey: AGENT_PUB_HEX,
    kind: BUZZ_OBSERVER_EVENT_KIND,
    created_at: Math.floor(Date.now() / 1_000),
    tags: [
      ['p', OWNER_PUB_HEX],
      ['agent', AGENT_PUB_HEX],
      ['frame', 'telemetry'],
    ],
    content,
    sig: '11'.repeat(64),
    ...overrides,
  };
}

function frameJson(seq: number, timestamp: string, kind = 'acp_read', extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    seq,
    timestamp,
    kind,
    agentIndex: 0,
    channelId: 'channel-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    payload: { direction: 'read' },
    ...extra,
  });
}

/**
 * A relay socket the test drives by hand, mirroring the agent-logs harness:
 * delivery is explicit so ordering relative to handler attachment stays
 * deterministic.
 */
class ControllableWebSocket {
  public static instances: ControllableWebSocket[] = [];
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onerror: (() => void) | null = null;
  public onclose: ((event: { code: number; reason: string }) => void) | null = null;
  public sent: string[] = [];
  public close = vi.fn();

  constructor(public readonly url: string) {
    ControllableWebSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }

  send(data: string) {
    this.sent.push(data);
  }

  emit(frame: unknown) {
    this.onmessage?.({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) });
  }

  end(code = 1006, reason = '') {
    this.onclose?.({ code, reason });
  }

  reqFilter(): Record<string, unknown> {
    const req = this.sent.map((raw) => JSON.parse(raw)).find((msg) => msg[0] === 'REQ');
    return req[2] as Record<string, unknown>;
  }
}

function buzzDeployments(launchConfigEnv: Record<string, unknown> | null) {
  const get = vi.fn().mockResolvedValue({
    id: 'agent-1',
    launchConfig: launchConfigEnv ? { env: launchConfigEnv } : null,
  });
  const secret = vi.fn().mockResolvedValue({
    agent_id: 'agent-1',
    key: 'BUZZ_PRIVATE_KEY',
    value: AGENT_SECRET_HEX,
    launch_epoch: 1,
  });
  const deployments = { get, secret } as unknown as Pick<Deployments, 'get' | 'secret'>;
  return { deployments, get, secret };
}

const VALID_ENV = {
  BUZZ_RELAY_URL: 'wss://relay.example.com',
  BUZZ_AUTH_TAG: JSON.stringify(['auth', OWNER_PUB_HEX, '', 'sig']),
};

async function flushMicrotasks(times = 5): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

describe('decodeBuzzSecret', () => {
  it('accepts raw 64-hex and nsec bech32 for the same key', () => {
    const fromHex = decodeBuzzSecret(AGENT_SECRET_HEX);
    const fromNsec = decodeBuzzSecret(nsecEncode(AGENT_SECRET));
    const fromBytes = decodeBuzzSecret(AGENT_SECRET);
    expect(bytesToHex(fromHex)).toBe(AGENT_SECRET_HEX);
    expect(bytesToHex(fromNsec)).toBe(AGENT_SECRET_HEX);
    expect(bytesToHex(fromBytes)).toBe(AGENT_SECRET_HEX);
  });

  it('rejects malformed secrets', () => {
    expect(() => decodeBuzzSecret('not-a-key')).toThrow();
    expect(() => decodeBuzzSecret('00'.repeat(32))).toThrow();
    expect(() => decodeBuzzSecret(new Uint8Array(31))).toThrow();
    expect(() => decodeBuzzSecret(bech32.encode('npub', bech32.toWords(AGENT_SECRET)))).toThrow();
  });
});

describe('NIP-44 v2 official vectors', () => {
  // From the published nip44.vectors.json (v2.valid).
  const vectors = [
    {
      sec1: '0000000000000000000000000000000000000000000000000000000000000001',
      sec2: '0000000000000000000000000000000000000000000000000000000000000002',
      conversationKey: 'c41c775356fd92eadc63ff5a0dc1da211b268cbea22316767095b2871ea1412d',
      plaintext: 'a',
      payload:
        'AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABee0G5VSK0/9YypIObAtDKfYEAjD35uVkHyB0F4DwrcNaCXlCWZKaArsGrY6M9wnuTMxWfp1RTN9Xga8no+kF5Vsb',
    },
    {
      sec1: '0000000000000000000000000000000000000000000000000000000000000002',
      sec2: '0000000000000000000000000000000000000000000000000000000000000001',
      conversationKey: 'c41c775356fd92eadc63ff5a0dc1da211b268cbea22316767095b2871ea1412d',
      plaintext: '\u{1F355}\u{1FAC3}',
      payload:
        'AvAAAAAAAAAAAAAAAAAAAPAAAAAAAAAAAAAAAAAAAAAPSKSK6is9ngkX2+cSq85Th16oRTISAOfhStnixqZziKMDvB0QQzgFZdjLTPicCJaV8nDITO+QfaQ61+KbWQIOO2Yj',
    },
    {
      sec1: '5c0c523f52a5b6fad39ed2403092df8cebc36318b39383bca6c00808626fab3a',
      sec2: '4b22aa260e4acb7021e32f38a6cdf4b673c6a277755bfce287e370c924dc936d',
      conversationKey: '3e2b52a63be47d34fe0a80e34e73d436d6963bc8f39827f327057a9986c20a45',
      plaintext: '表ポあA鷗ŒéＢ逍Üßªąñ丂㐀𠀀',
      payload:
        'ArY1I2xC2yDwIbuNHN/1ynXdGgzHLqdCrXUPMwELJPc7s7JqlCMJBAIIjfkpHReBPXeoMCyuClwgbT419jUWU1PwaNl4FEQYKCDKVJz+97Mp3K+Q2YGa77B6gpxB/lr1QgoqpDf7wDVrDmOqGoiPjWDqy8KzLueKDcm9BVP8xeTJIxs=',
    },
  ];

  it('derives the published conversation keys and decrypts the payloads', () => {
    for (const vector of vectors) {
      const peerPub = buzzPublicKeyHex(hexToBytes(vector.sec2));
      const key = buzzConversationKey(hexToBytes(vector.sec1), peerPub);
      expect(bytesToHex(key)).toBe(vector.conversationKey);
      expect(decryptBuzzPayload(key, vector.payload)).toBe(vector.plaintext);
    }
  });

  it('matches the published get_conversation_key vector', () => {
    const key = buzzConversationKey(
      hexToBytes('315e59ff51cb9209768cf7da80791ddcaae56ac9775eb25b6dee1234bc5d2268'),
      'c2f9d9948dc8c7c38321e4b85c8558872eafa0641cd269db76848a6073e69133',
    );
    expect(bytesToHex(key)).toBe('3dfef0ce2a4d80a25e7a328accf73448ef67096f65f79588e358d9a0eb9013f1');
  });

  it('rejects tampered MAC, version, and length', () => {
    const key = conversationKey();
    const good = _encryptForTest(key, frameJson(1, '2026-08-25T00:00:00Z'));
    expect(decryptBuzzPayload(key, good)).toContain('"seq":1');

    const decoded = base64.decode(good);
    const badMac = new Uint8Array(decoded);
    badMac[badMac.length - 1] ^= 0xff;
    expect(() => decryptBuzzPayload(key, base64.encode(badMac))).toThrow(/MAC/);

    const badVersion = new Uint8Array(decoded);
    badVersion[0] = 3;
    expect(() => decryptBuzzPayload(key, base64.encode(badVersion))).toThrow(/version/);

    const badCiphertext = new Uint8Array(decoded);
    badCiphertext[40] ^= 0xff;
    expect(() => decryptBuzzPayload(key, base64.encode(badCiphertext))).toThrow(/MAC/);

    expect(() => decryptBuzzPayload(key, base64.encode(decoded.subarray(0, 50)))).toThrow(/length/);
    expect(() => decryptBuzzPayload(key, '!!!not-base64!!!')).toThrow();
    expect(() => decryptBuzzPayload(hexToBytes('ff'.repeat(32)), good)).toThrow();
  });
});

describe('conversation key equivalence', () => {
  it('owner-nsec and agent-hex modes derive the identical key and decrypt the same frame', () => {
    const asOwner = buzzConversationKey(decodeBuzzSecret(nsecEncode(OWNER_SECRET)), AGENT_PUB_HEX);
    const asAgent = buzzConversationKey(decodeBuzzSecret(AGENT_SECRET_HEX), OWNER_PUB_HEX);
    expect(bytesToHex(asOwner)).toBe(bytesToHex(asAgent));

    const frame = frameJson(7, '2026-08-25T01:02:03Z');
    const payload = _encryptForTest(asAgent, frame);
    expect(decryptBuzzPayload(asOwner, payload)).toBe(frame);
    expect(decryptBuzzPayload(asAgent, payload)).toBe(frame);
  });

  it('test-side encryption round-trips through the module decrypt', () => {
    const key = conversationKey();
    const extracted = hkdfExtract(sha256, new Uint8Array(32), utf8ToBytes('nip44-v2'));
    expect(extracted.length).toBe(32);
    expect(decryptBuzzPayload(key, _encryptForTest(key, '{"hello":"world"}'))).toBe('{"hello":"world"}');
  });
});

describe('resolveBuzzOwnerFromEnv', () => {
  it('parses the owner pubkey from BUZZ_AUTH_TAG element [1]', () => {
    const resolved = resolveBuzzOwnerFromEnv(VALID_ENV);
    expect(resolved.relayUrl).toBe('wss://relay.example.com');
    expect(resolved.ownerPubHex).toBe(OWNER_PUB_HEX);
  });

  it('falls back to BUZZ_ACP_AGENT_OWNER when the auth tag is absent or malformed', () => {
    const fallbackEnv = {
      BUZZ_RELAY_URL: 'wss://relay.example.com',
      BUZZ_ACP_AGENT_OWNER: OWNER_PUB_HEX,
    };
    expect(resolveBuzzOwnerFromEnv(fallbackEnv).ownerPubHex).toBe(OWNER_PUB_HEX);
    expect(
      resolveBuzzOwnerFromEnv({ ...fallbackEnv, BUZZ_AUTH_TAG: 'not json' }).ownerPubHex,
    ).toBe(OWNER_PUB_HEX);
    expect(
      resolveBuzzOwnerFromEnv({ ...fallbackEnv, BUZZ_AUTH_TAG: JSON.stringify(['auth', 'zz', '', 'sig']) }).ownerPubHex,
    ).toBe(OWNER_PUB_HEX);
  });

  it('throws the not-Buzz-backed error when no relay URL is present', () => {
    expect(() => resolveBuzzOwnerFromEnv({})).toThrow(/not Buzz-backed/);
    expect(() => resolveBuzzOwnerFromEnv({ BUZZ_AUTH_TAG: VALID_ENV.BUZZ_AUTH_TAG })).toThrow(/not Buzz-backed/);
  });

  it('throws when neither owner source yields a valid pubkey', () => {
    expect(() =>
      resolveBuzzOwnerFromEnv({ BUZZ_RELAY_URL: 'wss://relay.example.com' }),
    ).toThrow(/owner pubkey/);
    expect(() =>
      resolveBuzzOwnerFromEnv({
        BUZZ_RELAY_URL: 'wss://relay.example.com',
        BUZZ_AUTH_TAG: JSON.stringify(['notauth', OWNER_PUB_HEX]),
        BUZZ_ACP_AGENT_OWNER: 'too-short',
      }),
    ).toThrow(/owner pubkey/);
  });
});

describe('subscribeBuzzActivity', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    ControllableWebSocket.instances = [];
    vi.stubGlobal('WebSocket', ControllableWebSocket as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function connectSubscription(env: Record<string, unknown> = VALID_ENV) {
    const { deployments, secret } = buzzDeployments(env);
    const frames: BuzzObserverFrame[] = [];
    const errors: Error[] = [];
    const closes: Array<{ code: number; reason: string }> = [];
    let historyEnds = 0;
    const subscription = await subscribeBuzzActivity(deployments, 'agent-1', {
      onFrame: (frame) => frames.push(frame),
      onHistoryEnd: () => {
        historyEnds += 1;
      },
      onClose: (event) => closes.push(event),
      onError: (error) => errors.push(error),
    });
    await flushMicrotasks();
    const socket = ControllableWebSocket.instances[0];
    return { subscription, socket, frames, errors, closes, secret, historyEnds: () => historyEnds };
  }

  it('rejects a non-Buzz agent with a clear error', async () => {
    const { deployments } = buzzDeployments({ SOME_OTHER_ENV: 'x' });
    await expect(subscribeBuzzActivity(deployments, 'agent-1', { onFrame: () => undefined }))
      .rejects.toThrow(/not Buzz-backed/);
  });

  it('rejects when the agent carries no launch config at all', async () => {
    const { deployments } = buzzDeployments(null);
    await expect(subscribeBuzzActivity(deployments, 'agent-1', { onFrame: () => undefined }))
      .rejects.toThrow(/not Buzz-backed/);
  });

  it('sends a REQ for kind 24200 with authors/#p filters, history lookback, and limit', async () => {
    const { socket, secret, subscription } = await connectSubscription();
    expect(socket.url).toBe('wss://relay.example.com');
    // The agent key is revealed even though no owner key was supplied.
    expect(secret).toHaveBeenCalledWith('agent-1', 'BUZZ_PRIVATE_KEY');
    const filter = socket.reqFilter();
    expect(filter.kinds).toEqual([BUZZ_OBSERVER_EVENT_KIND]);
    expect(filter.authors).toEqual([AGENT_PUB_HEX]);
    expect(filter['#p']).toEqual([OWNER_PUB_HEX]);
    expect(filter.limit).toBe(500);
    const expectedSince = Math.floor(Date.now() / 1_000) - 86_400;
    expect(Math.abs((filter.since as number) - expectedSince)).toBeLessThan(5);
    subscription.close();
  });

  it('reveals the agent key even when the caller supplies the owner key', async () => {
    const { deployments, secret } = buzzDeployments(VALID_ENV);
    const frames: BuzzObserverFrame[] = [];
    const subscription = await subscribeBuzzActivity(deployments, 'agent-1', {
      onFrame: (frame) => frames.push(frame),
      ownerSecretKey: nsecEncode(OWNER_SECRET),
    });
    await flushMicrotasks();
    expect(secret).toHaveBeenCalledWith('agent-1', 'BUZZ_PRIVATE_KEY');
    const socket = ControllableWebSocket.instances[0];
    socket.emit(['EVENT', 'buzz-activity-1', buzzEvent(_encryptForTest(conversationKey(), frameJson(1, '2026-08-25T00:00:01Z')))]);
    expect(frames).toHaveLength(1);
    expect(frames[0].seq).toBe(1);
    subscription.close();
  });

  it('streams history then live frames, firing onHistoryEnd exactly once', async () => {
    const { socket, frames, historyEnds, subscription } = await connectSubscription();
    const key = conversationKey();
    socket.emit(['EVENT', 'buzz-activity-1', buzzEvent(_encryptForTest(key, frameJson(1, '2026-08-25T00:00:01Z')))]);
    socket.emit(['EVENT', 'buzz-activity-1', buzzEvent(_encryptForTest(key, frameJson(2, '2026-08-25T00:00:02Z')))]);
    socket.emit(['EVENT', 'buzz-activity-1', buzzEvent(_encryptForTest(key, frameJson(3, '2026-08-25T00:00:03Z')))]);
    socket.emit(['EOSE', 'buzz-activity-1']);
    socket.emit(['EOSE', 'buzz-activity-1']);
    socket.emit(['EVENT', 'buzz-activity-1', buzzEvent(_encryptForTest(key, frameJson(4, '2026-08-25T00:00:04Z')))]);
    expect(frames.map((frame) => frame.seq)).toEqual([1, 2, 3, 4]);
    expect(historyEnds()).toBe(1);
    expect(frames[0].channelId).toBe('channel-1');
    expect(frames[0].startedAt).toBeUndefined();
    subscription.close();
  });

  it('silently drops forged senders, wrong kinds, and missing tags', async () => {
    const { socket, frames, subscription } = await connectSubscription();
    const key = conversationKey();
    const valid = _encryptForTest(key, frameJson(1, '2026-08-25T00:00:01Z'));
    const foreignPub = buzzPublicKeyHex(hexToBytes('33'.repeat(32)));
    socket.emit(['EVENT', 'buzz-activity-1', buzzEvent(valid, { pubkey: foreignPub })]);
    socket.emit(['EVENT', 'buzz-activity-1', buzzEvent(valid, { kind: 4 })]);
    socket.emit(['EVENT', 'buzz-activity-1', buzzEvent(valid, { tags: [['p', OWNER_PUB_HEX], ['frame', 'telemetry']] })]);
    socket.emit(['EVENT', 'buzz-activity-1', buzzEvent(valid, { tags: [['p', OWNER_PUB_HEX], ['agent', AGENT_PUB_HEX]] })]);
    socket.emit(['EVENT', 'buzz-activity-1', buzzEvent('garbage-not-nip44')]);
    socket.emit(['EVENT', 'buzz-activity-1', buzzEvent(valid)]);
    expect(frames.map((frame) => frame.seq)).toEqual([1]);
    subscription.close();
  });

  it('ignores events for other subscription ids', async () => {
    const { socket, frames, subscription } = await connectSubscription();
    const key = conversationKey();
    socket.emit(['EVENT', 'someone-else', buzzEvent(_encryptForTest(key, frameJson(1, '2026-08-25T00:00:01Z')))]);
    expect(frames).toHaveLength(0);
    subscription.close();
  });

  it('unwraps batch envelopes and dedups history/live overlap', async () => {
    const { socket, frames, subscription } = await connectSubscription();
    const key = conversationKey();
    const batch = JSON.stringify({
      seq: 90,
      timestamp: '2026-08-25T00:00:09Z',
      kind: 'batch',
      agentIndex: null,
      channelId: null,
      sessionId: null,
      turnId: null,
      payload: {
        events: [
          JSON.parse(frameJson(1, '2026-08-25T00:00:01Z')),
          JSON.parse(frameJson(2, '2026-08-25T00:00:02Z')),
        ],
      },
    });
    socket.emit(['EVENT', 'buzz-activity-1', buzzEvent(_encryptForTest(key, batch))]);
    socket.emit(['EOSE', 'buzz-activity-1']);
    // Live overlap: seq 2 replays, seq 3 is new.
    socket.emit(['EVENT', 'buzz-activity-1', buzzEvent(_encryptForTest(key, frameJson(2, '2026-08-25T00:00:02Z')))]);
    socket.emit(['EVENT', 'buzz-activity-1', buzzEvent(_encryptForTest(key, frameJson(3, '2026-08-25T00:00:03Z')))]);
    expect(frames.map((frame) => frame.seq)).toEqual([1, 2, 3]);
    subscription.close();
  });

  it('emits a malformed batch envelope as-is', async () => {
    const { socket, frames, subscription } = await connectSubscription();
    const key = conversationKey();
    const malformed = JSON.stringify({
      seq: 5,
      timestamp: '2026-08-25T00:00:05Z',
      kind: 'batch',
      agentIndex: null,
      channelId: null,
      sessionId: null,
      turnId: null,
      payload: { note: 'no events array here' },
    });
    socket.emit(['EVENT', 'buzz-activity-1', buzzEvent(_encryptForTest(key, malformed))]);
    expect(frames).toHaveLength(1);
    expect(frames[0].kind).toBe('batch');
    expect(frames[0].seq).toBe(5);
    subscription.close();
  });

  it('survives undecryptable and unparseable frames without killing the subscription', async () => {
    const { socket, frames, errors, subscription } = await connectSubscription();
    const key = conversationKey();
    const wrongKey = buzzConversationKey(hexToBytes('44'.repeat(32)), OWNER_PUB_HEX);
    socket.emit(['EVENT', 'buzz-activity-1', buzzEvent(_encryptForTest(wrongKey, frameJson(99, '2026-08-25T00:00:09Z')))]);
    socket.emit(['EVENT', 'buzz-activity-1', buzzEvent(_encryptForTest(key, 'not json at all'))]);
    socket.emit(['NOTICE', 'relay is grumpy']);
    socket.emit(['EVENT', 'buzz-activity-1', buzzEvent(_encryptForTest(key, frameJson(1, '2026-08-25T00:00:01Z')))]);
    expect(frames.map((frame) => frame.seq)).toEqual([1]);
    expect(errors.some((error) => error.message.includes('relay is grumpy'))).toBe(true);
    subscription.close();
  });

  it('reconnects after relay close and re-REQs from the last accepted frame', async () => {
    const { frames, subscription } = await connectSubscription();
    const key = conversationKey();
    const first = ControllableWebSocket.instances[0];
    first.emit(['EVENT', 'buzz-activity-1', buzzEvent(_encryptForTest(key, frameJson(1, '2026-08-25T00:00:11.500Z')))]);
    first.emit(['EOSE', 'buzz-activity-1']);
    first.end(1006, 'relay restart');
    await new Promise((resolve) => setTimeout(resolve, 1_300));
    expect(ControllableWebSocket.instances).toHaveLength(2);
    const second = ControllableWebSocket.instances[1];
    const filter = second.reqFilter();
    expect(filter.since).toBe(Math.floor(Date.parse('2026-08-25T00:00:11.500Z') / 1_000));
    second.emit(['EOSE', 'buzz-activity-2']);
    second.emit(['EVENT', 'buzz-activity-2', buzzEvent(_encryptForTest(key, frameJson(2, '2026-08-25T00:00:12Z')))]);
    expect(frames.map((frame) => frame.seq)).toEqual([1, 2]);
    subscription.close();
    second.end(1006);
    expect(ControllableWebSocket.instances).toHaveLength(2);
  }, 10_000);

  it('gives up with onClose after the bounded reconnect budget is spent', async () => {
    const { closes, subscription } = await connectSubscription();
    ControllableWebSocket.instances[0].end(1006, 'down');
    await new Promise((resolve) => setTimeout(resolve, 1_300));
    expect(ControllableWebSocket.instances).toHaveLength(2);
    ControllableWebSocket.instances[1].end(1006, 'down');
    await new Promise((resolve) => setTimeout(resolve, 2_300));
    expect(ControllableWebSocket.instances).toHaveLength(3);
    ControllableWebSocket.instances[2].end(1006, 'down for good');
    await new Promise((resolve) => setTimeout(resolve, 4_300));
    expect(ControllableWebSocket.instances).toHaveLength(4);
    ControllableWebSocket.instances[3].end(1006, 'still down');
    await flushMicrotasks();
    expect(closes).toHaveLength(1);
    expect(closes[0].reason).toBe('still down');
    subscription.close();
    await new Promise((resolve) => setTimeout(resolve, 4_300));
    expect(ControllableWebSocket.instances).toHaveLength(4);
  }, 20_000);

  it('tears down on close() and AbortSignal without further activity', async () => {
    const { socket, subscription } = await connectSubscription();
    subscription.close();
    expect(socket.close).toHaveBeenCalled();
    socket.end(1006);
    await new Promise((resolve) => setTimeout(resolve, 1_300));
    expect(ControllableWebSocket.instances).toHaveLength(1);

    const controller = new AbortController();
    const { deployments } = buzzDeployments(VALID_ENV);
    const frames: BuzzObserverFrame[] = [];
    const second = await subscribeBuzzActivity(deployments, 'agent-1', {
      onFrame: (frame) => frames.push(frame),
      signal: controller.signal,
    });
    await flushMicrotasks();
    controller.abort();
    const abortedSocket = ControllableWebSocket.instances[1];
    expect(abortedSocket.close).toHaveBeenCalled();
    abortedSocket.emit(['EVENT', 'buzz-activity-1', buzzEvent(_encryptForTest(conversationKey(), frameJson(1, '2026-08-25T00:00:01Z')))]);
    expect(frames).toHaveLength(0);
    second.close();
  }, 10_000);
});
