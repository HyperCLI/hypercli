"use client";

import { Button } from "@hypercli/shared-ui";
import { Menu, Cpu } from "lucide-react";

interface ChatHeaderProps {
  selectedModel: string;
  loadingModels: boolean;
  isFreeUser: boolean;
  onToggleSidebar: () => void;
  onShowLogin: () => void;
}

export function ChatHeader({
  selectedModel,
  loadingModels,
  isFreeUser,
  onToggleSidebar,
  onShowLogin,
}: ChatHeaderProps) {
  return (
    <div className="h-14 border-b border-border flex items-center gap-4 px-4 bg-background">
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleSidebar}
        className="text-muted-foreground hover:text-foreground"
      >
        <Menu className="w-5 h-5" />
      </Button>

      <div className="flex items-center gap-2 flex-1">
        <Cpu className="w-4 h-4 text-[#38D39F]" />
        <span className="text-sm text-[#D4D6D7]">
          {loadingModels ? "Loading..." : selectedModel || "No model selected"}
        </span>
      </div>

      {isFreeUser && (
        <Button
          variant="outline"
          onClick={onShowLogin}
          className="text-primary border-primary hover:bg-primary hover:text-primary-foreground"
        >
          Sign in to save history
        </Button>
      )}
    </div>
  );
}
