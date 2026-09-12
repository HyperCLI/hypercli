/**
 * Web Audio playback for streamed TTS chunks.
 *
 * The desktop CSP has no media-src, so `<audio>`/blob URLs are out
 * (AGENTS.md rules 5-8); chunks are decoded with `decodeAudioData` and
 * fed into a small playback queue instead.
 *
 * Cancellation: {@link VoicePlayer.speak} supersedes any in-flight playback,
 * and {@link VoicePlayer.stop} silences it. This is the "trail off, then the
 * next turn reads fresh" policy — a new turn never queues behind the old one.
 *
 * All failures are logged, never surfaced: spoken replies are ambient.
 */

import type { VoiceChunkEvent } from "../../../ts-sdk/src/voice-session.ts";
import { WebAudioPlaybackQueue, unlockWebAudio, type AudioContextLike, type AudioBufferLike, type WebAudioPlaybackState, type WebAudioUnlockDiagnostic } from "./web-audio-playback";

export type { AudioBufferLike, AudioContextLike, BufferSourceLike, WebAudioUnlockDiagnostic } from "./web-audio-playback";

export type VoicePlayerChunk = Uint8Array | VoiceChunkEvent;

export type AudioContextFactory = () => AudioContextLike;

export interface VoicePlayerDiagnostics {
  generation: number;
  playing: boolean;
  audioContextState?: string;
  playback: WebAudioPlaybackState;
  lastUnlock?: WebAudioUnlockDiagnostic;
  lastError?: unknown;
}

export class VoicePlayer {
  private ctx: AudioContextLike | null = null;
  private playback: WebAudioPlaybackQueue | null = null;
  private generation = 0;
  private queueTail: Promise<void> = Promise.resolve();
  private lastUnlock: WebAudioUnlockDiagnostic | undefined;
  private lastError: unknown;

  constructor(private readonly createContext: AudioContextFactory = () => new AudioContext()) {}

  /** Current playback generation; exposed for tests. */
  get activeGeneration(): number {
    return this.generation;
  }

  get playing(): boolean {
    return this.playback?.playing ?? false;
  }

  /** Whether the context exists and was verified `running` (not just resumed). */
  get unlocked(): boolean {
    return this.ctx?.state === "running";
  }

  diagnostics(): VoicePlayerDiagnostics {
    return {
      generation: this.generation,
      playing: this.playing,
      audioContextState: this.ctx?.state,
      playback: this.playback?.snapshot() ?? { name: "idle", queued: 0 },
      lastUnlock: this.lastUnlock,
      lastError: this.lastError,
    };
  }

  /**
   * Warm/unlock Web Audio while still inside a user gesture. WKWebView in the
   * packaged app may refuse to start an AudioContext created later, when the
   * agent reply finally streams back.
   */
  async prepare(): Promise<WebAudioUnlockDiagnostic> {
    let diagnostic: WebAudioUnlockDiagnostic;
    try {
      diagnostic = await unlockWebAudio(this.audioContext());
    } catch (error) {
      diagnostic = { ok: false, error };
    }
    this.lastUnlock = diagnostic;
    if (!diagnostic.ok) {
      this.lastError = diagnostic.error;
      console.error("[hypercli] read-aloud audio unlock failed:", diagnostic.error);
    }
    return diagnostic;
  }

  /** Silence whatever is playing (or being decoded) right now. */
  stop(): void {
    this.generation += 1;
    this.playback?.stop();
    this.queueTail = Promise.resolve();
  }

  /**
   * Decode and play an ordered chunk stream. Any previous playback is
   * stopped first (cancel-on-new-turn). Fire-and-forget: errors land in the
   * console only.
   */
  speak(chunks: AsyncIterable<VoicePlayerChunk>): void {
    const generation = ++this.generation;
    this.playback?.stop();
    this.queueTail = this.run(generation, chunks);
  }

  /** Queue chunks after already scheduled playback without cancelling it. */
  enqueue(chunks: AsyncIterable<VoicePlayerChunk>): void {
    const generation = this.generation;
    this.queueTail = this.queueTail.then(
      () => this.run(generation, chunks),
      () => this.run(generation, chunks),
    );
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  private audioContext(): AudioContextLike {
    if (!this.ctx) this.ctx = this.createContext();
    if (!this.playback) this.playback = new WebAudioPlaybackQueue(this.ctx);
    return this.ctx;
  }

  private async run(generation: number, chunks: AsyncIterable<VoicePlayerChunk>): Promise<void> {
    try {
      const ctx = this.audioContext();
      if (ctx.state === "suspended" && ctx.resume) {
        // Autoplay policies leave a context suspended until a gesture; the
        // decode/schedule path is unaffected, so wait before scheduling.
        await ctx.resume();
      }
      if (ctx.state && ctx.state !== "running") {
        // A suspended context accepts scheduled sources silently and never
        // ends them — the UI would claim "playing" forever. Refuse instead;
        // the caller surfaces the Replay state.
        throw new Error(`Audio context is ${ctx.state}, refusing to schedule playback`);
      }
      for await (const chunk of chunks) {
        if (!this.isCurrent(generation)) return;
        let buffer: { duration: number };
        try {
          buffer = isPcmChunk(chunk) ? pcmBytesToBuffer(ctx, chunk.audio, chunk.metadata) : await decodeEncodedChunk(ctx, chunkAudio(chunk));
        } catch (error) {
          // One undecodable chunk must not kill the rest of the reply.
          this.lastError = error;
          console.error("[hypercli] read-aloud chunk decode failed:", error);
          continue;
        }
        if (!this.isCurrent(generation)) return;
        this.playback?.enqueue(buffer as AudioBufferLike);
      }
    } catch (error) {
      if (this.isCurrent(generation)) {
        this.lastError = error;
        console.error("[hypercli] read-aloud playback failed:", error);
      }
    }
  }
}

type VoiceAudioMetadata = NonNullable<VoiceChunkEvent["metadata"]>;

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

function pcmBytesToBuffer(ctx: AudioContextLike, audio: Uint8Array, metadata?: VoiceAudioMetadata): AudioBufferLike {
  const sampleRate = metadata?.sampleRate ?? 24_000;
  const channels = metadata?.channels ?? 1;
  const sampleFormat = metadata?.sampleFormat ?? "s16le";
  if (sampleFormat.toLowerCase() !== "s16le") {
    throw new Error(`Unsupported PCM sample format: ${sampleFormat}`);
  }
  if ((metadata?.bytesPerSample ?? 2) !== 2) {
    throw new Error(`Unsupported PCM bytes per sample: ${metadata?.bytesPerSample}`);
  }
  if (!Number.isInteger(channels) || channels < 1) {
    throw new Error(`Unsupported PCM channel count: ${channels}`);
  }
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

/** Minimal event-target surface so tests can drive a fake. */
export interface WarmupTarget {
  addEventListener(type: string, listener: () => void, options?: { capture?: boolean }): void;
  removeEventListener(type: string, listener: () => void, options?: { capture?: boolean }): void;
}

/**
 * Belt-and-suspenders Web Audio unlock. The header speaker button is the
 * authoritative enable gesture, but any capture-phase pointerdown/click may
 * also be the gesture the webview accepts — so every one of them re-attempts
 * the resume until the context is verified running (no-op after). Returns an
 * uninstaller.
 */
export function installVoicePlaybackWarmup(
  player: VoicePlayer = readAloudPlayer,
  target: WarmupTarget | undefined = typeof window === "undefined" ? undefined : window,
): () => void {
  if (!target) return () => {};
  const warm = () => {
    if (player.unlocked) return;
    void player.prepare();
  };
  target.addEventListener("pointerdown", warm, { capture: true });
  target.addEventListener("click", warm, { capture: true });
  return () => {
    target.removeEventListener("pointerdown", warm, { capture: true });
    target.removeEventListener("click", warm, { capture: true });
  };
}
