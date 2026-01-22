"use client";

import { Button } from "@hypercli/shared-ui";
import { PanelLeftOpen, Cpu } from "lucide-react";

interface ChatHeaderProps {
  selectedModel: string;
  loadingModels: boolean;
  showSignIn: boolean;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onShowLogin: () => void;
}

export function ChatHeader({
  selectedModel,
  loadingModels,
  showSignIn,
  sidebarOpen,
  onToggleSidebar,
  onShowLogin,
}: ChatHeaderProps) {
  return (
    <div className="border-b border-border/80 bg-background/70 backdrop-blur-xl">
      <div className={`h-16 flex items-center gap-4 px-4 transition-all duration-300 ${
        sidebarOpen ? 'max-w-5xl mx-auto' : 'max-w-full'
      }`}>
        {!sidebarOpen && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleSidebar}
            className="text-muted-foreground hover:text-foreground border border-border/70 rounded-xl h-10 w-10"
          >
            <PanelLeftOpen className="w-5 h-5" />
          </Button>
        )}

        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border/60 bg-surface-low/70">
            <Cpu className="w-4 h-4 text-primary" />
            <span className="text-sm text-foreground truncate">
              {loadingModels ? "Loading models..." : selectedModel || "No model selected"}
            </span>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs text-text-tertiary">
            <span className="w-2 h-2 rounded-full bg-success animate-pulse-soft" />
            <span>Live</span>
          </div>
        </div>

        {showSignIn && (
          <Button
            variant="outline"
            onClick={onShowLogin}
            className="text-primary border-primary/60 hover:bg-primary hover:text-primary-foreground rounded-full px-4"
          >
            Sign in to save history
          </Button>
        )}
      </div>
    </div>
  );
}
