import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLAW_TOOLTIP_DELAY_MS } from "@/components/ClawTooltip";

import {
  AgentUsageTable,
  DashboardMetricCard,
  DashboardTimeRangeControl,
  IntegrationUsagePanel,
  TokenUsagePanel,
  dashboardMetricIcons,
  formatDashboardTokens,
  type DashboardDayData,
  type DashboardIntegrationUsage,
} from "./DashboardAnalytics";

const history: DashboardDayData[] = [
  { date: "2026-05-13", totalTokens: 100_000, promptTokens: 40_000, completionTokens: 60_000, requests: 40 },
  { date: "2026-05-14", totalTokens: 220_000, promptTokens: 90_000, completionTokens: 130_000, requests: 146 },
];

const integrations: DashboardIntegrationUsage[] = [
  { id: "slack", name: "Slack", totalTokens: 75_000, requests: 40 },
  { id: "cli", name: "CLI", totalTokens: 120_000, requests: 146 },
];

afterEach(() => {
  vi.useRealTimers();
});

function buildThirtyDayHistory(): DashboardDayData[] {
  const start = Date.UTC(2026, 3, 22);
  return Array.from({ length: 30 }, (_, index) => {
    const date = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
    const promptTokens = 40_000 + index * 1_000;
    const completionTokens = 60_000 + index * 1_500;
    return {
      date,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      requests: 20 + index,
    };
  });
}

describe("DashboardAnalytics", () => {
  it("formats compact token totals", () => {
    expect(formatDashboardTokens(320_000)).toBe("320k");
    expect(formatDashboardTokens(999_499)).toBe("999k");
    expect(formatDashboardTokens(999_999)).toBe("1.0M");
    expect(formatDashboardTokens(8_200_000)).toBe("8.2M");
    expect(formatDashboardTokens(999_999_999)).toBe("1.0B");
    expect(formatDashboardTokens(999_999_999_999)).toBe("1.0T");
    expect(formatDashboardTokens(0)).toBe("0");
    expect(formatDashboardTokens(Number.NaN)).toBe("---");
    expect(formatDashboardTokens(null)).toBe("---");
  });

  it("changes the selected time range", () => {
    const onChange = vi.fn();
    render(<DashboardTimeRangeControl value="7d" onChange={onChange} />);

    expect(screen.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "30 days" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "30 days" }));

    expect(onChange).toHaveBeenCalledWith("30d");
  });

  it("renders the populated dashboard panels", () => {
    render(
      <>
        <DashboardMetricCard title="Tokens" value="320k" periodLabel="Last 7 days" icon={dashboardMetricIcons.tokens} />
        <TokenUsagePanel history={history} periodLabel="Last 7 days (UTC)" />
        <IntegrationUsagePanel integrations={integrations} periodLabel="Last 7 days (UTC)" />
        <AgentUsageTable
          rows={[
            {
              id: "agent-1",
              name: "Dev Agent",
              status: "RUNNING",
              promptTokens: 120_000,
              completionTokens: 200_000,
              requests: 186,
              tokens: 320_000,
            },
          ]}
        />
      </>,
    );

    expect(screen.getAllByText("320k").length).toBeGreaterThan(0);
    expect(screen.getByText("Token usage")).toBeInTheDocument();
    expect(screen.getByText("Usage by API key")).toBeInTheDocument();
    expect(screen.getByText("Slack")).toBeInTheDocument();
    expect(screen.getByText("CLI")).toBeInTheDocument();
    expect(screen.getByText("Dev Agent")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders a compact linked workspace metric", () => {
    render(
      <DashboardMetricCard
        title="Agents"
        value="3"
        periodLabel="Across this account"
        icon={dashboardMetricIcons.agents}
        href="/dashboard/agents"
        compact
      />,
    );

    expect(screen.getByRole("link", { name: /Agents/i })).toHaveAttribute("href", "/dashboard/agents");
    expect(screen.getByText("Across this account")).toBeInTheDocument();
  });

  it("renders integration display names supplied by the normalizer", () => {
    render(
      <IntegrationUsagePanel
        periodLabel="Last 7 days (UTC)"
        integrations={[
          { id: "msteams", name: "Microsoft Teams", totalTokens: 80_000, requests: 20 },
        ]}
      />,
    );

    expect(screen.getByText("Microsoft Teams")).toBeInTheDocument();
    expect(screen.queryByText("msteams")).not.toBeInTheDocument();
  });

  it("distinguishes duplicate API-key names with references and request totals", () => {
    render(
      <IntegrationUsagePanel
        periodLabel="Last 7 days (UTC)"
        integrations={[
          { id: "key-1", name: "CLI key", reference: "abcdef...7890", totalTokens: 80_000, requests: 20 },
          { id: "key-2", name: "CLI key", reference: "123456...7890", totalTokens: 40_000, requests: 8 },
        ]}
      />,
    );

    expect(screen.getAllByText("CLI key")).toHaveLength(2);
    expect(screen.getByText("Key abcdef...7890")).toBeInTheDocument();
    expect(screen.getByText("Key 123456...7890")).toBeInTheDocument();
    expect(screen.getByText("20 requests")).toBeInTheDocument();
    expect(screen.getByText("8 requests")).toBeInTheDocument();
  });

  it("shows a token breakdown tooltip when hovering a bar", () => {
    vi.useFakeTimers();
    render(<TokenUsagePanel history={history} periodLabel="Last 7 days (UTC)" />);

    fireEvent.pointerMove(screen.getByRole("button", { name: "May 13: 100,000 total tokens, 40,000 prompt, 60,000 completion, 40 requests" }), { pointerType: "mouse" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(CLAW_TOOLTIP_DELAY_MS));

    const tooltip = screen.getByRole("tooltip");
    expect(within(tooltip).getByText("May 13")).toBeInTheDocument();
    expect(within(tooltip).getByText("Prompt")).toBeInTheDocument();
    expect(within(tooltip).getByText("Completion")).toBeInTheDocument();
    expect(within(tooltip).getByText("100k")).toBeInTheDocument();
    expect(within(tooltip).getByText("40")).toBeInTheDocument();
  });

  it("renders the actual UTC daily bucket for today's usage", () => {
    render(
      <TokenUsagePanel
        history={[
          { date: "2026-05-22", promptTokens: 106_000, completionTokens: 1_000, totalTokens: 107_000, requests: 5 },
        ]}
        periodLabel="Today (UTC)"
      />,
    );

    const dailyBucket = screen.getByRole("button", { name: "May 22: 107,000 total tokens, 106,000 prompt, 1,000 completion, 5 requests" });
    expect(screen.getByText("May 22")).toBeInTheDocument();
    expect(screen.queryByText("Now")).not.toBeInTheDocument();
    fireEvent.focus(dailyBucket);
    expect(within(screen.getByRole("tooltip")).getByText("107k")).toBeInTheDocument();
  });

  it("uses weekly ticks for the 30 day token chart", () => {
    render(<TokenUsagePanel history={buildThirtyDayHistory()} periodLabel="Last 30 days (UTC)" />);

    expect(screen.getByText("Apr 22")).toBeInTheDocument();
    expect(screen.getByText("Apr 29")).toBeInTheDocument();
    expect(screen.getByText("May 6")).toBeInTheDocument();
    expect(screen.getByText("May 13")).toBeInTheDocument();
    expect(screen.getByText("May 20")).toBeInTheDocument();
    expect(screen.queryByText("Apr 23")).not.toBeInTheDocument();
    expect(screen.queryByText("Today")).not.toBeInTheDocument();
  });

  it("renders empty collection states", () => {
    render(
      <>
        <TokenUsagePanel history={[]} periodLabel="Last 7 days (UTC)" />
        <IntegrationUsagePanel integrations={[]} periodLabel="Last 7 days (UTC)" />
        <AgentUsageTable rows={[]} />
      </>,
    );

    expect(screen.getByText("No token usage in this period")).toBeInTheDocument();
    expect(screen.getByText("No API key usage in this period")).toBeInTheDocument();
    expect(screen.getByText("No agent usage in this period")).toBeInTheDocument();
  });

  it("distinguishes unavailable and loading panels from empty usage", () => {
    render(
      <>
        <TokenUsagePanel history={[]} periodLabel="Last 7 days (UTC)" status="unavailable" />
        <IntegrationUsagePanel integrations={[]} periodLabel="Last 7 days (UTC)" status="loading" />
      </>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Usage unavailable");
    expect(screen.getByText("Loading usage...")).toBeInTheDocument();
    expect(screen.queryByText("No token usage in this period")).not.toBeInTheDocument();
  });
});
