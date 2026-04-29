"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useHyperCLI } from "./useHyperCLI";
import {
  getAgentPayments,
  getAgentPayment,
  getAgentBillingProfile,
  updateAgentBillingProfile,
  type AgentPayment,
  type AgentBillingProfileResponse,
  type AgentBillingProfileFields,
} from "@/lib/billing";

export const billingKeys = {
  payments: ["billing", "payments"] as const,
  payment: (id: string) => ["billing", "payment", id] as const,
  profile: ["billing", "profile"] as const,
};

export function useBilling() {
  const { hyperAgent, ready } = useHyperCLI();
  const queryClient = useQueryClient();

  // ── Payments list ──
  const {
    data: paymentsData,
    isLoading: paymentsLoading,
    error: paymentsError,
    refetch: refetchPayments,
  } = useQuery({
    queryKey: billingKeys.payments,
    queryFn: async () => {
      if (!hyperAgent) throw new Error("SDK not ready");
      return getAgentPayments(hyperAgent);
    },
    enabled: ready && !!hyperAgent,
  });

  // ── Billing profile ──
  const {
    data: profile,
    isLoading: profileLoading,
    error: profileError,
  } = useQuery({
    queryKey: billingKeys.profile,
    queryFn: async () => {
      if (!hyperAgent) throw new Error("SDK not ready");
      return getAgentBillingProfile(hyperAgent);
    },
    enabled: ready && !!hyperAgent,
  });

  // ── Update profile mutation ──
  const updateProfileMutation = useMutation({
    mutationFn: async (fields: AgentBillingProfileFields) => {
      if (!hyperAgent) throw new Error("SDK not ready");
      return updateAgentBillingProfile(hyperAgent, fields);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.profile });
    },
  });

  // ── Get single payment ──
  const getPayment = useCallback(
    async (paymentId: string): Promise<AgentPayment> => {
      if (!hyperAgent) throw new Error("SDK not ready");
      return getAgentPayment(hyperAgent, paymentId);
    },
    [hyperAgent],
  );

  const error = (paymentsError || profileError)
    ? ((paymentsError instanceof Error ? paymentsError.message : "") +
       (profileError instanceof Error ? profileError.message : "")).trim() || "Failed to load billing"
    : null;

  return {
    payments: paymentsData?.items ?? [],
    profile: profile ?? null,
    isLoading: paymentsLoading || profileLoading,
    error,
    refetch: refetchPayments,
    getPayment,
    updateProfile: updateProfileMutation.mutateAsync,
    isUpdatingProfile: updateProfileMutation.isPending,
  };
}
