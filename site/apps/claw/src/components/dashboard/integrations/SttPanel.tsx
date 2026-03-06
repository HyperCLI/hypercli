"use client";

import { Mic } from "lucide-react";

interface SttPanelProps {
  onClose: () => void;
}

export function SttPanel({ onClose }: SttPanelProps) {
  return (
    <div className="space-y-6">
      <div className="w-12 h-12 rounded-full bg-[var(--primary)]/10 flex items-center justify-center">
        <Mic className="w-6 h-6 text-[var(--primary)]" />
      </div>

      <p className="text-sm text-text-secondary">
        Your agent transcribes audio using faster-whisper (turbo). Pre-installed in every agent
        &mdash; nothing to set up.
      </p>

      <div className="space-y-3">
        <h4 className="text-sm font-medium text-foreground">What it can do</h4>
        <ul className="space-y-1.5 text-sm text-text-secondary">
          <li className="flex items-start gap-2">
            <span className="text-[var(--primary)] mt-1">&#8226;</span>
            Transcribe audio files and voice messages
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[var(--primary)] mt-1">&#8226;</span>
            Process recordings in any language Whisper supports
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[var(--primary)] mt-1">&#8226;</span>
            Runs locally in the agent pod &mdash; fast and private
          </li>
        </ul>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-foreground">Supported formats</h4>
        <div className="flex flex-wrap gap-1.5">
          {["mp3", "wav", "ogg", "flac", "m4a", "webm"].map((fmt) => (
            <span
              key={fmt}
              className="px-2 py-1 bg-[var(--surface-low)] text-text-secondary rounded text-xs font-mono"
            >
              {fmt}
            </span>
          ))}
        </div>
      </div>

      <div className="glass-card p-3 text-xs text-text-tertiary">
        <p>
          Try it: send an audio file to your agent and ask{" "}
          <span className="text-text-secondary">&quot;transcribe this&quot;</span>
        </p>
      </div>

      <div className="flex justify-end pt-2">
        <button onClick={onClose} className="btn-primary px-4 py-2 rounded-lg text-sm font-medium">
          Got it
        </button>
      </div>
    </div>
  );
}
