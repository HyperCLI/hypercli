"use client";

import { Paperclip } from "lucide-react";
import { getChatFileLabel } from "@/lib/chat-media";
import { deriveAttachmentPresentationState } from "@/lib/chat-attachment-state";
import { AudioPlayer } from "./AudioPlayer";
import { ChatImageViewer } from "./ChatImageViewer";
import type { ChatAttachment, ChatMessageType, ChatPendingFile } from "./types";

interface AttachmentSectionProps {
  attachments?: ChatAttachment[];
  files?: ChatPendingFile[];
  mediaUrls?: string[];
  toolCalls?: ChatMessageType["toolCalls"];
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

export function AttachmentSection({ attachments, files, mediaUrls, toolCalls }: AttachmentSectionProps) {
  const presentation = deriveAttachmentPresentationState({ attachments, files, mediaUrls, toolCalls });
  if (presentation.status === "empty") return null;

  return (
    <div className="mb-2 flex max-w-full flex-wrap gap-2">
      {presentation.items.map((item) => {
        if (item.state === "image-attachment") {
          const att = item.attachment;
          return (
            <ChatImageViewer
              key={item.key}
              src={`data:${att.mimeType};base64,${att.content}`}
              alt={att.fileName || "attachment"}
              width={240}
              height={240}
              sizes="(max-width: 640px) 100vw, 240px"
              className="h-auto max-h-[240px] max-w-full rounded-md object-cover sm:max-w-[240px]"
              downloadHref={`data:${att.mimeType};base64,${att.content}`}
              downloadFileName={att.fileName || "attachment"}
            />
          );
        }

        if (item.state === "file") {
          return (
            <div
              key={item.key}
              className="inline-flex max-w-full min-w-0 items-center gap-2 rounded-md border border-border bg-background/50 px-2.5 py-1.5 text-xs text-text-secondary"
            >
              <Paperclip className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{getChatFileLabel(item.file)}</span>
            </div>
          );
        }

        if (item.state === "image-url") {
          const reference = item.reference;
          return (
            <ChatImageViewer
              key={item.key}
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

        if (item.state === "audio-url") {
          const reference = item.reference;
          return (
            <AudioPlayer
              key={item.key}
              src={reference.url}
              title={reference.fileName}
              downloadHref={reference.url}
              downloadFileName={reference.fileName}
              downloadLabel={`Download ${reference.fileName}`}
            />
          );
        }

        if (item.state === "video-url") {
          const reference = item.reference;
          return (
            <video
              key={item.key}
              src={reference.url}
              controls
              preload="metadata"
              className="max-h-[320px] w-full max-w-[28rem] rounded-md border border-border bg-black"
              aria-label={`Video preview ${reference.fileName}`}
            />
          );
        }

        if (item.state === "link-url") {
          const reference = item.reference;
          return (
            <a
              key={item.key}
              href={reference.url}
              target="_blank"
              rel="noopener noreferrer"
              className="max-w-full break-words text-xs text-accent hover:underline [overflow-wrap:anywhere]"
            >
              {reference.fileName}
            </a>
          );
        }

        return <MediaUnavailable key={item.key} label={item.label} />;
      })}
    </div>
  );
}
