"use client";

import {
  BarChart3,
  Blocks,
  Bot,
  CircleDot,
  Code2,
  Grid2X2,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";
import { BRAND_ICONS } from "@/components/dashboard/BrandIcons";

export type DashboardTimeRange = "24h" | "7d" | "30d";

export interface DashboardDayData {
  date: string;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  requests: number;
}

export interface DashboardIntegrationUsage {
  id: string;
  name: string;
  totalTokens: number;
  requests: number;
}

export interface DashboardAgentUsageRow {
  id: string;
  name: string;
  status: string;
  integrations: number | null;
  requests: number | null;
  tokens: number | null;
  lastActivity: string | null;
}

export const dashboardRangeOptions: Array<{ value: DashboardTimeRange; label: string; days: number; periodLabel: string }> = [
  { value: "24h", label: "Last 24h", days: 1, periodLabel: "Last 24h" },
  { value: "7d", label: "Last 7 days", days: 7, periodLabel: "Last 7 days" },
  { value: "30d", label: "Last 30 days", days: 30, periodLabel: "Last 30 days" },
];

export function rangeDays(range: DashboardTimeRange) {
  return dashboardRangeOptions.find((option) => option.value === range)?.days ?? 7;
}

export function rangePeriodLabel(range: DashboardTimeRange) {
  return dashboardRangeOptions.find((option) => option.value === range)?.periodLabel ?? "Last 7 days";
}

export function formatDashboardTokens(value: number | null | undefined) {
  if (value == null) return "---";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  return value.toLocaleString();
}

export function hasCollectedData(history: DashboardDayData[], integrations: DashboardIntegrationUsage[]) {
  return (
    history.some((day) => day.totalTokens > 0 || day.requests > 0) ||
    integrations.some((integration) => integration.totalTokens > 0 || integration.requests > 0)
  );
}

function formatNumber(value: number | null | undefined) {
  if (value == null) return "---";
  return value.toLocaleString();
}

function formatDateLabel(value: string, todayIndex: number, currentIndex: number) {
  if (currentIndex === todayIndex) return "Today";
  const date = new Date(`${value}T00:00:00Z`);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function statusClassName(status: string) {
  switch (status) {
    case "RUNNING":
      return "bg-[#0f511d] text-[#32d43a]";
    case "FAILED":
      return "bg-[#4c1717] text-[#ff8b8b]";
    case "STOPPED":
      return "bg-white/8 text-text-secondary";
    default:
      return "bg-[#4f3911] text-[#f0c56c]";
  }
}

function integrationIcon(name: string): { icon: LucideIcon | ((props: React.SVGProps<SVGSVGElement>) => React.ReactNode); bg: string; color: string } {
  const key = name.trim().toLowerCase();
  if (key.includes("slack")) return { icon: BRAND_ICONS.slack, bg: "#ffffff", color: "#4A154B" };
  if (key.includes("telegram")) return { icon: BRAND_ICONS.telegram, bg: "#229ED9", color: "#ffffff" };
  if (key.includes("teams") || key.includes("msteams")) return { icon: BRAND_ICONS.teams, bg: "#5059C9", color: "#ffffff" };
  if (key.includes("cli") || key.includes("terminal")) return { icon: TerminalSquare, bg: "#050505", color: "#ffffff" };
  if (key.includes("code")) return { icon: Code2, bg: "#101113", color: "#ffffff" };
  return { icon: Blocks, bg: "#1b1b1d", color: "#ffffff" };
}

export function DashboardTimeRangeControl({
  value,
  onChange,
}: {
  value: DashboardTimeRange;
  onChange: (value: DashboardTimeRange) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-white/14 bg-[#0d0d0e]" aria-label="Dashboard time range">
      {dashboardRangeOptions.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`h-8 px-3 text-xs font-medium transition-colors ${
            value === option.value
              ? "bg-[#242426] text-foreground"
              : "text-text-secondary hover:bg-surface-low hover:text-foreground"
          } ${option.value !== "24h" ? "border-l border-white/10" : ""}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function DashboardMetricCard({
  title,
  value,
  periodLabel,
  icon: Icon,
}: {
  title: string;
  value: string;
  periodLabel: string;
  icon: LucideIcon;
}) {
  return (
    <section className="relative min-h-[116px] rounded-lg border border-white/12 bg-[#19191a] p-4">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#2b2b2e] text-text-muted">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-4 text-2xl font-bold leading-none text-foreground tabular-nums">{value}</p>
      <p className="mt-2 text-sm text-text-muted">{periodLabel}</p>
    </section>
  );
}

function EmptyPanelState() {
  return (
    <div className="flex min-h-[236px] flex-col items-center justify-center text-center">
      <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-[#2b2b2e] text-text-secondary">
        <BarChart3 className="h-4 w-4" />
      </div>
      <p className="text-sm text-text-muted">No data has been collected</p>
    </div>
  );
}

export function TokenUsagePanel({
  history,
  periodLabel,
}: {
  history: DashboardDayData[];
  periodLabel: string;
}) {
  const hasData = history.some((day) => day.totalTokens > 0);
  const maxTokens = Math.max(...history.map((day) => day.totalTokens), 1);
  const todayIndex = history.length - 1;

  return (
    <section className="rounded-lg border border-white/12 bg-[#19191a]">
      <div className="flex h-[70px] items-center justify-between border-b border-white/10 px-6">
        <h2 className="text-base font-semibold text-foreground">Token usage</h2>
        <span className="text-sm text-text-muted">{periodLabel}</span>
      </div>

      {!hasData ? (
        <EmptyPanelState />
      ) : (
        <div className="px-6 pb-6 pt-5">
          <div className="relative h-[190px]">
            <div aria-hidden className="absolute inset-x-0 top-8 border-t border-white/8" />
            <div aria-hidden className="absolute inset-x-0 top-20 border-t border-white/8" />
            <div aria-hidden className="absolute inset-x-0 top-32 border-t border-white/8" />
            <div className="relative flex h-full items-end gap-4">
              {history.map((day, index) => {
                const totalPct = Math.max((day.totalTokens / maxTokens) * 100, day.totalTokens > 0 ? 8 : 0);
                const promptShare = day.totalTokens > 0 ? day.promptTokens / day.totalTokens : 0;
                const promptPct = Math.max(totalPct * promptShare, day.promptTokens > 0 ? 2 : 0);
                const completionPct = Math.max(totalPct - promptPct, day.completionTokens > 0 ? 2 : 0);

                return (
                  <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                    <div className="flex h-[160px] w-full max-w-[50px] flex-col justify-end overflow-hidden rounded-md">
                      {day.promptTokens > 0 && (
                        <div className="w-full bg-[#2f80ed]" style={{ height: `${promptPct}%` }} />
                      )}
                      {day.completionTokens > 0 && (
                        <div className="w-full bg-[#8bc3f7]" style={{ height: `${completionPct}%` }} />
                      )}
                    </div>
                    <span className="text-xs text-text-muted">{formatDateLabel(day.date, todayIndex, index)}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-4 flex items-center gap-5 text-xs text-text-secondary">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#2f80ed]" />
              Prompt
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#8bc3f7]" />
              Completion
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

export function IntegrationUsagePanel({
  integrations,
  periodLabel,
}: {
  integrations: DashboardIntegrationUsage[];
  periodLabel: string;
}) {
  const visibleIntegrations = integrations.filter((integration) => integration.totalTokens > 0 || integration.requests > 0);
  const maxTokens = Math.max(...visibleIntegrations.map((integration) => integration.totalTokens), 1);

  return (
    <section className="rounded-lg border border-white/12 bg-[#19191a]">
      <div className="flex h-[70px] items-center justify-between border-b border-white/10 px-6">
        <h2 className="text-base font-semibold text-foreground">Usage by Integration</h2>
        <span className="text-sm text-text-muted">{periodLabel}</span>
      </div>

      {visibleIntegrations.length === 0 ? (
        <EmptyPanelState />
      ) : (
        <div className="relative min-h-[286px] px-6 py-6">
          <div aria-hidden className="absolute bottom-6 left-[38%] top-6 border-l border-white/8" />
          <div aria-hidden className="absolute bottom-6 left-[60%] top-6 border-l border-white/8" />
          <div aria-hidden className="absolute bottom-6 left-[82%] top-6 border-l border-white/8" />
          <div className="relative space-y-3">
            {visibleIntegrations.map((integration) => {
              const pct = Math.max((integration.totalTokens / maxTokens) * 72, 24);
              const iconSpec = integrationIcon(integration.name);
              const Icon = iconSpec.icon;

              return (
                <div key={integration.id} className="flex items-center gap-2">
                  <div
                    className="flex h-[50px] min-w-[116px] items-center gap-3 rounded-lg bg-[#2ad019] px-3 text-[#071207]"
                    style={{ width: `${pct}%` }}
                  >
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: iconSpec.bg }}>
                      <Icon className="h-4 w-4" style={{ color: iconSpec.color }} />
                    </span>
                    <span className="truncate text-sm font-medium">{integration.name}</span>
                  </div>
                  <span className="whitespace-nowrap text-sm text-foreground">{formatDashboardTokens(integration.totalTokens)} tokens</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

export function AgentUsageTable({
  rows,
}: {
  rows: DashboardAgentUsageRow[];
}) {
  const hasRows = rows.length > 0;

  return (
    <section className="rounded-lg border border-white/12 bg-[#19191a] p-4">
      <h2 className="mb-5 text-base font-semibold text-foreground">Agent usage table</h2>
      {!hasRows ? (
        <EmptyPanelState />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-foreground">
                <th className="px-3 py-3 font-semibold">Agent</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-3 py-3 font-semibold">Integrations</th>
                <th className="px-3 py-3 font-semibold">Requests</th>
                <th className="px-3 py-3 font-semibold">Tokens</th>
                <th className="px-3 py-3 font-semibold">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="text-foreground">
                  <td className="px-3 py-4">{row.name}</td>
                  <td className="px-3 py-4">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusClassName(row.status)}`}>
                      {row.status === "RUNNING" ? "Active" : row.status}
                    </span>
                  </td>
                  <td className="px-3 py-4 tabular-nums">{formatNumber(row.integrations)}</td>
                  <td className="px-3 py-4 tabular-nums">{formatNumber(row.requests)}</td>
                  <td className="px-3 py-4 tabular-nums">{formatDashboardTokens(row.tokens)}</td>
                  <td className="px-3 py-4">{row.lastActivity ?? "---"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export const dashboardMetricIcons = {
  tokens: CircleDot,
  requests: Code2,
  integrations: Grid2X2,
  agents: Bot,
} satisfies Record<string, LucideIcon>;
