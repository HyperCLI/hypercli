import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  AgentUsageTable,
  DashboardMetricCard,
  DashboardTimeRangeControl,
  IntegrationUsagePanel,
  TokenUsagePanel,
  dashboardMetricIcons,
  formatDashboardTokens,
  hasCollectedData,
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

function buildHourlyHistory(): DashboardDayData[] {
  return Array.from({ length: 24 }, (_, index) => {
    const promptTokens = 10_000 + index * 500;
    const completionTokens = 20_000 + index * 750;
    return {
      date: `2026-05-22T${String(index).padStart(2, "0")}:00:00Z`,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      requests: 3 + index,
    };
  });
}

describe("DashboardAnalytics", () => {
  it("formats compact token totals", () => {
    expect(formatDashboardTokens(320_000)).toBe("320k");
    expect(formatDashboardTokens(8_200_000)).toBe("8.2M");
    expect(formatDashboardTokens(null)).toBe("---");
  });

  it("detects collected data from history or integration usage", () => {
    expect(hasCollectedData([], [])).toBe(false);
    expect(hasCollectedData([{ ...history[0], totalTokens: 0, requests: 0 }], [])).toBe(false);
    expect(hasCollectedData(history, [])).toBe(true);
    expect(hasCollectedData([], integrations)).toBe(true);
  });

  it("changes the selected time range", () => {
    const onChange = vi.fn();
    render(<DashboardTimeRangeControl value="7d" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Last 30 days" }));

    expect(onChange).toHaveBeenCalledWith("30d");
  });

  it("renders the populated dashboard panels", () => {
    render(
      <>
        <DashboardMetricCard title="Tokens" value="320k" periodLabel="Last 7 days" icon={dashboardMetricIcons.tokens} />
        <TokenUsagePanel history={history} periodLabel="Last 7 days" />
        <IntegrationUsagePanel integrations={integrations} periodLabel="Last 7 days" />
        <AgentUsageTable
          rows={[
            {
              id: "agent-1",
              name: "Dev Agent",
              status: "RUNNING",
              integrations: 2,
              requests: 186,
              tokens: 320_000,
              lastActivity: "2 min ago",
            },
          ]}
        />
      </>,
    );

    expect(screen.getAllByText("320k").length).toBeGreaterThan(0);
    expect(screen.getByText("Token usage")).toBeInTheDocument();
    expect(screen.getByText("Usage by Integration")).toBeInTheDocument();
    expect(screen.getByText("Slack")).toBeInTheDocument();
    expect(screen.getByText("CLI")).toBeInTheDocument();
    expect(screen.getByText("Dev Agent")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders integration display names supplied by the normalizer", () => {
    render(
      <IntegrationUsagePanel
        periodLabel="Last 7 days"
        integrations={[
          { id: "msteams", name: "Microsoft Teams", totalTokens: 80_000, requests: 20 },
        ]}
      />,
    );

    expect(screen.getByText("Microsoft Teams")).toBeInTheDocument();
    expect(screen.queryByText("msteams")).not.toBeInTheDocument();
  });

  it("shows a token breakdown tooltip when hovering a bar", () => {
    render(<TokenUsagePanel history={history} periodLabel="Last 7 days" />);

    fireEvent.mouseEnter(screen.getByRole("button", { name: "May 13 token usage" }));

    const tooltip = screen.getByRole("tooltip");
    expect(within(tooltip).getByText("May 13")).toBeInTheDocument();
    expect(within(tooltip).getByText("Prompt")).toBeInTheDocument();
    expect(within(tooltip).getByText("Completion")).toBeInTheDocument();
    expect(within(tooltip).getByText("100k")).toBeInTheDocument();
    expect(within(tooltip).getByText("40")).toBeInTheDocument();
  });

  it("uses hourly ticks for the 24 hour token chart", () => {
    render(<TokenUsagePanel history={buildHourlyHistory()} periodLabel="Last 24h" />);

    expect(screen.getByText("12 AM")).toBeInTheDocument();
    expect(screen.getByText("6 AM")).toBeInTheDocument();
    expect(screen.getByText("12 PM")).toBeInTheDocument();
    expect(screen.getByText("6 PM")).toBeInTheDocument();
    expect(screen.getByText("Now")).toBeInTheDocument();
    expect(screen.queryByText("May 22")).not.toBeInTheDocument();
  });

  it("keeps the 24 hour chart axis when the API returns one daily bucket", () => {
    render(
      <TokenUsagePanel
        history={[
          { date: "2026-05-22", promptTokens: 106_000, completionTokens: 1_000, totalTokens: 107_000, requests: 5 },
        ]}
        periodLabel="Last 24h"
      />,
    );

    expect(screen.getAllByRole("button", { name: "May 22 token usage" })).toHaveLength(24);
    expect(screen.getByText("12 AM")).toBeInTheDocument();
    expect(screen.getByText("6 AM")).toBeInTheDocument();
    expect(screen.getByText("12 PM")).toBeInTheDocument();
    expect(screen.getByText("6 PM")).toBeInTheDocument();
    expect(screen.getByText("Now")).toBeInTheDocument();

    const nowBucket = screen.getAllByRole("button", { name: "May 22 token usage" }).at(-1);
    if (!nowBucket) throw new Error("Expected now bucket");
    fireEvent.mouseEnter(nowBucket);
    expect(within(screen.getByRole("tooltip")).getByText("107k")).toBeInTheDocument();
  });

  it("uses weekly ticks for the 30 day token chart", () => {
    render(<TokenUsagePanel history={buildThirtyDayHistory()} periodLabel="Last 30 days" />);

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
        <TokenUsagePanel history={[]} periodLabel="Last 7 days" />
        <IntegrationUsagePanel integrations={[]} periodLabel="Last 7 days" />
        <AgentUsageTable rows={[]} />
      </>,
    );

    expect(screen.getAllByText("No data has been collected")).toHaveLength(3);
  });
});
