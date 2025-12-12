"use client";

import { cn, Button, Separator } from "@hypercli/shared-ui";
import { Plus, MessageSquare, Settings, Cpu, Trash2, Moon, Sun, LogOut } from "lucide-react";
import Link from "next/link";

interface Chat {
  id: string;
  title: string;
  messages: { role: "user" | "assistant"; content: string }[];
  timestamp: number;
}

interface Model {
  id: string;
}

interface Balance {
  balance: string;
  rewards_balance: string;
}

interface ChatSidebarProps {
  chats: Chat[];
  currentChatId: string | null;
  models: Model[];
  selectedModel: string;
  loadingModels: boolean;
  balance: Balance | null;
  theme: "light" | "dark";
  onSelectChat: (chatId: string) => void;
  onDeleteChat: (chatId: string, e: React.MouseEvent) => void;
  onNewChat: () => void;
  onSelectModel: (modelId: string) => void;
  onToggleTheme: () => void;
  onTopUp: () => void;
  onLogout: () => void;
}

export function ChatSidebar({
  chats,
  currentChatId,
  models,
  selectedModel,
  loadingModels,
  balance,
  theme,
  onSelectChat,
  onDeleteChat,
  onNewChat,
  onSelectModel,
  onToggleTheme,
  onTopUp,
  onLogout,
}: ChatSidebarProps) {
  return (
    <aside className="w-72 border-r border-border bg-surface-low flex flex-col h-full">
      {/* Header */}
      <div className="h-14 border-b border-border flex items-center justify-between px-4">
        <Link href="/" className="text-lg font-bold text-foreground">
          Hyper<span className="text-primary">CLI</span>
          <span className="text-muted-foreground ml-1.5 text-sm font-normal">Chat</span>
        </Link>
        <button
          onClick={onToggleTheme}
          className="p-2 rounded-lg hover:bg-surface-high transition-colors text-muted-foreground hover:text-foreground"
        >
          {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
        </button>
      </div>

      {/* New Chat Button */}
      <div className="p-3">
        <Button onClick={onNewChat} className="w-full justify-start gap-2" size="sm">
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
        <div className="space-y-1 max-h-40 overflow-y-auto">
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
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
                  selectedModel === model.id
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-surface-high"
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
      <div className="flex-1 overflow-y-auto p-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2">
          Recent
        </h3>
        <div className="space-y-1">
          {chats.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">No conversations yet</div>
          ) : (
            chats.map((chat) => (
              <button
                key={chat.id}
                onClick={() => onSelectChat(chat.id)}
                className={cn(
                  "group w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
                  currentChatId === chat.id
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-surface-high"
                )}
              >
                <MessageSquare className="h-4 w-4 flex-shrink-0" />
                <span className="flex-1 text-left truncate">{chat.title || "New Chat"}</span>
                <button
                  onClick={(e) => onDeleteChat(chat.id, e)}
                  className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/20 hover:text-destructive transition-all"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-border space-y-3">
        {/* Balance Section */}
        {balance && (
          <div className="p-3 bg-surface-high rounded-lg">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">Balance</span>
              <button onClick={onTopUp} className="text-xs font-medium text-primary hover:underline">
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
          <button className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-surface-high transition-colors">
            <Settings className="h-4 w-4" />
            Settings
          </button>
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-destructive hover:bg-destructive/10 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </div>
      </div>
    </aside>
  );
}
