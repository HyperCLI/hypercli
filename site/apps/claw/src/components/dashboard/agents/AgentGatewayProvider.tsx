"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { OpenClawAgent } from "@hypercli.com/sdk/agents";
import { useOpenClawSession } from "@/hooks/useOpenClawSession";

type OpenClawGatewaySession = ReturnType<typeof useOpenClawSession>;

export type AgentGatewayBackend = "openclaw" | "hermes";

export interface AgentGatewaySession extends OpenClawGatewaySession {
  backend: AgentGatewayBackend;
}

type AgentGatewaySessionInput = OpenClawGatewaySession | AgentGatewaySession;

export function asAgentGatewaySession(session: AgentGatewaySessionInput): AgentGatewaySession {
  if ("backend" in session) return session;
  return {
    ...session,
    backend: "openclaw",
  };
}

const AgentGatewayContext = createContext<AgentGatewaySession | null>(null);

export function AgentGatewayProvider({
  agent,
  enabled,
  requestedSessionKey,
  children,
}: {
  agent: OpenClawAgent | null;
  enabled: boolean;
  requestedSessionKey?: string | null;
  children: ReactNode;
}) {
  const session = asAgentGatewaySession(useOpenClawSession(agent, enabled, requestedSessionKey));

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
  session: AgentGatewaySessionInput;
  children: ReactNode;
}) {
  return (
    <AgentGatewayContext.Provider value={asAgentGatewaySession(session)}>
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
