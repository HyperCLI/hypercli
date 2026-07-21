import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Agent } from "@/app/dashboard/agents/types";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  sidebarProps: null as Record<string, unknown> | null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("./AgentWorkspaceSidebar", () => ({
  AgentWorkspaceSidebar: (props: Record<string, unknown>) => {
    mocks.sidebarProps = props;
    return (
      <aside aria-label="Workspace navigation">
        <button type="button" onClick={() => (props.onOpenFiles as () => void)()}>Files</button>
        <button type="button" onClick={() => (props.onOpenIntegrations as () => void)()}>Integrations</button>
        <button type="button" onClick={() => (props.onOpenSkills as () => void)()}>Skills</button>
        <button type="button" onClick={() => (props.onOpenOpenClaw as () => void)()}>OpenClaw Settings</button>
        <button type="button" onClick={() => (props.onOpenSettings as () => void)()}>Settings</button>
        <button type="button" onClick={() => (props.onUpgrade as () => void)()}>Upgrade</button>
      </aside>
    );
  },
}));

import { DashboardWorkspaceNavigation } from "./DashboardWorkspaceNavigation";

const agent: Agent = {
  id: "agent-1",
  name: "Research",
  user_id: "user-1",
  pod_id: "pod-1",
  pod_name: "research",
  state: "RUNNING",
  cpu_millicores: 1000,
  memory_mib: 2048,
  hostname: "agent.example.com",
  started_at: "2026-07-20T00:00:00Z",
  stopped_at: null,
  last_error: null,
  created_at: "2026-07-20T00:00:00Z",
  updated_at: "2026-07-20T00:00:00Z",
  gatewayToken: null,
  meta: null,
};

describe("DashboardWorkspaceNavigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sidebarProps = null;
  });

  it("reuses the workspace sidebar without pretending sessions were loaded", () => {
    render(
      <DashboardWorkspaceNavigation
        selectedAgent={agent}
        isDesktopViewport
        workspaceName="Jane"
        workspaceInitial="J"
      />,
    );

    expect(screen.getByRole("complementary", { name: "Workspace navigation" })).toBeInTheDocument();
    expect(mocks.sidebarProps).toMatchObject({
      selectedAgent: agent,
      workspaceName: "Jane",
      workspaceInitial: "J",
      activeTab: "workspace",
      forceExpanded: true,
      sessions: null,
      sessionsFetched: false,
      sessionsUnavailableReason: "Open the agent workspace to load sessions.",
      selectedSessionKey: "main",
      showDesktop: false,
    });
  });

  it("deep-links workspace actions to the authoritative agent route", () => {
    render(
      <DashboardWorkspaceNavigation
        selectedAgent={agent}
        isDesktopViewport
        workspaceName="Jane"
        workspaceInitial="J"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    fireEvent.click(screen.getByRole("button", { name: "Integrations" }));
    fireEvent.click(screen.getByRole("button", { name: "Skills" }));
    fireEvent.click(screen.getByRole("button", { name: "OpenClaw Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));

    expect(mocks.push.mock.calls.map(([href]) => href)).toEqual([
      "/dashboard/agents?agentId=agent-1&tab=files",
      "/dashboard/agents?agentId=agent-1&tab=integrations",
      "/dashboard/agents?agentId=agent-1&tab=skills",
      "/dashboard/agents?agentId=agent-1&tab=openclaw",
      "/dashboard/agents?agentId=agent-1&tab=settings",
      "/plans",
    ]);
  });

  it("does not navigate agent actions before an agent is available", () => {
    render(
      <DashboardWorkspaceNavigation
        selectedAgent={null}
        isDesktopViewport
        workspaceName="Personal workspace"
        workspaceInitial="P"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.sidebarProps).toMatchObject({ selectedAgent: null, selectedSessionKey: null });
  });
});
