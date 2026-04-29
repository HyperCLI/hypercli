"use client";

import { useQuery } from "@tanstack/react-query";
import { useHyperCLI } from "./useHyperCLI";
import type { UsageInfo, DayData, KeyUsageEntry } from "@/types";
import type {
  HyperAgentKeyUsage,
  HyperAgentUsageHistory,
  HyperAgentUsageSummary,
} from "@hypercli.com/sdk/agent";

export const usageKeys = {
  current: ["usage"] as const,
  history: (days: number) => ["usage", "history", days] as const,
  keys: (days: number) => ["usage", "keys", days] as const,
};

export function useUsage(days: number = 7) {
  const { hyperAgent, ready } = useHyperCLI();

  const {
    data: usage,
    isLoading: usageLoading,
    error: usageError,
  } = useQuery({
    queryKey: usageKeys.current,
    queryFn: async () => {
      if (!hyperAgent) throw new Error("SDK not ready");
      return normalizeUsage(await hyperAgent.usageSummary());
    },
    enabled: ready && !!hyperAgent,
  });

  const {
    data: history,
    isLoading: historyLoading,
  } = useQuery({
    queryKey: usageKeys.history(days),
    queryFn: async () => {
      if (!hyperAgent) throw new Error("SDK not ready");
      return normalizeHistory(await hyperAgent.usageHistory(days));
    },
    enabled: ready && !!hyperAgent,
  });

  const {
    data: keyUsage,
    isLoading: keyUsageLoading,
  } = useQuery({
    queryKey: usageKeys.keys(days),
    queryFn: async () => {
      if (!hyperAgent) throw new Error("SDK not ready");
      return normalizeKeyUsage(await hyperAgent.keyUsage(days));
    },
    enabled: ready && !!hyperAgent,
  });

  const error = usageError
    ? (usageError instanceof Error ? usageError.message : String(usageError))
    : null;

  return {
    usage: usage ?? null,
    history: history ?? [],
    keyUsage: keyUsage ?? [],
    isLoading: usageLoading || historyLoading || keyUsageLoading,
    error,
  };
}

function normalizeUsage(usage: HyperAgentUsageSummary): UsageInfo {
  return {
    tpd_limit: 0,
    tpd_used: usage.totalTokens,
    total_tokens: usage.totalTokens,
  };
}

function normalizeHistory(history: HyperAgentUsageHistory): DayData[] {
  return history.history.map((entry) => ({
    date: entry.date,
    input_tokens: entry.promptTokens,
    output_tokens: entry.completionTokens,
  }));
}

function normalizeKeyUsage(keyUsage: HyperAgentKeyUsage): KeyUsageEntry[] {
  return keyUsage.keys.map((entry) => ({
    key_ref: entry.keyHash,
    key_name: entry.name,
    total_tokens: entry.totalTokens,
    input_tokens: entry.promptTokens,
    output_tokens: entry.completionTokens,
  }));
}
