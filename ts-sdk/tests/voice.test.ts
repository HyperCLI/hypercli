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
      voice: 'Chelsie',
      language: 'english',
      responseFormat: 'wav',
    });

    expect(audio).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls).toEqual([
      {
        path: '/agents/voice/tts',
        body: {
          text: 'hello',
          voice: 'Chelsie',
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
});
