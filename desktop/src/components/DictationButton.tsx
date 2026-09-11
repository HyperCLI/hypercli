import { useEffect, useRef, useState } from "react";
import { Loader2, Mic } from "lucide-react";
import { dictation } from "../lib/dictation";
import { micCaptureSupported } from "../lib/mic-capture";
import { useMachine } from "../lib/use-machine";

/**
 * Push-to-talk mic button for the composer. Renders nothing when the webview
 * has no `getUserMedia` or no usable MediaRecorder container (WKWebView on
 * macOS < 13.3): an unusable dictation button is worse than no button.
 *
 * The button only sends intents to the dictation machine — all mic/socket
 * lifecycle lives in `lib/dictation.ts`. Click semantics: idle → record;
 * starting → abort; recording → stop and transcribe; transcribing → wait for
 * the spinner (Esc cancels). The icon carries the state: mic, red pulsing mic
 * while recording, spinner while starting/transcribing.
 */
export function DictationButton({
  disabled,
  onTranscript,
}: {
  /** Composer gating: agent not chat-ready or a turn in flight. Never blocks an in-progress dictation. */
  disabled: boolean;
  onTranscript: (text: string) => void;
}) {
  const state = useMachine(dictation);
  const [supported] = useState(() => micCaptureSupported());
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  useEffect(() => dictation.onTranscript((text) => onTranscriptRef.current(text)), []);

  // Esc is the discard path: recording stops, nothing is inserted. A no-op
  // when idle, so it is safe alongside every other Escape handler.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dictation.cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // An unmounting pane must not keep the mic.
  useEffect(() => () => dictation.cancel(), []);

  if (!supported) return null;

  if (state.name === "transcribing") {
    return (
      <button className="composer-icon" disabled title="Transcribing… (Esc to discard)" aria-pressed="true">
        <Loader2 size={16} className="animate-spin" />
      </button>
    );
  }

  const recording = state.name === "recording";
  return (
    <button
      onClick={() => dictation.toggle()}
      disabled={!recording && state.name === "idle" && disabled}
      aria-pressed={state.name !== "idle"}
      className={`composer-icon disabled:opacity-40 ${recording ? "text-error" : ""}`}
      title={
        recording
          ? "Stop and transcribe (Esc to discard)"
          : state.name === "starting"
            ? "Starting microphone… (click to cancel)"
            : "Dictate a message"
      }
    >
      {state.name === "starting" ? (
        <Loader2 size={16} className="animate-spin" />
      ) : (
        <Mic size={16} className={recording ? "animate-pulse" : undefined} />
      )}
    </button>
  );
}
