import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toAgentViewModel } from "@/components/dashboard/agents/agentViewModel";
import { buildSdkAgent } from "@/test/factories";

const mocks = vi.hoisted(() => ({
  getToken: vi.fn(),
  usageHistory: vi.fn(),
  keyUsage: vi.fn(),
  agentUsage: vi.fn(),
  userId: "user-1",
}));

vi.mock("@/hooks/useAgentAuth", () => ({
  useAgentAuth: () => ({
    getToken: mocks.getToken,
    user: { id: mocks.userId, fullName: "Jane Rivera", email: "jane@example.com" },
  }),
}));

vi.mock("@/lib/agent-client", () => ({
  createHyperAgentClient: () => ({
    usageHistory: mocks.usageHistory,
    keyUsage: mocks.keyUsage,
    agentUsage: mocks.agentUsage,
  }),
}));

vi.mock("@/components/ClawTooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}));

import WorkspaceUsagePanel from "./WorkspaceUsagePanel";

function buildHistory(days: number, totalTokens: number, requests = totalTokens > 0 ? 1 : 0) {
  const start = Date.UTC(2026, 6, 1);
  return {
    days,
    history: Array.from({ length: days }, (_, index) => {
      const isLast = index === days - 1;
      const total = isLast ? totalTokens : 0;
      return {
        date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
        totalTokens: total,
        promptTokens: Math.floor(total * 0.6),
        completionTokens: total - Math.floor(total * 0.6),
        requests: isLast ? requests : 0,
      };
    }),
  };
}

function buildAgentUsage(days: number, overrides: Record<string, unknown> = {}) {
  return {
    days,
    agents: [],
    unattributed: { totalTokens: 0, promptTokens: 0, completionTokens: 0, requests: 0 },
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("WorkspaceUsagePanel", () => {
  const agentA = toAgentViewModel(buildSdkAgent({ id: "agent-a", name: "alpha", state: "RUNNING" }));
  const agentB = toAgentViewModel(buildSdkAgent({ id: "agent-b", name: "beta", state: "STOPPED" }));

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userId = "user-1";
    mocks.getToken.mockResolvedValue("session-token");
    mocks.usageHistory.mockImplementation((days: number) => Promise.resolve(buildHistory(days, 0)));
    mocks.keyUsage.mockImplementation((days: number) => Promise.resolve({ days, keys: [] }));
    mocks.agentUsage.mockImplementation((days: number) => Promise.resolve(buildAgentUsage(days, {
      agents: [
        {
          agentId: "agent-a",
          name: "Alpha",
          managed: true,
          avatarUrl: null,
          totalTokens: 0,
          promptTokens: 0,
          completionTokens: 0,
          requests: 0,
        },
      ],
    })));
  });

  it("renders successful zeroes as zero instead of unknown data", async () => {
    render(<WorkspaceUsagePanel accountAgents={[agentA]} />);

    const tokenCard = screen.getByRole("heading", { name: "Tokens" }).closest("section");
    const requestCard = screen.getByRole("heading", { name: "Requests" }).closest("section");
    const keyCard = screen.getByRole("heading", { name: "API keys used" }).closest("section");
    if (!tokenCard || !requestCard || !keyCard) throw new Error("Expected usage metric cards");

    await waitFor(() => expect(within(tokenCard).getByText("0")).toBeInTheDocument());
    expect(within(requestCard).getByText("0")).toBeInTheDocument();
    expect(within(keyCard).getByText("0")).toBeInTheDocument();
    expect(screen.getByText("No token usage in this period")).toBeInTheDocument();
    expect(screen.getByText("No API key usage in this period")).toBeInTheDocument();

    const agentRow = screen.getByText("Alpha").closest("tr");
    if (!agentRow) throw new Error("Expected Alpha usage row");
    expect(within(agentRow).getAllByText("0")).toHaveLength(4);
    expect(screen.queryByText("---")).not.toBeInTheDocument();
  });

  it("uses backend-attributed agent values and retains unattributed account usage", async () => {
    mocks.usageHistory.mockResolvedValue(buildHistory(7, 999, 9));
    mocks.agentUsage.mockResolvedValue(buildAgentUsage(7, {
      agents: [
        {
          agentId: "agent-a",
          name: "Alpha",
          managed: true,
          avatarUrl: null,
          totalTokens: 100,
          promptTokens: 60,
          completionTokens: 40,
          requests: 2,
        },
        {
          agentId: "agent-b",
          name: "Beta",
          managed: true,
          avatarUrl: null,
          totalTokens: 200,
          promptTokens: 120,
          completionTokens: 80,
          requests: 3,
        },
        {
          agentId: "agent-c",
          name: "Backend only",
          managed: true,
          avatarUrl: null,
          totalTokens: 50,
          promptTokens: 30,
          completionTokens: 20,
          requests: 1,
        },
      ],
      unattributed: { totalTokens: 699, promptTokens: 419, completionTokens: 280, requests: 4 },
    }));

    render(<WorkspaceUsagePanel accountAgents={[agentA, agentB]} />);

    const alphaRow = (await screen.findByText("Alpha")).closest("tr");
    const betaRow = screen.getByText("Beta").closest("tr");
    const backendOnlyRow = screen.getByText("Backend only").closest("tr");
    const unattributedRow = screen.getByText("Unattributed usage").closest("tr");
    if (!alphaRow || !betaRow || !backendOnlyRow || !unattributedRow) throw new Error("Expected attributed usage rows");

    expect(within(alphaRow).getByText("100")).toBeInTheDocument();
    expect(within(betaRow).getByText("200")).toBeInTheDocument();
    expect(within(backendOnlyRow).getByText("50")).toBeInTheDocument();
    expect(within(backendOnlyRow).getByText("Unknown")).toBeInTheDocument();
    expect(within(unattributedRow).getByText("699")).toBeInTheDocument();
    expect(within(unattributedRow).getByText("Not an agent")).toBeInTheDocument();
    expect(within(alphaRow).queryByText("999")).not.toBeInTheDocument();
    expect(mocks.agentUsage).toHaveBeenCalledWith(7);
  });

  it("keeps successful sections visible when history is unavailable and retries all sources", async () => {
    mocks.usageHistory.mockRejectedValue(new Error("history unavailable"));
    mocks.keyUsage.mockResolvedValue({
      days: 7,
      keys: [{
        keyHash: "key-hash",
        name: "CLI key",
        totalTokens: 55,
        promptTokens: 30,
        completionTokens: 25,
        requests: 2,
      }],
    });

    render(<WorkspaceUsagePanel accountAgents={[agentA]} />);

    expect(await screen.findByText("Some usage data could not be loaded. Available sections are shown.")).toBeInTheDocument();
    expect(screen.getByText("CLI key")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tokens" }).closest("section")).toHaveTextContent("Unavailable");
    expect(screen.getAllByText("Usage unavailable").length).toBeGreaterThan(0);
    expect(screen.queryByText("No token usage in this period")).not.toBeInTheDocument();

    mocks.usageHistory.mockResolvedValue(buildHistory(7, 25, 1));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.queryByText("Some usage data could not be loaded. Available sections are shown.")).not.toBeInTheDocument());
    expect(mocks.usageHistory).toHaveBeenCalledTimes(2);
  });

  it("treats malformed usage counts as unavailable instead of rendering believable zeroes", async () => {
    const malformed = buildHistory(7, 10, 1);
    malformed.history[6].totalTokens = Number.NaN;
    mocks.usageHistory.mockResolvedValue(malformed);

    render(<WorkspaceUsagePanel accountAgents={[agentA]} />);

    expect(await screen.findByText("Some usage data could not be loaded. Available sections are shown.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tokens" }).closest("section")).toHaveTextContent("Unavailable");
    expect(screen.queryByText("NaN")).not.toBeInTheDocument();
  });

  it("does not let a slower prior range overwrite the current range", async () => {
    const thirtyDayHistory = deferred<ReturnType<typeof buildHistory>>();
    const todayHistory = deferred<ReturnType<typeof buildHistory>>();
    mocks.usageHistory.mockImplementation((days: number) => {
      if (days === 30) return thirtyDayHistory.promise;
      if (days === 1) return todayHistory.promise;
      return Promise.resolve(buildHistory(days, 7, 1));
    });

    render(<WorkspaceUsagePanel accountAgents={[agentA]} />);

    const tokenCard = screen.getByRole("heading", { name: "Tokens" }).closest("section");
    if (!tokenCard) throw new Error("Expected token metric card");
    await waitFor(() => expect(within(tokenCard).getByText("7")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "30 days" }));
    await waitFor(() => expect(mocks.usageHistory).toHaveBeenCalledWith(30));
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    await waitFor(() => expect(mocks.usageHistory).toHaveBeenCalledWith(1));

    await act(async () => todayHistory.resolve(buildHistory(1, 1, 1)));
    await waitFor(() => expect(within(tokenCard).getByText("1")).toBeInTheDocument());
    await act(async () => thirtyDayHistory.resolve(buildHistory(30, 30, 3)));

    await waitFor(() => expect(within(tokenCard).getByText("1")).toBeInTheDocument());
    expect(within(tokenCard).queryByText("30")).not.toBeInTheDocument();
    expect(within(tokenCard).getByText("Today (UTC)")).toBeInTheDocument();
  });

  it("reloads usage when the authenticated principal changes", async () => {
    mocks.usageHistory.mockImplementation((days: number) => Promise.resolve(
      buildHistory(days, mocks.userId === "user-1" ? 10 : 20, 1),
    ));
    const { rerender } = render(<WorkspaceUsagePanel accountAgents={[agentA]} />);

    const tokenCard = screen.getByRole("heading", { name: "Tokens" }).closest("section");
    if (!tokenCard) throw new Error("Expected token metric card");
    await waitFor(() => expect(within(tokenCard).getByText("10")).toBeInTheDocument());

    mocks.userId = "user-2";
    rerender(<WorkspaceUsagePanel accountAgents={[agentA]} />);

    await waitFor(() => expect(within(tokenCard).getByText("20")).toBeInTheDocument());
    expect(mocks.usageHistory).toHaveBeenCalledTimes(2);
  });
});
