import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws';
import { VoiceSession, VoiceStreamError } from '../src/voice-session.js';

function chunkMessage(requestId: string, index: number, total: number, payload: string): string {
  return JSON.stringify({
    type: 'chunk',
    request_id: requestId,
    index,
    total,
    audio_b64: Buffer.from(payload).toString('base64'),
    final: index === total - 1,
  });
}

describe('VoiceSession', () => {
  let server: WebSocketServer;
  let url: string;
  let received: Array<Record<string, unknown>>;

  function startServer(onMessage: (ws: ServerSocket, message: Record<string, unknown>) => void): Promise<void> {
    return new Promise((resolve) => {
      server = new WebSocketServer({ port: 0 }, () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        url = `ws://127.0.0.1:${port}`;
        resolve();
      });
      server.on('connection', (ws) => {
        ws.on('message', (raw) => {
          const message = JSON.parse(String(raw)) as Record<string, unknown>;
          received.push(message);
          onMessage(ws, message);
        });
      });
    });
  }

  beforeEach(() => {
    received = [];
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('yields ordered chunks then completes on done', async () => {
    await startServer((ws, message) => {
      if (message.type !== 'speak') return;
      const rid = String(message.request_id);
      ws.send(JSON.stringify({ type: 'start', request_id: rid, format: 'mp3' }));
      ws.send(chunkMessage(rid, 0, 2, 'first'));
      ws.send(chunkMessage(rid, 1, 2, 'second'));
      ws.send(JSON.stringify({ type: 'done', request_id: rid, total_chunks: 2, elapsed: 0.1 }));
    });

    const session = new VoiceSession({ wsUrl: url, credential: 'hyper_api_test' });
    await session.open();
    expect(session.state).toBe('idle');

    const chunks = [];
    for await (const chunk of session.speak({ text: 'Hello. World.', voice: 'serena' })) {
      expect(session.state).toBe('receiving');
      chunks.push(chunk);
    }
    expect(session.state).toBe('idle');
    session.close();

    expect(chunks.map((c) => Buffer.from(c.audio).toString())).toEqual(['first', 'second']);
    expect(chunks.map((c) => c.index)).toEqual([0, 1]);
    expect(chunks[1].final).toBe(true);
    expect(received[0]).toMatchObject({ type: 'speak', text: 'Hello. World.', voice: 'serena', chunks: true });
  });

  it('throws VoiceStreamError on server error', async () => {
    await startServer((ws, message) => {
      if (message.type !== 'speak') return;
      const rid = String(message.request_id);
      ws.send(JSON.stringify({ type: 'error', request_id: rid, code: '400', detail: 'Unsupported speakers' }));
    });

    const session = new VoiceSession({ wsUrl: url, credential: 'hyper_api_test' });
    await session.open();

    const iterate = async () => {
      for await (const _chunk of session.speak({ text: 'hello', voice: 'nope' })) {
        // no-op
      }
    };
    await expect(iterate()).rejects.toThrowError(VoiceStreamError);
    expect(session.state).toBe('idle');
    session.close();
  });

  it('rejects a second speak while a request is in flight', async () => {
    await startServer((ws, message) => {
      if (message.type !== 'speak') return;
      const rid = String(message.request_id);
      ws.send(chunkMessage(rid, 0, 3, 'first'));
      // Never send done — session stays mid-request.
    });

    const session = new VoiceSession({ wsUrl: url, credential: 'hyper_api_test' });
    await session.open();

    const iterator = session.speak({ text: 'hello' })[Symbol.asyncIterator]();
    await iterator.next();
    expect(session.state).toBe('receiving');

    const second = session.speak({ text: 'again' })[Symbol.asyncIterator]();
    await expect(second.next()).rejects.toThrow(/one request at a time/);

    await iterator.return?.();
    expect(session.state).toBe('idle');
    session.close();
  });

  it('sends cancel when the consumer breaks early', async () => {
    let cancelSeen: (() => void) | null = null;
    const cancelled = new Promise<void>((resolve) => {
      cancelSeen = resolve;
    });
    await startServer((ws, message) => {
      if (message.type === 'speak') {
        const rid = String(message.request_id);
        ws.send(chunkMessage(rid, 0, 3, 'first'));
      } else if (message.type === 'cancel') {
        cancelSeen?.();
      }
    });

    const session = new VoiceSession({ wsUrl: url, credential: 'hyper_api_test' });
    await session.open();

    for await (const _chunk of session.speak({ text: 'hello' })) {
      break;
    }
    await cancelled;
    const cancels = received.filter((m) => m.type === 'cancel');
    expect(cancels).toHaveLength(1);
    expect(cancels[0].request_id).toBe(received[0].request_id);
    session.close();
  });

  it('requires open() before speak', async () => {
    const session = new VoiceSession({ wsUrl: 'ws://127.0.0.1:1', credential: 'hyper_api_test' });
    const iterator = session.speak({ text: 'hello' })[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toThrow(/not connected/);
  });

  it('chunks=false yields a single assembled chunk', async () => {
    await startServer((ws, message) => {
      if (message.type !== 'speak') return;
      expect(message.chunks).toBe(false);
      const rid = String(message.request_id);
      ws.send(JSON.stringify({ type: 'start', request_id: rid, format: 'mp3' }));
      ws.send(chunkMessage(rid, 0, 1, 'assembled-file'));
      ws.send(JSON.stringify({ type: 'done', request_id: rid, total_chunks: 1, elapsed: 0.1 }));
    });

    const session = new VoiceSession({ wsUrl: url, credential: 'hyper_api_test' });
    await session.open();

    const chunks = [];
    for await (const chunk of session.speak({ text: 'hello', chunks: false })) {
      chunks.push(chunk);
    }
    session.close();

    expect(chunks).toHaveLength(1);
    expect(Buffer.from(chunks[0].audio).toString()).toBe('assembled-file');
    expect(chunks[0].final).toBe(true);
  });
});
