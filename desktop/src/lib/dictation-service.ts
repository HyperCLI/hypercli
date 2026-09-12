import { createVoiceTranscriptionSession } from "../api";
import type { DictationDeps } from "./dictation";
import { MicCapture } from "./mic-capture";

export type DictationFailurePhase = "ws-open" | "session-failed" | "mic" | "recorder";

export class DictationServiceError extends Error {
  readonly phase: DictationFailurePhase;

  constructor(phase: DictationFailurePhase, cause: unknown) {
    super(messageOf(cause));
    this.name = "DictationServiceError";
    this.phase = phase;
    this.cause = cause;
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error ?? "No further detail was reported.");
}

export function wrapDictationFailure(phase: DictationFailurePhase, error: unknown): DictationServiceError {
  return error instanceof DictationServiceError && error.phase === phase ? error : new DictationServiceError(phase, error);
}

export function isDictationServiceError(error: unknown): error is DictationServiceError {
  return error instanceof DictationServiceError;
}

/** Desktop dictation boundary: API session open plus platform mic capture. */
export function createDesktopDictationService(): DictationDeps {
  return {
    openSession: async () => {
      try {
        return await createVoiceTranscriptionSession();
      } catch (error) {
        throw wrapDictationFailure("ws-open", error);
      }
    },
    startCapture: async (handlers) => {
      try {
        return await MicCapture.start({
          onChunk: handlers.onChunk,
          onError: (error) => handlers.onError(wrapDictationFailure("recorder", error)),
        });
      } catch (error) {
        throw wrapDictationFailure("mic", error);
      }
    },
  };
}
