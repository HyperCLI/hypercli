"use client";

import { Brain } from "lucide-react";

export function ChatThinkingIndicator(_props?: { variant?: string }) {
  return (
    <div className="flex justify-start">
      <div className="bg-surface-low rounded-lg px-4 py-3 flex items-center gap-3 border-l-2 border-[#38D39F]/50">
        <Brain className="w-4 h-4 text-[#38D39F]" />
        <span className="text-sm text-text-secondary">Thinking</span>
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#38D39F] animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-1.5 h-1.5 rounded-full bg-[#38D39F] animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="w-1.5 h-1.5 rounded-full bg-[#38D39F] animate-bounce" style={{ animationDelay: "300ms" }} />
        </span>
      </div>
    </div>
  );
}
