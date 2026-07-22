"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ClawTooltip";

interface DayData {
  date: string;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  requests: number;
}

interface UsageChartProps {
  history: DayData[];
  loading?: boolean;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

function formatDate(d: string): string {
  const date = new Date(d + "T00:00:00Z");
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function UsageChart({ history, loading }: UsageChartProps) {
  if (loading) {
    return (
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">
          Token Usage (7 days)
        </h3>
        <div className="h-48 flex items-center justify-center text-text-muted">
          Loading...
        </div>
      </div>
    );
  }

  const max = Math.max(...history.map((d) => d.total_tokens), 1);

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-foreground">
          Token Usage (7 days)
        </h3>
        <span className="text-sm text-text-muted">
          {formatTokens(history.reduce((s, d) => s + d.total_tokens, 0))} total
        </span>
      </div>

      {/* Bar chart */}
      <div className="flex items-end gap-2 h-48">
        {history.map((day) => {
          const pct = (day.total_tokens / max) * 100;
          const promptPct =
            day.total_tokens > 0
              ? (day.prompt_tokens / day.total_tokens) * pct
              : 0;
          const completionPct = pct - promptPct;

          return (
            <Tooltip key={day.date}>
              <TooltipTrigger asChild>
                <div
                  tabIndex={0}
                  aria-label={`${formatDate(day.date)} usage details`}
                  className="group relative flex flex-1 flex-col items-center gap-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex h-40 w-full flex-col justify-end">
                    {day.total_tokens > 0 ? (
                      <>
                        <div
                          className="w-full rounded-t bg-chart-2/80 transition-all duration-300"
                          style={{ height: `${Math.max(completionPct, 0.5)}%` }}
                        />
                        <div
                          className="w-full bg-primary/80 transition-all duration-300"
                          style={{
                            height: `${Math.max(promptPct, 0.5)}%`,
                            borderRadius: completionPct > 0 ? "0" : "0.25rem 0.25rem 0 0",
                          }}
                        />
                      </>
                    ) : (
                      <div className="h-[2px] w-full rounded bg-surface-low" />
                    )}
                  </div>

                  <span className="text-[10px] text-text-muted">
                    {formatDate(day.date)}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8} className="whitespace-nowrap border border-border px-3 py-2 shadow-lg">
                <div className="text-xs">
                  <p className="font-medium text-foreground">
                    {formatDate(day.date)}
                  </p>
                  <p className="text-text-muted">
                    {formatTokens(day.total_tokens)} tokens
                  </p>
                  <p className="text-text-muted">
                    {day.requests} requests
                  </p>
                  <p className="text-primary">
                    ↑ {formatTokens(day.prompt_tokens)} prompt
                  </p>
                  <p className="text-chart-2">
                    ↓ {formatTokens(day.completion_tokens)} completion
                  </p>
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 text-xs text-text-muted">
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-sm bg-primary/80" />
          Prompt
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-sm bg-chart-2/80" />
          Completion
        </div>
      </div>
    </div>
  );
}
