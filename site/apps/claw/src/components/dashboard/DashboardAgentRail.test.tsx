import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardAgentRail } from "./DashboardAgentRail";

vi.mock("@hypercli/shared-ui", () => ({
  HyperCLILogo: ({ className }: { className?: string }) => <div aria-hidden="true" className={className} />,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
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

describe("DashboardAgentRail", () => {
  beforeEach(() => {
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

    expect(screen.getByLabelText("Agents")).toBeInTheDocument();
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
    expect(screen.getAllByText("Dev Agent").length).toBeGreaterThan(0);
    expect(screen.getByText("Connected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Launch agent" }));
    expect(mocks.routerPush).toHaveBeenCalledWith("/dashboard/agents?open=agent-launcher");

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(onCollapsedChange).toHaveBeenCalledWith(true);
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
});
