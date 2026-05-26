"use client";

import { useState } from "react";
import { motion } from "framer-motion";

import type { ChatMessageProps } from "./types";
import { getEntranceProps, getBubbleClasses } from "./bubbleStyles";
import { useTypewriter } from "./useTypewriter";
import { useInlineAudio } from "./useInlineAudio";
import { AudioPlayer } from "./AudioPlayer";
import { MessageName } from "./MessageName";
import { ToolCallBlock } from "./ToolCallBlock";
import { shouldStackToolCalls, ToolCallStack } from "./ToolCallStack";
import { AttachmentSection } from "./AttachmentSection";
import { MarkdownContent } from "./MarkdownContent";
import { StreamingIndicator } from "./StreamingIndicator";
import { TimestampDisplay } from "./TimestampDisplay";
import { DirectoryVisualization, parseDirectoryVisualization } from "./DirectoryVisualization";

export function ChatMessageBubble({
  message,
  inlineAudioFile = null,
  agentId = null,
  timestampVariant = "off",
  nameVariant = "off",
  bubblesVariant = "off",
  animationVariant = "off",
  themeVariant = "off",
  streamingVariant = "off",
  isStreaming = false,
  agentName,
  agentMeta,
  senderName,
  isGroupChat = false,
}: ChatMessageProps) {
  const [toolsOpen, setToolsOpen] = useState<Record<number, boolean>>({});
  const inlineAudio = useInlineAudio(inlineAudioFile);

  // Suppress content that's a JSON echo of tool results already shown in the tool call UI.
  const hasToolCalls = (message.toolCalls?.length ?? 0) > 0;
  const hasToolResults = message.toolCalls?.some((tc) => tc.result != null) ?? false;
  let contentIsJson = false;
  if (hasToolResults) {
    const trimmedContent = message.content.trim();
    if (trimmedContent.startsWith("{") || trimmedContent.startsWith("[")) {
      try { JSON.parse(trimmedContent); contentIsJson = true; } catch { /* not JSON */ }
    }
  }
  const effectiveContent = contentIsJson ? "" : message.content;
  const contentDirectoryListing = message.role === "assistant" && effectiveContent
    ? parseDirectoryVisualization(effectiveContent)
    : null;

  const typewriterActive = isStreaming && message.role === "assistant" && streamingVariant === "v2";
  const displayedContent = useTypewriter(effectiveContent, typewriterActive);
  const showStreamingIndicator = isStreaming && (!hasToolCalls || Boolean(displayedContent));

  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  // ── System message ──
  if (isSystem) {
    return (
      <div className="flex min-w-0 max-w-full justify-center">
        <div className="max-w-[85%] break-words rounded-lg border border-[#d05f5f]/20 bg-[#d05f5f]/10 px-4 py-2 text-sm text-[#d05f5f] [overflow-wrap:anywhere]">
          {message.content}
        </div>
      </div>
    );
  }

  const effectiveName = senderName || agentName || "Agent";
  const bubbleClass = getBubbleClasses(bubblesVariant, themeVariant, isUser);

  // ── Name display flags ──
  const showAssistantName = !isUser || isGroupChat;
  const showV1Name = showAssistantName && nameVariant === "v1";
  const showV2Name = showAssistantName && nameVariant === "v2";
  const showV3Name = showAssistantName && nameVariant === "v3";
  const messageColumnClass = isUser
    ? "w-fit max-w-[75%] flex-none items-end"
    : `max-w-full flex-1 items-start ${bubblesVariant === "v3" ? "min-w-0" : ""}`;

  const toggleToolCall = (index: number) => {
    setToolsOpen((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  return (
    <motion.div
      className={`group flex min-w-0 max-w-full ${isUser ? "justify-end" : "justify-start"} items-start gap-2`}
      {...getEntranceProps(animationVariant, isUser)}
    >
      {/* v2 name: avatar circle to the left */}
      {showV2Name && (
        <MessageName variant="v2" placement="avatar-left" isUser={isUser} effectiveName={effectiveName} agentMeta={agentMeta} />
      )}

      <div className={`flex min-w-0 flex-col ${messageColumnClass}`}>

        {/* v1 name: monogram above */}
        {showV1Name && (
          <MessageName variant="v1" placement="above-bubble" isUser={isUser} effectiveName={effectiveName} agentMeta={agentMeta} />
        )}

        {/* v3 name: sparkle above */}
        {showV3Name && (
          <MessageName variant="v3" placement="above-bubble" isUser={isUser} effectiveName={effectiveName} />
        )}

        {/* v2 name: text above when avatar present */}
        {showV2Name && (
          <MessageName variant="v2" placement="text-above" isUser={isUser} effectiveName={effectiveName} />
        )}

        {/* ── Bubble ── */}
        <div className={`${bubbleClass}${showStreamingIndicator && streamingVariant === "v3" ? " relative overflow-hidden" : ""}`}>
          {/* Tool calls */}
          {shouldStackToolCalls(message.toolCalls) ? (
            <ToolCallStack
              toolCalls={message.toolCalls ?? []}
              themeVariant={themeVariant}
              agentId={agentId}
              isStreaming={isStreaming}
            />
          ) : (
            message.toolCalls?.map((tc, j) => (
              <ToolCallBlock
                key={j}
                toolCall={tc}
                index={j}
                isOpen={!!toolsOpen[j]}
                onToggle={toggleToolCall}
                themeVariant={themeVariant}
                agentId={agentId}
                isStreaming={isStreaming}
              />
            ))
          )}

          {/* Attachments */}
          <AttachmentSection
            attachments={message.attachments}
            files={message.files}
            mediaUrls={message.mediaUrls}
          />

          {/* Content */}
          {contentDirectoryListing ? (
            <DirectoryVisualization
              title="Directory"
              rootPath={contentDirectoryListing.rootPath}
              entries={contentDirectoryListing.entries}
              truncated={contentDirectoryListing.truncated}
            />
          ) : displayedContent && <MarkdownContent content={displayedContent} />}

          {/* Streaming indicator */}
          <StreamingIndicator variant={streamingVariant} isStreaming={showStreamingIndicator} isUser={isUser} />

          {/* Timestamp inside bubble (v2) */}
          <TimestampDisplay timestamp={message.timestamp} variant={timestampVariant} placement="inside" isUser={isUser} />
        </div>

        {/* Audio playback */}
        {inlineAudioFile && (
          <AudioPlayer
            src={inlineAudio.src}
            title={inlineAudioFile.path.split("/").filter(Boolean).pop() || "Voice message"}
            loading={inlineAudio.loading}
            error={inlineAudio.failed}
            downloadHref={inlineAudio.src ?? undefined}
            downloadFileName={inlineAudioFile.path.split("/").filter(Boolean).pop() || "voice-message.webm"}
            className="mt-2"
          />
        )}

        {/* Timestamp outside bubble */}
        <TimestampDisplay timestamp={message.timestamp} variant={timestampVariant} placement="outside" isUser={isUser} />
      </div>
    </motion.div>
  );
}
