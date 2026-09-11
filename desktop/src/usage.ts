import type { UsageDay, UsageKeyEntry, UsageMetrics } from "./api";

export type UsageRange = "1d" | "7d" | "30d";

export const USAGE_RANGE_OPTIONS: Array<{
  value: UsageRange;
  label: string;
  days: number;
  periodLabel: string;
}> = [
  { value: "1d", label: "Today", days: 1, periodLabel: "Today (UTC)" },
  { value: "7d", label: "7 days", days: 7, periodLabel: "Last 7 days (UTC)" },
  { value: "30d", label: "30 days", days: 30, periodLabel: "Last 30 days (UTC)" },
];

export function usageRangeDays(range: UsageRange) {
  return USAGE_RANGE_OPTIONS.find((option) => option.value === range)?.days ?? 7;
}

export function usagePeriodLabel(range: UsageRange) {
  return (
    USAGE_RANGE_OPTIONS.find((option) => option.value === range)?.periodLabel ??
    "Last 7 days (UTC)"
  );
}

export function formatTokens(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value < 0) return "—";
  if (value >= 999_500_000_000)
    return `${(value / 1_000_000_000_000).toFixed(value >= 10_000_000_000_000 ? 0 : 1)}T`;
  if (value >= 999_500_000)
    return `${(value / 1_000_000_000).toFixed(value >= 10_000_000_000 ? 0 : 1)}B`;
  if (value >= 999_500)
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  return value.toLocaleString();
}

export function sumUsageHistory(history: UsageDay[]): UsageMetrics {
  return history.reduce(
    (totals, day) => ({
      total_tokens: totals.total_tokens + day.total_tokens,
      prompt_tokens: totals.prompt_tokens + day.prompt_tokens,
      completion_tokens: totals.completion_tokens + day.completion_tokens,
      requests: totals.requests + day.requests,
    }),
    { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0, requests: 0 },
  );
}

export function activeKeyCount(keys: UsageKeyEntry[]) {
  return keys.filter((key) => key.total_tokens > 0 || key.requests > 0).length;
}

export interface UsageKeyRow {
  id: string;
  name: string;
  reference: string | null;
  total_tokens: number;
  requests: number;
}

function shortKeyReference(value: string, prefixLength = 6) {
  return value.length <= prefixLength + 4
    ? value
    : `${value.slice(0, prefixLength)}...${value.slice(-4)}`;
}

function uniqueShortKeyReference(value: string, references: string[]) {
  for (let prefixLength = 6; prefixLength + 4 < value.length; prefixLength += 2) {
    const shortened = shortKeyReference(value, prefixLength);
    if (
      references.every(
        (candidate) =>
          candidate === value ||
          shortKeyReference(candidate, prefixLength) !== shortened,
      )
    ) {
      return shortened;
    }
  }
  return value;
}

export function usageKeyRows(keys: UsageKeyEntry[]): UsageKeyRow[] {
  const rows = keys.map((entry) => {
    const id = entry.key_hash.trim();
    const rawName = entry.name.trim();
    const name = !rawName || rawName === id.slice(0, 12) ? "Unnamed API key" : rawName;
    return {
      id,
      name,
      reference: null,
      total_tokens: entry.total_tokens,
      requests: entry.requests,
    };
  });
  const nameCounts = new Map<string, number>();
  for (const row of rows) {
    const key = row.name.toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const referencedIds = rows
    .filter(
      (row) =>
        row.name === "Unnamed API key" ||
        (nameCounts.get(row.name.toLowerCase()) ?? 0) > 1,
    )
    .map((row) => row.id);
  return rows.map((row) => ({
    ...row,
    reference:
      row.name === "Unnamed API key" ||
      (nameCounts.get(row.name.toLowerCase()) ?? 0) > 1
        ? uniqueShortKeyReference(row.id, referencedIds)
        : null,
  }));
}

export interface UsageAgentRow {
  id: string;
  name: string;
  kind: "agent" | "unattributed";
  prompt_tokens: number;
  completion_tokens: number;
  requests: number;
  total_tokens: number;
}

function hasUsageActivity(m: UsageMetrics) {
  return (
    m.total_tokens > 0 ||
    m.prompt_tokens > 0 ||
    m.completion_tokens > 0 ||
    m.requests > 0
  );
}

export function agentUsageRows(
  agents: import("./api").UsageAgentEntry[] | null,
  unattributed: UsageMetrics | null,
): UsageAgentRow[] {
  const rows: UsageAgentRow[] = (agents ?? [])
    // The backend lists every agent on the account, including ones with no
    // activity in the window; a table of all-zero rows reads as broken.
    .filter(hasUsageActivity)
    .map((entry) => ({
      id: entry.agent_id,
      name: entry.name.trim() || entry.agent_id,
      kind: "agent",
      prompt_tokens: entry.prompt_tokens,
      completion_tokens: entry.completion_tokens,
      requests: entry.requests,
      total_tokens: entry.total_tokens,
    }));
  if (unattributed && hasUsageActivity(unattributed)) {
    rows.push({
      id: "usage:unattributed",
      name: "Unattributed usage",
      kind: "unattributed",
      prompt_tokens: unattributed.prompt_tokens,
      completion_tokens: unattributed.completion_tokens,
      requests: unattributed.requests,
      total_tokens: unattributed.total_tokens,
    });
  }
  return rows;
}

export function usageDateLabel(value: string) {
  const date = value.split("T")[0] || value;
  if (date === new Date().toISOString().slice(0, 10)) return "Today";
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Long key lists are sorted and clamped to this many rows in the panel. */
export const USAGE_KEY_ROW_LIMIT = 8;

// ---------------------------------------------------------------------------
// ACP `usage_update` (per-turn context-window fill) — used/size are a
// used-of-limit pair, not cumulative counters; cost.amount is a currency
// float (dollars unless a currency code says otherwise).
// ---------------------------------------------------------------------------

export interface UsageUpdateInfo {
  used?: number | null;
  size?: number | null;
  cost?: { amount?: number | null; currency?: string | null } | null;
}

function finiteNonNegative(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function trimAmountDecimals(text: string, minimum = 2) {
  const [int, frac] = text.split(".");
  if (frac === undefined) return text;
  const trimmed = frac.replace(/0+$/, "").padEnd(minimum, "0");
  return `${int}.${trimmed}`;
}

export function formatCostAmount(
  amount: number | null | undefined,
  currency?: string | null,
): string | null {
  const value = finiteNonNegative(amount);
  if (value == null) return null;
  const text =
    value >= 1 ? value.toFixed(2) : trimAmountDecimals(value.toFixed(4));
  const code = currency?.trim() ?? "";
  return !code || code === "USD" ? `$${text}` : `${text} ${code}`;
}

/**
 * One-line label for an ACP `usage_update`. Never renders placeholders like
 * "?" or NaN — unknown fields fall back to a bare note.
 */
export function usageUpdateText(info: UsageUpdateInfo): string {
  const used = finiteNonNegative(info.used);
  const size = finiteNonNegative(info.size);
  let base: string;
  if (used != null && size != null && size > 0) {
    const pct = Math.max(0, Math.min(999, Math.round((used / size) * 100)));
    base = `Context ${formatTokens(used)} of ${formatTokens(size)} tokens (${pct}%)`;
  } else if (used != null) {
    base = `Context ${formatTokens(used)} tokens used`;
  } else if (size != null && size > 0) {
    base = `Context window ${formatTokens(size)} tokens`;
  } else {
    base = "Context usage updated";
  }
  const cost = formatCostAmount(info.cost?.amount, info.cost?.currency);
  return cost ? `${base} · ${cost}` : base;
}
