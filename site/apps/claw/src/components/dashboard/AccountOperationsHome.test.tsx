import { fireEvent, screen, within } from "@testing-library/react";
import type { Workspace } from "@hypercli.com/sdk/workspaces";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toAgentViewModel } from "@/components/dashboard/agents/agentViewModel";
import { buildSdkAgent } from "@/test/factories";
import { renderWithClient } from "@/test/utils";

const mockUseAccountOperationsOverview = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useAccountOperationsOverview", () => ({
  useAccountOperationsOverview: mockUseAccountOperationsOverview,
}));

import { AccountOperationsHome } from "./AccountOperationsHome";

const workspace: Workspace = {
  id: "space-1",
  name: "main-space",
  slug: "main-space",
  displayName: "Main Space",
  displaySlug: null,
  description: "Shared account context",
  role: "admin",
  createdAt: null,
  updatedAt: null,
};

const capturedAt = Date.now();
const sdkAgent = buildSdkAgent({ id: "agent-1", name: "Research Agent", state: "RUNNING" });
const agent = toAgentViewModel(sdkAgent);

function setOverview(overrides: Record<string, unknown> = {}) {
  mockUseAccountOperationsOverview.mockReturnValue({
    overview: {
      agents: {
        "agent-1": {
          agentId: "agent-1",
          dataState: "ready",
          sessions: [{
            key: "research",
            clientMode: "web",
            clientDisplayName: "Market research",
            createdAt: capturedAt - 7_200_000,
            lastMessageAt: capturedAt - 3_600_000,
            title: "Market research",
            messageCount: 8,
            sourceChannelId: "slack",
            model: "openai/gpt-5",
            raw: {},
          }],
          cronJobs: [{
            id: "job-1",
            name: "Daily brief",
            schedule: "0 9 * * *",
            prompt: "Brief the team",
            description: "Daily brief",
            enabled: true,
            timezone: "UTC",
            targetSessionKey: "research",
          }],
          failures: {},
          capturedAt,
        },
      },
      spaces: [{ workspace, visibility: "known", agentIds: ["agent-1"] }],
      capturedAt,
      ...overrides,
    },
    loading: false,
    refreshing: false,
    refresh: vi.fn(async () => undefined),
  });
}

describe("AccountOperationsHome", () => {
  beforeEach(() => {
    mockUseAccountOperationsOverview.mockReset();
    setOverview();
  });

  it("joins recent conversations, Domain access, and upcoming scheduled work", () => {
    const onOpenConversation = vi.fn();
    const onOpenScheduled = vi.fn();
    const onOpenDomain = vi.fn();

    renderWithClient(
      <AccountOperationsHome
        sdkAgents={[sdkAgent]}
        agents={[agent]}
        workspaces={[workspace]}
        spaceAccessClient={null}
        displayName="Franc Reyes"
        onOpenConversation={onOpenConversation}
        onOpenScheduled={onOpenScheduled}
        onOpenDomain={onOpenDomain}
      />,
    );

    expect(screen.getByRole("heading", { name: /Good (morning|afternoon|evening), Franc\./, level: 1 })).toBeInTheDocument();
    expect(screen.queryByText(/Franc Reyes/)).not.toBeInTheDocument();
    expect(screen.getByText(/Pick up where you left off/i)).toBeInTheDocument();
    expect(screen.queryByText("Manage Domains")).not.toBeInTheDocument();
    expect(screen.getAllByText("Market research").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Known Domain access for Market research")).toHaveTextContent("Main Space");
    expect(screen.getByText("via slack")).toBeInTheDocument();
    expect(screen.getByText("openai/gpt-5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 scheduled" })).toBeInTheDocument();
    expect(screen.getAllByText("Daily brief").length).toBeGreaterThan(0);
    expect(screen.getByText(/at 9:00 am utc/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Resume Market research with Research Agent" }));
    expect(onOpenConversation).toHaveBeenCalledWith("agent-1", "research");

    fireEvent.click(screen.getByRole("button", { name: /Open Daily brief for Research Agent/i }));
    expect(onOpenScheduled).toHaveBeenCalledWith("agent-1");

    expect(screen.getByText("Give tomorrow one less thing to remember.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add another scheduled task" }));
    expect(onOpenScheduled).toHaveBeenLastCalledWith("agent-1");

    fireEvent.click(screen.getByRole("button", { name: "Main Space" }));
    expect(onOpenDomain).toHaveBeenCalledWith("space-1");
  });

  it("turns available daily token capacity into a next action", () => {
    const onOpenAgent = vi.fn();
    const onOpenUsage = vi.fn();

    renderWithClient(
      <AccountOperationsHome
        sdkAgents={[sdkAgent]}
        agents={[agent]}
        workspaces={[workspace]}
        spaceAccessClient={null}
        dailyTokenUsage={200_000}
        dailyTokenLimit={2_000_000}
        onOpenAgent={onOpenAgent}
        onOpenUsage={onOpenUsage}
      />,
    );

    expect(screen.queryByText("Daily runway")).not.toBeInTheDocument();
    expect(screen.getByText("You have 1.8M tokens available. What will you finish today?")).toBeInTheDocument();
    expect(screen.queryByText("1.8M available now")).not.toBeInTheDocument();
    expect(screen.getByText("You are here")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Daily token capacity remaining" })).toHaveAttribute("aria-valuenow", "1800000");

    fireEvent.click(screen.getByRole("button", { name: "Put 1.8M to work" }));
    expect(onOpenAgent).toHaveBeenCalledWith("agent-1");
    fireEvent.click(screen.getByRole("button", { name: "View usage" }));
    expect(onOpenUsage).toHaveBeenCalledTimes(1);
  });

  it("surfaces Domain access gaps without claiming observed usage", () => {
    const onOpenKnowledge = vi.fn();
    setOverview({
      spaces: [{ workspace, visibility: "known", agentIds: [] }],
    });

    renderWithClient(
      <AccountOperationsHome
        sdkAgents={[sdkAgent]}
        agents={[agent]}
        workspaces={[workspace]}
        spaceAccessClient={null}
        onOpenKnowledge={onOpenKnowledge}
      />,
    );

    expect(screen.getByRole("heading", { name: "Knowledge in reach" })).toBeInTheDocument();
    expect(screen.getByText("1 Domain is waiting to meet an agent.")).toBeInTheDocument();
    expect(screen.getByText(/direct access, not observed conversation usage/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Connect a Domain" }));
    expect(onOpenKnowledge).toHaveBeenCalledTimes(1);
  });

  it("keeps partial gateway coverage visible without hiding available activity", () => {
    setOverview({
      agents: {
        "agent-1": {
          agentId: "agent-1",
          dataState: "unavailable",
          sessions: null,
          cronJobs: null,
          failures: { sessions: "Unavailable", cron: "Unavailable" },
          capturedAt: null,
        },
      },
    });

    renderWithClient(
      <AccountOperationsHome
        sdkAgents={[sdkAgent]}
        agents={[agent]}
        workspaces={[workspace]}
        spaceAccessClient={null}
      />,
    );

    expect(screen.getByText(/1 agent has incomplete activity data/i)).toBeInTheDocument();
    expect(screen.getByText("Some sessions are out of view")).toBeInTheDocument();
    expect(screen.getByText("Some scheduled work is unavailable")).toBeInTheDocument();
  });

  it("ranks regular agents and gently surfaces agents quiet for a week", () => {
    const regularSdkAgent = buildSdkAgent({ id: "agent-2", name: "Daily Copilot", state: "RUNNING" });
    const quietSdkAgent = buildSdkAgent({ id: "agent-3", name: "Archive Scout", state: "RUNNING" });
    const regularAgent = toAgentViewModel(regularSdkAgent);
    const quietAgent = toAgentViewModel(quietSdkAgent);
    const onOpenAgent = vi.fn();
    setOverview({
      agents: {
        "agent-1": {
          agentId: "agent-1",
          dataState: "ready",
          sessions: [{
            key: "research",
            clientMode: "web",
            clientDisplayName: "Market research",
            createdAt: capturedAt - 7_200_000,
            lastMessageAt: capturedAt - 3_600_000,
            title: "Market research",
            messageCount: 8,
            raw: {},
          }],
          cronJobs: [],
          failures: {},
          capturedAt,
        },
        "agent-2": {
          agentId: "agent-2",
          dataState: "ready",
          sessions: [{
            key: "daily",
            clientMode: "web",
            clientDisplayName: "Daily planning",
            createdAt: capturedAt - 7_200_000,
            lastMessageAt: capturedAt - 1_800_000,
            title: "Daily planning",
            messageCount: 34,
            raw: {},
          }],
          cronJobs: [],
          failures: {},
          capturedAt,
        },
        "agent-3": {
          agentId: "agent-3",
          dataState: "ready",
          sessions: [{
            key: "archive",
            clientMode: "web",
            clientDisplayName: "Archive review",
            createdAt: capturedAt - 12 * 86_400_000,
            lastMessageAt: capturedAt - 10 * 86_400_000,
            title: "Archive review",
            messageCount: 1,
            raw: {},
          }],
          cronJobs: [],
          failures: {},
          capturedAt,
        },
      },
    });

    renderWithClient(
      <AccountOperationsHome
        sdkAgents={[sdkAgent, regularSdkAgent, quietSdkAgent]}
        agents={[agent, regularAgent, quietAgent]}
        workspaces={[workspace]}
        spaceAccessClient={null}
        onOpenAgent={onOpenAgent}
      />,
    );

    const mostUsed = screen.getByLabelText("Most used agents");
    expect(within(mostUsed).getAllByRole("button")[0]).toHaveAccessibleName("Open Daily Copilot");
    expect(within(mostUsed).getByText(/34 messages/)).toBeInTheDocument();

    const waiting = screen.getByLabelText("Agents waiting in the wings");
    const revisit = within(waiting).getByRole("button", { name: "Revisit Archive Scout" });
    expect(within(waiting).getByText(/Last conversation/i)).toBeInTheDocument();
    fireEvent.click(revisit);
    expect(onOpenAgent).toHaveBeenCalledWith("agent-3");
  });

  it("treats recent zero-message sessions as team activity", () => {
    const recentAt = Date.now();
    setOverview({
      agents: {
        "agent-1": {
          agentId: "agent-1",
          dataState: "ready",
          sessions: [
            {
              key: "greeting",
              clientMode: "web",
              clientDisplayName: "Greeting",
              createdAt: recentAt - 5 * 60_000,
              lastMessageAt: recentAt - 4 * 60_000,
              title: "Greeting",
              messageCount: 0,
              raw: {},
            },
            {
              key: "new-session",
              clientMode: "web",
              clientDisplayName: "New Session",
              createdAt: recentAt - 6 * 60_000,
              lastMessageAt: recentAt - 4 * 60_000,
              title: "New Session",
              messageCount: 0,
              raw: {},
            },
          ],
          cronJobs: [],
          failures: {},
          capturedAt: recentAt,
        },
      },
    });

    renderWithClient(
      <AccountOperationsHome
        sdkAgents={[sdkAgent]}
        agents={[agent]}
        workspaces={[workspace]}
        spaceAccessClient={null}
      />,
    );

    const mostUsed = screen.getByLabelText("Most used agents");
    expect(within(mostUsed).getByRole("button", { name: "Open Research Agent" })).toBeInTheDocument();
    expect(within(mostUsed).getByText("2 sessions · 0 messages")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Agents waiting in the wings")).queryByText("Research Agent")).not.toBeInTheDocument();
    expect(screen.getByText("Based on sessions available now")).toBeInTheDocument();
    expect(screen.queryByText(/A first conversation will begin shaping this list/i)).not.toBeInTheDocument();
  });

  it("shows an actionable empty state for a new account", () => {
    setOverview({ agents: {}, spaces: [] });
    const onOpenAgentLauncher = vi.fn();

    renderWithClient(
      <AccountOperationsHome
        sdkAgents={[]}
        agents={[]}
        workspaces={[]}
        spaceAccessClient={null}
        onOpenAgentLauncher={onOpenAgentLauncher}
      />,
    );

    expect(screen.getByRole("heading", { name: "Start something worth continuing" })).toBeInTheDocument();
    expect(screen.getByText("Hand off the task you wish was already moving.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create my first agent" }));
    expect(onOpenAgentLauncher).toHaveBeenCalledTimes(1);
  });

  it("turns a quiet account into a compact, actionable daily brief", () => {
    setOverview({
      agents: {
        "agent-1": {
          agentId: "agent-1",
          dataState: "ready",
          sessions: [],
          cronJobs: [],
          failures: {},
          capturedAt,
        },
      },
    });
    const onOpenAgent = vi.fn();
    const onOpenScheduled = vi.fn();

    renderWithClient(
      <AccountOperationsHome
        sdkAgents={[sdkAgent]}
        agents={[agent]}
        workspaces={[workspace]}
        spaceAccessClient={null}
        displayName="Franc"
        onOpenAgent={onOpenAgent}
        onOpenScheduled={onOpenScheduled}
      />,
    );

    expect(screen.getByText("No sessions yet")).toBeInTheDocument();
    expect(screen.getByText("Give tomorrow a head start.")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /Talk to Research Agent/i })[0]!);
    expect(onOpenAgent).toHaveBeenCalledWith("agent-1");
    fireEvent.click(screen.getByRole("button", { name: "Schedule the first task" }));
    expect(onOpenScheduled).toHaveBeenCalledWith("agent-1");
  });

  it("does not turn unavailable Domain access into a no-access claim", () => {
    setOverview({
      spaces: [{ workspace, visibility: "unavailable", agentIds: null }],
    });

    renderWithClient(
      <AccountOperationsHome
        sdkAgents={[sdkAgent]}
        agents={[agent]}
        workspaces={[workspace]}
        spaceAccessClient={null}
      />,
    );

    expect(screen.getByLabelText("Known Domain access for Market research")).toHaveTextContent("Domain access unavailable");
    expect(screen.queryByText("No known direct Domain access")).not.toBeInTheDocument();
  });

  it("does not describe a stopped agent as online or its hidden schedule as empty", () => {
    const stoppedSdkAgent = buildSdkAgent({ id: "agent-1", name: "Research Agent", state: "STOPPED" });
    const stoppedAgent = toAgentViewModel(stoppedSdkAgent);
    setOverview({
      agents: {
        "agent-1": {
          agentId: "agent-1",
          dataState: "offline",
          sessions: null,
          cronJobs: null,
          failures: {},
          capturedAt: null,
        },
      },
    });

    renderWithClient(
      <AccountOperationsHome
        sdkAgents={[stoppedSdkAgent]}
        agents={[stoppedAgent]}
        workspaces={[workspace]}
        spaceAccessClient={null}
      />,
    );

    expect(screen.getByText("Some sessions are out of view")).toBeInTheDocument();
    expect(screen.queryByText(/Research Agent is online/i)).not.toBeInTheDocument();
    expect(screen.getByText("Some scheduled work is unavailable")).toBeInTheDocument();
  });
});
