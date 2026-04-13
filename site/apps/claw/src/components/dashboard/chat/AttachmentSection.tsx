"use client";

import { Paperclip } from "lucide-react";
import type { ChatAttachment, ChatPendingFile } from "./types";

interface AttachmentSectionProps {
  attachments?: ChatAttachment[];
  files?: ChatPendingFile[];
  mediaUrls?: string[];
}

export function AttachmentSection({ attachments, files, mediaUrls }: AttachmentSectionProps) {
  return (
    <>
      {/* Image attachments */}
      {attachments && attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {attachments.map((att, i) => (
            <img
              key={i}
              src={`data:${att.mimeType};base64,${att.content}`}
              alt={att.fileName || "attachment"}
              className="max-w-[240px] max-h-[240px] rounded-md object-cover cursor-pointer"
              onClick={() => window.open(`data:${att.mimeType};base64,${att.content}`, "_blank")}
            />
          ))}
        </div>
      )}

      {/* File attachments */}
      {files && files.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {files.map((file, i) => (
            <div
              key={`${file.name}-${i}`}
              className="inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-background/50 px-2.5 py-1.5 text-xs text-text-secondary"
            >
              <Paperclip className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{file.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Agent-sent media (URLs) */}
      {mediaUrls && mediaUrls.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {mediaUrls.map((url, i) => {
            const isImage = /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(url) || url.startsWith("data:image/");
            if (isImage) {
              return (
                <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                  <img
                    src={url}
                    alt="media"
                    className="max-w-[320px] max-h-[320px] rounded-md object-contain"
                    loading="lazy"
                  />
                </a>
              );
            }
            return (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline text-xs"
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
