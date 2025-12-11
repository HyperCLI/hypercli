"use client";

import { cn, Button, Separator } from "@hypercli/shared-ui";
import { Plus, MessageSquare, Settings, Cpu } from "lucide-react";
import Link from "next/link";

const models = [
  { id: "llama-3-70b", name: "Llama 3 70B", status: "online" },
  { id: "mistral-7b", name: "Mistral 7B", status: "online" },
  { id: "claude-3", name: "Claude 3", status: "offline" },
  { id: "gpt-4", name: "GPT-4", status: "offline" },
];

const conversations = [
  { id: "1", title: "Code review help", model: "llama-3-70b" },
  { id: "2", title: "API design discussion", model: "mistral-7b" },
  { id: "3", title: "Debug Python script", model: "llama-3-70b" },
];

interface ChatSidebarProps {
  selectedModel: string;
  onSelectModel: (model: string) => void;
}

export function ChatSidebar({ selectedModel, onSelectModel }: ChatSidebarProps) {
  return (
    <aside className="w-64 border-r border-border bg-surface-low flex flex-col">
      {/* Header */}
      <div className="h-14 border-b border-border flex items-center px-4">
        <Link href="/" className="text-lg font-bold text-foreground">
          Hyper<span className="text-primary">CLI</span>
        </Link>
      </div>

      {/* New Chat Button */}
      <div className="p-3">
        <Button className="w-full justify-start gap-2" size="sm">
          <Plus className="h-4 w-4" />
          New Chat
        </Button>
      </div>

      <Separator />

      {/* Model Selector */}
      <div className="p-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2">
          Models
        </h3>
        <div className="space-y-1">
          {models.map((model) => (
            <button
              key={model.id}
              onClick={() => onSelectModel(model.id)}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
                selectedModel === model.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface-high"
              )}
            >
              <Cpu className="h-4 w-4" />
              <span className="flex-1 text-left">{model.name}</span>
              <span
                className={cn(
                  "w-2 h-2 rounded-full",
                  model.status === "online" ? "bg-success" : "bg-muted-foreground"
                )}
              />
            </button>
          ))}
        </div>
      </div>

      <Separator />

      {/* Recent Conversations */}
      <div className="flex-1 overflow-y-auto p-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2">
          Recent
        </h3>
        <div className="space-y-1">
          {conversations.map((conv) => (
            <button
              key={conv.id}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-surface-high transition-colors"
            >
              <MessageSquare className="h-4 w-4" />
              <span className="flex-1 text-left truncate">{conv.title}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-border">
        <button className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-surface-high transition-colors">
          <Settings className="h-4 w-4" />
          Settings
        </button>
      </div>
    </aside>
  );
}
