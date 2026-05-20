import { fireEvent, render, screen } from "@testing-library/react";
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
