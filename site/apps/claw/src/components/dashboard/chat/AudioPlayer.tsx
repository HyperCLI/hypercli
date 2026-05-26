"use client";

import { useCallback, useId, useRef, useState } from "react";
import { Download, Loader2, Pause, Play, Volume2 } from "lucide-react";

interface AudioPlayerProps {
  src?: string | null;
  title?: string;
  loading?: boolean;
  error?: boolean;
  downloadHref?: string;
  downloadFileName?: string;
  downloadLabel?: string;
  onDownload?: () => void | Promise<void>;
  className?: string;
}

function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function AudioPlayer({
  src,
  title = "Audio",
  loading = false,
  error = false,
  downloadHref,
  downloadFileName,
  downloadLabel,
  onDownload,
  className,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const labelId = useId();
  const [playback, setPlayback] = useState({
    src: null as string | null,
    playing: false,
    duration: 0,
    currentTime: 0,
  });
  const unavailable = error || (!loading && !src);
  const currentPlayback = playback.src === (src ?? null)
    ? playback
    : { src: src ?? null, playing: false, duration: 0, currentTime: 0 };
  const canSeek = currentPlayback.duration > 0 && Number.isFinite(currentPlayback.duration);

  const updatePlayback = useCallback((next: Partial<Omit<typeof playback, "src">>) => {
    const activeSrc = src ?? null;
    setPlayback((current) => ({
      src: activeSrc,
      playing: current.src === activeSrc ? current.playing : false,
      duration: current.src === activeSrc ? current.duration : 0,
      currentTime: current.src === activeSrc ? current.currentTime : 0,
      ...next,
    }));
  }, [src]);

  const syncMetadata = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    updatePlayback({
      duration: Number.isFinite(audio.duration) ? audio.duration : 0,
      currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
    });
  }, [updatePlayback]);

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || unavailable || loading) return;
    if (audio.paused) {
      void audio.play().catch(() => updatePlayback({ playing: false }));
      return;
    }
    audio.pause();
  }, [loading, unavailable, updatePlayback]);

  const handleSeek = useCallback((value: string) => {
    const audio = audioRef.current;
    if (!audio || !canSeek) return;
    const nextTime = Number(value);
    if (!Number.isFinite(nextTime)) return;
    audio.currentTime = nextTime;
    updatePlayback({ currentTime: nextTime });
  }, [canSeek, updatePlayback]);

  const handleDownload = useCallback(() => {
    if (!onDownload) return;
    void onDownload();
  }, [onDownload]);

  const statusLabel = loading ? "Loading audio" : "Audio unavailable";
  const displayTitle = unavailable ? statusLabel : title;

  return (
    <div
      className={`flex w-full max-w-[22rem] min-w-0 items-center gap-2 rounded-md border border-border bg-background/50 px-2.5 py-2 text-text-secondary ${className ?? ""}`}
      aria-labelledby={labelId}
    >
      {src && (
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onLoadedMetadata={syncMetadata}
          onDurationChange={syncMetadata}
          onTimeUpdate={syncMetadata}
          onPlay={() => updatePlayback({ playing: true })}
          onPause={() => updatePlayback({ playing: false })}
          onEnded={() => {
            updatePlayback({ playing: false, currentTime: 0 });
          }}
          onError={() => {
            updatePlayback({ playing: false });
          }}
        />
      )}

      <button
        type="button"
        onClick={togglePlayback}
        disabled={loading || unavailable}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-low text-text-muted transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[#38D39F] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-text-muted"
        aria-label={currentPlayback.playing ? `Pause ${title}` : `Play ${title}`}
        title={currentPlayback.playing ? "Pause" : "Play"}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : currentPlayback.playing ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex min-w-0 items-center justify-between gap-2">
          <span id={labelId} className="flex min-w-0 items-center gap-1.5 truncate text-xs font-medium text-foreground">
            <Volume2 className="h-3.5 w-3.5 shrink-0 text-[#38D39F]" />
            <span className="truncate">{displayTitle}</span>
          </span>
          <span className="shrink-0 font-mono text-[10px] text-text-muted">
            {formatAudioTime(currentPlayback.currentTime)} / {formatAudioTime(currentPlayback.duration)}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={canSeek ? currentPlayback.duration : 100}
          step="0.1"
          value={canSeek ? Math.min(currentPlayback.currentTime, currentPlayback.duration) : 0}
          disabled={!canSeek || loading || unavailable}
          onChange={(event) => handleSeek(event.currentTarget.value)}
          className="block h-1.5 w-full cursor-pointer accent-[#38D39F] disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={`Seek ${title}`}
        />
      </div>

      {onDownload ? (
        <button
          type="button"
          onClick={handleDownload}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-low text-text-muted transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[#38D39F]"
          aria-label={downloadLabel ?? `Download ${title}`}
          title="Download"
        >
          <Download className="h-4 w-4" />
        </button>
      ) : downloadHref ? (
        <a
          href={downloadHref}
          download={downloadFileName}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-low text-text-muted transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[#38D39F]"
          aria-label={downloadLabel ?? `Download ${title}`}
          title="Download"
        >
          <Download className="h-4 w-4" />
        </a>
      ) : null}
    </div>
  );
}
