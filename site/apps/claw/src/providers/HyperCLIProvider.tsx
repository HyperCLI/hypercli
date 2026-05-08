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
import { createAgentClient, createHyperAgentClient } from "@/lib/agent-client";
import { HyperCLIContext, type HyperCLIContextValue } from "./HyperCLIContext";

// ── Context shape ──

// ── Provider ──

export function HyperCLIProvider({ children }: { children: ReactNode }) {
  const { getToken } = useAgentAuth();
  const [token, setToken] = useState<string | null>(null);
  const initRef = useRef(false);

  const clients = useMemo(() => {
    if (!token) return { deployments: null, hyperAgent: null };
    return {
      deployments: createAgentClient(token),
      hyperAgent: createHyperAgentClient(token),
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
