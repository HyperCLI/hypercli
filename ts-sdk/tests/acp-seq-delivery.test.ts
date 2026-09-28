import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { ACP_SEQ_META_KEY, CodingAgentAcpClient } from '../src/acp.js';

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
 * `initialize` and pushes `session/update` notifications carrying the
 * store-seq `_meta` annotation the delivery tracker consumes. Deliberately
 * knows NOTHING about read acks — user read receipts are backend-owned
 * (2026-09-27) and the client must emit no read-ack traffic at all.
 */
class FakeAcpProxy {
  public readonly peer: { frames: WireFrame[] } = { frames: [] };
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
    if (annotate) params._meta = { [ACP_SEQ_META_KEY]: { seq: this.seq } };
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

async function connect(proxy: FakeAcpProxy): Promise<CodingAgentAcpClient> {
  const client = await CodingAgentAcpClient.connect({ url: proxy.url, token: '' }, {});
  clients.push(client);
  return client;
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const proxy of proxies.splice(0)) await proxy.close();
});

describe('seq-delivery tracking', () => {
  it('tracks the seq annotation and ignores unannotated frames', async () => {
    const proxy = await startProxy();
    const client = await connect(proxy);
    expect(client.seqDeliveryState('sess')).toEqual({ latestSeq: 0, gaps: 0 });

    proxy.pushUpdate('sess', 'one');
    await waitFor(() => client.seqDeliveryState('sess').latestSeq === 1);
    proxy.pushUpdate('sess', 'legacy direct-bridge frame', undefined, false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.seqDeliveryState('sess')).toEqual({ latestSeq: 1, gaps: 0 });
  });

  it('counts forward seq jumps as delivery gaps', async () => {
    const proxy = await startProxy();
    const client = await connect(proxy);
    proxy.pushUpdate('sess', 'one');
    await waitFor(() => client.seqDeliveryState('sess').latestSeq === 1);
    proxy.pushUpdate('sess', 'four', 4);
    await waitFor(() => client.seqDeliveryState('sess').latestSeq === 4);
    expect(client.seqDeliveryState('sess').gaps).toBe(1);

    // Stale/duplicate deliveries move nothing and count nothing.
    proxy.pushUpdate('sess', 'replay', 2);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.seqDeliveryState('sess')).toEqual({ latestSeq: 4, gaps: 1 });
  });

  it('emits no read-ack traffic (read receipts are backend-owned)', async () => {
    const proxy = await startProxy();
    const client = await connect(proxy);
    proxy.pushUpdate('sess', 'one');
    proxy.pushUpdate('sess', 'two');
    proxy.pushUpdate('sess', 'three');
    await waitFor(() => client.seqDeliveryState('sess').latestSeq === 3);
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The only request the client may ever send here is initialize — any
    // _hypercli.dev/session_read_ack frame would be the resurrected no-op lie.
    expect(proxy.peer.frames.map((frame) => frame.method)).toEqual(['initialize']);
  });
});

describe('close', () => {
  it('clears tracked seq-delivery state', async () => {
    const proxy = await startProxy();
    const client = await connect(proxy);
    proxy.pushUpdate('sess', 'one');
    await waitFor(() => client.seqDeliveryState('sess').latestSeq === 1);
    client.close();
    expect(client.seqDeliveryState('sess')).toEqual({ latestSeq: 0, gaps: 0 });
  });
});
