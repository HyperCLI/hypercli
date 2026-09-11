/**
 * Read-aloud controller: the one place a finished turn becomes speech.
 *
 * Composes the pure flattening (voice-read.ts), the TTS socket (api.ts
 * boundary) and the Web Audio queue (voice-player.ts) behind a module-level
 * singleton — exactly one chat renders at a time, so one authority decides
 * what is speaking.
 *
 * Policy: reads only when the persisted pref is on; a new read supersedes
 * the in-flight one; every failure is logged and swallowed.
 */
import { speechStream } from "../api";
import { readAloudPlayer, type VoicePlayer } from "./voice-player";
import { flattenForSpeech, readAloudEnabled } from "./voice-read";

export class ReadAloudController {
  private generation = 0;
  private cancelStream: (() => void) | null = null;

  constructor(private readonly player: VoicePlayer = readAloudPlayer) {}

  /** Silences playback, cancels any in-flight TTS stream. Idempotent. */
  stop(): void {
    this.generation += 1;
    this.cancelStream?.();
    this.cancelStream = null;
    this.player.stop();
  }

  /**
   * Read a completed turn's reply unconditionally. Empty/code-only turns
   * flatten to "" and are a no-op. `voice` is opaque here — api.ts decides
   * what a voice reference looks like (see `agentTtsVoice`).
   */
  async read(text: string, options: { voice?: string } = {}): Promise<void> {
    const flattened = flattenForSpeech(text);
    this.stop();
    if (!flattened) return;
    const generation = this.generation;
    try {
      const stream = await speechStream(flattened, { voice: options.voice });
      if (generation !== this.generation) {
        stream.cancel();
        return;
      }
      this.cancelStream = stream.cancel;
      // The player consumes the chunk generator itself: an early stop() runs
      // the generator's finally, which cancels server-side and closes the
      // socket.
      this.player.speak(stream.chunks);
    } catch (error) {
      if (generation === this.generation) {
        console.error("[hypercli] read-aloud failed:", error);
      }
    }
  }

  /**
   * Read a completed turn only when the user has the toggle on. This is the
   * call sites' entry point.
   */
  async readIfEnabled(text: string, options: { voice?: string } = {}): Promise<void> {
    if (!readAloudEnabled()) return;
    await this.read(text, options);
  }
}

/** The app's single read-aloud authority. */
export const readAloud = new ReadAloudController();
