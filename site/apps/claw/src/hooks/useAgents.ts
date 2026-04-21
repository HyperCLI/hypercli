"use client";

import { useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useHyperCLI } from "./useHyperCLI";
import { isTransitionalState } from "@/types";
import type { SdkAgent, AgentListResponse } from "@/types";

// ── Query keys ──

export const agentsKeys = {
  all: ["agents"] as const,
  detail: (id: string) => ["agent", id] as const,
};

// ── Hook ──

export function useAgents() {
  const { deployments, token, ready } = useHyperCLI();
  const queryClient = useQueryClient();

  // ── List query ──
  const {
    data,
    isLoading,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: agentsKeys.all,
    queryFn: async (): Promise<AgentListResponse> => {
      if (!deployments) throw new Error("SDK not ready");
      const items = await deployments.list();
      return { items };
    },
    enabled: ready && !!deployments,
    refetchInterval: (query) => {
      const resp = query.state.data;
      if (!resp?.items) return 60_000;
      const hasTransitional = resp.items.some((a: SdkAgent) =>
        isTransitionalState(a.state),
      );
      return hasTransitional ? 3_000 : 60_000;
    },
  });

  const agents = data?.items ?? [];
  const budget = data?.budget ?? null;
  const error = queryError ? (queryError instanceof Error ? queryError.message : String(queryError)) : null;
  const clusterUnavailable = !!queryError && String(queryError).includes("503");

  // ── Create mutation ──
  const createMutation = useMutation({
    mutationFn: async (options: Record<string, unknown>) => {
      if (!deployments) throw new Error("SDK not ready");
      return deployments.createOpenClaw(options);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentsKeys.all });
    },
  });

  // ── Start mutation ──
  const startMutation = useMutation({
    mutationFn: async (agentId: string) => {
      if (!deployments) throw new Error("SDK not ready");
      return deployments.startOpenClaw(agentId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentsKeys.all });
    },
  });

  // ── Stop mutation ──
  const stopMutation = useMutation({
    mutationFn: async (agentId: string) => {
      if (!deployments) throw new Error("SDK not ready");
      return deployments.stop(agentId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentsKeys.all });
    },
  });

  // ── Delete mutation ──
  const deleteMutation = useMutation({
    mutationFn: async (agentId: string) => {
      if (!deployments) throw new Error("SDK not ready");
      return deployments.delete(agentId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentsKeys.all });
    },
  });

  // ── Mutation state helpers ──
  const mutatingIds = useMemo(() => ({
    starting: new Set<string>(),
    stopping: new Set<string>(),
    deleting: new Set<string>(),
  }), []);

  const isStarting = useCallback((id: string) => startMutation.isPending && startMutation.variables === id, [startMutation]);
  const isStopping = useCallback((id: string) => stopMutation.isPending && stopMutation.variables === id, [stopMutation]);
  const isDeleting = useCallback((id: string) => deleteMutation.isPending && deleteMutation.variables === id, [deleteMutation]);

  return {
    agents,
    budget,
    isLoading,
    error,
    clusterUnavailable,
    refetch,
    createAgent: createMutation.mutateAsync,
    startAgent: startMutation.mutateAsync,
    stopAgent: stopMutation.mutateAsync,
    deleteAgent: deleteMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isStarting,
    isStopping,
    isDeleting,
  };
}
