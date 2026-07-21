import { fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AGENT_ROSTER_ORDER_STORAGE_KEY } from "@/hooks/useAgentRosterOrder";
import { DashboardAgentRail } from "./DashboardAgentRail";

vi.mock("@hypercli/shared-ui", () => ({
  HyperCLILogo: ({ className }: { className?: string }) => <div aria-hidden="true" className={className} />,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  ThemeToggle: () => <button type="button">Theme</button>,
}));

const mocks = vi.hoisted(() => ({
  routerPush: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: mocks.routerPush }),
}));

const agent = {
  id: "agent-1",
  name: "Dev Agent",
  state: "RUNNING" as const,
  meta: null,
};

const stoppedAgent = { ...agent, id: "agent-stopped", name: "Stopped Agent", state: "STOPPED" as const };
const failedAgent = { ...agent, id: "agent-failed", name: "Failed Agent", state: "FAILED" as const };
const startingAgent = { ...agent, id: "agent-starting", name: "Starting Agent", state: "STARTING" as const };

describe("DashboardAgentRail", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.routerPush.mockClear();
  });

  it("renders the collapsed rail and expands on request", () => {
    const onCollapsedChange = vi.fn();
    render(
      <DashboardAgentRail
        accountInitial="j"
        agents={[agent]}
        collapsed
        onCollapsedChange={onCollapsedChange}
      />,
    );

    expect(screen.getByLabelText("Agents")).toHaveClass("bg-surface-low");
    expect(screen.getByRole("link", { name: "Create agent" })).toHaveAttribute("href", "/dashboard/agents?open=agent-launcher");
    expect(screen.getByRole("link", { name: "Open Dev Agent" })).toHaveAttribute("href", "/dashboard/agents?agentId=agent-1");
    expect(screen.getByRole("button", { name: "J" })).toHaveTextContent("J");

    fireEvent.click(screen.getByRole("button", { name: "Expand agents sidebar" }));

    expect(onCollapsedChange).toHaveBeenCalledWith(false);
  });

  it("renders the expanded agent list and collapse action", () => {
    const onCollapsedChange = vi.fn();
    render(
      <DashboardAgentRail
        accountInitial="J"
        agents={[agent]}
        collapsed={false}
        onCollapsedChange={onCollapsedChange}
      />,
    );

    expect(screen.getByRole("link", { name: "HyperCLI home" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Launch agent" })).toBeInTheDocument();
    expect(screen.getByText("My Agents")).toBeInTheDocument();
    expect(screen.queryByText("Available Agents")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Move / })).not.toBeInTheDocument();
    expect(screen.getAllByText("Dev Agent").length).toBeGreaterThan(0);
    expect(screen.getByText("Connected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Launch agent" }));
    expect(mocks.routerPush).toHaveBeenCalledWith("/dashboard/agents?open=agent-launcher");

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });

  it("hides stopped agents until they are enabled from the expanded sidebar", () => {
    function Harness() {
      const [collapsed, setCollapsed] = useState(true);
      return (
        <DashboardAgentRail
          agents={[agent, stoppedAgent, failedAgent, startingAgent]}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
        />
      );
    }

    render(<Harness />);

    expect(screen.queryByRole("link", { name: "Open Stopped Agent" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Failed Agent" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Starting Agent" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand agents sidebar" }));
    expect(screen.queryByText("Stopped Agent")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show offline agents" }));
    expect(screen.getAllByText("Stopped Agent").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.getByRole("link", { name: "Open Stopped Agent" })).toBeInTheDocument();
  });

  it("calls the logout handler from the account menu", () => {
    const onLogout = vi.fn();
    render(
      <DashboardAgentRail
        accountInitial="J"
        agents={[]}
        collapsed
        onCollapsedChange={vi.fn()}
        onLogout={onLogout}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "J" }));
    expect(screen.getByRole("menuitem", { name: "Agents" })).toHaveAttribute("href", "/dashboard/agents");
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

    expect(onLogout).toHaveBeenCalledOnce();
  });

  it("uses the persisted roster order in the collapsed rail", () => {
    window.localStorage.setItem(AGENT_ROSTER_ORDER_STORAGE_KEY, JSON.stringify({
      version: 1,
      agentIds: [failedAgent.id, agent.id],
    }));

    render(
      <DashboardAgentRail
        agents={[agent, failedAgent]}
        collapsed
        onCollapsedChange={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("link", { name: /^Open / }).map((link) => link.getAttribute("aria-label"))).toEqual([
      "Open Failed Agent",
      "Open Dev Agent",
    ]);
  });

  it("reorders agents directly from the collapsed rail", () => {
    render(
      <DashboardAgentRail
        agents={[agent, failedAgent, startingAgent]}
        collapsed
        onCollapsedChange={vi.fn()}
      />,
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "Move Starting Agent" }), { key: "ArrowUp" });

    expect(screen.getAllByRole("link", { name: /^Open / }).map((link) => link.getAttribute("aria-label"))).toEqual([
      "Open Dev Agent",
      "Open Starting Agent",
      "Open Failed Agent",
    ]);
  });
});
