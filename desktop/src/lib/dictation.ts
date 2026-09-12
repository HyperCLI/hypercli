/**
 * Push-to-talk dictation: the composer's voice-input state machine.
 *
 * ```
 *   idle ──toggle──► starting ──started──► recording ──toggle──► transcribing ──final──► idle (inserts)
 *     ▲    ◄────────── cancel ──────────────┴─────────── cancel ───────────────┘
 *     └──── failed (mic/session/stream) from any non-idle state — reported to the ErrorBar
 * ```
 *
 * - One AttemptSlot covers start → record → finish; cancel aborts it and
 *   teardown (recorder stop + socket close) is idempotent (FSM.md guarantees
 *   1–2). Async continuations guard on `slot.owns(attempt)` before touching
 *   state, and reducers re-check the state name, so late events are inert.
 * - Failures publish to the ErrorBar via connection-errors and the machine
 *   lands back on `idle` — the bar, not a sticky machine state, is the
 *   persistent surface a user can dismiss (FSM.md guarantee 5).
 * - No ghost text: the protocol buffers audio until commit, so only
 *   `transcript.final` is ever delivered to the draft.
 */
import { Machine } from "./machine";
import {
  clearConnectionIssue,
  reportConnectionError,
  reportConnectionIssue,
} from "./connection-errors";
import {
  createDesktopDictationService,
  isDictationServiceError,
  wrapDictationFailure,
} from "./dictation-service";

// ---------------------------------------------------------------------------
// Shapes (structural, so tests never touch the SDK or a real mic)
// ---------------------------------------------------------------------------

export interface DictationStreamEvent {
  type: string;
  text?: string;
}

export interface DictationSessionLike {
  sendAudio(bytes: Uint8Array): void;
  commit(): void;
  events(): AsyncGenerator<DictationStreamEvent, void, undefined>;
  close(): void;
}

export interface DictationCaptureLike {
  readonly mimeType: string;
  /** Stops mic + recorder; resolves after the final chunk has been delivered. */
  stop(): Promise<void>;
}

export interface DictationDeps {
  openSession: () => Promise<DictationSessionLike>;
  startCapture: (handlers: {
    onChunk: (bytes: Uint8Array) => void;
    onError: (error: unknown) => void;
  }) => Promise<DictationCaptureLike>;
}

export type DictationState =
  | { readonly name: "idle" }
  | { readonly name: "starting" }
  | { readonly name: "recording" }
  | { readonly name: "transcribing" };

export type DictationEvent =
  | { readonly type: "toggle" }
  | { readonly type: "cancel" }
  | { readonly type: "started"; attempt: number }
  | { readonly type: "final"; attempt: number; text: string }
  | { readonly type: "failed"; attempt: number; error: unknown };

// ---------------------------------------------------------------------------
// Error reporting
// ---------------------------------------------------------------------------

export const MIC_PERMISSION_ISSUE_ID = "dictation:mic-permission";
export const DICTATION_WS_OPEN_ISSUE_ID = "dictation:ws-open";
export const DICTATION_SESSION_ISSUE_ID = "dictation:session-failed";
export const DICTATION_MIC_ISSUE_ID = "dictation:mic";
export const DICTATION_RECORDER_ISSUE_ID = "dictation:recorder";

/** macOS TCC denial surfaces as a DOMException from getUserMedia. */
function isMicPermissionError(error: unknown): boolean {
  const candidate = isDictationServiceError(error) ? error.cause : error;
  return (
    typeof DOMException !== "undefined" &&
    candidate instanceof DOMException &&
    (candidate.name === "NotAllowedError" || candidate.name === "SecurityError")
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error ?? "No further detail was reported.");
}

// ---------------------------------------------------------------------------
// Draft insertion
// ---------------------------------------------------------------------------

/**
 * Splice dictated text into a draft. A space is added only where the splice
 * would otherwise glue words together; the caret lands right after the
 * inserted text. Without a usable selection the transcript appends to the end.
 */
export function insertTranscript(
  draft: string,
  transcript: string,
  selection?: { start: number; end: number } | null,
): { draft: string; caret: number } {
  const text = transcript.trim();
  if (!text) return { draft, caret: draft.length };
  const at =
    selection && selection.start >= 0 && selection.end >= selection.start && selection.end <= draft.length
      ? selection
      : { start: draft.length, end: draft.length };
  const before = draft.slice(0, at.start);
  const after = draft.slice(at.end);
  const lead = before.length > 0 && !/\s$/.test(before) ? " " : "";
  const trail = after.length > 0 && !/^\s/.test(after) ? " " : "";
  return { draft: `${before}${lead}${text}${trail}${after}`, caret: (before + lead + text).length };
}

// ---------------------------------------------------------------------------
// The machine
// ---------------------------------------------------------------------------

export class DictationMachine extends Machine<DictationState, DictationEvent> {
  private run: { capture: DictationCaptureLike; session: DictationSessionLike } | null = null;
  /** Chunks are accepted until the session is committed — the recorder's final flush must still land. */
  private acceptingChunks = false;
  private readonly transcriptListeners = new Set<(text: string) => void>();

  constructor(private readonly deps: DictationDeps) {
    super({ name: "idle" });
  }

  /** Mic-button intent: idle → start; starting → abort; recording → transcribe; transcribing → no-op. */
  toggle(): void {
    this.send({ type: "toggle" });
  }

  /** Esc path: discard the dictation; nothing is inserted. No-op when idle. */
  cancel(): void {
    this.send({ type: "cancel" });
  }

  onTranscript(listener: (text: string) => void): () => void {
    this.transcriptListeners.add(listener);
    return () => {
      this.transcriptListeners.delete(listener);
    };
  }

  protected reduce(state: DictationState, event: DictationEvent): void {
    switch (event.type) {
      case "toggle":
        if (state.name === "idle") this.commit({ name: "starting" });
        else if (state.name === "starting") {
          this.abortAttempt();
          this.commit({ name: "idle" });
        } else if (state.name === "recording") this.commit({ name: "transcribing" });
        // transcribing: the commit has gone out; only cancel (Esc) interrupts the wait.
        return;
      case "cancel":
        if (state.name !== "idle") {
          this.abortAttempt();
          this.commit({ name: "idle" });
        }
        return;
      case "started":
        if (state.name === "starting" && this.slot.owns(event.attempt)) this.commit({ name: "recording" });
        return;
      case "final":
        if (state.name === "transcribing" && this.slot.owns(event.attempt)) {
          const text = event.text.trim();
          if (text) for (const listener of [...this.transcriptListeners]) listener(text);
          this.teardownRun();
          this.commit({ name: "idle" });
        }
        return;
      case "failed":
        if (state.name === "idle" || !this.slot.owns(event.attempt)) return;
        this.reportFailure(event.error);
        this.teardownRun();
        this.commit({ name: "idle" });
        return;
    }
  }

  protected onEnter(state: DictationState): void {
    if (state.name === "starting") void this.runStart();
    else if (state.name === "transcribing") void this.runFinish();
  }

  protected onDispose(): void {
    this.teardownRun();
    this.transcriptListeners.clear();
  }

  private async runStart(): Promise<void> {
    const attempt = this.slot.begin();
    let capture: DictationCaptureLike | null = null;
    let session: DictationSessionLike | null = null;
    try {
      // Session first: audio that arrived before the socket opened would be dropped.
      session = await this.deps.openSession();
      if (!attempt.active) {
        session.close();
        return;
      }
      capture = await this.deps.startCapture({
        onChunk: (bytes) => this.handleChunk(attempt.id, bytes),
        onError: (error) =>
          this.send({ type: "failed", attempt: attempt.id, error: wrapDictationFailure("recorder", error) }),
      });
      if (!attempt.active) {
        await capture.stop();
        session.close();
        return;
      }
      this.run = { capture, session };
      this.acceptingChunks = true;
      // A working mic settles any earlier permission report.
      clearConnectionIssue(MIC_PERMISSION_ISSUE_ID);
      this.send({ type: "started", attempt: attempt.id });
    } catch (error) {
      if (capture) await capture.stop().catch(() => {});
      session?.close();
      if (attempt.active) this.send({ type: "failed", attempt: attempt.id, error });
    }
  }

  private async runFinish(): Promise<void> {
    const attempt = this.slot.current;
    const run = this.run;
    if (!attempt || !run) {
      this.send({
        type: "failed",
        attempt: attempt?.id ?? 0,
        error: wrapDictationFailure("session-failed", new Error("Dictation lost its session before it could transcribe.")),
      });
      return;
    }
    try {
      // stop() flushes the recorder's final chunk, which still flows through handleChunk.
      await run.capture.stop();
      this.acceptingChunks = false;
      if (!attempt.active) {
        run.session.close();
        return;
      }
      try {
        run.session.commit();
      } catch (error) {
        throw wrapDictationFailure("session-failed", error);
      }
      let text = "";
      try {
        for await (const event of run.session.events()) {
          if (event.type === "transcript.final") text = typeof event.text === "string" ? event.text : "";
        }
      } catch (error) {
        throw wrapDictationFailure("session-failed", error);
      }
      if (!attempt.active) return;
      this.send({ type: "final", attempt: attempt.id, text });
    } catch (error) {
      if (attempt.active) this.send({ type: "failed", attempt: attempt.id, error });
    }
  }

  private handleChunk(attemptId: number, bytes: Uint8Array): void {
    if (!this.slot.owns(attemptId) || !this.run || !this.acceptingChunks) return;
    try {
      this.run.session.sendAudio(bytes);
    } catch (error) {
      this.send({ type: "failed", attempt: attemptId, error });
    }
  }

  private reportFailure(error: unknown): void {
    if (isMicPermissionError(error)) {
      reportConnectionIssue({
        id: MIC_PERMISSION_ISSUE_ID,
        kind: "permission",
        title: "Microphone access is off",
        detail: "HyperCLI couldn't use the microphone for dictation because access is denied.",
        hint: "Allow HyperCLI in System Settings → Privacy & Security → Microphone, then try again.",
        at: Date.now(),
      });
      return;
    }
    if (isDictationServiceError(error)) {
      const message = errorMessage(error.cause);
      if (error.phase === "ws-open") {
        reportConnectionIssue({
          id: DICTATION_WS_OPEN_ISSUE_ID,
          kind: "socket",
          title: "Voice dictation couldn't connect",
          detail: `HyperCLI couldn't open the voice transcription socket. ${message}`,
          hint: "This points to the WebSocket handshake or allowed-connections policy, not microphone access.",
          action: { label: "Retry", kind: "retry" },
          at: Date.now(),
        });
        return;
      }
      if (error.phase === "session-failed") {
        reportConnectionIssue({
          id: DICTATION_SESSION_ISSUE_ID,
          kind: "socket",
          title: "Voice dictation failed",
          detail: `The transcription session failed after it opened. ${message}`,
          hint: "Audio capture started, so this is on the transcription session path rather than the browser microphone prompt.",
          action: { label: "Retry", kind: "retry" },
          at: Date.now(),
        });
        return;
      }
      if (error.phase === "mic") {
        reportConnectionIssue({
          id: DICTATION_MIC_ISSUE_ID,
          kind: "permission",
          title: "Microphone couldn't start",
          detail: `HyperCLI couldn't start microphone capture for dictation. ${message}`,
          hint: "Check microphone permission and whether another app is holding the input device.",
          action: { label: "Open settings", kind: "open-settings" },
          at: Date.now(),
        });
        return;
      }
      if (error.phase === "recorder") {
        reportConnectionIssue({
          id: DICTATION_RECORDER_ISSUE_ID,
          kind: "unknown",
          title: "Microphone recording failed",
          detail: `The microphone recorder stopped unexpectedly. ${message}`,
          hint: "The voice connection may be healthy; this points to MediaRecorder or the input device.",
          action: { label: "Retry", kind: "retry" },
          at: Date.now(),
        });
        return;
      }
    }
    reportConnectionError(error, { operation: "Voice dictation" });
  }

  /** Stop mic + close socket. Idempotent; safe mid-connect (guards are in the flows). */
  private teardownRun(): void {
    this.acceptingChunks = false;
    const run = this.run;
    this.run = null;
    if (!run) return;
    void run.capture.stop().catch(() => {});
    run.session.close();
  }

  private abortAttempt(): void {
    this.slot.cancel();
    this.teardownRun();
  }
}

/** The app's single dictation authority: one composer, one mic, one socket. */
export const dictation = new DictationMachine(createDesktopDictationService());
