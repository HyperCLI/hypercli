/**
 * Web Audio playback for streamed TTS chunks.
 *
 * The desktop CSP has no media-src, so `<audio>`/blob URLs are out
 * (AGENTS.md rules 5-8); chunks are decoded with `decodeAudioData` and
 * scheduled back-to-back on a shared AudioContext instead.
 *
 * Cancellation: {@link VoicePlayer.speak} supersedes any in-flight playback,
 * and {@link VoicePlayer.stop} silences it. This is the "trail off, then the
 * next turn reads fresh" policy — a new turn never queues behind the old one.
 *
 * All failures are logged, never surfaced: spoken replies are ambient.
 */

/** Structural subset of AudioContext so tests can drive a fake clock. */
export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: unknown;
  readonly state?: string;
  resume?(): Promise<void>;
  decodeAudioData(data: ArrayBuffer): Promise<{ duration: number }>;
  createBufferSource(): BufferSourceLike;
}

export interface BufferSourceLike {
  buffer: { duration: number } | null;
  connect(destination: unknown): void;
  start(when?: number): void;
  stop(): void;
  onended: ((...args: never[]) => void) | null;
}

export type AudioContextFactory = () => AudioContextLike;

/** How far ahead of now the next chunk is scheduled, in seconds. */
const SCHEDULE_LEAD_S = 0.05;

export class VoicePlayer {
  private ctx: AudioContextLike | null = null;
  private generation = 0;
  private readonly sources = new Set<BufferSourceLike>();

  constructor(private readonly createContext: AudioContextFactory = () => new AudioContext()) {}

  /** Current playback generation; exposed for tests. */
  get activeGeneration(): number {
    return this.generation;
  }

  get playing(): boolean {
    return this.sources.size > 0;
  }

  /** Silence whatever is playing (or being decoded) right now. */
  stop(): void {
    this.generation += 1;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already finished.
      }
    }
    this.sources.clear();
  }

  /**
   * Decode and play an ordered chunk stream. Any previous playback is
   * stopped first (cancel-on-new-turn). Fire-and-forget: errors land in the
   * console only.
   */
  speak(chunks: AsyncIterable<Uint8Array>): void {
    const generation = ++this.generation;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already finished.
      }
    }
    this.sources.clear();
    void this.run(generation, chunks);
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  private audioContext(): AudioContextLike {
    if (!this.ctx) this.ctx = this.createContext();
    return this.ctx;
  }

  private async run(generation: number, chunks: AsyncIterable<Uint8Array>): Promise<void> {
    try {
      const ctx = this.audioContext();
      if (ctx.state === "suspended" && ctx.resume) {
        // Autoplay policies leave a context suspended until a gesture; the
        // decode/schedule path is unaffected, so resume is best-effort.
        ctx.resume().catch(() => {});
      }
      let nextStart = 0;
      for await (const audio of chunks) {
        if (!this.isCurrent(generation)) return;
        let buffer: { duration: number };
        try {
          // decodeAudioData detaches its input, and the SDK's chunk may be a
          // view over a larger buffer — copy into a fresh ArrayBuffer.
          buffer = await ctx.decodeAudioData(audio.slice().buffer as ArrayBuffer);
        } catch (error) {
          // One undecodable chunk must not kill the rest of the reply.
          console.error("[hypercli] read-aloud chunk decode failed:", error);
          continue;
        }
        if (!this.isCurrent(generation)) return;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        const startAt = Math.max(nextStart, ctx.currentTime + SCHEDULE_LEAD_S);
        source.start(startAt);
        nextStart = startAt + buffer.duration;
        this.sources.add(source);
        source.onended = () => this.sources.delete(source);
      }
    } catch (error) {
      if (this.isCurrent(generation)) {
        console.error("[hypercli] read-aloud playback failed:", error);
      }
    }
  }
}

/** Exactly one chat is on screen, so one player is the cancellation authority. */
export const readAloudPlayer = new VoicePlayer();
