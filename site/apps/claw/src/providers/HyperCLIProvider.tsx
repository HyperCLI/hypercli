"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { createAgentClient, createHyperAgentClient, createWorkspacesClient } from "@/lib/agent-client";
import { HyperCLIContext, type HyperCLIContextValue } from "./HyperCLIContext";

// ── Context shape ──

// ── Provider ──

export function HyperCLIProvider({ children }: { children: ReactNode }) {
  const { getToken } = useAgentAuth();
  const [token, setToken] = useState<string | null>(null);
  const initRef = useRef(false);

  const clients = useMemo(() => {
    if (!token) return { deployments: null, hyperAgent: null, workspaces: null };
    return {
      deployments: createAgentClient(token),
      hyperAgent: createHyperAgentClient(token),
      workspaces: createWorkspacesClient(token),
    };
  }, [token]);

  const refreshClients = useCallback(async () => {
    try {
      const freshToken = await getToken();
      setToken(freshToken);
    } catch {
      setToken(null);
    }
  }, [getToken]);

  // Initialize on mount
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    refreshClients();
  }, [refreshClients]);

  const value = useMemo<HyperCLIContextValue>(
    () => ({
      deployments: clients.deployments,
      hyperAgent: clients.hyperAgent,
      workspaces: clients.workspaces,
      token,
      ready: !!token,
      refreshClients,
    }),
    [clients, token, refreshClients],
  );

  return (
    <HyperCLIContext.Provider value={value}>
      {children}
    </HyperCLIContext.Provider>
  );
}
