import { useEffect, useRef, useState } from "react";
import { getStoredToken } from "@/lib/api";
import { createAgentClient } from "@/lib/agent-client";
import { normalizeOpenClawWorkspaceFilePath } from "@/lib/agent-file-path";
import type { AgentFileReference } from "./types";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

export function useInlineAudio(inlineAudioFile: AgentFileReference | null | undefined) {
  const fileAgentId = inlineAudioFile?.agentId ?? null;
  const filePath = inlineAudioFile?.path ?? null;
  const fileKey = fileAgentId && filePath ? `${fileAgentId}:${filePath}` : null;
  const [state, setState] = useState({
    key: null as string | null,
    src: null as string | null,
    failed: false,
  });
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    if (!fileAgentId || !filePath || !fileKey) return;
    let cancelled = false;
    const token = getStoredToken();
    if (!token) {
      Promise.resolve().then(() => {
        if (!cancelled) setState({ key: fileKey, src: null, failed: true });
      });
      return () => {
        cancelled = true;
      };
    }

    createAgentClient(token)
      .fileReadBytes(fileAgentId, normalizeOpenClawWorkspaceFilePath(filePath))
      .then((bytes) => {
        if (cancelled) return;
        const url = URL.createObjectURL(new Blob([toArrayBuffer(bytes)]));
        blobUrlRef.current = url;
        setState({ key: fileKey, src: url, failed: false });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ key: fileKey, src: null, failed: true });
      });

    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [fileAgentId, filePath, fileKey]);

  if (!fileKey) return { src: null, loading: false, failed: false };
  if (state.key !== fileKey) return { src: null, loading: true, failed: false };
  return { src: state.src, loading: false, failed: state.failed };
}
