"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Wrench } from "lucide-react";
import type { ChatMessage as ChatMessageType } from "@/hooks/useGatewayChat";

interface ChatMessageProps {
  message: ChatMessageType;
}

function formatTime(ts?: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ChatMessageBubble({ message }: ChatMessageProps) {
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState<Record<number, boolean>>({});

  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  if (isSystem) {
    return (
      <div className="flex justify-center">
        <div className="max-w-[85%] rounded-lg px-4 py-2 text-sm bg-[#d05f5f]/10 border border-[#d05f5f]/20 text-[#d05f5f]">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} group`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm ${
          isUser
            ? "bg-surface-high text-foreground"
            : "bg-surface-low text-foreground"
        }`}
      >
        {/* Thinking block */}
        {message.thinking && (
          <button
            onClick={() => setThinkingOpen(!thinkingOpen)}
            className="flex items-center gap-1.5 text-xs text-text-muted mb-2 hover:text-text-secondary transition-colors"
          >
            {thinkingOpen ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            Thinking...
          </button>
        )}
        {message.thinking && thinkingOpen && (
          <pre className="text-xs text-text-muted whitespace-pre-wrap mb-2 italic leading-relaxed">
            {message.thinking}
          </pre>
        )}

        {/* Tool calls */}
        {message.toolCalls?.map((tc, j) => (
          <div
            key={j}
            className="mb-2 text-xs bg-background/50 border border-border rounded-md overflow-hidden"
          >
            <button
              onClick={() =>
                setToolsOpen((prev) => ({ ...prev, [j]: !prev[j] }))
              }
              className="flex items-center gap-1.5 w-full px-2.5 py-1.5 hover:bg-surface-low transition-colors text-left"
            >
              <Wrench className="w-3 h-3 text-[#f0c56c]" />
              <span className="text-[#f0c56c] font-medium">{tc.name}</span>
              {toolsOpen[j] ? (
                <ChevronDown className="w-3 h-3 text-text-muted ml-auto" />
              ) : (
                <ChevronRight className="w-3 h-3 text-text-muted ml-auto" />
              )}
            </button>
            {toolsOpen[j] && (
              <pre className="px-2.5 py-1.5 text-text-muted whitespace-pre-wrap border-t border-border font-mono">
                {tc.args}
                {tc.result && (
                  <>
                    {"\n"}
                    <span className="text-text-secondary">→ {tc.result}</span>
                  </>
                )}
              </pre>
            )}
          </div>
        ))}

        {/* Content */}
        {message.content && (
          <div className="whitespace-pre-wrap leading-relaxed">
            {message.content}
          </div>
        )}

        {/* Timestamp on hover */}
        {message.timestamp && (
          <div className="text-[10px] text-text-muted mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {formatTime(message.timestamp)}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatThinkingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bg-surface-low rounded-lg px-4 py-2.5 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
        <span className="text-xs text-text-muted">Thinking...</span>
      </div>
    </div>
  );
}
