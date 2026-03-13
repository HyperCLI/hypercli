import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewayClient } from '../src/gateway.js';

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  public readonly url: string;
  public onmessage: ((event: { data: string }) => void) | null = null;
  public onerror: (() => void) | null = null;
  public onclose: (() => void) | null = null;
  public sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    queueMicrotask(() => this.onclose?.());
  }

  emit(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  emitClose() {
    this.onclose?.();
  }
}

describe('GatewayClient', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.restoreAllMocks();
    vi.stubGlobal('WebSocket', MockWebSocket as any);
    vi.stubGlobal('crypto', {
      randomUUID: () => 'uuid-123',
    } as any);
  });

  async function connectClient() {
    const client = new GatewayClient({
      url: 'wss://openclaw-agent.example',
      gatewayToken: 'gw-token',
    });

    const connectPromise = client.connect();
    const ws = MockWebSocket.instances.at(-1);
    if (!ws) throw new Error('Missing websocket instance');

    ws.emit({ event: 'connect.challenge' });
    ws.emit({
      type: 'res',
      ok: true,
      payload: {
        protocol: 3,
        server: { version: 'test' },
      },
    });

    await connectPromise;
    return { client, ws };
  }

  it('does not call onDisconnect for intentional local closes', async () => {
    const { client } = await connectClient();
    const onDisconnect = vi.fn();
    client.onDisconnect = onDisconnect;

    client.close();
    await Promise.resolve();

    expect(onDisconnect).not.toHaveBeenCalled();
  });

  it('calls onDisconnect when the socket closes unexpectedly', async () => {
    const { client, ws } = await connectClient();
    const onDisconnect = vi.fn();
    client.onDisconnect = onDisconnect;

    ws.emitClose();

    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });
});
