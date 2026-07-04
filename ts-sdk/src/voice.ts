/**
 * Voice capability API
 */
import { getAgentsWsUrlFromProductBase } from './config.js';
import type { HTTPClient } from './http.js';
import { VoiceSession, type VoiceChunkEvent } from './voice-session.js';

export {
  VoiceSession,
  VoiceStreamError,
  type CloneSpeakOptions,
  type DesignSpeakOptions,
  type SpeakOptions,
  type VoiceChunkEvent,
  type VoiceSessionOptions,
  type VoiceSessionState,
} from './voice-session.js';

export interface TTSOptions {
  text: string;
  voice?: string;
  language?: string;
  responseFormat?: string;
}

export interface CloneOptions {
  text: string;
  refAudio: Uint8Array | ArrayBuffer;
  language?: string;
  xVectorOnly?: boolean;
  responseFormat?: string;
}

export interface DesignOptions {
  text: string;
  description: string;
  language?: string;
  responseFormat?: string;
}

function encodeBase64(bytes: Uint8Array | ArrayBuffer): string {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(data).toString('base64');
  }
  // Browser fallback: btoa over chunked binary string (avoids arg-limit blowups)
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < data.length; i += CHUNK) {
    binary += String.fromCharCode(...data.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export class VoiceAPI {
  constructor(private http: HTTPClient) {}

  async tts(options: TTSOptions): Promise<Uint8Array> {
    return this.http.postBytes('/voice/tts', {
      text: options.text,
      voice: options.voice ?? 'serena',
      language: options.language ?? 'auto',
      response_format: options.responseFormat ?? 'mp3',
    });
  }

  async clone(options: CloneOptions): Promise<Uint8Array> {
    return this.http.postBytes('/voice/clone', {
      text: options.text,
      ref_audio_base64: encodeBase64(options.refAudio),
      language: options.language ?? 'auto',
      x_vector_only: options.xVectorOnly ?? true,
      response_format: options.responseFormat ?? 'mp3',
    });
  }

  async design(options: DesignOptions): Promise<Uint8Array> {
    return this.http.postBytes('/voice/design', {
      text: options.text,
      instruct: options.description,
      language: options.language ?? 'auto',
      response_format: options.responseFormat ?? 'mp3',
    });
  }

  /**
   * Create a streaming VoiceSession over /ws/voice (call open() or use ttsStream()).
   */
  connect(options?: { timeoutMs?: number }): VoiceSession {
    return new VoiceSession({
      wsUrl: getAgentsWsUrlFromProductBase(this.http.base),
      credential: this.http.credential,
      timeoutMs: options?.timeoutMs,
    });
  }

  /**
   * One-shot streaming TTS: opens a session, speaks, closes.
   */
  async *ttsStream(options: TTSOptions & { timeoutMs?: number }): AsyncGenerator<VoiceChunkEvent, void, undefined> {
    const session = this.connect({ timeoutMs: options.timeoutMs });
    await session.open();
    try {
      yield* session.speak({
        text: options.text,
        voice: options.voice,
        language: options.language,
        format: options.responseFormat,
        chunks: true,
      });
    } finally {
      session.close();
    }
  }

  /**
   * One-shot streaming voice clone: opens a session, speaks, closes.
   */
  async *cloneStream(options: CloneOptions & { timeoutMs?: number }): AsyncGenerator<VoiceChunkEvent, void, undefined> {
    const session = this.connect({ timeoutMs: options.timeoutMs });
    await session.open();
    try {
      yield* session.speakClone({
        text: options.text,
        refAudio: options.refAudio,
        language: options.language,
        xVectorOnly: options.xVectorOnly,
        format: options.responseFormat,
        chunks: true,
      });
    } finally {
      session.close();
    }
  }

  /**
   * One-shot streaming voice design: opens a session, speaks, closes.
   */
  async *designStream(options: DesignOptions & { timeoutMs?: number }): AsyncGenerator<VoiceChunkEvent, void, undefined> {
    const session = this.connect({ timeoutMs: options.timeoutMs });
    await session.open();
    try {
      yield* session.speakDesign({
        text: options.text,
        description: options.description,
        language: options.language,
        format: options.responseFormat,
        chunks: true,
      });
    } finally {
      session.close();
    }
  }
}
