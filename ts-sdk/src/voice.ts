/**
 * Voice capability API
 */
import type { HTTPClient } from './http.js';

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
  return Buffer.from(data).toString('base64');
}

export class VoiceAPI {
  constructor(private http: HTTPClient) {}

  async tts(options: TTSOptions): Promise<Uint8Array> {
    return this.http.postBytes('/agents/voice/tts', {
      text: options.text,
      voice: options.voice ?? 'Chelsie',
      language: options.language ?? 'auto',
      response_format: options.responseFormat ?? 'mp3',
    });
  }

  async clone(options: CloneOptions): Promise<Uint8Array> {
    return this.http.postBytes('/agents/voice/clone', {
      text: options.text,
      ref_audio_base64: encodeBase64(options.refAudio),
      language: options.language ?? 'auto',
      x_vector_only: options.xVectorOnly ?? true,
      response_format: options.responseFormat ?? 'mp3',
    });
  }

  async design(options: DesignOptions): Promise<Uint8Array> {
    return this.http.postBytes('/agents/voice/design', {
      text: options.text,
      instruct: options.description,
      language: options.language ?? 'auto',
      response_format: options.responseFormat ?? 'mp3',
    });
  }
}
