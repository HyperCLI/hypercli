/**
 * Voice capability API
 */
import { getAgentsWsUrlFromProductBase } from './config.js';
import { requestWithRetry, responseAPIError, type HTTPClient } from './http.js';
import { VoiceSession, type VoiceChunkEvent } from './voice-session.js';
import {
  VoiceTranscriptionSession,
  type TranscriptionStartOptions,
  type VoiceTranscriptionEvent,
} from './voice-transcription-session.js';

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

export {
  VoiceTranscriptionSession,
  type TranscriptionStartOptions,
  type VoiceTranscriptDeltaEvent,
  type VoiceTranscriptFinalEvent,
  type VoiceTranscriptionAckEvent,
  type VoiceTranscriptionEvent,
  type VoiceTranscriptionSessionOptions,
  type VoiceTranscriptionSessionState,
} from './voice-transcription-session.js';

export interface TTSOptions {
  text: string;
  voice?: string;
  language?: string;
  responseFormat?: string;
  signal?: AbortSignal;
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

export interface TranscribeOptions {
  audio: Uint8Array | ArrayBuffer | Blob;
  filename?: string;
  contentType?: string;
  language?: string;
  model?: string;
  responseFormat?: string;
  prompt?: string;
  signal?: AbortSignal;
}

export interface TranscriptionResult {
  text: string;
  [key: string]: unknown;
}

export interface TranscribeStreamOptions {
  audio: Uint8Array | ArrayBuffer | string;
  language?: string;
  model?: string;
  responseFormat?: string;
  prompt?: string;
  base64?: boolean;
  timeoutMs?: number;
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
    }, options.signal ? { signal: options.signal } : {});
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

  async transcribe(options: TranscribeOptions): Promise<TranscriptionResult> {
    const formData = new FormData();
    const filename = options.filename ?? 'audio';
    const audio = options.audio instanceof Blob
      ? options.audio
      : new Blob([options.audio as unknown as NonNullable<ConstructorParameters<typeof Blob>[0]>[number]], {
        type: options.contentType ?? 'application/octet-stream',
      });
    formData.append('file', audio, filename);
    if (options.language) formData.append('language', options.language);
    if (options.model) formData.append('model', options.model);
    if (options.responseFormat) formData.append('response_format', options.responseFormat);
    if (options.prompt) formData.append('prompt', options.prompt);

    const response = await requestWithRetry({
      method: 'POST',
      url: `${this.http.base}/voice/transcribe`,
      headers: { Authorization: `Bearer ${this.http.credential}` },
      body: formData,
      rawBody: true,
      signal: options.signal,
    });
    if (response.status >= 400) throw await responseAPIError(response, 'POST');
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const data = await response.json() as Record<string, unknown>;
      return { ...data, text: String(data.text ?? data.transcript ?? '') };
    }
    return { text: await response.text() };
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

  connectTranscription(options?: TranscriptionStartOptions & { timeoutMs?: number }): VoiceTranscriptionSession {
    return new VoiceTranscriptionSession({
      wsUrl: getAgentsWsUrlFromProductBase(this.http.base),
      credential: this.http.credential,
      timeoutMs: options?.timeoutMs,
      language: options?.language,
      model: options?.model,
      responseFormat: options?.responseFormat,
      prompt: options?.prompt,
    });
  }

  async *transcribeStream(
    options: TranscribeStreamOptions,
  ): AsyncGenerator<VoiceTranscriptionEvent, void, undefined> {
    const session = this.connectTranscription({
      timeoutMs: options.timeoutMs,
      language: options.language,
      model: options.model,
      responseFormat: options.responseFormat,
      prompt: options.prompt,
    });
    await session.open();
    try {
      yield* session.transcribe(options.audio, {
        base64: options.base64,
      });
    } finally {
      session.close();
    }
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
