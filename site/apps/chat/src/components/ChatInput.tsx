"use client";

import { useState } from "react";
import { Button, Input } from "@hypercli/shared-ui";
import { Send, Paperclip } from "lucide-react";

interface ChatInputProps {
  onSendMessage: (content: string) => void;
}

export function ChatInput({ onSendMessage }: ChatInputProps) {
  const [input, setInput] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      onSendMessage(input.trim());
      setInput("");
    }
  };

  return (
    <div className="border-t border-border p-4">
      <form
        onSubmit={handleSubmit}
        className="max-w-3xl mx-auto flex items-center gap-3"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground"
        >
          <Paperclip className="h-5 w-5" />
        </Button>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Send a message..."
          className="flex-1"
        />
        <Button type="submit" size="icon" disabled={!input.trim()}>
          <Send className="h-5 w-5" />
        </Button>
      </form>
      <p className="text-xs text-muted-foreground text-center mt-2">
        Messages are processed by your HyperCLI deployment
      </p>
    </div>
  );
}
