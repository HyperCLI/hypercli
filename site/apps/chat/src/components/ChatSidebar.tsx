"use client";

import { cn, Button, Separator } from "@hypercli/shared-ui";
import { Plus, MessageSquare, Settings, Cpu, Trash2, Moon, Sun, LogOut, PanelLeftClose } from "lucide-react";
import Link from "next/link";

interface Thread {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

interface Model {
  id: string;
}

interface Balance {
  balance: string;
  rewards_balance: string;
}

interface ChatSidebarProps {
  threads: Thread[];
  currentThreadId: string | null;
  models: Model[];
  selectedModel: string;
  loadingModels: boolean;
  loadingThreads: boolean;
  balance: Balance | null;
  theme: "light" | "dark";
  onSelectThread: (threadId: string) => void;
  onDeleteThread: (threadId: string, e: React.MouseEvent) => void;
  onNewThread: () => void;
  onSelectModel: (modelId: string) => void;
  onToggleTheme: () => void;
  onTopUp: () => void;
  onLogout: () => void;
  onHideSidebar?: () => void;
}

export function ChatSidebar({
  threads,
  currentThreadId,
  models,
  selectedModel,
  loadingModels,
  loadingThreads,
  balance,
  theme,
  onSelectThread,
  onDeleteThread,
  onNewThread,
  onSelectModel,
  onToggleTheme,
  onTopUp,
  onLogout,
  onHideSidebar,
}: ChatSidebarProps) {
  return (
    <aside className="w-72 border-r border-border/80 bg-surface-low/90 flex flex-col h-full">
      {/* Header */}
      <div className="h-16 border-b border-border/80 flex items-center justify-between px-4">
        <Link href={process.env.NEXT_PUBLIC_MAIN_SITE_URL || "/"} className="text-lg font-semibold text-foreground tracking-tight">
          Hyper<span className="text-primary">CLI</span>
          <span className="text-muted-foreground ml-1.5 text-xs font-semibold uppercase tracking-[0.2em]">Chat</span>
        </Link>
        <div className="flex items-center gap-1">
          {onHideSidebar && (
            <button
              onClick={onHideSidebar}
              className="p-2 rounded-xl border border-border/60 hover:bg-surface-high transition-colors text-muted-foreground hover:text-foreground cursor-pointer"
              title="Hide sidebar"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onToggleTheme}
            className="p-2 rounded-xl border border-border/60 hover:bg-surface-high transition-colors text-muted-foreground hover:text-foreground cursor-pointer"
          >
            {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* New Chat Button */}
      <div className="p-3">
        <Button onClick={onNewThread} className="w-full justify-start gap-2 rounded-xl shadow-lg shadow-primary/10" size="sm">
          <Plus className="h-4 w-4" />
          New Chat
        </Button>
      </div>

      <Separator />

      {/* Model Selector */}
      <div className="p-3">
        <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.2em] mb-2 px-2">
          Models
        </h3>
        <div className="space-y-1 max-h-44 overflow-y-auto chat-scrollbar pr-1">
          {loadingModels ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">Loading...</div>
          ) : models.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">No models available</div>
          ) : (
            models.map((model) => (
              <button
                key={model.id}
                onClick={() => onSelectModel(model.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-colors border cursor-pointer",
                  selectedModel === model.id
                    ? "bg-primary/10 text-primary border-primary/40"
                    : "text-muted-foreground hover:text-foreground hover:bg-surface-high/80 border-border/50"
                )}
              >
                <Cpu className="h-4 w-4 flex-shrink-0" />
                <span className="flex-1 text-left truncate">{model.id}</span>
                <span className="w-2 h-2 rounded-full bg-success flex-shrink-0" />
              </button>
            ))
          )}
        </div>
      </div>

      <Separator />

      {/* Recent Conversations */}
      <div className="flex-1 overflow-y-auto p-3 chat-scrollbar">
        <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.2em] mb-2 px-2">
          Recent
        </h3>
        <div className="space-y-1">
          {loadingThreads ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">Loading...</div>
          ) : threads.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">No conversations yet</div>
          ) : (
            threads.map((thread) => (
              <div
                key={thread.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectThread(thread.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectThread(thread.id);
                  }
                }}
                className={cn(
                  "group w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-colors cursor-pointer border",
                  currentThreadId === thread.id
                    ? "bg-primary/10 text-primary border-primary/40"
                    : "text-muted-foreground hover:text-foreground hover:bg-surface-high/80 border-border/50"
                )}
              >
                <MessageSquare className="h-4 w-4 flex-shrink-0" />
                <span className="flex-1 text-left truncate">{thread.title || "New Chat"}</span>
                <button
                  onClick={(e) => onDeleteThread(thread.id, e)}
                  className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/20 hover:text-destructive transition-all cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-border/80 space-y-3">
        {/* Balance Section */}
        {balance && (
          <div className="p-3 bg-surface-high/80 rounded-xl border border-border/60">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">Balance</span>
              <button onClick={onTopUp} className="text-xs font-medium text-primary hover:underline cursor-pointer">
                Top Up
              </button>
            </div>
            <p className="text-xl font-bold text-foreground">${balance.balance}</p>
            {balance.rewards_balance && parseFloat(balance.rewards_balance) > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5">+${balance.rewards_balance} rewards</p>
            )}
          </div>
        )}

        {/* Settings & Logout */}
        <div className="space-y-1">
          <button className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-surface-high/80 transition-colors border border-transparent hover:border-border/60 cursor-pointer">
            <Settings className="h-4 w-4" />
            Settings
          </button>
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-destructive hover:bg-destructive/10 transition-colors border border-transparent hover:border-destructive/30 cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </div>
      </div>
    </aside>
  );
}
