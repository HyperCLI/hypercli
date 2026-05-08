"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useHyperCLI } from "./useHyperCLI";
import type { HyperAgentPlan, HyperAgentCurrentPlan, AgentTypeCatalogResponse } from "@/types";

export const plansKeys = {
  catalog: ["plans"] as const,
  current: ["plans", "current"] as const,
  types: ["plans", "types"] as const,
};

export function usePlans() {
  const { hyperAgent, token, ready } = useHyperCLI();
  const queryClient = useQueryClient();

  // ── Plans catalog ──
  const {
    data: plans,
    isLoading: plansLoading,
    error: plansError,
  } = useQuery({
    queryKey: plansKeys.catalog,
    queryFn: async (): Promise<HyperAgentPlan[]> => {
      if (!hyperAgent) throw new Error("SDK not ready");
      return hyperAgent.plans();
    },
    enabled: ready && !!hyperAgent,
  });

  // ── Current plan ──
  const {
    data: currentPlan,
    isLoading: currentPlanLoading,
    error: currentPlanError,
  } = useQuery({
    queryKey: plansKeys.current,
    queryFn: async (): Promise<HyperAgentCurrentPlan> => {
      if (!hyperAgent) throw new Error("SDK not ready");
      return hyperAgent.currentPlan();
    },
    enabled: ready && !!hyperAgent,
  });

  // ── Type catalog ──
  const {
    data: typeCatalog,
    isLoading: typeCatalogLoading,
  } = useQuery({
    queryKey: plansKeys.types,
    queryFn: async (): Promise<AgentTypeCatalogResponse> => {
      if (!hyperAgent) throw new Error("SDK not ready");
      return hyperAgent.agentTypes() as unknown as AgentTypeCatalogResponse;
    },
    enabled: ready && !!hyperAgent && !!token,
  });

  const error = plansError || currentPlanError
    ? ((plansError instanceof Error ? plansError.message : "") +
       (currentPlanError instanceof Error ? currentPlanError.message : "")).trim() || "Failed to load plans"
    : null;

  const refreshCurrentPlan = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: plansKeys.current });
  }, [queryClient]);

  return {
    plans: plans ?? [],
    currentPlan: currentPlan ?? null,
    typeCatalog: typeCatalog ?? null,
    isLoading: plansLoading || currentPlanLoading || typeCatalogLoading,
    error,
    refreshCurrentPlan,
  };
}
