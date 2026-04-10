"use client";

import { useQuery } from "@tanstack/react-query";
import { useHyperCLI } from "./useHyperCLI";
import { clawFetch } from "@/lib/api";
import type { UsageInfo, DayData, KeyUsageEntry } from "@/types";

export const usageKeys = {
  current: ["usage"] as const,
  history: (days: number) => ["usage", "history", days] as const,
  keys: (days: number) => ["usage", "keys", days] as const,
};

export function useUsage(days: number = 7) {
  const { token, ready } = useHyperCLI();

  const {
    data: usage,
    isLoading: usageLoading,
    error: usageError,
  } = useQuery({
    queryKey: usageKeys.current,
    queryFn: async () => {
      if (!token) throw new Error("Not authenticated");
      return clawFetch<UsageInfo>("/usage", token);
    },
    enabled: ready && !!token,
  });

  const {
    data: history,
    isLoading: historyLoading,
  } = useQuery({
    queryKey: usageKeys.history(days),
    queryFn: async () => {
      if (!token) throw new Error("Not authenticated");
      return clawFetch<DayData[]>(`/usage/history?days=${days}`, token);
    },
    enabled: ready && !!token,
  });

  const {
    data: keyUsage,
    isLoading: keyUsageLoading,
  } = useQuery({
    queryKey: usageKeys.keys(days),
    queryFn: async () => {
      if (!token) throw new Error("Not authenticated");
      return clawFetch<KeyUsageEntry[]>(`/usage/keys?days=${days}`, token);
    },
    enabled: ready && !!token,
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
