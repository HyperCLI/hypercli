import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { DASHBOARD_RELEASE_AVAILABILITY } from "@/lib/dashboard-release-boundary";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

vi.mock("@/hooks/useAgentAuth", () => ({
  useAgentAuth: () => ({
    logout: vi.fn(),
    user: { email: "jane@example.com" },
  }),
}));

vi.mock("@/components/dashboard/DashboardMobileAgentMenuContext", () => ({
  useDashboardMobileAgentMenu: () => ({ agentMenu: null }),
}));

vi.mock("@/components/HyperCLILogoLink", () => ({
  HyperCLILogoLink: () => <a href="/dashboard">HyperCLI</a>,
}));

vi.mock("@hypercli/shared-ui", () => ({
  ThemeSelector: () => <div>Theme</div>,
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  },
}));

import { DashboardNav } from "./DashboardNav";

describe("DashboardNav", () => {
  it("links the account menu to administration sections", () => {
    render(<DashboardNav />);

    const accountButton = screen.getByText("J").closest("button");
    expect(accountButton).not.toBeNull();
    fireEvent.click(accountButton!);

    expect(screen.getByRole("link", { name: /shared knowledge/i })).toHaveAttribute(
      "href",
      "/dashboard/agents?section=knowledge",
    );
    expect(screen.getByRole("link", { name: /^billing$/i })).toHaveAttribute(
      "href",
      "/dashboard/billing",
    );
    expect(screen.getByRole("link", { name: /api keys/i })).toHaveAttribute("href", "/keys");
    expect(screen.getByRole("link", { name: /^plans$/i })).toHaveAttribute("href", "/plans");
  });

  it("hides release-gated surfaces from the account menu while they are unavailable", () => {
    // The shipped release policy must have both surfaces disabled; if this
    // assertion fails after intentionally re-enabling a surface, update the
    // expectations below to match the new policy.
    expect(DASHBOARD_RELEASE_AVAILABILITY).toEqual({ "knowledge-hub": false, members: false });

    render(<DashboardNav />);

    const accountButton = screen.getByText("J").closest("button");
    expect(accountButton).not.toBeNull();
    fireEvent.click(accountButton!);

    expect(screen.queryByRole("link", { name: /knowledge hub/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^members$/i })).not.toBeInTheDocument();
    // Still-available destinations keep rendering.
    expect(screen.getByRole("link", { name: /shared knowledge/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^billing$/i })).toBeInTheDocument();
  });

  it("hides release-gated surfaces from the mobile navigation menu while they are unavailable", () => {
    expect(DASHBOARD_RELEASE_AVAILABILITY).toEqual({ "knowledge-hub": false, members: false });

    render(<DashboardNav />);

    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));

    expect(screen.queryByRole("link", { name: /knowledge hub/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^members$/i })).not.toBeInTheDocument();
    // Non-gated account links still appear in the mobile menu.
    expect(screen.getByRole("link", { name: /shared knowledge/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /api keys/i })).toBeInTheDocument();
  });
});
