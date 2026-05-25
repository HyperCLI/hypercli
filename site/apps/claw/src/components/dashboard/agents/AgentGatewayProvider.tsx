"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { OpenClawAgent } from "@hypercli.com/sdk/agents";
import { useOpenClawSession } from "@/hooks/useOpenClawSession";

export type AgentGatewaySession = ReturnType<typeof useOpenClawSession>;

const AgentGatewayContext = createContext<AgentGatewaySession | null>(null);

export function AgentGatewayProvider({
  agent,
  enabled,
  children,
}: {
  agent: OpenClawAgent | null;
  enabled: boolean;
  children: ReactNode;
}) {
  const session = useOpenClawSession(agent, enabled);

  return (
    <AgentGatewayContext.Provider value={session}>
      {children}
    </AgentGatewayContext.Provider>
  );
}

export function AgentGatewaySessionProvider({
  session,
  children,
}: {
  session: AgentGatewaySession;
  children: ReactNode;
}) {
  return (
    <AgentGatewayContext.Provider value={session}>
      {children}
    </AgentGatewayContext.Provider>
  );
}

export function useAgentGatewaySession(): AgentGatewaySession {
  const session = useContext(AgentGatewayContext);
  if (!session) {
    throw new Error("useAgentGatewaySession must be used within an AgentGatewayProvider");
  }
  return session;
}
