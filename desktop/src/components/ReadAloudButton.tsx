import { Volume2, VolumeX } from "lucide-react";
import { nextReadAloudEnabled } from "../lib/voice-read";

/**
 * Read-aloud speaker toggle for the chat header. Three states, in precedence
 * order: no voice configured (grayed, disabled — the click must not toggle),
 * voice configured but off (slashed speaker), and voice on (active speaker).
 * `onToggle` only ever fires with the new pref when the toggle is allowed.
 */
export function ReadAloudButton({
  hasVoice,
  enabled,
  onToggle,
}: {
  hasVoice: boolean;
  enabled: boolean;
  onToggle: (next: boolean) => void;
}) {
  const active = hasVoice && enabled;
  return (
    <button
      onClick={() => {
        const next = nextReadAloudEnabled(hasVoice, enabled);
        if (next !== null) onToggle(next);
      }}
      disabled={!hasVoice}
      aria-pressed={active}
      className={`ui-icon-button-sm shrink-0 disabled:opacity-40 ${active ? "text-accent" : ""}`}
      title={
        !hasVoice
          ? "Upload audio to have your agent speak"
          : enabled
            ? "Mute voice replies"
            : "Read replies aloud"
      }
    >
      {active ? <Volume2 size={14} /> : <VolumeX size={14} />}
    </button>
  );
}
