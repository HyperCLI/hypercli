/**
 * Voice transcription streaming session over /ws/voice/transcribe.
 *
 * This is intentionally separate from VoiceSession: TTS sends text and receives
 * audio chunks, while transcription sends audio and receives transcript events.
 */
import type NodeWebSocket from 'ws';
import { encodeBase64, VoiceStreamError } from './voice-session.js';

export type VoiceTranscriptionSessionState = 'closed' | 'ready' | 'streaming' | 'committed';

export interface VoiceTranscriptionSessionOptions {
  /** Agents WS base, e.g. wss://api.agents.hypercli.com/ws */
  wsUrl: string;
  /** API key (hyper_api_...) or opaque access token. */
  credential: string;
  /** Per-request timeout in milliseconds (default 300 000). */
  timeoutMs?: number;
  language?: string;
  model?: string;
  responseFormat?: string;
  prompt?: string;
}

export interface TranscriptionStartOptions {
  language?: string;
  model?: string;
  responseFormat?: string;
  prompt?: string;
}

export interface VoiceTranscriptionAckEvent {
  type: 'ack';
  [key: string]: unknown;
}

export interface VoiceTranscriptDeltaEvent {
  type: 'transcript.delta';
  text: string;
  delta?: string;
  [key: string]: unknown;
}

export interface VoiceTranscriptFinalEvent {
  type: 'transcript.final';
  text: string;
  [key: string]: unknown;
}

export type VoiceTranscriptionEvent =
  | VoiceTranscriptionAckEvent
  | VoiceTranscriptDeltaEvent
  | VoiceTranscriptFinalEvent;

type NodeWebSocketConstructor = typeof NodeWebSocket;

interface Waiter {
  resolve: (value: string) => void;
  reject: (error: Error) => void;
}

async function loadNodeWebSocket(): Promise<NodeWebSocketConstructor> {
  const moduleName = 'ws';
  const mod = await import(moduleName);
  return (mod.default ?? mod) as NodeWebSocketConstructor;
}

function bytesFromAudio(audio: Uint8Array | ArrayBuffer): Uint8Array {
  return audio instanceof Uint8Array ? audio : new Uint8Array(audio);
}

export class VoiceTranscriptionSession {
  state: VoiceTranscriptionSessionState = 'closed';

  private readonly wsUrl: string;
  private readonly credential: string;
  private readonly timeoutMs: number;
  private readonly transcriptionOptions: TranscriptionStartOptions;
  private ws: WebSocket | NodeWebSocket | null = null;
  private messages: string[] = [];
  private waiter: Waiter | null = null;
  private closeError: Error | null = null;

  constructor(options: VoiceTranscriptionSessionOptions) {
    this.wsUrl = options.wsUrl.replace(/\/+$/, '');
    this.credential = options.credential;
    this.timeoutMs = options.timeoutMs ?? 300_000;
    this.transcriptionOptions = {
      language: options.language,
      model: options.model,
      responseFormat: options.responseFormat,
      prompt: options.prompt,
    };
  }

  async open(): Promise<this> {
    if (this.ws) return this;
    const useBrowserSocket = 'localStorage' in globalThis && typeof WebSocket !== 'undefined';

    await new Promise<void>((resolve, reject) => {
      if (useBrowserSocket) {
        const url = this.connectionUrl();
        const ws = new WebSocket(url);
        this.ws = ws;
        ws.onopen = () => resolve();
        ws.onmessage = (event: { data?: unknown }) => this.enqueue(String(event.data ?? ''));
        ws.onerror = () => reject(new Error('voice transcription WS connection failed'));
        ws.onclose = (event: { code?: number; reason?: string }) =>
          this.handleClose(event.code ?? 1006, String(event.reason ?? ''));
        return;
      }
      loadNodeWebSocket()
        .then((NodeSocket) => {
          const ws = new NodeSocket(this.connectionUrl(), {
            headers: { Authorization: `Bearer ${this.credential}` },
          });
          this.ws = ws;
          ws.on('open', () => resolve());
          ws.on('message', (data: NodeWebSocket.RawData) =>
            this.enqueue(typeof data === 'string' ? data : data.toString()));
          ws.on('error', (error: Error) => reject(error));
          ws.on('close', (code: number, reason: Buffer) =>
            this.handleClose(code ?? 1006, reason?.toString() ?? ''));
        })
        .catch(() => reject(new Error('WebSocket is not available in this environment')));
    });

    await this.waitForReady();
    this.state = 'ready';
    return this;
  }

  close(): void {
    const ws = this.ws;
    this.ws = null;
    this.state = 'closed';
    if (ws) {
      try {
        ws.close();
      } catch {
        // already closed
      }
    }
  }

  sendAudio(audio: Uint8Array | ArrayBuffer): void {
    if (!this.ws) throw new Error('Session is not connected');
    this.ws.send(bytesFromAudio(audio));
    this.state = 'streaming';
  }

  sendBase64Audio(audio: string | Uint8Array | ArrayBuffer): void {
    this.sendJson({
      event: 'audio',
      audio: typeof audio === 'string' ? audio : encodeBase64(audio),
    });
    this.state = 'streaming';
  }

  commit(): void {
    this.sendJson({ event: 'commit' });
    this.state = 'committed';
  }

  async *events(): AsyncGenerator<VoiceTranscriptionEvent, void, undefined> {
    if (!this.ws || this.state === 'closed') {
      throw new Error("Session is not connected; call open() first");
    }
    const deadline = Date.now() + this.timeoutMs;
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new VoiceStreamError('timeout', `voice transcription stream timed out after ${this.timeoutMs}ms`);
      }
      const message = this.parseMessage(await this.nextMessage(remaining));
      if (!message) continue;
      if (message.type === 'error') {
        throw new VoiceStreamError(String(message.code ?? ''), String(message.detail ?? message.message ?? ''));
      }
      if (message.type === 'ack') {
        yield message as unknown as VoiceTranscriptionAckEvent;
        continue;
      }
      if (message.type === 'transcript.delta') {
        yield { ...message, type: 'transcript.delta', text: String(message.text ?? ''), delta: String(message.delta ?? '') };
        continue;
      }
      if (message.type === 'transcript.final') {
        yield { ...message, type: 'transcript.final', text: String(message.text ?? '') };
        this.state = this.ws ? 'ready' : 'closed';
        return;
      }
    }
  }

  async *transcribe(
    audio: Uint8Array | ArrayBuffer | string,
    options: { base64?: boolean } = {},
  ): AsyncGenerator<VoiceTranscriptionEvent, void, undefined> {
    if (typeof audio === 'string' || options.base64) {
      this.sendBase64Audio(audio);
    } else {
      this.sendAudio(audio);
    }
    this.commit();
    yield* this.events();
  }

  private sendJson(message: Record<string, unknown>): void {
    if (!this.ws) throw new Error('Session is not connected');
    const body = Object.fromEntries(Object.entries(message).filter(([, value]) => value !== undefined));
    this.ws.send(JSON.stringify(body));
  }

  private connectionUrl(): string {
    const params = new URLSearchParams({ token: this.credential });
    if (this.transcriptionOptions.language) params.set('language', this.transcriptionOptions.language);
    if (this.transcriptionOptions.model) params.set('model', this.transcriptionOptions.model);
    if (this.transcriptionOptions.responseFormat) params.set('response_format', this.transcriptionOptions.responseFormat);
    if (this.transcriptionOptions.prompt) params.set('prompt', this.transcriptionOptions.prompt);
    return `${this.wsUrl}/voice/transcribe?${params.toString()}`;
  }

  private async waitForReady(): Promise<void> {
    const deadline = Date.now() + this.timeoutMs;
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new VoiceStreamError('timeout', `voice transcription stream timed out after ${this.timeoutMs}ms`);
      }
      const message = this.parseMessage(await this.nextMessage(remaining));
      if (!message) continue;
      if (message.type === 'ready') return;
      if (message.type === 'error') {
        throw new VoiceStreamError(String(message.code ?? ''), String(message.detail ?? message.message ?? ''));
      }
      this.messages.push(JSON.stringify(message));
    }
  }

  private parseMessage(raw: string): Record<string, unknown> | null {
    try {
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (message.type === undefined && typeof message.event === 'string') {
        message.type = message.event;
      }
      if (message.detail === undefined && typeof message.error === 'string') {
        message.detail = message.error;
      }
      return message;
    } catch {
      return null;
    }
  }

  private enqueue(raw: string): void {
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter.resolve(raw);
      return;
    }
    this.messages.push(raw);
  }

  private handleClose(code: number, reason: string): void {
    this.ws = null;
    this.state = 'closed';
    this.closeError = new Error(`voice transcription WS closed (${code}): ${reason || 'connection closed'}`);
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter.reject(this.closeError);
    }
  }

  private nextMessage(timeoutMs: number): Promise<string> {
    const queued = this.messages.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (!this.ws) return Promise.reject(this.closeError ?? new Error('Session is not connected'));
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new VoiceStreamError('timeout', `no message within ${Math.round(timeoutMs)}ms`));
      }, timeoutMs);
      this.waiter = {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
    });
  }
}
