"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@hypercli/shared-ui";
import { Send } from "lucide-react";

interface ChatInputProps {
  onSendMessage: (content: string) => void;
  disabled?: boolean;
  placeholder?: string;
  initialValue?: string;
}

export function ChatInput({
  onSendMessage,
  disabled = false,
  placeholder = "Type your message... (Shift+Enter for new line)",
  initialValue = "",
}: ChatInputProps) {
  const [input, setInput] = useState(initialValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Update input when initialValue changes (for pre-filled messages)
  useEffect(() => {
    if (initialValue) {
      setInput(initialValue);
    }
  }, [initialValue]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 200) + "px";
    }
  }, [input]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !disabled) {
      onSendMessage(input.trim());
      setInput("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div
      className="sticky bottom-0 border-t border-border/70 p-4 bg-background/80 backdrop-blur-xl z-30"
      style={{
        paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
        transform: "translateY(calc(-1 * var(--keyboard-offset)))",
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="max-w-5xl mx-auto flex items-end gap-3"
      >
        <div className="flex-1 rounded-2xl border border-border/70 bg-surface-high/70 shadow-lg shadow-black/30 px-4 py-3">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="w-full bg-transparent text-foreground text-[15px] resize-none focus:outline-none disabled:opacity-50"
          />
          <div className="mt-2 flex items-center justify-between text-[11px] text-text-tertiary">
            <span>Shift + Enter for new line</span>
            <span className={disabled ? "text-text-muted" : ""}>{input.trim().length} chars</span>
          </div>
        </div>
        <Button
          type="submit"
          disabled={disabled || !input.trim()}
          className="px-5 py-3 h-auto rounded-2xl"
        >
          <Send className="h-5 w-5" />
        </Button>
      </form>
    </div>
  );
}
