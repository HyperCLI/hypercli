import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws';
import { VoiceSession, VoiceStreamError } from '../src/voice-session.js';

function sendAudio(ws: ServerSocket, requestId: string, index: number, total: number, payload: string): void {
  const bytes = Buffer.from(payload);
  ws.send(JSON.stringify({
    type: 'audio',
    request_id: requestId,
    seq: index,
    total,
    bytes: bytes.length,
    final: index === total - 1,
  }));
  ws.send(bytes);
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
      sendAudio(ws, rid, 0, 2, 'first');
      sendAudio(ws, rid, 1, 2, 'second');
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

  it('sends the credential as both ?token= and an Authorization header in Node', async () => {
    const upgrade: { url?: string; authorization?: string } = {};
    await new Promise<void>((resolve) => {
      server = new WebSocketServer({ port: 0 }, () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        url = `ws://127.0.0.1:${port}`;
        resolve();
      });
      server.on('connection', (ws, req) => {
        upgrade.url = req.url;
        upgrade.authorization = req.headers.authorization;
        ws.close(1000);
      });
    });

    const session = new VoiceSession({ wsUrl: url, credential: 'hyper_api_test' });
    await session.open();
    session.close();

    expect(upgrade.url).toBe('/voice?token=hyper_api_test');
    expect(upgrade.authorization).toBe('Bearer hyper_api_test');
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

  it('rejects binary without an audio header', async () => {
    await startServer((ws, message) => {
      if (message.type !== 'speak') return;
      // The malformed frame is injected below so the test does not depend on
      // ws' server-side text/binary frame inference for Buffer values.
    });

    const session = new VoiceSession({ wsUrl: url, credential: 'hyper_api_test' });
    await session.open();

    try {
      const iterate = async () => {
        for await (const _chunk of session.speak({ text: 'hello' })) {
          // no-op
        }
      };
      const result = expect(iterate()).rejects.toThrow(/binary frame without audio header/);
      await new Promise((resolve) => setTimeout(resolve, 0));
      (session as unknown as { enqueue(raw: unknown): void }).enqueue(new Uint8Array([1, 2, 3]));
      await result;
    } finally {
      session.close();
    }
  });

  it('rejects non-monotonic audio sequence numbers', async () => {
    await startServer((ws, message) => {
      if (message.type !== 'speak') return;
      sendAudio(ws, String(message.request_id), 1, 2, 'second');
    });

    const session = new VoiceSession({ wsUrl: url, credential: 'hyper_api_test' });
    await session.open();

    const iterate = async () => {
      for await (const _chunk of session.speak({ text: 'hello' })) {
        // no-op
      }
    };
    await expect(iterate()).rejects.toThrow(/Unexpected audio sequence/);
    session.close();
  });

  it('rejects done chunk count mismatches', async () => {
    await startServer((ws, message) => {
      if (message.type !== 'speak') return;
      const rid = String(message.request_id);
      sendAudio(ws, rid, 0, 1, 'only');
      ws.send(JSON.stringify({ type: 'done', request_id: rid, total_chunks: 2, elapsed: 0.1 }));
    });

    const session = new VoiceSession({ wsUrl: url, credential: 'hyper_api_test' });
    await session.open();

    const iterate = async () => {
      for await (const _chunk of session.speak({ text: 'hello' })) {
        // no-op
      }
    };
    await expect(iterate()).rejects.toThrow(/Done chunk count mismatch/);
    session.close();
  });

  it('rejects a second speak while a request is in flight', async () => {
    await startServer((ws, message) => {
      if (message.type !== 'speak') return;
      const rid = String(message.request_id);
      sendAudio(ws, rid, 0, 3, 'first');
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
        sendAudio(ws, rid, 0, 3, 'first');
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
      sendAudio(ws, rid, 0, 1, 'assembled-file');
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
  it('speakClone sends op=clone with reference audio', async () => {
    await startServer((ws, message) => {
      if (message.type !== 'speak') return;
      const rid = String(message.request_id);
      sendAudio(ws, rid, 0, 1, 'cloned-audio');
      ws.send(JSON.stringify({ type: 'done', request_id: rid, total_chunks: 1, elapsed: 0.1 }));
    });

    const session = new VoiceSession({ wsUrl: url, credential: 'hyper_api_test' });
    await session.open();

    const chunks = [];
    for await (const chunk of session.speakClone({
      text: 'clone me',
      refAudio: new Uint8Array(Buffer.from('reference-audio')),
    })) {
      chunks.push(chunk);
    }
    session.close();

    expect(Buffer.from(chunks[0].audio).toString()).toBe('cloned-audio');
    expect(received[0]).toMatchObject({
      type: 'speak',
      op: 'clone',
      ref_audio_base64: Buffer.from('reference-audio').toString('base64'),
      x_vector_only: true,
    });
    expect(received[0]).not.toHaveProperty('voice');
  });

  it('speakDesign sends op=design with instruct', async () => {
    await startServer((ws, message) => {
      if (message.type !== 'speak') return;
      const rid = String(message.request_id);
      sendAudio(ws, rid, 0, 1, 'designed-audio');
      ws.send(JSON.stringify({ type: 'done', request_id: rid, total_chunks: 1, elapsed: 0.1 }));
    });

    const session = new VoiceSession({ wsUrl: url, credential: 'hyper_api_test' });
    await session.open();

    const chunks = [];
    for await (const chunk of session.speakDesign({ text: 'design me', description: 'a warm narrator' })) {
      chunks.push(chunk);
    }
    session.close();

    expect(Buffer.from(chunks[0].audio).toString()).toBe('designed-audio');
    expect(received[0]).toMatchObject({ type: 'speak', op: 'design', instruct: 'a warm narrator' });
  });

  it('speak sends op=tts', async () => {
    await startServer((ws, message) => {
      if (message.type !== 'speak') return;
      const rid = String(message.request_id);
      sendAudio(ws, rid, 0, 1, 'tts-audio');
      ws.send(JSON.stringify({ type: 'done', request_id: rid, total_chunks: 1, elapsed: 0.1 }));
    });

    const session = new VoiceSession({ wsUrl: url, credential: 'hyper_api_test' });
    await session.open();
    for await (const _chunk of session.speak({ text: 'hi', voice: 'serena' })) {
      // consume
    }
    session.close();

    expect(received[0]).toMatchObject({ type: 'speak', op: 'tts', voice: 'serena' });
  });
});
