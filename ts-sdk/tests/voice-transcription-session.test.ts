import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws';
import { VoiceTranscriptionSession } from '../src/voice-transcription-session.js';

describe('VoiceTranscriptionSession', () => {
  let server: WebSocketServer;
  let url: string;
  let received: Array<string | Buffer>;
  let requestUrl = '';

  function startServer(onMessage: (ws: ServerSocket, raw: string | Buffer) => void): Promise<void> {
    return new Promise((resolve) => {
      server = new WebSocketServer({ port: 0 }, () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        url = `ws://127.0.0.1:${port}`;
        resolve();
      });
      server.on('connection', (ws, request) => {
        requestUrl = request.url ?? '';
        ws.send(JSON.stringify({ event: 'ready' }));
        ws.on('message', (raw) => {
          const value = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
          received.push(value);
          onMessage(ws, value);
        });
      });
    });
  }

  beforeEach(() => {
    received = [];
    requestUrl = '';
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('sends binary audio and commit, then yields delta/final events', async () => {
    await startServer((ws, raw) => {
      if (Buffer.isBuffer(raw) && raw.toString() === '{"event":"commit"}') {
        ws.send(JSON.stringify({ event: 'ack' }));
        ws.send(JSON.stringify({ event: 'transcript.delta', delta: 'hello ', text: 'hello ' }));
        ws.send(JSON.stringify({ event: 'transcript.final', text: 'hello world' }));
      }
    });

    const session = new VoiceTranscriptionSession({ wsUrl: url, credential: 'hyper_api_test' });
    await session.open();

    const events = [];
    for await (const event of session.transcribe(new Uint8Array([1, 2, 3]))) {
      events.push(event);
    }
    session.close();

    expect(received[0]).toEqual(Buffer.from([1, 2, 3]));
    expect(JSON.parse(received[1].toString())).toEqual({ event: 'commit' });
    expect(events.map((event) => event.type)).toEqual(['ack', 'transcript.delta', 'transcript.final']);
    expect(events[2]).toMatchObject({ text: 'hello world' });
  });

  it('sends optional transcription config and base64 audio', async () => {
    await startServer((ws, raw) => {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (message.event === 'commit') {
        ws.send(JSON.stringify({ event: 'transcript.final', text: 'done' }));
      }
    });

    const session = new VoiceTranscriptionSession({
      wsUrl: url,
      credential: 'hyper_api_test',
      language: 'en',
      model: 'tiny',
      responseFormat: 'json',
      prompt: 'names',
    });
    await session.open();
    for await (const _event of session.transcribe('AQID', {
      base64: true,
    })) {
      // consume
    }
    session.close();

    const params = new URLSearchParams(requestUrl.split('?')[1] ?? '');
    expect(params.get('language')).toBe('en');
    expect(params.get('model')).toBe('tiny');
    expect(params.get('response_format')).toBe('json');
    expect(params.get('prompt')).toBe('names');
    expect(JSON.parse(received[0].toString())).toEqual({ event: 'audio', audio: 'AQID' });
    expect(JSON.parse(received[1].toString())).toEqual({ event: 'commit' });
  });
});
