"use client";

import { Paperclip } from "lucide-react";
import { AudioPlayer } from "./AudioPlayer";
import { ChatImageViewer } from "./ChatImageViewer";
import type { ChatAttachment, ChatPendingFile } from "./types";

interface AttachmentSectionProps {
  attachments?: ChatAttachment[];
  files?: ChatPendingFile[];
  mediaUrls?: string[];
}

function mediaFileNameFromUrl(url: string, fallback = "media"): string {
  if (/^data:/i.test(url.trim())) return fallback;
  try {
    const parsed = new URL(url, "https://hypercli.local");
    const name = parsed.pathname.split("/").filter(Boolean).pop();
    return name ? decodeURIComponent(name) : fallback;
  } catch {
    return url.split(/[?#]/)[0].split("/").filter(Boolean).pop() || fallback;
  }
}

function isAudioUrl(url: string): boolean {
  return /^(?:data:audio\/|blob:)/i.test(url) || /\.(aac|flac|m4a|mp3|oga|ogg|opus|wav|weba|webm)(?:[?#].*)?$/i.test(url);
}

export function AttachmentSection({ attachments, files, mediaUrls }: AttachmentSectionProps) {
  return (
    <>
      {/* Image attachments */}
      {attachments && attachments.length > 0 && (
        <div className="mb-2 flex max-w-full flex-wrap gap-2">
          {attachments.map((att, i) => (
            <ChatImageViewer
              key={i}
              src={`data:${att.mimeType};base64,${att.content}`}
              alt={att.fileName || "attachment"}
              width={240}
              height={240}
              sizes="(max-width: 640px) 100vw, 240px"
              className="h-auto max-h-[240px] max-w-full rounded-md object-cover sm:max-w-[240px]"
              downloadHref={`data:${att.mimeType};base64,${att.content}`}
              downloadFileName={att.fileName || "attachment"}
            />
          ))}
        </div>
      )}

      {/* File attachments */}
      {files && files.length > 0 && (
        <div className="mb-2 flex max-w-full flex-wrap gap-2">
          {files.map((file, i) => (
            <div
              key={`${file.name}-${i}`}
              className="inline-flex max-w-full min-w-0 items-center gap-2 rounded-md border border-border bg-background/50 px-2.5 py-1.5 text-xs text-text-secondary"
            >
              <Paperclip className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{file.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Agent-sent media (URLs) */}
      {mediaUrls && mediaUrls.length > 0 && (
        <div className="mb-2 flex max-w-full flex-wrap gap-2">
          {mediaUrls.map((url, i) => {
            const isImage = /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(url) || url.startsWith("data:image/");
            if (isImage) {
              return (
                <ChatImageViewer
                  key={i}
                  src={url}
                  alt="media"
                  width={320}
                  height={320}
                  sizes="(max-width: 640px) 100vw, 320px"
                  className="h-auto max-h-[320px] max-w-full rounded-md object-contain sm:max-w-[320px]"
                  loading="lazy"
                  downloadHref={url}
                  downloadFileName={mediaFileNameFromUrl(url)}
                />
              );
            }
            if (isAudioUrl(url)) {
              const label = mediaFileNameFromUrl(url, "audio");
              return (
                <AudioPlayer
                  key={i}
                  src={url}
                  title={label}
                  downloadHref={url}
                  downloadFileName={label}
                  downloadLabel={`Download ${label}`}
                />
              );
            }
            return (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="max-w-full break-words text-xs text-accent hover:underline [overflow-wrap:anywhere]"
              >
                {url.split("/").pop() || "media"}
              </a>
            );
          })}
        </div>
      )}
    </>
  );
}
