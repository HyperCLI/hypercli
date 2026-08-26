"use client";

import Link from "next/link";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ClawTooltip";
import {
  Badge,
  Card,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hypercli/shared-ui";

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
  reference?: string | null;
}

export type DashboardDataStatus = "loading" | "ready" | "unavailable";

export interface DashboardAgentUsageRow {
  id: string;
  name: string;
  status: string | null;
  promptTokens: number;
  completionTokens: number;
  requests: number;
  tokens: number;
  kind?: "agent" | "unattributed";
}

export const dashboardRangeOptions: Array<{ value: DashboardTimeRange; label: string; days: number; periodLabel: string }> = [
  { value: "24h", label: "Today", days: 1, periodLabel: "Today (UTC)" },
  { value: "7d", label: "7 days", days: 7, periodLabel: "Last 7 days (UTC)" },
  { value: "30d", label: "30 days", days: 30, periodLabel: "Last 30 days (UTC)" },
];

export function rangeDays(range: DashboardTimeRange) {
  return dashboardRangeOptions.find((option) => option.value === range)?.days ?? 7;
}

export function rangePeriodLabel(range: DashboardTimeRange) {
  return dashboardRangeOptions.find((option) => option.value === range)?.periodLabel ?? "Last 7 days (UTC)";
}

export function formatDashboardTokens(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value < 0) return "---";
  if (value >= 999_500_000_000) return `${(value / 1_000_000_000_000).toFixed(value >= 10_000_000_000_000 ? 0 : 1)}T`;
  if (value >= 999_500_000) return `${(value / 1_000_000_000).toFixed(value >= 10_000_000_000 ? 0 : 1)}B`;
  if (value >= 999_500) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  return value.toLocaleString();
}

function formatNumber(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value < 0) return "---";
  return value.toLocaleString();
}

function formatDateLabel(value: string, useRelativeToday = true) {
  if (useRelativeToday && dateOnly(value) === new Date().toISOString().slice(0, 10)) return "Today";
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

function tooltipAlign(index: number, total: number): "start" | "center" | "end" {
  if (index <= 1) return "start";
  if (index >= total - 2) return "end";
  return "center";
}

function statusClassName(status: string | null) {
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
          aria-pressed={value === option.value}
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
  compact = false,
  href,
  accent = false,
}: {
  title: string;
  value: string;
  periodLabel: string;
  icon: LucideIcon;
  compact?: boolean;
  href?: string;
  accent?: boolean;
}) {
  const className = compact
    ? "group relative block min-h-[108px] rounded-xl border border-border bg-surface-low/35 p-4 text-left transition-colors hover:border-border-strong hover:bg-surface-low/55"
    : "relative block min-h-[116px] rounded-lg border border-border bg-surface-low p-4 text-left";
  const content = compact ? (
    <>
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${accent ? "text-[var(--selection-accent)]" : "text-text-muted"}`} />
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">{title}</h2>
      </div>
      <p className={`mt-3 text-2xl font-semibold leading-none tracking-tight tabular-nums ${accent ? "text-[var(--selection-accent)]" : "text-foreground"}`}>
        {value}
      </p>
      <p className="mt-2 text-[11px] text-text-muted">{periodLabel}</p>
    </>
  ) : (
    <>
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-high text-text-muted">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-4 text-2xl font-bold leading-none text-foreground tabular-nums">{value}</p>
      <p className="mt-2 text-sm text-text-muted">{periodLabel}</p>
    </>
  );

  return href ? (
    <Link href={href} className={className}>{content}</Link>
  ) : (
    <section className={className}>{content}</section>
  );
}

function PanelState({
  status,
  emptyMessage,
}: {
  status: DashboardDataStatus;
  emptyMessage: string;
}) {
  const message = status === "loading"
    ? "Loading usage..."
    : status === "unavailable"
      ? "Usage unavailable"
      : emptyMessage;

  return (
    <div
      className="flex min-h-[236px] flex-col items-center justify-center text-center"
      role={status === "unavailable" ? "alert" : undefined}
      aria-live={status === "loading" ? "polite" : undefined}
    >
      <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-surface-high text-text-secondary">
        <BarChart3 className="h-4 w-4" />
      </div>
      <p className="text-sm text-text-muted">{message}</p>
    </div>
  );
}

export function TokenUsagePanel({
  history,
  periodLabel,
  status = "ready",
  title = "Token usage",
}: {
  history: DashboardDayData[];
  periodLabel: string;
  status?: DashboardDataStatus;
  title?: string;
}) {
  const chartHistory = history;
  const hasData = chartHistory.some((day) => day.totalTokens > 0);
  const maxTokens = Math.max(...chartHistory.map((day) => day.totalTokens), 1);
  const denseRange = chartHistory.length > 14;
  const tickIndexes = dateTickIndexes(chartHistory.length);
  const barGapClass = denseRange ? "gap-1.5" : "gap-4";
  const barShapeClass = denseRange
    ? "max-w-[12px] rounded-[5px]"
    : "max-w-[50px] rounded-md";
  const chartColumns = chartHistory.length > 0
    ? { gridTemplateColumns: `repeat(${chartHistory.length}, minmax(0, 1fr))` }
    : undefined;

  return (
    <Card className="gap-0 rounded-lg bg-surface-low">
      <div className="flex min-h-[70px] items-center border-b border-border px-6 text-left">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="mt-0.5 truncate text-[11px] text-text-muted">{periodLabel}</p>
        </div>
      </div>

      {status !== "ready" || !hasData ? (
        <PanelState status={status} emptyMessage="No token usage in this period" />
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
                return (
                  <Tooltip key={`${day.date}-${index}`}>
                    <div className="relative flex min-w-0 items-end justify-center">
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={`${formatTooltipDate(day.date)}: ${formatNumber(day.totalTokens)} total tokens, ${formatNumber(day.promptTokens)} prompt, ${formatNumber(day.completionTokens)} completion, ${formatNumber(day.requests)} requests`}
                          className={`flex h-[160px] w-full flex-col justify-end overflow-hidden outline-none transition-[filter] data-[state=delayed-open]:brightness-110 focus-visible:ring-2 focus-visible:ring-primary/70 ${barShapeClass}`}
                        >
                          {day.promptTokens > 0 && (
                            <span className="w-full bg-primary" style={{ height: `${promptPct}%` }} />
                          )}
                          {day.completionTokens > 0 && (
                            <span className="w-full bg-chart-2" style={{ height: `${completionPct}%` }} />
                          )}
                        </button>
                      </TooltipTrigger>
                    </div>
                    <TooltipContent
                      side="top"
                      sideOffset={8}
                      align={tooltipAlign(index, chartHistory.length)}
                      className="w-[150px] border border-border px-3 py-2 text-left shadow-2xl"
                    >
                      <div className="text-xs">
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
                    </TooltipContent>
                  </Tooltip>
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
                    {formatDateLabel(day.date, !denseRange)}
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
    </Card>
  );
}

export function IntegrationUsagePanel({
  integrations,
  periodLabel,
  status = "ready",
}: {
  integrations: DashboardIntegrationUsage[];
  periodLabel: string;
  status?: DashboardDataStatus;
}) {
  const visibleIntegrations = integrations.filter((integration) => integration.totalTokens > 0 || integration.requests > 0);
  const maxTokens = Math.max(...visibleIntegrations.map((integration) => integration.totalTokens), 1);

  return (
    <Card className="gap-0 rounded-lg bg-surface-low">
      <div className="flex h-[70px] items-center justify-between border-b border-border px-6">
        <h2 className="text-base font-semibold text-foreground">Usage by API key</h2>
        <span className="text-sm text-text-muted">{periodLabel}</span>
      </div>

      {status !== "ready" || visibleIntegrations.length === 0 ? (
        <PanelState status={status} emptyMessage="No API key usage in this period" />
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
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{integration.name}</span>
                      {integration.reference ? (
                        <span className="block truncate text-[10px] opacity-75">Key {integration.reference}</span>
                      ) : null}
                    </span>
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-right text-sm text-foreground">
                    <span className="block">{formatDashboardTokens(integration.totalTokens)} tokens</span>
                    <span className="block text-[10px] text-text-muted">{formatNumber(integration.requests)} requests</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

export function AgentUsageTable({
  rows,
  status = "ready",
  title = "Usage by agent",
}: {
  rows: DashboardAgentUsageRow[];
  status?: DashboardDataStatus;
  title?: string;
}) {
  const hasRows = rows.length > 0;

  return (
    <Card className="gap-0 rounded-lg bg-surface-low p-4 text-left">
      <h2 className="mb-5 text-base font-semibold text-foreground">{title}</h2>
      {status !== "ready" || !hasRows ? (
        <PanelState status={status} emptyMessage="No agent usage in this period" />
      ) : (
        <div
          className="overflow-x-auto rounded-lg border border-border"
          role="region"
          aria-label={`${title} table`}
          tabIndex={0}
        >
          <Table className="min-w-[720px] border-collapse text-left text-sm">
            <TableHeader>
              <TableRow className="text-foreground hover:bg-transparent">
                <TableHead className="h-auto px-3 py-3 font-semibold">Agent</TableHead>
                <TableHead className="h-auto px-3 py-3 font-semibold">Status</TableHead>
                <TableHead className="h-auto px-3 py-3 text-right font-semibold">Prompt</TableHead>
                <TableHead className="h-auto px-3 py-3 text-right font-semibold">Completion</TableHead>
                <TableHead className="h-auto px-3 py-3 text-right font-semibold">Requests</TableHead>
                <TableHead className="h-auto px-3 py-3 text-right font-semibold">Total tokens</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={`${row.kind ?? "agent"}:${row.id}`} className="text-foreground">
                  <TableCell className="px-3 py-4">{row.name}</TableCell>
                  <TableCell className="px-3 py-4">
                    {row.kind === "unattributed" ? (
                      <span className="text-text-muted">Not an agent</span>
                    ) : (
                      <Badge variant="secondary" className={`rounded-full px-2 py-0.5 text-xs ${statusClassName(row.status)}`}>
                        {row.status === "RUNNING" ? "Active" : row.status ?? "Unknown"}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-4 text-right tabular-nums">{formatDashboardTokens(row.promptTokens)}</TableCell>
                  <TableCell className="px-3 py-4 text-right tabular-nums">{formatDashboardTokens(row.completionTokens)}</TableCell>
                  <TableCell className="px-3 py-4 text-right tabular-nums">{formatNumber(row.requests)}</TableCell>
                  <TableCell className="px-3 py-4 text-right tabular-nums">{formatDashboardTokens(row.tokens)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

export const dashboardMetricIcons = {
  tokens: CircleDot,
  requests: Code2,
  integrations: Grid2X2,
  agents: Bot,
} satisfies Record<string, LucideIcon>;
