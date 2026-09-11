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

import type { VoiceChunkEvent } from "../../../ts-sdk/src/voice-session.ts";

export type VoicePlayerChunk = Uint8Array | VoiceChunkEvent;

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
  speak(chunks: AsyncIterable<VoicePlayerChunk>): void {
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

  private async run(generation: number, chunks: AsyncIterable<VoicePlayerChunk>): Promise<void> {
    try {
      const ctx = this.audioContext();
      if (ctx.state === "suspended" && ctx.resume) {
        // Autoplay policies leave a context suspended until a gesture; the
        // decode/schedule path is unaffected, so resume is best-effort.
        ctx.resume().catch(() => {});
      }
      let nextStart = 0;
      for await (const chunk of chunks) {
        if (!this.isCurrent(generation)) return;
        let buffer: { duration: number };
        try {
          buffer = isPcmChunk(chunk)
            ? pcmChunkToBuffer(ctx, chunk)
            : await decodeEncodedChunk(ctx, chunkAudio(chunk));
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

function chunkAudio(chunk: VoicePlayerChunk): Uint8Array {
  return chunk instanceof Uint8Array ? chunk : chunk.audio;
}

function isPcmChunk(chunk: VoicePlayerChunk): chunk is VoiceChunkEvent {
  if (chunk instanceof Uint8Array) return false;
  const format = chunk.metadata?.format?.toLowerCase();
  const contentType = chunk.metadata?.contentType?.toLowerCase();
  return format === "pcm" || contentType === "audio/pcm";
}

async function decodeEncodedChunk(ctx: AudioContextLike, audio: Uint8Array): Promise<{ duration: number }> {
  // decodeAudioData detaches its input, and the SDK's chunk may be a view over
  // a larger buffer — copy into a fresh ArrayBuffer.
  return ctx.decodeAudioData(audio.slice().buffer as ArrayBuffer);
}

function pcmChunkToBuffer(ctx: AudioContextLike, chunk: VoiceChunkEvent): AudioBufferLike {
  const sampleRate = chunk.metadata?.sampleRate ?? 24_000;
  const channels = chunk.metadata?.channels ?? 1;
  const sampleFormat = chunk.metadata?.sampleFormat ?? "s16le";
  if (sampleFormat.toLowerCase() !== "s16le") {
    throw new Error(`Unsupported PCM sample format: ${sampleFormat}`);
  }
  if ((chunk.metadata?.bytesPerSample ?? 2) !== 2) {
    throw new Error(`Unsupported PCM bytes per sample: ${chunk.metadata?.bytesPerSample}`);
  }
  if (!Number.isInteger(channels) || channels < 1) {
    throw new Error(`Unsupported PCM channel count: ${channels}`);
  }
  const audio = chunk.audio;
  const sampleBytes = 2;
  const frameBytes = channels * sampleBytes;
  if (audio.byteLength % frameBytes !== 0) {
    throw new Error("PCM chunk length is not aligned to complete frames");
  }
  const frames = audio.byteLength / frameBytes;
  const buffer = ctx.createBuffer(channels, frames, sampleRate);
  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  for (let channel = 0; channel < channels; channel += 1) {
    const output = buffer.getChannelData(channel);
    for (let frame = 0; frame < frames; frame += 1) {
      output[frame] = view.getInt16((frame * channels + channel) * sampleBytes, true) / 32768;
    }
  }
  return buffer;
}

/** Exactly one chat is on screen, so one player is the cancellation authority. */
export const readAloudPlayer = new VoicePlayer();
