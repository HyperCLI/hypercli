/**
 * Voice streaming session over the /ws/voice WebSocket.
 *
 * The server owns text chunking; a session receives an ordered stream of
 * audio chunks. One request at a time: idle → rendering → receiving → idle.
 * Works in both Node (`ws` package, Authorization header) and the browser
 * (global WebSocket, `?token=` query — browsers cannot set WS headers).
 */
import type NodeWebSocket from 'ws';

export type VoiceSessionState = 'closed' | 'idle' | 'rendering' | 'receiving';

export interface VoiceChunkEvent {
  requestId: string;
  index: number;
  total: number;
  audio: Uint8Array;
  final: boolean;
}

export interface VoiceSessionOptions {
  /** Agents WS base, e.g. wss://api.agents.hypercli.com/ws */
  wsUrl: string;
  /** API key (hyper_api_...) or opaque access token. */
  credential: string;
  /** Per-request timeout in milliseconds (default 300 000). */
  timeoutMs?: number;
}

export interface SpeakOptions {
  text: string;
  voice?: string;
  language?: string;
  format?: string;
  /** true (default): receive each server-side split; false: one assembled file. */
  chunks?: boolean;
  requestId?: string;
}

export interface CloneSpeakOptions {
  text: string;
  refAudio: Uint8Array | ArrayBuffer;
  language?: string;
  xVectorOnly?: boolean;
  format?: string;
  chunks?: boolean;
  requestId?: string;
}

export interface DesignSpeakOptions {
  text: string;
  description: string;
  language?: string;
  format?: string;
  chunks?: boolean;
  requestId?: string;
}

export class VoiceStreamError extends Error {
  constructor(
    public readonly code: string,
    public readonly detail: string,
  ) {
    super(`voice stream error ${code}: ${detail}`);
    this.name = 'VoiceStreamError';
  }
}

export function encodeBase64(bytes: Uint8Array | ArrayBuffer): string {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(data).toString('base64');
  }
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < data.length; i += CHUNK) {
    binary += String.fromCharCode(...data.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function randomRequestId(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

interface Waiter {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

type NodeWebSocketConstructor = typeof NodeWebSocket;

async function loadNodeWebSocket(): Promise<NodeWebSocketConstructor> {
  const moduleName = 'ws';
  const mod = await import(moduleName);
  return (mod.default ?? mod) as NodeWebSocketConstructor;
}

export class VoiceSession {
  state: VoiceSessionState = 'closed';

  private readonly wsUrl: string;
  private readonly credential: string;
  private readonly timeoutMs: number;
  private ws: WebSocket | NodeWebSocket | null = null;
  private messages: unknown[] = [];
  private waiter: Waiter | null = null;
  private closeError: Error | null = null;

  constructor(options: VoiceSessionOptions) {
    this.wsUrl = options.wsUrl.replace(/\/+$/, '');
    this.credential = options.credential;
    this.timeoutMs = options.timeoutMs ?? 300_000;
  }

  async open(): Promise<this> {
    if (this.ws) return this;
    const useBrowserSocket = 'localStorage' in globalThis && typeof WebSocket !== 'undefined';

    await new Promise<void>((resolve, reject) => {
      if (useBrowserSocket) {
        // Browsers cannot set WS headers — credential rides the token query param.
        const url = `${this.wsUrl}/voice?token=${encodeURIComponent(this.credential)}`;
        const ws = new WebSocket(url);
        ws.binaryType = 'arraybuffer';
        this.ws = ws;
        ws.onopen = () => resolve();
        ws.onmessage = (event: { data?: unknown }) => this.enqueue(event.data ?? '');
        ws.onerror = () => reject(new Error('voice WS connection failed'));
        ws.onclose = (event: { code?: number; reason?: string }) =>
          this.handleClose(event.code ?? 1006, String(event.reason ?? ''));
        return;
      }
      loadNodeWebSocket()
        .then((NodeSocket) => {
          // Send the credential as both ?token= and an Authorization: Bearer
          // header so either server-side probe shape accepts the session.
          const ws = new NodeSocket(`${this.wsUrl}/voice?token=${encodeURIComponent(this.credential)}`, {
            headers: { Authorization: `Bearer ${this.credential}` },
          });
          this.ws = ws;
          ws.on('open', () => resolve());
          ws.on('message', (data: NodeWebSocket.RawData, isBinary: boolean) =>
            this.enqueue(isBinary ? data : textFromRaw(data)));
          ws.on('error', (error: Error) => reject(error));
          ws.on('close', (code: number, reason: Buffer) =>
            this.handleClose(code ?? 1006, reason?.toString() ?? ''));
        })
        .catch(() => reject(new Error('WebSocket is not available in this environment')));
    });

    this.state = 'idle';
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

  async cancel(requestId: string): Promise<void> {
    this.send({ type: 'cancel', request_id: requestId });
  }

  /** Speak text with a preset voice. */
  async *speak(options: SpeakOptions): AsyncGenerator<VoiceChunkEvent, void, undefined> {
    yield* this.runSpeak(
      'tts',
      {
        text: options.text,
        voice: options.voice ?? 'serena',
        language: options.language ?? 'auto',
      },
      options,
    );
  }

  /** Speak text in a voice cloned from reference audio. */
  async *speakClone(options: CloneSpeakOptions): AsyncGenerator<VoiceChunkEvent, void, undefined> {
    yield* this.runSpeak(
      'clone',
      {
        text: options.text,
        ref_audio_base64: encodeBase64(options.refAudio),
        language: options.language ?? 'auto',
        x_vector_only: options.xVectorOnly ?? true,
      },
      options,
    );
  }

  /** Speak text in a voice designed from a natural-language description. */
  async *speakDesign(options: DesignSpeakOptions): AsyncGenerator<VoiceChunkEvent, void, undefined> {
    yield* this.runSpeak(
      'design',
      {
        text: options.text,
        instruct: options.description,
        language: options.language ?? 'auto',
      },
      options,
    );
  }

  private async *runSpeak(
    op: string,
    body: Record<string, unknown>,
    options: { format?: string; chunks?: boolean; requestId?: string },
  ): AsyncGenerator<VoiceChunkEvent, void, undefined> {
    if (!this.ws || this.state === 'closed') {
      throw new Error("Session is not connected; call open() first");
    }
    if (this.state !== 'idle') {
      throw new Error(`Session is ${this.state}; one request at a time`);
    }

    const requestId = options.requestId ?? randomRequestId();
    const deadline = Date.now() + this.timeoutMs;
    this.state = 'rendering';
    let finished = false;
    try {
      this.send({
        type: 'speak',
        request_id: requestId,
        op,
        format: options.format ?? 'mp3',
        chunks: options.chunks ?? true,
        ...body,
      });

      let expectedSeq = 0;
      let receivedChunks = 0;
      let sawFinal = false;

      while (true) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          throw new VoiceStreamError('timeout', `voice stream timed out after ${this.timeoutMs}ms`);
        }
        const raw = await this.nextMessage(remaining);
        if (typeof raw !== 'string' && !isTextBuffer(raw)) {
          throw new VoiceStreamError('protocol', 'Unexpected binary frame without audio header');
        }
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(textFromRaw(raw)) as Record<string, unknown>;
        } catch {
          throw new VoiceStreamError('protocol', 'Expected JSON control frame');
        }
        const rid = String(message.request_id ?? '');
        if (rid !== '' && rid !== requestId) continue;

        switch (message.type) {
          case 'audio': {
            if (sawFinal) {
              throw new VoiceStreamError('protocol', 'Audio frame received after final chunk');
            }
            const seq = Number(message.seq ?? -1);
            if (seq !== expectedSeq) {
              throw new VoiceStreamError('protocol', `Unexpected audio sequence: expected ${expectedSeq}, got ${seq}`);
            }
            const expected = Number(message.bytes ?? -1);
            if (expected < 0) {
              throw new VoiceStreamError('protocol', 'Audio header has invalid byte length');
            }
            const payloadRaw = await this.nextMessage(Math.max(0, deadline - Date.now()));
            const audio = bytesFromRaw(payloadRaw);
            if (audio.length !== expected) {
              throw new VoiceStreamError('protocol', `Audio payload length mismatch: expected ${expected}, got ${audio.length}`);
            }
            const total = Number(message.total ?? 1);
            const final = Boolean(message.final);
            if (total < 1 || seq >= total) {
              throw new VoiceStreamError('protocol', `Invalid audio total ${total} for sequence ${seq}`);
            }
            expectedSeq += 1;
            receivedChunks += 1;
            sawFinal = final;
            this.state = 'receiving';
            yield {
              requestId,
              index: seq,
              total,
              audio,
              final,
            };
            break;
          }
          case 'done':
            if (message.total_chunks !== undefined && Number(message.total_chunks) !== receivedChunks) {
              throw new VoiceStreamError('protocol', `Done chunk count mismatch: expected ${receivedChunks}, got ${String(message.total_chunks)}`);
            }
            if (message.chunks !== undefined && Number(message.chunks) !== receivedChunks) {
              throw new VoiceStreamError('protocol', `Done chunk count mismatch: expected ${receivedChunks}, got ${String(message.chunks)}`);
            }
            if (receivedChunks > 0 && !sawFinal) {
              throw new VoiceStreamError('protocol', 'Done received before final audio chunk');
            }
            finished = true;
            return;
          case 'error':
            finished = true;
            throw new VoiceStreamError(String(message.code ?? ''), String(message.detail ?? ''));
          default:
            break;
        }
      }
    } finally {
      if (!finished && this.ws) {
        // Consumer bailed early (or timed out) — cancel server-side.
        try {
          await this.cancel(requestId);
        } catch {
          // socket may already be gone
        }
      }
      this.state = this.ws ? 'idle' : 'closed';
    }
  }

  private send(message: Record<string, unknown>): void {
    if (!this.ws) {
      throw new Error('Session is not connected');
    }
    this.ws.send(JSON.stringify(message));
  }

  private enqueue(raw: unknown): void {
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
    this.closeError = new Error(`voice WS closed (${code}): ${reason || 'connection closed'}`);
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter.reject(this.closeError);
    }
  }

  private nextMessage(timeoutMs: number): Promise<unknown> {
    const queued = this.messages.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }
    if (!this.ws) {
      return Promise.reject(this.closeError ?? new Error('Session is not connected'));
    }
    return new Promise<unknown>((resolve, reject) => {
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

function isTextBuffer(raw: unknown): boolean {
  return typeof Buffer !== 'undefined' && Buffer.isBuffer(raw);
}

function textFromRaw(raw: unknown): string {
  if (Array.isArray(raw)) return Buffer.concat(raw as Buffer[]).toString();
  return typeof raw === 'string' ? raw : Buffer.from(raw as Uint8Array).toString();
}

function bytesFromRaw(raw: unknown): Uint8Array {
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (Array.isArray(raw)) return new Uint8Array(Buffer.concat(raw as Buffer[]));
  throw new VoiceStreamError('protocol', 'Expected binary audio payload after audio header');
}
