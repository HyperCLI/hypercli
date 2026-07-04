import { describe, expect, it } from 'vitest';
import { VoiceAPI } from '../src/voice.js';

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
        path: '/agents/voice/tts',
        body: {
          text: 'hello',
          voice: 'serena',
          language: 'english',
          response_format: 'wav',
        },
      },
    ]);
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
      path: '/agents/voice/clone',
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
      path: '/agents/voice/design',
      body: {
        text: 'hello',
        instruct: 'warm narrator',
        language: 'auto',
        response_format: 'wav',
      },
    });
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
        ws.send(JSON.stringify({
          type: 'chunk',
          request_id: rid,
          index: 0,
          total: 1,
          audio_b64: Buffer.from(`audio-${message.op}`).toString('base64'),
          final: true,
        }));
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
