"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Key,
  Activity,
  Gauge,
  ArrowRight,
  Zap,
  Hash,
  Bot,
  Play,
  Square,
  ExternalLink,
  MessageSquare,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { agentApiFetch } from "@/lib/api";
import { createAgentClient, startOpenClawAgent } from "@/lib/agent-client";
import { removeAgentState } from "@/lib/agent-store";
import { refreshGatewayToken } from "@/lib/gateway-auth";
import UsageChart from "@/components/dashboard/UsageChart";
import KeyUsageTable from "@/components/dashboard/KeyUsageTable";
import { OnboardingGuide } from "@/components/dashboard/OnboardingGuide";
import { agentAvatar, type AgentMeta } from "@/lib/avatar";

// ── Types ──

interface PlanLimits {
  tpd: number;
  tpm: number;
  burst_tpm: number;
  rpm: number;
}

interface PlanInfo {
  id: string;
  name: string;
  price: number;
  aiu: number;
  features: string[];
  expires_at: string | null;
  provider?: string | null;
  seconds_remaining?: number | null;
  limits: PlanLimits;
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

type AgentState = "PENDING" | "STARTING" | "RUNNING" | "STOPPING" | "STOPPED" | "FAILED";

interface Agent {
  id: string;
  name: string;
  state: AgentState;
  cpu: number;
  memory: number;
  hostname: string | null;
  started_at: string | null;
  last_error: string | null;
  meta?: AgentMeta | null;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function stateDotClass(state: AgentState): string {
  switch (state) {
    case "RUNNING": return "bg-[#38D39F]";
    case "FAILED": return "bg-[#d05f5f]";
    case "STOPPED": return "bg-text-muted";
    default: return "bg-[#f0c56c]";
  }
}

function x402CountdownTone(secondsRemaining: number): string {
  const days = secondsRemaining / 86400;
  if (days > 5) return "border-[#38D39F]/45 text-[#38D39F] bg-[#38D39F]/8";
  if (days > 2) return "border-[#f0c56c]/45 text-[#f0c56c] bg-[#f0c56c]/10";
  return "border-[#d05f5f]/45 text-[#d05f5f] bg-[#d05f5f]/10";
}

function x402CountdownLabel(secondsRemaining: number): string {
  return String(Math.max(0, Math.ceil(secondsRemaining / 86400)));
}

// ── Main component ──

export default function DashboardPage() {
  const { getToken, user } = useAgentAuth();
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [history, setHistory] = useState<DayData[]>([]);
  const [keyUsage, setKeyUsage] = useState<KeyUsageEntry[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [openingGatewayId, setOpeningGatewayId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const token = await getToken();
      const [planData, usageData, historyData, keyData, agentData] =
        await Promise.allSettled([
          agentApiFetch<PlanInfo>("/plans/current", token),
          agentApiFetch<UsageInfo>("/usage", token),
          agentApiFetch<HistoryResponse>("/usage/history?days=7", token),
          agentApiFetch<KeyUsageResponse>("/usage/keys?days=7", token),
          agentApiFetch<{ items?: Agent[] } | Agent[]>("/deployments", token),
        ]);

      if (planData.status === "fulfilled") setPlan(planData.value);
      if (usageData.status === "fulfilled") setUsage(usageData.value);
      if (historyData.status === "fulfilled") setHistory(historyData.value.history);
      if (keyData.status === "fulfilled") setKeyUsage(keyData.value.keys);
      if (agentData.status === "fulfilled") {
        const items = Array.isArray(agentData.value) ? agentData.value : agentData.value.items || [];
        setAgents(items);
      }
    } catch {
      // Graceful fallback
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleStartAgent = async (agentId: string) => {
    setStartingId(agentId);
    removeAgentState(agentId);
    try {
      const token = await getToken();
      await startOpenClawAgent(token, agentId);
      await fetchData();
    } catch { /* handled silently */ } finally {
      setStartingId(null);
    }
  };

  const handleStopAgent = async (agentId: string) => {
    setStoppingId(agentId);
    try {
      const token = await getToken();
      await createAgentClient(token).stop(agentId);
      removeAgentState(agentId);
      await fetchData();
    } catch { /* handled silently */ } finally {
      setStoppingId(null);
    }
  };

  const handleOpenGateway = useCallback(async (agentId: string, hostname: string) => {
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    setOpeningGatewayId(agentId);
    try {
      const token = await getToken();
      const gatewayToken = await refreshGatewayToken(agentId, token);
      if (!gatewayToken) {
        throw new Error("Missing OPENCLAW_GATEWAY_TOKEN");
      }
      const gatewayUrl = `https://${hostname}/#token=${encodeURIComponent(gatewayToken)}`;
      if (popup) {
        popup.location.href = gatewayUrl;
      } else {
        const fallback = window.open(gatewayUrl, "_blank");
        if (fallback) fallback.opener = null;
      }
    } catch {
      if (popup) popup.close();
    } finally {
      setOpeningGatewayId(null);
    }
  }, [getToken]);

  const showOnboarding = !loading && usage && usage.total_tokens === 0 && usage.active_keys === 0 && agents.length === 0;

  return (
    <div>
      {/* Welcome header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Welcome back{user?.email ? `, ${user.email.split("@")[0]}` : ""}
          </h1>
          {plan && (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs bg-surface-high text-text-secondary px-2 py-0.5 rounded-full font-medium">
                {plan.name}
              </span>
              {plan.provider === "X402" && typeof plan.seconds_remaining === "number" && plan.seconds_remaining > 0 && (
                <div className="flex items-center gap-2">
                  <div
                    className={`w-9 h-9 rounded-full border flex items-center justify-center font-semibold text-xs ${x402CountdownTone(plan.seconds_remaining)}`}
                    title={`${x402CountdownLabel(plan.seconds_remaining)} days left`}
                  >
                    {x402CountdownLabel(plan.seconds_remaining)}
                  </div>
                  <span className="text-xs text-text-muted">
                    days left
                  </span>
                </div>
              )}
              {plan.expires_at && (
                <span className="text-xs text-text-muted">
                  {plan.provider === "X402" ? "Expires" : "Renews"}{" "}
                  {new Date(plan.expires_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
              )}
            </div>
          )}
        </div>
        <Link
          href="/agents"
          className="btn-primary px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
        >
          <Bot className="w-4 h-4" />
          New Agent
        </Link>
      </div>

      {/* Onboarding guide for new users */}
      {showOnboarding && <OnboardingGuide />}

      {/* Agent cards grid — the hero section */}
      {agents.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-foreground">Your Agents</h2>
            <Link href="/agents" className="text-sm font-medium text-text-secondary hover:text-foreground flex items-center gap-1.5 transition-colors">
              Manage Agents <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((agent, i) => {
              const avatar = agentAvatar(agent.name || agent.id, agent.meta);
              const AvatarIcon = avatar.icon;
              const isRunning = agent.state === "RUNNING";
              const isStopped = agent.state === "STOPPED" || agent.state === "FAILED";
              const isTransitioning = ["PENDING", "STARTING", "STOPPING"].includes(agent.state);

              return (
                <motion.div
                  key={agent.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="glass-card p-4"
                >
                  <div className="flex items-start gap-3 mb-3">
                    {/* Avatar */}
                    <div className="relative flex-shrink-0">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center overflow-hidden"
                        style={{ backgroundColor: avatar.bgColor }}
                      >
                        {avatar.imageUrl ? (
                          <img src={avatar.imageUrl} alt={`${agent.name} avatar`} className="w-full h-full object-cover" />
                        ) : (
                          <AvatarIcon className="w-5 h-5" style={{ color: avatar.fgColor }} />
                        )}
                      </div>
                      <motion.div
                        className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${stateDotClass(agent.state)}`}
                        animate={isTransitioning ? { opacity: [0.5, 1, 0.5] } : {}}
                        transition={isTransitioning ? { duration: 1.5, repeat: Infinity } : {}}
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <Link href="/agents" className="text-sm font-semibold text-foreground truncate hover:text-accent transition-colors block">{agent.name}</Link>
                      <p className="text-xs text-text-muted">
                        {agent.cpu} vCPU · {agent.memory} GiB
                      </p>
                    </div>

                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${
                      isRunning ? "bg-[#38D39F]/10 text-[#38D39F]" :
                      agent.state === "FAILED" ? "bg-[#d05f5f]/10 text-[#d05f5f]" :
                      isStopped ? "bg-surface-low text-text-muted" :
                      "bg-[#f0c56c]/15 text-[#f0c56c]"
                    }`}>
                      {agent.state}
                    </span>
                  </div>

                  {/* Uptime / error */}
                  {isRunning && agent.started_at && (
                    <p className="text-xs text-text-muted mb-3">Up {relativeTime(agent.started_at)}</p>
                  )}
                  {agent.state === "FAILED" && agent.last_error && (
                    <p className="text-xs text-[#d05f5f] mb-3 truncate">{agent.last_error}</p>
                  )}

                  {/* Quick actions */}
                  <div className="flex items-center gap-2">
                    {isStopped && (
                      <button
                        onClick={() => handleStartAgent(agent.id)}
                        disabled={startingId === agent.id}
                        className="px-2.5 py-1 rounded text-xs border border-border-medium text-foreground hover:bg-surface-low disabled:opacity-60 flex items-center gap-1"
                      >
                        {startingId === agent.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                        Start
                      </button>
                    )}
                    {(isRunning || isTransitioning) && agent.state !== "STOPPING" && (
                      <button
                        onClick={() => handleStopAgent(agent.id)}
                        disabled={stoppingId === agent.id}
                        className="px-2.5 py-1 rounded text-xs border border-[#f0c56c]/30 text-[#f0c56c] hover:bg-[#f0c56c]/10 disabled:opacity-60 flex items-center gap-1"
                      >
                        {stoppingId === agent.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />}
                        Stop
                      </button>
                    )}
                    {isRunning && (
                      <Link
                        href="/agents"
                        className="px-2.5 py-1 rounded text-xs border border-border text-text-secondary hover:bg-surface-low flex items-center gap-1"
                      >
                        <MessageSquare className="w-3 h-3" />
                        Chat
                      </Link>
                    )}
                    {isRunning && agent.hostname && (
                      <button
                        onClick={() => void handleOpenGateway(agent.id, agent.hostname!)}
                        disabled={openingGatewayId === agent.id}
                        className="px-2.5 py-1 rounded text-xs border border-border text-text-secondary hover:bg-surface-low disabled:opacity-60 flex items-center gap-1"
                      >
                        {openingGatewayId === agent.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
                        Desktop
                      </button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {/* Stats bar — compact horizontal row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-text-tertiary" />
            <span className="text-xs text-text-tertiary">Tokens (30d)</span>
          </div>
          <p className="text-xl font-bold text-foreground tabular-nums">
            {loading ? "—" : usage ? formatTokens(usage.total_tokens) : "0"}
          </p>
        </div>

        <div className="glass-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Hash className="w-4 h-4 text-text-tertiary" />
            <span className="text-xs text-text-tertiary">Requests</span>
          </div>
          <p className="text-xl font-bold text-foreground tabular-nums">
            {loading ? "—" : usage ? usage.request_count.toLocaleString() : "0"}
          </p>
        </div>

        <div className="glass-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Key className="w-4 h-4 text-text-tertiary" />
            <span className="text-xs text-text-tertiary">Active Keys</span>
          </div>
          <p className="text-xl font-bold text-foreground tabular-nums">
            {loading ? "—" : usage ? usage.active_keys : "0"}
          </p>
        </div>

        <div className="glass-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-text-tertiary" />
            <span className="text-xs text-text-tertiary">Rate Limit</span>
          </div>
          <p className="text-xl font-bold text-foreground tabular-nums">
            {plan ? formatTokens(plan.limits.tpd) : "—"}
          </p>
          {plan && <p className="text-[10px] text-text-muted mt-0.5">tokens/day</p>}
        </div>
      </div>

      {/* Charts row */}
      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <UsageChart history={history} loading={loading} />
        <KeyUsageTable keys={keyUsage} loading={loading} />
      </div>

      {/* Quick Actions */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">Quick Actions</h3>
        <div className="grid sm:grid-cols-4 gap-3">
          <Link
            href="/agents"
            className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-surface-low transition-colors"
          >
            <Bot className="w-5 h-5 text-text-secondary" />
            <span className="text-sm text-text-secondary">Manage Agents</span>
          </Link>
          <Link
            href="/keys"
            className="flex items-center gap-3 p-3 rounded-lg hover:bg-surface-low transition-colors"
          >
            <Key className="w-5 h-5 text-text-secondary" />
            <span className="text-sm text-text-secondary">Create API Key</span>
          </Link>
          <Link
            href="/plans"
            className="flex items-center gap-3 p-3 rounded-lg hover:bg-surface-low transition-colors"
          >
            <Gauge className="w-5 h-5 text-text-secondary" />
            <span className="text-sm text-text-secondary">View Plans</span>
          </Link>
          <a
            href="https://docs.hypercli.com/hyperclaw"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-3 rounded-lg hover:bg-surface-low transition-colors"
          >
            <Activity className="w-5 h-5 text-text-secondary" />
            <span className="text-sm text-text-secondary">Documentation</span>
          </a>
        </div>
      </div>
    </div>
  );
}
