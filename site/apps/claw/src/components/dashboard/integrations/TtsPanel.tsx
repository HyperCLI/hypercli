"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Check, Loader2, Volume2, Square } from "lucide-react";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { VOICE_API_URL } from "@/lib/api";

const SPEAKERS = [
  "Aria", "Ryan", "Luna", "Serena", "Daniel", "Ethan", "Nova", "Chelsie", "Aidan",
] as const;

const FORMATS = ["opus", "mp3", "wav", "flac"] as const;

interface TtsPanelProps {
  currentSpeaker?: string;
  currentFormat?: string;
  onSave: (config: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}

export function TtsPanel({ currentSpeaker, currentFormat, onSave, onClose }: TtsPanelProps) {
  const [speaker, setSpeaker] = useState(currentSpeaker || "Aria");
  const [format, setFormat] = useState(currentFormat || "opus");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<"loading" | "playing" | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { getToken } = useAgentAuth();

  const stopPreview = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setPreviewingVoice(null);
    setPreviewState(null);
  }, []);

  const handlePreviewClick = useCallback(async (voiceName: string) => {
    if (previewingVoice === voiceName) {
      stopPreview();
      return;
    }

    stopPreview();
    const controller = new AbortController();
    abortRef.current = controller;
    setPreviewingVoice(voiceName);
    setPreviewState("loading");

    try {
      const token = await getToken();
      const response = await fetch(`${VOICE_API_URL}/tts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: `Hi, my name is ${voiceName}. How can I help you today?`,
          voice: voiceName,
          language: "auto",
          response_format: "mp3",
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`TTS request failed: ${response.status}`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;

      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => stopPreview();
      audio.onerror = () => stopPreview();

      await audio.play();
      setPreviewState("playing");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      stopPreview();
    }
  }, [previewingVoice, stopPreview, getToken]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (audioRef.current) {
        audioRef.current.onended = null;
        audioRef.current.onerror = null;
        audioRef.current.pause();
        audioRef.current.src = "";
      }
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
      }
    };
  }, []);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      await onSave({
        integrations: { voice: { speaker, format } },
      });
      onClose();
    } catch {
      setError("Failed to save voice preferences. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-text-secondary">
        Your agent can speak using Qwen3-TTS &mdash; with 9 preset voices and voice cloning.
      </p>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Default Speaker</label>
        <div className="space-y-1">
          {SPEAKERS.map((s) => (
            <label
              key={s}
              className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
                speaker === s
                  ? "bg-[var(--primary)]/8 border border-[var(--primary)]/20"
                  : "hover:bg-[var(--surface-low)] border border-transparent"
              }`}
            >
              <input
                type="radio"
                name="speaker"
                value={s}
                checked={speaker === s}
                onChange={() => setSpeaker(s)}
                className="accent-[var(--primary)]"
              />
              <div className="flex items-center gap-2 flex-1">
                <span className="text-sm text-foreground">{s}</span>
              </div>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  handlePreviewClick(s);
                }}
                disabled={previewState === "loading" && previewingVoice !== s}
                className={`p-1 transition-colors ${
                  previewingVoice === s && previewState === "playing"
                    ? "text-[var(--primary)]"
                    : "text-text-tertiary hover:text-foreground"
                } disabled:opacity-30 disabled:cursor-not-allowed`}
                title={previewingVoice === s ? `Stop ${s}` : `Preview ${s}`}
              >
                {previewingVoice === s && previewState === "loading" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : previewingVoice === s && previewState === "playing" ? (
                  <Square className="w-3 h-3 fill-current" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5" />
                )}
              </button>
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Output Format</label>
        <div className="flex gap-2">
          {FORMATS.map((f) => (
            <button
              key={f}
              onClick={() => setFormat(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                format === f
                  ? "bg-[var(--primary)]/15 text-[var(--primary)] border border-[var(--primary)]/20"
                  : "bg-[var(--surface-low)] text-text-secondary hover:text-foreground border border-[var(--border)]"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="glass-card p-3 text-xs text-text-tertiary">
        <p>
          Your agent can also clone any voice from a reference audio file. Try:{" "}
          <span className="text-text-secondary">&quot;Read this aloud&quot;</span> or{" "}
          <span className="text-text-secondary">&quot;Say hello in Aria&apos;s voice&quot;</span>
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-400">{error}</p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="btn-secondary px-4 py-2 rounded-lg text-sm font-medium">
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-40"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Save preferences
        </button>
      </div>
    </div>
  );
}
