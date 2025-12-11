"use client";

import { cn } from "@hypercli/shared-ui";
import { User, Bot } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatWindowProps {
  messages: Message[];
}

export function ChatWindow({ messages }: ChatWindowProps) {
  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Bot className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-xl font-semibold text-foreground mb-2">
            Start a conversation
          </h2>
          <p className="text-muted-foreground">
            Send a message to begin chatting with the AI model. Your
            conversations are powered by HyperCLI deployments.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6">
      {messages.map((message, index) => (
        <div
          key={index}
          className={cn(
            "flex gap-4 max-w-3xl mx-auto",
            message.role === "user" ? "flex-row-reverse" : ""
          )}
        >
          {/* Avatar */}
          <div
            className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
              message.role === "user"
                ? "bg-primary/20"
                : "bg-surface-high"
            )}
          >
            {message.role === "user" ? (
              <User className="w-4 h-4 text-primary" />
            ) : (
              <Bot className="w-4 h-4 text-muted-foreground" />
            )}
          </div>

          {/* Message Content */}
          <div
            className={cn(
              "flex-1 rounded-lg p-4",
              message.role === "user"
                ? "bg-primary/10 text-foreground"
                : "bg-surface-low text-foreground"
            )}
          >
            <p className="text-sm leading-relaxed">{message.content}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
