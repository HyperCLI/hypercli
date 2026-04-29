"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Pause, Play } from "lucide-react";

import type { ChatMessageProps } from "./types";
import { getEntranceProps, getBubbleClasses } from "./bubbleStyles";
import { useTypewriter } from "./useTypewriter";
import { useInlineAudio } from "./useInlineAudio";
import { MessageName } from "./MessageName";
import { ToolCallBlock } from "./ToolCallBlock";
import { AttachmentSection } from "./AttachmentSection";
import { MarkdownContent } from "./MarkdownContent";
import { StreamingIndicator } from "./StreamingIndicator";
import { TimestampDisplay } from "./TimestampDisplay";

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
  senderName,
  isGroupChat = false,
}: ChatMessageProps) {
  const [toolsOpen, setToolsOpen] = useState<Record<number, boolean>>({});
  const { isPlaying: inlineAudioPlaying, toggle: toggleInlineAudio } = useInlineAudio(inlineAudioFile);

  // Suppress content that's a JSON echo of tool results already shown in the tool call UI.
  const hasToolResults = message.toolCalls?.some((tc) => tc.result != null) ?? false;
  let contentIsJson = false;
  if (hasToolResults) {
    const trimmedContent = message.content.trim();
    if (trimmedContent.startsWith("{") || trimmedContent.startsWith("[")) {
      try { JSON.parse(trimmedContent); contentIsJson = true; } catch { /* not JSON */ }
    }
  }
  const effectiveContent = contentIsJson ? "" : message.content;

  const typewriterActive = isStreaming && message.role === "assistant" && streamingVariant === "v2";
  const displayedContent = useTypewriter(effectiveContent, typewriterActive);

  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  // ── System message ──
  if (isSystem) {
    return (
      <div className="flex justify-center">
        <div className="max-w-[85%] rounded-lg px-4 py-2 text-sm bg-[#d05f5f]/10 border border-[#d05f5f]/20 text-[#d05f5f]">
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

  const toggleToolCall = (index: number) => {
    setToolsOpen((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  return (
    <motion.div
      className={`flex ${isUser ? "justify-end" : "justify-start"} items-start gap-2 group`}
      {...getEntranceProps(animationVariant, isUser)}
    >
      {/* v2 name: avatar circle to the left */}
      {showV2Name && (
        <MessageName variant="v2" placement="avatar-left" isUser={isUser} effectiveName={effectiveName} />
      )}

      <div className={`flex flex-col ${isUser ? "items-end" : "items-start"} ${bubblesVariant === "v3" && !isUser ? "flex-1 min-w-0" : ""}`}>

        {/* v1 name: monogram above */}
        {showV1Name && (
          <MessageName variant="v1" placement="above-bubble" isUser={isUser} effectiveName={effectiveName} />
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
        <div className={`${bubbleClass}${isStreaming && streamingVariant === "v3" ? " relative overflow-hidden" : ""}`}>
          {/* Tool calls */}
          {message.toolCalls?.map((tc, j) => (
            <ToolCallBlock
              key={j}
              toolCall={tc}
              index={j}
              isOpen={!!toolsOpen[j]}
              onToggle={toggleToolCall}
              themeVariant={themeVariant}
              agentId={agentId}
            />
          ))}

          {/* Attachments */}
          <AttachmentSection
            attachments={message.attachments}
            files={message.files}
            mediaUrls={message.mediaUrls}
          />

          {/* Content */}
          {displayedContent && <MarkdownContent content={displayedContent} />}

          {/* Streaming indicator */}
          <StreamingIndicator variant={streamingVariant} isStreaming={isStreaming} isUser={isUser} />

          {/* Timestamp inside bubble (v2) */}
          <TimestampDisplay timestamp={message.timestamp} variant={timestampVariant} placement="inside" isUser={isUser} />
        </div>

        {/* Audio playback */}
        {inlineAudioFile && (
          <button
            type="button"
            onClick={toggleInlineAudio}
            className="mt-2 inline-flex items-center justify-center rounded-md border border-border bg-background/50 p-1.5 text-text-muted hover:text-foreground"
            title={inlineAudioPlaying ? "Pause voice message" : "Play voice message"}
          >
            {inlineAudioPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
        )}

        {/* Timestamp outside bubble */}
        <TimestampDisplay timestamp={message.timestamp} variant={timestampVariant} placement="outside" isUser={isUser} />
      </div>
    </motion.div>
  );
}
