"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { useHyperCLI } from "./useHyperCLI";
import { agentsKeys } from "./useAgents";
import { isTransitionalState } from "@/types";
import type { SdkAgent, AgentTokenResponse } from "@/types";

export function useAgent(agentId: string | null) {
  const { deployments, ready } = useHyperCLI();

  const {
    data: agent,
    isLoading,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: agentsKeys.detail(agentId ?? ""),
    queryFn: async (): Promise<SdkAgent> => {
      if (!deployments || !agentId) throw new Error("SDK not ready");
      return deployments.get(agentId);
    },
    enabled: ready && !!deployments && !!agentId,
    refetchInterval: (query) => {
      const a = query.state.data;
      if (!a) return false;
      return isTransitionalState(a.state) ? 3_000 : 60_000;
    },
  });

  const error = queryError ? (queryError instanceof Error ? queryError.message : String(queryError)) : null;

  const refreshToken = useCallback(async (): Promise<AgentTokenResponse> => {
    if (!deployments || !agentId) throw new Error("SDK not ready");
    return deployments.refreshToken(agentId);
  }, [deployments, agentId]);

  const getEnv = useCallback(async (): Promise<Record<string, string>> => {
    if (!deployments || !agentId) throw new Error("SDK not ready");
    const result = await deployments.env(agentId);
    return result.env;
  }, [deployments, agentId]);

  const getMetrics = useCallback(async (): Promise<Record<string, unknown>> => {
    if (!deployments || !agentId) throw new Error("SDK not ready");
    return deployments.metrics(agentId);
  }, [deployments, agentId]);

  return {
    agent: agent ?? null,
    isLoading,
    error,
    refetch,
    refreshToken,
    getEnv,
    getMetrics,
  };
}
