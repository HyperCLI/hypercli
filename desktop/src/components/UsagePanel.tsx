import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, Loader2, RefreshCw } from "lucide-react";
import {
  usageSummary,
  type UsageDay,
  type UsageSummary,
} from "../api";
import {
  USAGE_RANGE_OPTIONS,
  activeKeyCount,
  agentUsageRows,
  formatTokens,
  sumUsageHistory,
  usageDateLabel,
  usageKeyRows,
  usageRangeDays,
  usagePeriodLabel,
  type UsageAgentRow,
  type UsageRange,
} from "../usage";

type SectionStatus = "loading" | "ready" | "unavailable";

export function UsagePanel() {
  const [range, setRange] = useState<UsageRange>("7d");
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const generationRef = useRef(0);

  const fetchData = useCallback((selected: UsageRange) => {
    const generation = ++generationRef.current;
    setLoading(true);
    setFailed(false);
    usageSummary(usageRangeDays(selected))
      .then((value) => {
        if (generation !== generationRef.current) return;
        setSummary(value);
        setLoading(false);
      })
      .catch(() => {
        if (generation !== generationRef.current) return;
        setSummary(null);
        setFailed(true);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchData(range);
    return () => {
      generationRef.current += 1;
    };
  }, [fetchData, range]);

  if (failed) {
    return (
      <div className="pt-8 text-center">
        <div className="text-[13px] font-medium mb-1">Usage unavailable</div>
        <p className="text-[12px] text-text-secondary leading-relaxed">
          We couldn't load usage right now. Try again later.
        </p>
        <button
          onClick={() => fetchData(range)}
          className="ui-secondary-button mt-3"
        >
          Retry
        </button>
      </div>
    );
  }

  const periodLabel = usagePeriodLabel(range);
  const sectionStatus = (section: unknown[] | object | null): SectionStatus =>
    loading ? "loading" : section === null ? "unavailable" : "ready";
  const history = summary?.history ?? null;
  const keys = summary?.keys ?? null;
  const agents = summary?.agents ?? null;
  const totals = sumUsageHistory(history ?? []);
  const keyRows = usageKeyRows(keys ?? []);
  const agentRows = agentUsageRows(agents, summary?.unattributed ?? null);
  const someUnavailable =
    !loading &&
    (history === null || keys === null || agents === null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">Account usage</div>
          <div className="mt-0.5 text-[11px] text-text-secondary">
            Token activity across this account, grouped by UTC day.
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="segmented-tabs">
            {USAGE_RANGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => setRange(option.value)}
                className={`segmented-tab ${
                  range === option.value ? "segmented-tab-active" : ""
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => fetchData(range)}
            className="ui-icon-button-sm"
            title="Refresh usage"
            aria-label="Refresh usage"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {someUnavailable && (
        <div className="rounded-lg border border-warning/50 bg-warning-bg px-3 py-2 text-[11px] text-warning">
          Some usage data could not be loaded. Available sections are shown.
        </div>
      )}

      <div className="grid grid-cols-3 gap-2.5">
        <MetricCard
          title="Tokens"
          status={sectionStatus(history)}
          value={formatTokens(totals.total_tokens)}
          periodLabel={periodLabel}
        />
        <MetricCard
          title="Requests"
          status={sectionStatus(history)}
          value={totals.requests.toLocaleString()}
          periodLabel={periodLabel}
        />
        <MetricCard
          title="API keys used"
          status={sectionStatus(keys)}
          value={activeKeyCount(keys ?? []).toLocaleString()}
          periodLabel={periodLabel}
        />
      </div>

      <TokenUsageSection
        history={history}
        status={sectionStatus(history)}
        periodLabel={periodLabel}
      />

      <div className="grid grid-cols-1 gap-4">
        <KeyUsageSection
          keys={keyRows}
          status={sectionStatus(keys)}
          periodLabel={periodLabel}
        />
        <AgentUsageSection
          rows={agentRows}
          status={sectionStatus(agents)}
        />
      </div>
    </div>
  );
}

function MetricCard({
  title,
  status,
  value,
  periodLabel,
}: {
  title: string;
  status: SectionStatus;
  value: string;
  periodLabel: string;
}) {
  return (
    <section className="soft-card px-3 py-2.5">
      <h2 className="side-caption">{title}</h2>
      {status === "loading" ? (
        <div className="mt-3 flex items-center gap-2 text-[11px] text-text-secondary">
          <Loader2 size={11} className="animate-spin" />
          Loading
        </div>
      ) : status === "unavailable" ? (
        <div className="mt-3 text-[11px] text-text-secondary">Unavailable</div>
      ) : (
        <div className="mt-2 text-[17px] font-semibold leading-none tabular-nums">
          {value}
        </div>
      )}
      <div className="mt-2 text-[10px] text-text-secondary">{periodLabel}</div>
    </section>
  );
}

function SectionCard({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="soft-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5">
        <h2 className="text-[12px] font-semibold">{title}</h2>
        {caption && (
          <span className="text-[10px] text-text-secondary">{caption}</span>
        )}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

function SectionState({
  status,
  emptyMessage,
}: {
  status: SectionStatus;
  emptyMessage: string;
}) {
  const message =
    status === "loading"
      ? "Loading usage…"
      : status === "unavailable"
        ? "Usage unavailable"
        : emptyMessage;
  return (
    <div
      className="flex min-h-[140px] flex-col items-center justify-center text-center"
      role={status === "unavailable" ? "alert" : undefined}
    >
      <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-md bg-active-row text-text-secondary">
        {status === "loading" ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <BarChart3 size={12} />
        )}
      </div>
      <p className="text-[11px] text-text-secondary">{message}</p>
    </div>
  );
}

function TokenUsageSection({
  history,
  status,
  periodLabel,
}: {
  history: UsageDay[] | null;
  status: SectionStatus;
  periodLabel: string;
}) {
  const days = history ?? [];
  const hasData = days.some((day) => day.total_tokens > 0);
  const maxTokens = Math.max(...days.map((day) => day.total_tokens), 1);

  return (
    <SectionCard title="Token usage" caption={periodLabel}>
      {status !== "ready" || !hasData ? (
        <SectionState status={status} emptyMessage="No token usage in this period" />
      ) : (
        <div>
          <div className="flex h-[110px] items-end gap-[3px]">
            {days.map((day) => {
              const totalPct = Math.max(
                (day.total_tokens / maxTokens) * 100,
                day.total_tokens > 0 ? 6 : 0,
              );
              const promptShare =
                day.total_tokens > 0 ? day.prompt_tokens / day.total_tokens : 0;
              const promptPct = Math.max(
                totalPct * promptShare,
                day.prompt_tokens > 0 ? 2 : 0,
              );
              const completionPct = Math.max(
                totalPct - promptPct,
                day.completion_tokens > 0 ? 2 : 0,
              );
              return (
                <div
                  key={day.date}
                  title={`${usageDateLabel(day.date)}: ${day.total_tokens.toLocaleString()} tokens (${day.prompt_tokens.toLocaleString()} prompt, ${day.completion_tokens.toLocaleString()} completion), ${day.requests.toLocaleString()} requests`}
                  className="flex h-full min-w-0 flex-1 flex-col justify-end"
                >
                  {day.prompt_tokens > 0 && (
                    <div
                      className="w-full rounded-t-[2px] bg-accent"
                      style={{ height: `${promptPct}%` }}
                    />
                  )}
                  {day.completion_tokens > 0 && (
                    <div
                      className="w-full bg-accent/40"
                      style={{ height: `${completionPct}%` }}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[10px] text-text-secondary">
            <span>{usageDateLabel(days[0].date)}</span>
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                Prompt
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-accent/40" />
                Completion
              </span>
            </span>
            <span>{usageDateLabel(days[days.length - 1].date)}</span>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function KeyUsageSection({
  keys,
  status,
  periodLabel,
}: {
  keys: ReturnType<typeof usageKeyRows>;
  status: SectionStatus;
  periodLabel: string;
}) {
  const visible = keys.filter((key) => key.total_tokens > 0 || key.requests > 0);
  const maxTokens = Math.max(...visible.map((key) => key.total_tokens), 1);

  return (
    <SectionCard title="Usage by API key" caption={periodLabel}>
      {status !== "ready" || visible.length === 0 ? (
        <SectionState status={status} emptyMessage="No API key usage in this period" />
      ) : (
        <div className="space-y-2">
          {visible.map((key) => {
            const pct = Math.max((key.total_tokens / maxTokens) * 100, 2);
            return (
              <div key={key.id} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[12px] font-medium">
                      {key.name}
                      {key.reference && (
                        <span className="ml-1.5 font-mono text-[10px] text-text-secondary">
                          {key.reference}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-text-secondary">
                      {formatTokens(key.total_tokens)} tokens ·{" "}
                      {key.requests.toLocaleString()} requests
                    </span>
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-active-row overflow-hidden">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

function AgentUsageSection({
  rows,
  status,
}: {
  rows: UsageAgentRow[];
  status: SectionStatus;
}) {
  return (
    <SectionCard title="Usage by agent">
      {status !== "ready" || rows.length === 0 ? (
        <SectionState status={status} emptyMessage="No agent usage in this period" />
      ) : (
        <div className="overflow-x-auto" role="region" aria-label="Usage by agent table">
          <table className="w-full border-collapse text-left text-[12px]">
            <thead>
              <tr className="text-[10px] text-text-secondary">
                <th className="py-1 pr-3 font-semibold">Agent</th>
                <th className="px-3 py-1 text-right font-semibold">Prompt</th>
                <th className="px-3 py-1 text-right font-semibold">Completion</th>
                <th className="px-3 py-1 text-right font-semibold">Requests</th>
                <th className="py-1 pl-3 text-right font-semibold">Total tokens</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.kind}:${row.id}`} className="border-t border-border">
                  <td className="py-2 pr-3">
                    <span className="font-medium">{row.name}</span>
                    {row.kind === "unattributed" && (
                      <span className="ml-1.5 text-[10px] text-text-secondary">
                        Not an agent
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatTokens(row.prompt_tokens)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatTokens(row.completion_tokens)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.requests.toLocaleString()}
                  </td>
                  <td className="py-2 pl-3 text-right tabular-nums">
                    {formatTokens(row.total_tokens)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
