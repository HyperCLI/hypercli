"use client";

import { Paperclip } from "lucide-react";
import { classifyChatMediaReference, getChatFileLabel } from "@/lib/chat-media";
import { AudioPlayer } from "./AudioPlayer";
import { ChatImageViewer } from "./ChatImageViewer";
import type { ChatAttachment, ChatPendingFile } from "./types";

interface AttachmentSectionProps {
  attachments?: ChatAttachment[];
  files?: ChatPendingFile[];
  mediaUrls?: string[];
}

function MediaUnavailable({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label="Media preview unavailable"
      className="inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-background/50 px-2.5 py-1.5 text-xs text-text-secondary"
    >
      <Paperclip className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </div>
  );
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
              <span className="truncate">{getChatFileLabel(file)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Agent-sent media (URLs) */}
      {mediaUrls && mediaUrls.length > 0 && (
        <div className="mb-2 flex max-w-full flex-wrap gap-2">
          {mediaUrls.map((url, i) => {
            const reference = classifyChatMediaReference(url);
            if (reference.kind === "workspace") {
              return (
                <div
                  key={`${reference.raw}-${i}`}
                  className="inline-flex max-w-full min-w-0 items-center gap-2 rounded-md border border-border bg-background/50 px-2.5 py-1.5 text-xs text-text-secondary"
                >
                  <Paperclip className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{getChatFileLabel(reference.media.file)}</span>
                </div>
              );
            }

            if (reference.kind === "image") {
              return (
                <ChatImageViewer
                  key={`${reference.raw}-${i}`}
                  src={reference.url}
                  alt={reference.fileName}
                  width={320}
                  height={320}
                  sizes="(max-width: 640px) 100vw, 320px"
                  className="h-auto max-h-[320px] max-w-full rounded-md object-contain sm:max-w-[320px]"
                  loading="lazy"
                  downloadHref={reference.url}
                  downloadFileName={reference.fileName}
                />
              );
            }

            if (reference.kind === "audio") {
              return (
                <AudioPlayer
                  key={`${reference.raw}-${i}`}
                  src={reference.url}
                  title={reference.fileName}
                  downloadHref={reference.url}
                  downloadFileName={reference.fileName}
                  downloadLabel={`Download ${reference.fileName}`}
                />
              );
            }

            if (reference.kind === "local" || reference.kind === "unsupported") {
              return <MediaUnavailable key={`${reference.raw}-${i}`} label={reference.label} />;
            }

            if (reference.kind === "file") {
              return (
                <div
                  key={`${reference.raw}-${i}`}
                  className="inline-flex max-w-full min-w-0 items-center gap-2 rounded-md border border-border bg-background/50 px-2.5 py-1.5 text-xs text-text-secondary"
                >
                  <Paperclip className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{reference.fileName}</span>
                </div>
              );
            }

            return (
              <a
                key={`${reference.raw}-${i}`}
                href={reference.url}
                target="_blank"
                rel="noopener noreferrer"
                className="max-w-full break-words text-xs text-accent hover:underline [overflow-wrap:anywhere]"
              >
                {reference.fileName}
              </a>
            );
          })}
        </div>
      )}
    </>
  );
}
