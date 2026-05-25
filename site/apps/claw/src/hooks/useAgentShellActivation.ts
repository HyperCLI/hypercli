"use client";

import { useEffect, useReducer } from "react";

interface UseAgentShellActivationOptions {
  agentId: string | null;
  agentState: string | null;
  activeTab: string;
}

interface ShellActivationEvent {
  agentId: string | null;
  agentRunning: boolean;
  activeTab: string;
}

function shellActivationReducer(currentAgentId: string | null, event: ShellActivationEvent): string | null {
  if (!event.agentId || !event.agentRunning) return null;
  if (event.activeTab === "shell") return event.agentId;
  return currentAgentId === event.agentId ? currentAgentId : null;
}

export function useAgentShellActivation({
  agentId,
  agentState,
  activeTab,
}: UseAgentShellActivationOptions): boolean {
  const [activatedAgentId, updateActivation] = useReducer(shellActivationReducer, null);
  const agentRunning = agentState === "RUNNING";

  useEffect(() => {
    updateActivation({ agentId, agentRunning, activeTab });
  }, [activeTab, agentId, agentRunning]);

  return Boolean(agentId && agentRunning && activatedAgentId === agentId);
}
