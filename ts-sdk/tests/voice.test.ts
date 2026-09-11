import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceAPI } from '../src/voice.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('Voice API', () => {
  it('posts TTS payload to agents voice route', async () => {
    const calls: Array<{ path: string; body: any }> = [];
    const http = {
      postBytes: async (path: string, body: any) => {
        calls.push({ path, body });
        return new Uint8Array([1, 2, 3]);
      },
    };

    const audio = await new VoiceAPI(http as any).tts({
      text: 'hello',
      voice: 'serena',
      language: 'english',
      responseFormat: 'wav',
    });

    expect(audio).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls).toEqual([
      {
        path: '/voice/tts',
        body: {
          text: 'hello',
          voice: 'serena',
          language: 'english',
          response_format: 'wav',
        },
      },
    ]);
  });

  it('forwards TTS cancellation to the HTTP request', async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const http = {
      postBytes: async (_path: string, _body: any, options?: { signal?: AbortSignal }) => {
        receivedSignal = options?.signal;
        return new Uint8Array([1]);
      },
    };

    await new VoiceAPI(http as any).tts({ text: 'hello', signal: controller.signal });

    expect(receivedSignal).toBe(controller.signal);
  });

  it('base64 encodes clone reference audio', async () => {
    const calls: Array<{ path: string; body: any }> = [];
    const http = {
      postBytes: async (path: string, body: any) => {
        calls.push({ path, body });
        return new Uint8Array([4, 5, 6]);
      },
    };

    const audio = await new VoiceAPI(http as any).clone({
      text: 'clone me',
      refAudio: new Uint8Array(Buffer.from('reference-audio')),
      responseFormat: 'wav',
    });

    expect(audio).toEqual(new Uint8Array([4, 5, 6]));
    expect(calls[0]).toEqual({
      path: '/voice/clone',
      body: {
        text: 'clone me',
        ref_audio_base64: 'cmVmZXJlbmNlLWF1ZGlv',
        language: 'auto',
        x_vector_only: true,
        response_format: 'wav',
      },
    });
  });

  it('posts design payload to agents voice route', async () => {
    const calls: Array<{ path: string; body: any }> = [];
    const http = {
      postBytes: async (path: string, body: any) => {
        calls.push({ path, body });
        return new Uint8Array([7, 8, 9]);
      },
    };

    const audio = await new VoiceAPI(http as any).design({
      text: 'hello',
      description: 'warm narrator',
      responseFormat: 'wav',
    });

    expect(audio).toEqual(new Uint8Array([7, 8, 9]));
    expect(calls[0]).toEqual({
      path: '/voice/design',
      body: {
        text: 'hello',
        instruct: 'warm narrator',
        language: 'auto',
        response_format: 'wav',
      },
    });
  });

  it('posts transcription audio as multipart form data', async () => {
    let receivedUrl = '';
    let receivedHeaders: HeadersInit | undefined;
    let receivedForm: FormData | undefined;
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      receivedUrl = String(url);
      receivedHeaders = init?.headers;
      receivedForm = init?.body as FormData;
      return new Response(JSON.stringify({ text: 'hello world' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const http = { base: 'https://api.test/agents', credential: 'hyper_api_test' };
    const result = await new VoiceAPI(http as any).transcribe({
      audio: new Uint8Array([1, 2, 3]),
      filename: 'speech.wav',
      language: 'en',
      model: 'tiny',
      responseFormat: 'json',
      prompt: 'names',
    });

    expect(result.text).toBe('hello world');
    expect(receivedUrl).toBe('https://api.test/agents/voice/transcribe');
    expect(receivedHeaders).toEqual({ Authorization: 'Bearer hyper_api_test' });
    expect(receivedForm?.get('language')).toBe('en');
    expect(receivedForm?.get('model')).toBe('tiny');
    expect(receivedForm?.get('response_format')).toBe('json');
    expect(receivedForm?.get('prompt')).toBe('names');
    const file = receivedForm?.get('file');
    expect(file).toBeInstanceOf(Blob);
    expect((file as Blob).size).toBe(3);
  });

  it('returns plain-text transcription responses', async () => {
    globalThis.fetch = vi.fn(async () => new Response('plain transcript', { status: 200 })) as typeof fetch;
    const http = { base: 'https://api.test/agents', credential: 'hyper_api_test' };

    await expect(new VoiceAPI(http as any).transcribe({ audio: new Uint8Array([1]) }))
      .resolves.toEqual({ text: 'plain transcript' });
  });

  it('cloneStream and designStream ride a session with the right ops', async () => {
    const { WebSocketServer } = await import('ws');
    const { VoiceAPI } = await import('../src/voice.js');
    const { VoiceSession } = await import('../src/voice-session.js');

    const received: Array<Record<string, unknown>> = [];
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server.on('listening', () => resolve()));
    const address = server.address();
    const url = `ws://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    server.on('connection', (ws) => {
      ws.on('message', (raw) => {
        const message = JSON.parse(String(raw)) as Record<string, unknown>;
        received.push(message);
        if (message.type !== 'speak') return;
        const rid = String(message.request_id);
        const audio = Buffer.from(`audio-${message.op}`);
        ws.send(JSON.stringify({
          type: 'audio',
          request_id: rid,
          seq: 0,
          total: 1,
          bytes: audio.length,
          final: true,
        }));
        ws.send(audio);
        ws.send(JSON.stringify({ type: 'done', request_id: rid, total_chunks: 1, elapsed: 0.1 }));
      });
    });

    try {
      const api = new VoiceAPI({} as any);
      (api as any).connect = () => new VoiceSession({ wsUrl: url, credential: 'hyper_api_test' });

      const cloneChunks = [];
      for await (const chunk of api.cloneStream({ text: 'clone me', refAudio: new Uint8Array([1, 2]) })) {
        cloneChunks.push(chunk);
      }
      expect(Buffer.from(cloneChunks[0].audio).toString()).toBe('audio-clone');

      const designChunks = [];
      for await (const chunk of api.designStream({ text: 'design me', description: 'a narrator' })) {
        designChunks.push(chunk);
      }
      expect(Buffer.from(designChunks[0].audio).toString()).toBe('audio-design');

      const ops = received.filter((m) => m.type === 'speak').map((m) => m.op);
      expect(ops).toEqual(['clone', 'design']);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
