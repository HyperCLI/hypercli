"use client";

import React from "react";
import { Sheet, SheetContent } from "@hypercli/shared-ui";

import { AgentView } from "@/components/dashboard/AgentView";
import type { AgentViewProps } from "@/components/dashboard/agentViewTypes";
import type { Agent } from "@/app/dashboard/agents/types";

interface AgentInspectorProps {
  isDesktopViewport: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  selectedAgent: Agent | null;
  isSelectedRunning: boolean;
  activeTab: AgentViewProps["activeTab"];
  onTabChange: NonNullable<AgentViewProps["onTabChange"]>;
  viewProps: Omit<AgentViewProps, "agentName" | "activeTab" | "onTabChange" | "agentStatus">;
}

function buildAgentStatus(selectedAgent: Agent, isSelectedRunning: boolean): AgentViewProps["agentStatus"] {
  if (isSelectedRunning) {
    return {
      state: selectedAgent.state as "RUNNING",
      uptime: selectedAgent.started_at ? Date.now() - new Date(selectedAgent.started_at).getTime() : 0,
      cpu: selectedAgent.cpu_millicores / 10,
      memory: { used: selectedAgent.memory_mib, total: selectedAgent.memory_mib },
    };
  }

  if (selectedAgent.state === "STOPPED") {
    return {
      state: "STOPPED",
      uptime: 0,
      cpu: 0,
      memory: { used: 0, total: selectedAgent.memory_mib },
    };
  }

  return {
    state: (selectedAgent.state === "PENDING"
      ? "STARTING"
      : selectedAgent.state === "FAILED"
        ? "STOPPED"
      : selectedAgent.state) as "RUNNING" | "STOPPED" | "STARTING" | "STOPPING",
    uptime: 0,
    cpu: 0,
    memory: { used: 0, total: selectedAgent.memory_mib },
  };
}

export function AgentInspector({
  isDesktopViewport,
  open,
  setOpen,
  selectedAgent,
  isSelectedRunning,
  activeTab,
  onTabChange,
  viewProps,
}: AgentInspectorProps) {
  if (!selectedAgent) return null;

  const inspector = (
    <AgentView
      {...viewProps}
      agentName={selectedAgent.name || selectedAgent.id}
      activeTab={activeTab}
      onTabChange={onTabChange}
      agentStatus={buildAgentStatus(selectedAgent, isSelectedRunning)}
    />
  );

  if (isDesktopViewport) {
    return (
      <div className="w-80 flex-shrink-0 border-l border-border flex flex-col min-h-0">
        {inspector}
      </div>
    );
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="bottom"
        className="h-[80dvh] p-0 border-t border-border bg-background"
      >
        <div className="h-full flex flex-col min-h-0">
          {inspector}
        </div>
      </SheetContent>
    </Sheet>
  );
}
