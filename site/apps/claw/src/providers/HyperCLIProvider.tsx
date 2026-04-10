"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Deployments } from "@hypercli.com/sdk/agents";
import type { HyperAgent } from "@hypercli.com/sdk/agent";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { createAgentClient, createHyperAgentClient } from "@/lib/agent-client";

// ── Context shape ──

export interface HyperCLIContextValue {
  /** Deployments client (agents CRUD, file ops, logs, shell) */
  deployments: Deployments | null;
  /** HyperAgent client (AI plans, models, inference) */
  hyperAgent: HyperAgent | null;
  /** Current auth token for clawFetch calls during migration */
  token: string | null;
  /** Whether SDK clients are ready to use */
  ready: boolean;
  /** Force refresh token and recreate clients */
  refreshClients: () => Promise<void>;
}

export const HyperCLIContext = createContext<HyperCLIContextValue | null>(null);

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
