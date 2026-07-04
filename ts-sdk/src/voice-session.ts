/**
 * Voice streaming session over the /ws/voice WebSocket.
 *
 * The server owns text chunking; a session receives an ordered stream of
 * audio chunks. One request at a time: idle → rendering → receiving → idle.
 * Works in both Node (`ws` package, Authorization header) and the browser
 * (global WebSocket, `?jwt=` query — browsers cannot set WS headers).
 */
import NodeWebSocket from 'ws';

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
  /** API key (hyper_api_...) or JWT. */
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

export class VoiceStreamError extends Error {
  constructor(
    public readonly code: string,
    public readonly detail: string,
  ) {
    super(`voice stream error ${code}: ${detail}`);
    this.name = 'VoiceStreamError';
  }
}

function decodeBase64(value: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(value, 'base64'));
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function randomRequestId(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

interface Waiter {
  resolve: (value: string) => void;
  reject: (error: Error) => void;
}

export class VoiceSession {
  state: VoiceSessionState = 'closed';

  private readonly wsUrl: string;
  private readonly credential: string;
  private readonly timeoutMs: number;
  private ws: WebSocket | NodeWebSocket | null = null;
  private messages: string[] = [];
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
    if (!useBrowserSocket && typeof NodeWebSocket === 'undefined') {
      throw new Error('WebSocket is not available in this environment');
    }

    await new Promise<void>((resolve, reject) => {
      if (useBrowserSocket) {
        // Browsers cannot set WS headers — credential rides the jwt query param.
        const url = `${this.wsUrl}/voice?jwt=${encodeURIComponent(this.credential)}`;
        const ws = new WebSocket(url);
        this.ws = ws;
        ws.onopen = () => resolve();
        ws.onmessage = (event: { data?: unknown }) => this.enqueue(String(event.data ?? ''));
        ws.onerror = () => reject(new Error('voice WS connection failed'));
        ws.onclose = (event: { code?: number; reason?: string }) =>
          this.handleClose(event.code ?? 1006, String(event.reason ?? ''));
        return;
      }
      const ws = new NodeWebSocket(`${this.wsUrl}/voice`, {
        headers: { Authorization: `Bearer ${this.credential}` },
      });
      this.ws = ws;
      ws.on('open', () => resolve());
      ws.on('message', (data: NodeWebSocket.RawData) =>
        this.enqueue(typeof data === 'string' ? data : data.toString()));
      ws.on('error', (error: Error) => reject(error));
      ws.on('close', (code: number, reason: Buffer) =>
        this.handleClose(code ?? 1006, reason?.toString() ?? ''));
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

  async *speak(options: SpeakOptions): AsyncGenerator<VoiceChunkEvent, void, undefined> {
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
        text: options.text,
        voice: options.voice ?? 'serena',
        language: options.language ?? 'auto',
        format: options.format ?? 'mp3',
        chunks: options.chunks ?? true,
      });

      while (true) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          throw new VoiceStreamError('timeout', `voice stream timed out after ${this.timeoutMs}ms`);
        }
        const raw = await this.nextMessage(remaining);
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          continue;
        }
        const rid = String(message.request_id ?? '');
        if (rid !== '' && rid !== requestId) continue;

        switch (message.type) {
          case 'chunk': {
            this.state = 'receiving';
            yield {
              requestId,
              index: Number(message.index ?? 0),
              total: Number(message.total ?? 1),
              audio: decodeBase64(String(message.audio_b64 ?? '')),
              final: Boolean(message.final),
            };
            break;
          }
          case 'done':
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
    this.closeError = new Error(`voice WS closed (${code}): ${reason || 'connection closed'}`);
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter.reject(this.closeError);
    }
  }

  private nextMessage(timeoutMs: number): Promise<string> {
    const queued = this.messages.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }
    if (!this.ws) {
      return Promise.reject(this.closeError ?? new Error('Session is not connected'));
    }
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
