export interface AudioBufferLike {
  readonly duration: number;
  getChannelData(channel: number): Float32Array;
}

/** Structural subset of AudioContext so tests can drive a fake clock. */
export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: unknown;
  readonly state?: string;
  resume?(): Promise<void>;
  decodeAudioData(data: ArrayBuffer): Promise<{ duration: number }>;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike;
  createBufferSource(): BufferSourceLike;
}

export interface BufferSourceLike {
  buffer: { duration: number } | null;
  connect(destination: unknown): void;
  start(when?: number): void;
  stop(): void;
  onended: ((...args: never[]) => void) | null;
}

export type WebAudioPlaybackState =
  | { name: "idle"; queued: number }
  | { name: "playing"; queued: number };

type ActivePlaybackState =
  | { name: "idle" }
  | { name: "playing"; source: BufferSourceLike };

export interface WebAudioUnlockDiagnostic {
  ok: boolean;
  contextState?: string;
  error?: unknown;
}

export class WebAudioPlaybackQueue {
  private state: ActivePlaybackState = { name: "idle" };
  private readonly queued: AudioBufferLike[] = [];

  constructor(private readonly ctx: AudioContextLike) {}

  get playing(): boolean {
    return this.state.name === "playing" || this.queued.length > 0;
  }

  snapshot(): WebAudioPlaybackState {
    return { name: this.state.name, queued: this.queued.length };
  }

  enqueue(buffer: AudioBufferLike): void {
    this.queued.push(buffer);
    this.pump();
  }

  stop(): void {
    this.queued.length = 0;
    if (this.state.name === "playing") {
      const source = this.state.source;
      this.state = { name: "idle" };
      try {
        source.stop();
      } catch {
        // Already ended.
      }
      return;
    }
    this.state = { name: "idle" };
  }

  private pump(): void {
    if (this.state.name !== "idle") return;
    const buffer = this.queued.shift();
    if (!buffer) return;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    this.state = { name: "playing", source };
    source.onended = () => {
      if (this.state.name === "playing" && this.state.source === source) {
        this.state = { name: "idle" };
        this.pump();
      }
    };
    source.start();
  }
}

/**
 * Resume the context and prove it. Packaged WKWebView can resolve `resume()`
 * while the context stays `suspended`, so success is reported only when
 * `state === "running"` after the attempt — never because resume() resolved.
 */
export async function unlockWebAudio(ctx: AudioContextLike): Promise<WebAudioUnlockDiagnostic> {
  try {
    if (ctx.state !== "running" && ctx.resume) await ctx.resume();
    if (ctx.state !== "running") return { ok: false, contextState: ctx.state };
    const silent = ctx.createBuffer(1, 1, 24_000);
    const source = ctx.createBufferSource();
    source.buffer = silent;
    source.connect(ctx.destination);
    source.start(ctx.currentTime);
    return { ok: true, contextState: ctx.state };
  } catch (error) {
    return { ok: false, contextState: ctx.state, error };
  }
}
