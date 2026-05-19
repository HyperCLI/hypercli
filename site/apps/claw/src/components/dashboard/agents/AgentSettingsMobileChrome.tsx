"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Bot, MessageSquare, SlidersHorizontal } from "lucide-react";

import { HyperClawLogoLink } from "@/components/HyperClawLogoLink";

export interface AgentSettingsMobileSection {
  id: string;
  label: string;
}

interface AgentSettingsMobileChromeProps {
  activeSection: string;
  agentsMenuOpen?: boolean;
  onBackToChat?: () => void;
  onOpenAgentsMenu?: () => void;
  onOpenWorkspaceMenu?: () => void;
  onSectionChange: (sectionId: string) => void;
  sections: AgentSettingsMobileSection[];
  showBackToChat?: boolean;
  workspaceMenuOpen?: boolean;
}

export function AgentSettingsMobileChrome({
  activeSection,
  agentsMenuOpen = false,
  onBackToChat,
  onOpenAgentsMenu,
  onOpenWorkspaceMenu,
  onSectionChange,
  sections,
  showBackToChat = false,
  workspaceMenuOpen = false,
}: AgentSettingsMobileChromeProps) {
  return (
    <div className="flex shrink-0 flex-col bg-background">
      <div className="relative flex shrink-0 items-center justify-between border-b border-border px-4 py-4">
        <div className="flex min-w-0 items-center gap-2">
          <HyperClawLogoLink className="h-[31px] w-[102px] shrink-0" priority />
          <h1 className="truncate text-base font-medium text-text-muted">Settings</h1>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-border bg-surface-low/80 p-1">
          <AnimatePresence initial={false}>
            {showBackToChat && onBackToChat && (
              <motion.button
                key="settings-mobile-chat-return"
                type="button"
                aria-label="Back to chat"
                onClick={onBackToChat}
                initial={{ opacity: 0, scale: 0.85, width: 0 }}
                animate={{ opacity: 1, scale: 1, width: 40 }}
                exit={{ opacity: 0, scale: 0.85, width: 0 }}
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                className="flex h-10 shrink-0 items-center justify-center overflow-hidden rounded-lg text-text-secondary transition-colors hover:bg-background hover:text-foreground"
              >
                <MessageSquare className="h-5 w-5 shrink-0" />
              </motion.button>
            )}
          </AnimatePresence>
          <button
            type="button"
            aria-label="Open agents sidebar"
            aria-expanded={agentsMenuOpen}
            onClick={onOpenAgentsMenu}
            disabled={!onOpenAgentsMenu}
            className={`flex h-10 w-10 items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              agentsMenuOpen
                ? "border-[#38D39F]/30 bg-[#38D39F]/10 text-[#38D39F]"
                : "border-transparent text-text-secondary hover:bg-background hover:text-foreground"
            }`}
          >
            <Bot className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Open workspace sidebar"
            aria-expanded={workspaceMenuOpen}
            onClick={onOpenWorkspaceMenu}
            disabled={!onOpenWorkspaceMenu}
            className={`flex h-10 w-10 items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              workspaceMenuOpen
                ? "border-[#38D39F]/30 bg-[#38D39F]/10 text-[#38D39F]"
                : "border-transparent text-text-secondary hover:bg-background hover:text-foreground"
            }`}
          >
            <SlidersHorizontal className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="shrink-0 border-b border-foreground px-5 py-5">
        <nav
          aria-label="Settings sections"
          className="flex h-7 w-full overflow-hidden rounded-[5px] bg-[#5a5a5a] p-[1px]"
        >
          {sections.map((section) => {
            const active = activeSection === section.id;
            return (
              <button
                key={section.id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => onSectionChange(section.id)}
                className={`flex h-full min-w-0 flex-1 items-center justify-center rounded-[4px] px-1 text-[11px] font-medium leading-none transition-colors ${
                  active
                    ? "bg-[#666] text-foreground shadow-[inset_0_0_0_1px_rgba(255,255,255,0.28)]"
                    : "text-text-muted hover:bg-white/5 hover:text-foreground"
                }`}
              >
                <span className="truncate">{section.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
