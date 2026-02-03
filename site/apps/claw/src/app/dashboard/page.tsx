"use client";

import { useState, useEffect } from "react";
import { Key, Activity, Gauge, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useClawAuth } from "@/hooks/useClawAuth";
import { clawFetch } from "@/lib/api";

interface PlanInfo {
  id: string;
  name: string;
  price: number;
  aiu: number;
  tpm_limit: number;
  rpm_limit: number;
  features: string[];
  expires_at: string | null;
}

interface UsageInfo {
  total_tokens: number;
  active_keys: number;
  current_tpm: number;
  current_rpm: number;
}

export default function DashboardPage() {
  const { getToken } = useClawAuth();
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = await getToken();
        const [planData, usageData] = await Promise.allSettled([
          clawFetch<PlanInfo>("/plans/current", token),
          clawFetch<UsageInfo>("/usage", token),
        ]);

        if (planData.status === "fulfilled") setPlan(planData.value);
        if (usageData.status === "fulfilled") setUsage(usageData.value);
      } catch {
        // Backend endpoints may be stubs — graceful fallback
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
      <div className="grid sm:grid-cols-3 gap-4 mb-8">
        <div className="glass-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-lg bg-[#38D39F]/10 flex items-center justify-center">
              <Activity className="w-4 h-4 text-primary" />
            </div>
            <span className="text-sm text-text-tertiary">Tokens Processed</span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {loading ? (
              "—"
            ) : usage ? (
              usage.total_tokens.toLocaleString()
            ) : (
              "0"
            )}
          </p>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-lg bg-[#38D39F]/10 flex items-center justify-center">
              <Key className="w-4 h-4 text-primary" />
            </div>
            <span className="text-sm text-text-tertiary">Active API Keys</span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {loading ? "—" : usage ? usage.active_keys : "0"}
          </p>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-lg bg-[#38D39F]/10 flex items-center justify-center">
              <Gauge className="w-4 h-4 text-primary" />
            </div>
            <span className="text-sm text-text-tertiary">Rate Limits</span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {plan ? (
              <>
                {(plan.tpm_limit / 1000).toFixed(0)}K{" "}
                <span className="text-sm text-text-muted font-normal">
                  TPM
                </span>
              </>
            ) : (
              "—"
            )}
          </p>
        </div>
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
            <span className="text-sm text-text-secondary">
              View Plans
            </span>
          </Link>
          <a
            href="https://docs.hyperclaw.app"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-3 rounded-lg hover:bg-surface-low transition-colors"
          >
            <Activity className="w-5 h-5 text-primary" />
            <span className="text-sm text-text-secondary">
              Documentation
            </span>
          </a>
        </div>
      </div>
    </div>
  );
}
