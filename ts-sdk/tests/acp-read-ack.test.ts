import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import {
  ACP_READ_ACK_METHOD,
  ACP_READ_ACK_META_KEY,
  CodingAgentAcpClient,
  CodingAgentAcpReadAckError,
} from '../src/acp.js';

interface WireFrame {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * Loopback stand-in for the backend ACP proxy's client-facing socket: answers
 * `initialize` + the `_hypercli.dev/session_read_ack` request exactly like the
 * proxy contract (GREATEST cursor under the row lock; `persisted: true`), and
 * pushes `session/update` notifications carrying the store-seq `_meta`
 * annotation the ack tracker consumes.
 */
class FakeAcpProxy {
  public readonly peer: { frames: WireFrame[]; ackRequests: WireFrame[] } = { frames: [], ackRequests: [] };
  public cursor = 0;
  public failAcks = false;
  private socket: WsSocket | null = null;
  private seq = 0;
  private wss: WebSocketServer | null = null;

  get url(): string {
    if (!this.wss) throw new Error('proxy not started');
    return `ws://127.0.0.1:${(this.wss.address() as AddressInfo).port}/ws/acp`;
  }

  async start(): Promise<this> {
    this.wss = new WebSocketServer({ port: 0 });
    this.wss.on('connection', (socket) => {
      this.socket = socket;
      socket.on('message', (data: Buffer) => this.handle(JSON.parse(data.toString()) as WireFrame));
    });
    await new Promise<void>((resolve) => this.wss!.once('listening', resolve));
    return this;
  }

  async close(): Promise<void> {
    this.socket?.terminate();
    await new Promise<void>((resolve) => (this.wss ? this.wss.close(() => resolve()) : resolve()));
    this.wss = null;
  }

  private handle(frame: WireFrame): void {
    this.peer.frames.push(frame);
    if (frame.id === undefined || frame.method === undefined) return;
    if (frame.method === 'initialize') {
      this.send({ jsonrpc: '2.0', id: frame.id, result: { protocolVersion: 1, agentCapabilities: {} } });
      return;
    }
    if (frame.method === ACP_READ_ACK_METHOD) {
      this.peer.ackRequests.push(frame);
      if (this.failAcks) {
        this.send({ jsonrpc: '2.0', id: frame.id, error: { code: -32603, message: 'store down' } });
        return;
      }
      const seq = Number(frame.params?.seq);
      this.cursor = Math.max(this.cursor, seq);
      this.send({ jsonrpc: '2.0', id: frame.id, result: { sessionId: frame.params?.sessionId, cursor: this.cursor, persisted: true } });
      return;
    }
    this.send({ jsonrpc: '2.0', id: frame.id, error: { code: -32601, message: `method not found: ${frame.method}` } });
  }

  private send(frame: WireFrame): void {
    this.socket?.send(JSON.stringify(frame));
  }

  /** One persisted-and-teed frame with the next annotated store seq (or an explicit one for gap tests). */
  pushUpdate(sessionId: string, text: string, seq?: number, annotate = true): number {
    this.seq = seq ?? this.seq + 1;
    const params: Record<string, unknown> = {
      sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
    };
    if (annotate) params._meta = { [ACP_READ_ACK_META_KEY]: { seq: this.seq } };
    this.send({ jsonrpc: '2.0', method: 'session/update', params });
    return this.seq;
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for condition');
}

const proxies: FakeAcpProxy[] = [];
const clients: CodingAgentAcpClient[] = [];

async function startProxy(): Promise<FakeAcpProxy> {
  const proxy = await new FakeAcpProxy().start();
  proxies.push(proxy);
  return proxy;
}

async function connect(proxy: FakeAcpProxy, options: Parameters<typeof CodingAgentAcpClient.connect>[1] = {}): Promise<CodingAgentAcpClient> {
  const client = await CodingAgentAcpClient.connect({ url: proxy.url, token: '' }, options);
  clients.push(client);
  return client;
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const proxy of proxies.splice(0)) await proxy.close();
});

describe('read-ack delivery tracking', () => {
  it('tracks the seq annotation and ignores unannotated frames', async () => {
    const proxy = await startProxy();
    const client = await connect(proxy);
    expect(client.readAckState('sess')).toEqual({ latestSeq: 0, ackedSeq: 0, gaps: 0 });

    proxy.pushUpdate('sess', 'one');
    await waitFor(() => client.readAckState('sess').latestSeq === 1);
    proxy.pushUpdate('sess', 'legacy direct-bridge frame', undefined, false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.readAckState('sess')).toEqual({ latestSeq: 1, ackedSeq: 0, gaps: 0 });
    expect(proxy.peer.ackRequests).toEqual([]);
  });

  it('counts forward seq jumps as delivery gaps', async () => {
    const proxy = await startProxy();
    const client = await connect(proxy);
    proxy.pushUpdate('sess', 'one');
    await waitFor(() => client.readAckState('sess').latestSeq === 1);
    proxy.pushUpdate('sess', 'four', 4);
    await waitFor(() => client.readAckState('sess').latestSeq === 4);
    expect(client.readAckState('sess').gaps).toBe(1);
  });
});

describe('explicit ackSessionRead', () => {
  it('sends the batch ack and records the confirmed cursor', async () => {
    const proxy = await startProxy();
    const client = await connect(proxy);
    proxy.pushUpdate('sess', 'one');
    proxy.pushUpdate('sess', 'two');
    await waitFor(() => client.readAckState('sess').latestSeq === 2);

    const cursor = await client.ackSessionRead('sess');
    expect(cursor).toBe(2);
    expect(client.readAckState('sess')).toEqual({ latestSeq: 2, ackedSeq: 2, gaps: 0 });
    expect(proxy.peer.ackRequests).toHaveLength(1);
    expect(proxy.peer.ackRequests[0].params).toEqual({ sessionId: 'sess', seq: 2 });
  });

  it('never regresses the client cursor on a stale explicit ack', async () => {
    const proxy = await startProxy();
    const client = await connect(proxy);
    proxy.pushUpdate('sess', 'one');
    proxy.pushUpdate('sess', 'two');
    proxy.pushUpdate('sess', 'three');
    await waitFor(() => client.readAckState('sess').latestSeq === 3);

    expect(await client.ackSessionRead('sess', 3)).toBe(3);
    // GREATEST is applied server-side too: a stale ack resolves with the
    // already-advanced cursor, so the wire answer IS the current position.
    expect(await client.ackSessionRead('sess', 1)).toBe(3);
    expect(client.readAckState('sess').ackedSeq).toBe(3);
  });

  it('resolves 0 without touching the wire when nothing was delivered', async () => {
    const proxy = await startProxy();
    const client = await connect(proxy);
    expect(await client.ackSessionRead('sess')).toBe(0);
    expect(proxy.peer.ackRequests).toEqual([]);
  });
});

describe('automatic batch acks (readAckEvery)', () => {
  it('acks once per N delivered messages, at-least-once paced', async () => {
    const proxy = await startProxy();
    const client = await connect(proxy, { readAckEvery: 2 });

    proxy.pushUpdate('sess', 'one');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(proxy.peer.ackRequests).toEqual([]);

    proxy.pushUpdate('sess', 'two');
    await waitFor(() => client.readAckState('sess').ackedSeq === 2);
    expect(proxy.peer.ackRequests).toHaveLength(1);

    // Below the threshold again: 3 − 2 < 2 → no ack.
    proxy.pushUpdate('sess', 'three');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(proxy.peer.ackRequests).toHaveLength(1);

    proxy.pushUpdate('sess', 'four');
    await waitFor(() => client.readAckState('sess').ackedSeq === 4);
    expect(proxy.peer.ackRequests.map((frame) => frame.params?.seq)).toEqual([2, 4]);
  });

  it('surfaces a failed ack as a soft error and retries on the next delivery', async () => {
    const proxy = await startProxy();
    const soft: Error[] = [];
    const client = await connect(proxy, { readAckEvery: 1, onError: (error) => soft.push(error) });
    proxy.failAcks = true;

    proxy.pushUpdate('sess', 'one');
    await waitFor(() => soft.length > 0);
    expect(soft[0]).toBeInstanceOf(CodingAgentAcpReadAckError);
    expect((soft[0] as CodingAgentAcpReadAckError).seq).toBe(1);
    expect(client.readAckState('sess').ackedSeq).toBe(0);

    proxy.failAcks = false;
    proxy.pushUpdate('sess', 'two');
    await waitFor(() => client.readAckState('sess').ackedSeq === 2);
    expect(proxy.peer.ackRequests).toHaveLength(2);
  });
});

describe('close', () => {
  it('clears tracked read-ack state', async () => {
    const proxy = await startProxy();
    const client = await connect(proxy);
    proxy.pushUpdate('sess', 'one');
    await waitFor(() => client.readAckState('sess').latestSeq === 1);
    client.close();
    expect(client.readAckState('sess')).toEqual({ latestSeq: 0, ackedSeq: 0, gaps: 0 });
  });
});
