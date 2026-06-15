"use client";

import { useState } from "react";
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

function formatDateLabel(value: string, todayIndex: number, currentIndex: number, useRelativeToday = true) {
  if (useRelativeToday && currentIndex === todayIndex) return "Today";
  const date = parseDashboardDate(value);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function formatTooltipDate(value: string) {
  const date = parseDashboardDate(value);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function parseDashboardDate(value: string) {
  return new Date(value.includes("T") ? value : `${value}T00:00:00Z`);
}

function dateOnly(value: string) {
  return value.split("T")[0] || value;
}

function hourlySlotDate(baseDate: string, hour: number) {
  return `${dateOnly(baseDate)}T${String(hour).padStart(2, "0")}:00:00Z`;
}

function normalizeHourlyHistory(history: DashboardDayData[]): DashboardDayData[] {
  if (history.length === 24 && history.every((entry) => entry.date.includes("T"))) {
    return history;
  }

  const baseDate = history.find((entry) => entry.date)?.date ?? new Date().toISOString().slice(0, 10);
  const slots = Array.from({ length: 24 }, (_, hour): DashboardDayData => ({
    date: hourlySlotDate(baseDate, hour),
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    requests: 0,
  }));

  if (history.length === 1 && !history[0].date.includes("T")) {
    slots[23] = { ...history[0], date: slots[23].date };
    return slots;
  }

  for (const entry of history) {
    const parsed = parseDashboardDate(entry.date);
    const hour = Number.isFinite(parsed.getTime()) && entry.date.includes("T") ? parsed.getUTCHours() : 23;
    const current = slots[hour];
    slots[hour] = {
      date: current.date,
      totalTokens: current.totalTokens + entry.totalTokens,
      promptTokens: current.promptTokens + entry.promptTokens,
      completionTokens: current.completionTokens + entry.completionTokens,
      requests: current.requests + entry.requests,
    };
  }

  return slots;
}

function dateTickIndexes(entryCount: number) {
  if (entryCount <= 10) {
    return new Set(Array.from({ length: entryCount }, (_, index) => index));
  }

  const interval = entryCount > 21 ? 7 : Math.ceil(entryCount / 6);
  const indexes = new Set<number>();
  for (let index = 0; index < entryCount; index += interval) {
    indexes.add(index);
  }
  if (entryCount <= 21) indexes.add(entryCount - 1);
  return indexes;
}

function hourlyTickIndexes(entryCount: number) {
  if (entryCount <= 0) return new Set<number>();
  return new Set([
    0,
    Math.floor(entryCount * 0.25),
    Math.floor(entryCount * 0.5),
    Math.floor(entryCount * 0.75),
    entryCount - 1,
  ].filter((index) => index >= 0 && index < entryCount));
}

function formatHourlyTickLabel(index: number, total: number) {
  if (index === total - 1) return "Now";
  const hour = Math.round((index * 24) / Math.max(total, 1)) % 24;
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

function tooltipPositionClass(index: number, total: number) {
  if (index <= 1) return "left-0";
  if (index >= total - 2) return "right-0";
  return "left-1/2 -translate-x-1/2";
}

function statusClassName(status: string) {
  switch (status) {
    case "RUNNING":
      return "bg-success/15 text-success";
    case "FAILED":
      return "bg-destructive/15 text-destructive";
    case "STOPPED":
      return "bg-surface-low text-text-secondary";
    default:
      return "bg-warning/15 text-warning";
  }
}

function integrationIcon(name: string): { icon: LucideIcon | ((props: React.SVGProps<SVGSVGElement>) => React.ReactNode); bg: string; color: string } {
  const key = name.trim().toLowerCase();
  if (key.includes("slack")) return { icon: BRAND_ICONS.slack, bg: "var(--surface-high)", color: "var(--foreground)" };
  if (key.includes("telegram")) return { icon: BRAND_ICONS.telegram, bg: "var(--surface-high)", color: "var(--foreground)" };
  if (key.includes("teams") || key.includes("msteams")) return { icon: BRAND_ICONS.teams, bg: "var(--surface-high)", color: "var(--foreground)" };
  if (key.includes("cli") || key.includes("terminal")) return { icon: TerminalSquare, bg: "var(--surface-high)", color: "var(--foreground)" };
  if (key.includes("code")) return { icon: Code2, bg: "var(--surface-high)", color: "var(--foreground)" };
  return { icon: Blocks, bg: "var(--surface-high)", color: "var(--foreground)" };
}

export function DashboardTimeRangeControl({
  value,
  onChange,
}: {
  value: DashboardTimeRange;
  onChange: (value: DashboardTimeRange) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-border bg-background" aria-label="Dashboard time range">
      {dashboardRangeOptions.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`h-8 px-3 text-xs font-medium transition-colors ${
            value === option.value
              ? "bg-surface-high text-foreground"
              : "text-text-secondary hover:bg-surface-low hover:text-foreground"
          } ${option.value !== "24h" ? "border-l border-border" : ""}`}
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
    <section className="relative min-h-[116px] rounded-lg border border-border bg-surface-low p-4">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-high text-text-muted">
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
      <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-surface-high text-text-secondary">
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
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const hourlyRange = periodLabel === "Last 24h";
  const chartHistory = hourlyRange ? normalizeHourlyHistory(history) : history;
  const hasData = chartHistory.some((day) => day.totalTokens > 0);
  const maxTokens = Math.max(...chartHistory.map((day) => day.totalTokens), 1);
  const todayIndex = chartHistory.length - 1;
  const denseRange = !hourlyRange && chartHistory.length > 14;
  const tickIndexes = hourlyRange ? hourlyTickIndexes(chartHistory.length) : dateTickIndexes(chartHistory.length);
  const barGapClass = hourlyRange ? "gap-2.5" : denseRange ? "gap-1.5" : "gap-4";
  const barShapeClass = hourlyRange
    ? "max-w-[14px] rounded-[7px]"
    : denseRange
    ? "max-w-[12px] rounded-[5px]"
    : "max-w-[50px] rounded-md";
  const chartColumns = chartHistory.length > 0
    ? { gridTemplateColumns: `repeat(${chartHistory.length}, minmax(0, 1fr))` }
    : undefined;

  return (
    <section className="rounded-lg border border-border bg-surface-low">
      <div className="flex h-[70px] items-center justify-between border-b border-border px-6">
        <h2 className="text-base font-semibold text-foreground">Token usage</h2>
        <span className="text-sm text-text-muted">{periodLabel}</span>
      </div>

      {!hasData ? (
        <EmptyPanelState />
      ) : (
        <div className="px-6 pb-6 pt-5">
          <div className="relative h-[190px]">
            <div aria-hidden className="absolute inset-x-0 top-0 h-[160px]">
              <div className="absolute inset-x-0 top-0 border-t border-border/80" />
              <div className="absolute inset-x-0 top-1/3 border-t border-border/60" />
              <div className="absolute inset-x-0 top-2/3 border-t border-border/40" />
            </div>
            <div className={`relative grid h-[160px] items-end ${barGapClass}`} style={chartColumns}>
              {chartHistory.map((day, index) => {
                const totalPct = Math.max((day.totalTokens / maxTokens) * 100, day.totalTokens > 0 ? 8 : 0);
                const promptShare = day.totalTokens > 0 ? day.promptTokens / day.totalTokens : 0;
                const promptPct = Math.max(totalPct * promptShare, day.promptTokens > 0 ? 2 : 0);
                const completionPct = Math.max(totalPct - promptPct, day.completionTokens > 0 ? 2 : 0);
                const tooltipId = `token-usage-tooltip-${index}`;

                return (
                  <div key={`${day.date}-${index}`} className="relative flex min-w-0 items-end justify-center">
                    <button
                      type="button"
                      aria-label={`${formatTooltipDate(day.date)} token usage`}
                      aria-describedby={activeIndex === index ? tooltipId : undefined}
                      onFocus={() => setActiveIndex(index)}
                      onBlur={() => setActiveIndex((current) => (current === index ? null : current))}
                      onMouseEnter={() => setActiveIndex(index)}
                      onMouseLeave={() => setActiveIndex((current) => (current === index ? null : current))}
                      className={`flex h-[160px] w-full flex-col justify-end overflow-hidden outline-none transition-[filter] focus-visible:ring-2 focus-visible:ring-primary/70 ${barShapeClass} ${activeIndex === index ? "brightness-110" : ""}`}
                    >
                      {day.promptTokens > 0 && (
                        <span className="w-full bg-primary" style={{ height: `${promptPct}%` }} />
                      )}
                      {day.completionTokens > 0 && (
                        <span className="w-full bg-chart-2" style={{ height: `${completionPct}%` }} />
                      )}
                    </button>
                    {activeIndex === index && (
                      <div
                        id={tooltipId}
                        role="tooltip"
                        className={`pointer-events-none absolute bottom-full z-30 mb-2 w-[150px] rounded-lg border border-border bg-popover px-3 py-2 text-left text-xs text-foreground shadow-2xl ${tooltipPositionClass(index, chartHistory.length)}`}
                      >
                        <p className="font-medium text-foreground">{formatTooltipDate(day.date)}</p>
                        <div className="mt-2 space-y-1">
                          <div className="flex items-center justify-between gap-3">
                            <span className="flex items-center gap-1.5 text-text-muted">
                              <span className="h-2 w-2 rounded-full bg-primary" />
                              Prompt
                            </span>
                            <span className="tabular-nums text-foreground">{formatDashboardTokens(day.promptTokens)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="flex items-center gap-1.5 text-text-muted">
                              <span className="h-2 w-2 rounded-full bg-chart-2" />
                              Completion
                            </span>
                            <span className="tabular-nums text-foreground">{formatDashboardTokens(day.completionTokens)}</span>
                          </div>
                        </div>
                        <div className="mt-2 border-t border-border pt-2">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-foreground">Tokens</span>
                            <span className="tabular-nums text-foreground">{formatDashboardTokens(day.totalTokens)}</span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-3">
                            <span className="text-foreground">Requests</span>
                            <span className="tabular-nums text-foreground">{day.requests.toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-2 grid" style={chartColumns}>
              {chartHistory.map((day, index) => (
                tickIndexes.has(index) ? (
                  <span
                    key={`${day.date}-${index}`}
                    className={`whitespace-nowrap text-xs text-text-muted ${
                      index === 0
                        ? "justify-self-start"
                        : index >= chartHistory.length - 2
                        ? "justify-self-end"
                        : "justify-self-center"
                    }`}
                  >
                    {hourlyRange ? formatHourlyTickLabel(index, chartHistory.length) : formatDateLabel(day.date, todayIndex, index, !denseRange)}
                  </span>
                ) : (
                  <span key={`${day.date}-${index}`} aria-hidden />
                )
              ))}
            </div>
          </div>
          <div className="mt-4 flex items-center gap-5 text-xs text-text-secondary">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-primary" />
              Prompt
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-chart-2" />
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
    <section className="rounded-lg border border-border bg-surface-low">
      <div className="flex h-[70px] items-center justify-between border-b border-border px-6">
        <h2 className="text-base font-semibold text-foreground">Usage by Integration</h2>
        <span className="text-sm text-text-muted">{periodLabel}</span>
      </div>

      {visibleIntegrations.length === 0 ? (
        <EmptyPanelState />
      ) : (
        <div className="relative min-h-[286px] px-6 py-6">
          <div aria-hidden className="absolute bottom-6 left-[38%] top-6 border-l border-border" />
          <div aria-hidden className="absolute bottom-6 left-[60%] top-6 border-l border-border" />
          <div aria-hidden className="absolute bottom-6 left-[82%] top-6 border-l border-border" />
          <div className="relative space-y-3">
            {visibleIntegrations.map((integration) => {
              const pct = Math.max((integration.totalTokens / maxTokens) * 72, 24);
              const iconSpec = integrationIcon(integration.name);
              const Icon = iconSpec.icon;

              return (
                <div key={integration.id} className="flex items-center gap-2">
                  <div
                    className="flex h-[50px] min-w-[116px] items-center gap-3 rounded-lg bg-selection-accent px-3 text-selection-accent-foreground"
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
    <section className="rounded-lg border border-border bg-surface-low p-4">
      <h2 className="mb-5 text-base font-semibold text-foreground">Agent usage table</h2>
      {!hasRows ? (
        <EmptyPanelState />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border text-foreground">
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
