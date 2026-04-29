import { useCallback, useEffect, useRef, useState } from "react";
import { getStoredToken } from "@/lib/api";
import { createAgentClient } from "@/lib/agent-client";
import type { AgentFileReference } from "./types";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

export function useInlineAudio(inlineAudioFile: AgentFileReference | null | undefined) {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!inlineAudioFile) return;
    let cancelled = false;
    const token = getStoredToken();
    if (!token) return;

    createAgentClient(token)
      .fileReadBytes(inlineAudioFile.agentId, inlineAudioFile.path)
      .then((bytes) => {
        if (cancelled) return;
        const url = URL.createObjectURL(new Blob([toArrayBuffer(bytes)]));
        blobUrlRef.current = url;
        const audio = new Audio(url);
        audio.addEventListener("ended", () => setIsPlaying(false));
        audio.addEventListener("pause", () => setIsPlaying(false));
        audio.addEventListener("play", () => setIsPlaying(true));
        audioRef.current = audio;
      })
      .catch(() => {
        if (cancelled) return;
        setIsPlaying(false);
      });

    return () => {
      cancelled = true;
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.src = "";
      }
      audioRef.current = null;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
      setIsPlaying(false);
    };
  }, [inlineAudioFile?.agentId, inlineAudioFile?.path]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
      return;
    }
    audio.pause();
  }, []);

  return { isPlaying, toggle };
}
