import { render, screen } from "@testing-library/react";
import type { HTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardShell } from "./DashboardShell";

const mocks = vi.hoisted(() => ({
  pathname: "/dashboard",
  push: vi.fn(),
  auth: {
    isLoading: false,
    isAuthenticated: true,
    flowState: "complete",
    error: null,
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/hooks/useAgentAuth", () => ({
  useAgentAuth: () => mocks.auth,
}));

vi.mock("@/components/dashboard/WorkspaceContext", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/dashboard/DashboardNav", () => ({
  DashboardNav: () => <div data-testid="dashboard-nav" />,
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({
      children,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...props
    }: HTMLAttributes<HTMLDivElement> & {
      children: ReactNode;
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
    }) => <div data-testid="motion-route" {...props}>{children}</div>,
  },
}));

describe("DashboardShell", () => {
  beforeEach(() => {
    mocks.pathname = "/dashboard";
    mocks.push.mockClear();
    mocks.auth.isLoading = false;
    mocks.auth.isAuthenticated = true;
    mocks.auth.flowState = "complete";
    mocks.auth.error = null;
  });

  it("keeps a mobile-only account nav for the dashboard overview", () => {
    render(
      <DashboardShell>
        <div>Dashboard overview</div>
      </DashboardShell>,
    );

    expect(screen.getByTestId("dashboard-nav")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-dashboard-nav")).toHaveClass("lg:hidden");
    expect(screen.queryByTestId("motion-route")).not.toBeInTheDocument();
    expect(screen.getByRole("main").parentElement).toHaveClass("fixed", "inset-x-0", "top-0", "overflow-hidden");
    expect(screen.getByRole("main")).toHaveClass("h-dvh", "pt-14", "lg:pt-0");
  });

  it("uses the dashboard overview layout for the trailing-slash dashboard path", () => {
    mocks.pathname = "/dashboard/";

    render(
      <DashboardShell>
        <div>Dashboard overview</div>
      </DashboardShell>,
    );

    expect(screen.getByTestId("dashboard-nav")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-dashboard-nav")).toHaveClass("lg:hidden");
    expect(screen.queryByTestId("motion-route")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveClass("h-dvh", "pt-14", "lg:pt-0");
  });

  it("keeps dashboard agents in the same immersive shell", () => {
    mocks.pathname = "/dashboard/agents";

    render(
      <DashboardShell>
        <div>Agents page</div>
      </DashboardShell>,
    );

    expect(screen.queryByTestId("dashboard-nav")).not.toBeInTheDocument();
    expect(screen.queryByTestId("motion-route")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveClass("h-dvh", "pt-0");
  });

  it("renders the exact agents dashboard for anonymous visitors", () => {
    mocks.pathname = "/dashboard/agents/";
    mocks.auth.isAuthenticated = false;
    mocks.auth.flowState = "idle";

    render(
      <DashboardShell>
        <div>Anonymous agents page</div>
      </DashboardShell>,
    );

    expect(screen.getByText("Anonymous agents page")).toBeInTheDocument();
  });

  it("keeps the public agents dashboard mounted while authentication exchanges", () => {
    mocks.pathname = "/dashboard/agents";
    mocks.auth.isLoading = true;
    mocks.auth.isAuthenticated = false;
    mocks.auth.flowState = "exchanging";

    render(
      <DashboardShell>
        <div>Pending agents setup</div>
      </DashboardShell>,
    );

    expect(screen.getByText("Pending agents setup")).toBeInTheDocument();
  });

  it("does not expose nested agent routes to anonymous visitors", () => {
    mocks.pathname = "/dashboard/agents/agent-1/files";
    mocks.auth.isAuthenticated = false;
    mocks.auth.flowState = "idle";

    render(
      <DashboardShell>
        <div>Private agent files</div>
      </DashboardShell>,
    );

    expect(screen.queryByText("Private agent files")).not.toBeInTheDocument();
  });

  it("keeps settings immersive with a mobile-only account nav", () => {
    mocks.pathname = "/dashboard/settings";

    render(
      <DashboardShell>
        <div>Settings page</div>
      </DashboardShell>,
    );

    expect(screen.getByTestId("dashboard-nav")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-dashboard-nav")).toHaveClass("lg:hidden");
    expect(screen.queryByTestId("motion-route")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveClass("h-dvh", "pt-14", "lg:pt-0");
  });

  it("keeps usage in the same immersive shell", () => {
    mocks.pathname = "/usage";

    render(
      <DashboardShell>
        <div>Usage page</div>
      </DashboardShell>,
    );

    expect(screen.queryByTestId("dashboard-nav")).not.toBeInTheDocument();
    expect(screen.queryByTestId("motion-route")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveClass("h-dvh", "pt-0");
  });

  it("keeps the top nav for non-immersive dashboard pages", () => {
    mocks.pathname = "/dashboard/billing";

    render(
      <DashboardShell>
        <div>Billing page</div>
      </DashboardShell>,
    );

    expect(screen.getByTestId("dashboard-nav")).toBeInTheDocument();
    expect(screen.getByTestId("motion-route")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveClass("h-dvh", "pt-14");
  });
});
