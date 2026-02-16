"use client";

import { useState, useEffect } from "react";
import { Key, Activity, Gauge, ArrowRight, Zap, Hash } from "lucide-react";
import Link from "next/link";
import { useClawAuth } from "@/hooks/useClawAuth";
import { clawFetch } from "@/lib/api";
import UsageChart from "@/components/dashboard/UsageChart";
import KeyUsageTable from "@/components/dashboard/KeyUsageTable";

interface PlanInfo {
  id: string;
  name: string;
  price: number;
  aiu: number;
  tpd?: number;
  tpm_limit: number;
  rpm_limit: number;
  features: string[];
  expires_at: string | null;
}

interface UsageInfo {
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  request_count: number;
  active_keys: number;
  current_tpm: number;
  current_rpm: number;
  period: string;
}

interface DayData {
  date: string;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  requests: number;
}

interface HistoryResponse {
  history: DayData[];
  days: number;
}

interface KeyUsageEntry {
  key_hash: string;
  name: string;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  requests: number;
}

interface KeyUsageResponse {
  keys: KeyUsageEntry[];
  days: number;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

export default function DashboardPage() {
  const { getToken } = useClawAuth();
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [history, setHistory] = useState<DayData[]>([]);
  const [keyUsage, setKeyUsage] = useState<KeyUsageEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = await getToken();
        const [planData, usageData, historyData, keyData] =
          await Promise.allSettled([
            clawFetch<PlanInfo>("/plans/current", token),
            clawFetch<UsageInfo>("/usage", token),
            clawFetch<HistoryResponse>("/usage/history?days=7", token),
            clawFetch<KeyUsageResponse>("/usage/keys?days=7", token),
          ]);

        if (planData.status === "fulfilled") setPlan(planData.value);
        if (usageData.status === "fulfilled") setUsage(usageData.value);
        if (historyData.status === "fulfilled")
          setHistory(historyData.value.history);
        if (keyData.status === "fulfilled") setKeyUsage(keyData.value.keys);
      } catch {
        // Graceful fallback
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [getToken]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
        <Link
          href="/dashboard/keys"
          className="btn-primary px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
        >
          <Key className="w-4 h-4" />
          API Keys
        </Link>
      </div>

      {/* Current Plan */}
      <div className="glass-card p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-text-tertiary mb-1">Current Plan</p>
            <h2 className="text-2xl font-bold text-foreground">
              {loading ? (
                <span className="text-text-muted">Loading...</span>
              ) : plan ? (
                <>
                  {plan.name}{" "}
                  <span className="text-primary text-lg font-normal">
                    {plan.aiu} AIU
                  </span>
                </>
              ) : (
                <span className="text-text-muted">Free Tier</span>
              )}
            </h2>
            {plan?.expires_at && (
              <p className="text-sm text-text-muted mt-1">
                Renews{" "}
                {new Date(plan.expires_at).toLocaleDateString(undefined, {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            )}
          </div>
          <Link
            href="/dashboard/plans"
            className="btn-secondary px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            Manage Plan
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid sm:grid-cols-4 gap-4 mb-6">
        <div className="glass-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-lg bg-[#38D39F]/10 flex items-center justify-center">
              <Activity className="w-4 h-4 text-primary" />
            </div>
            <span className="text-sm text-text-tertiary">Tokens (30d)</span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {loading
              ? "—"
              : usage
                ? formatTokens(usage.total_tokens)
                : "0"}
          </p>
          {usage && usage.total_tokens > 0 && (
            <p className="text-xs text-text-muted mt-1">
              {formatTokens(usage.prompt_tokens)} prompt /{" "}
              {formatTokens(usage.completion_tokens)} completion
            </p>
          )}
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-lg bg-[#38D39F]/10 flex items-center justify-center">
              <Hash className="w-4 h-4 text-primary" />
            </div>
            <span className="text-sm text-text-tertiary">Requests (30d)</span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {loading
              ? "—"
              : usage
                ? usage.request_count.toLocaleString()
                : "0"}
          </p>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-lg bg-[#38D39F]/10 flex items-center justify-center">
              <Key className="w-4 h-4 text-primary" />
            </div>
            <span className="text-sm text-text-tertiary">Active Keys</span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {loading ? "—" : usage ? usage.active_keys : "0"}
          </p>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-lg bg-[#38D39F]/10 flex items-center justify-center">
              <Zap className="w-4 h-4 text-primary" />
            </div>
            <span className="text-sm text-text-tertiary">Rate Limit</span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {plan?.tpd ? (
              <>
                {formatTokens(plan.tpd)}{" "}
                <span className="text-sm text-text-muted font-normal">tokens/day</span>
              </>
            ) : usage ? (
              <>
                {formatTokens(usage.current_tpm)}{" "}
                <span className="text-sm text-text-muted font-normal">TPM</span>
              </>
            ) : plan ? (
              <>
                {formatTokens(plan.tpm_limit)}{" "}
                <span className="text-sm text-text-muted font-normal">TPM</span>
              </>
            ) : (
              "—"
            )}
          </p>
          {(usage || plan) && (
            <p className="text-xs text-text-muted mt-1">
              4x burst &middot; 2x sustained (12h)
            </p>
          )}
        </div>
      </div>

      {/* Charts row */}
      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <UsageChart history={history} loading={loading} />
        <KeyUsageTable keys={keyUsage} loading={loading} />
      </div>

      {/* Quick Actions */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">
          Quick Actions
        </h3>
        <div className="grid sm:grid-cols-3 gap-3">
          <Link
            href="/dashboard/keys"
            className="flex items-center gap-3 p-3 rounded-lg hover:bg-surface-low transition-colors"
          >
            <Key className="w-5 h-5 text-primary" />
            <span className="text-sm text-text-secondary">
              Create API Key
            </span>
          </Link>
          <Link
            href="/dashboard/plans"
            className="flex items-center gap-3 p-3 rounded-lg hover:bg-surface-low transition-colors"
          >
            <Gauge className="w-5 h-5 text-primary" />
            <span className="text-sm text-text-secondary">View Plans</span>
          </Link>
          <a
            href="https://docs.hypercli.com/hyperclaw"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-3 rounded-lg hover:bg-surface-low transition-colors"
          >
            <Activity className="w-5 h-5 text-primary" />
            <span className="text-sm text-text-secondary">Documentation</span>
          </a>
        </div>
      </div>
    </div>
  );
}
