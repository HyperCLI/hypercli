/**
 * Microphone capture for push-to-talk dictation.
 *
 * Why MediaRecorder and not raw PCM: the STT worker decodes an *encoded
 * container*, not raw s16le. The chunks emitted here concatenate into one
 * complete webm/mp4 stream whose magic bytes the worker identifies
 * server-side — the /ws/voice/transcribe protocol carries no format or
 * suffix parameter (confirmed in every client: ts-sdk, the Python SDK, and
 * the CLI's `hyper voice transcribe <file>` all send bare frames).
 *
 * The container is whatever the platform offers, chosen from
 * {@link MIC_MIME_PREFERENCE} at runtime: Chromium answers opus-in-webm,
 * WKWebView (the packaged shell) answers `audio/mp4`. TCC prompts and the
 * 13.3+ getUserMedia floor are the webview's concern — all this module does
 * beyond feature detection is `getUserMedia({ audio: true })`.
 */

export const MIC_MIME_PREFERENCE = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"] as const;

const MIME_EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
};

/** The first MIME type the recorder supports, in preference order; null when none. */
export function pickSupportedMimeType(
  isTypeSupported?: (mimeType: string) => boolean,
  preference: readonly string[] = MIC_MIME_PREFERENCE,
): string | null {
  const supported =
    isTypeSupported ??
    ((mimeType: string) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mimeType));
  for (const mimeType of preference) {
    if (supported(mimeType)) return mimeType;
  }
  return null;
}

/** File extension for a captured container ("webm", "m4a"). Diagnostic seam: the wire protocol has nowhere to send it. */
export function audioContainerExtension(mimeType: string): string {
  return MIME_EXTENSIONS[mimeType.split(";")[0].trim().toLowerCase()] ?? "bin";
}

/**
 * Whether dictation can run at all in this webview. Drives the mic button's
 * visibility: on a WKWebView without getUserMedia (macOS < 13.3) or without
 * any usable recorder container, the button hides rather than dead-ends.
 */
export function micCaptureSupported(env?: {
  hasGetUserMedia?: boolean;
  isTypeSupported?: (mimeType: string) => boolean;
}): boolean {
  if (env) {
    return Boolean(env.hasGetUserMedia) && pickSupportedMimeType(env.isTypeSupported) !== null;
  }
  if (typeof navigator === "undefined" || typeof navigator.mediaDevices?.getUserMedia !== "function") {
    return false;
  }
  return pickSupportedMimeType() !== null;
}

export interface MicCaptureHandlers {
  onChunk: (bytes: Uint8Array) => void;
  onError: (error: unknown) => void;
}

/** One live recording: mic stream plus its MediaRecorder. */
export class MicCapture {
  private stopped = false;
  /** Chunk delivery chain; also what {@link stop} drains. Keeps chunk order strict. */
  private pending: Promise<void> = Promise.resolve();

  private constructor(
    private readonly stream: MediaStream,
    private readonly recorder: MediaRecorder,
    readonly mimeType: string,
  ) {}

  static async start(handlers: MicCaptureHandlers): Promise<MicCapture> {
    const mimeType = pickSupportedMimeType();
    if (!mimeType) throw new Error("This webview has no supported audio recorder format.");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    try {
      const recorder = new MediaRecorder(stream, { mimeType });
      const capture = new MicCapture(stream, recorder, mimeType);
      recorder.ondataavailable = (event: BlobEvent) => {
        if (!event.data || event.data.size === 0) return;
        capture.pending = capture.pending.then(async () => {
          handlers.onChunk(new Uint8Array(await event.data.arrayBuffer()));
        });
      };
      recorder.onerror = (event: Event) => {
        handlers.onError((event as { error?: unknown }).error ?? new Error("The microphone recorder failed."));
      };
      recorder.start(250);
      return capture;
    } catch (error) {
      for (const track of stream.getTracks()) track.stop();
      throw error;
    }
  }

  get extension(): string {
    return audioContainerExtension(this.mimeType);
  }

  /**
   * Stop the recorder and release the mic. Resolves only after the final
   * `dataavailable` burst has been delivered to `onChunk`, so callers can
   * commit the session with no audio lost. Idempotent.
   */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    const recorder = this.recorder;
    if (recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });
    }
    await this.pending;
    for (const track of this.stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // A track that already ended is not an error.
      }
    }
  }
}
