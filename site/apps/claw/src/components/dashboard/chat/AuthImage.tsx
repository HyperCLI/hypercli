"use client";

import { useEffect, useRef, useState } from "react";
import { getStoredToken } from "@/lib/api";
import { createAgentClient } from "@/lib/agent-client";

function parseAgentFileUrl(src: string): { agentId: string; path: string } | null {
  try {
    const url = new URL(src, typeof window !== "undefined" ? window.location.origin : "https://agents.hypercli.com");
    const match = url.pathname.match(/\/deployments\/([^/]+)\/files\/(.+)$/);
    if (!match) return null;
    const [, agentId, encodedPath] = match;
    const path = encodedPath
      .split("/")
      .filter(Boolean)
      .map((part) => decodeURIComponent(part))
      .join("/");
    if (!agentId || !path) return null;
    return { agentId, path };
  } catch {
    return null;
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

export function AuthImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const blobRef = useRef<string | null>(null);

  useEffect(() => {
    setBlobUrl(null);
    setFailed(false);
    if (blobRef.current) { URL.revokeObjectURL(blobRef.current); blobRef.current = null; }

    const token = getStoredToken();
    if (!token) { setFailed(true); return; }
    const target = parseAgentFileUrl(src);
    if (!target) { setFailed(true); return; }

    createAgentClient(token).fileReadBytes(target.agentId, target.path)
      .then((bytes) => {
        const blob = new Blob([toArrayBuffer(bytes)]);
        const url = URL.createObjectURL(blob);
        blobRef.current = url;
        setBlobUrl(url);
      })
      .catch(() => {
        setFailed(true);
      });

    return () => {
      if (blobRef.current) { URL.revokeObjectURL(blobRef.current); blobRef.current = null; }
    };
  }, [src]);

  if (failed || !blobUrl) return null;

  return (
    <a href={blobUrl} target="_blank" rel="noopener noreferrer">
      <img src={blobUrl} alt={alt} className={className} loading="lazy" />
    </a>
  );
}
