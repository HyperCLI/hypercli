import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DASHBOARD_RELEASE_AVAILABILITY } from "@/lib/dashboard-release-boundary";

const releaseBoundaryMock = vi.hoisted(() => ({
  // Defaults mirror the shipped release policy: both surfaces unavailable.
  knowledgeHubAvailable: false,
  membersAvailable: false,
}));

vi.mock("@/lib/dashboard-release-boundary", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/dashboard-release-boundary")>();
  return {
    ...original,
    isDashboardReleaseSurfaceAvailable: (surface: string) => {
      if (surface === "knowledge-hub") return releaseBoundaryMock.knowledgeHubAvailable;
      if (surface === "members") return releaseBoundaryMock.membersAvailable;
      return original.isDashboardReleaseSurfaceAvailable(surface as never);
    },
  };
});

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
  beforeEach(() => {
    releaseBoundaryMock.knowledgeHubAvailable = false;
    releaseBoundaryMock.membersAvailable = false;
  });

  it("links the account menu to administration sections", () => {
    render(<DashboardNav />);

    const accountButton = screen.getByText("J").closest("button");
    expect(accountButton).not.toBeNull();
    fireEvent.click(accountButton!);

    expect(screen.queryByRole("link", { name: /shared knowledge/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^billing$/i })).toHaveAttribute(
      "href",
      "/dashboard/billing",
    );
    expect(screen.getByRole("link", { name: /api keys/i })).toHaveAttribute("href", "/keys");
    expect(screen.getByRole("link", { name: /^plans$/i })).toHaveAttribute("href", "/plans");
  });

  it("hides release-gated surfaces from the account menu while they are unavailable", () => {
    // The shipped release policy must have all surfaces disabled; if this
    // assertion fails after intentionally re-enabling a surface, update the
    // expectations below to match the new policy.
    expect(DASHBOARD_RELEASE_AVAILABILITY).toEqual({
      "hermes-launcher": false,
      "knowledge-hub": false,
      members: false,
    });

    render(<DashboardNav />);

    const accountButton = screen.getByText("J").closest("button");
    expect(accountButton).not.toBeNull();
    fireEvent.click(accountButton!);

    expect(screen.queryByRole("link", { name: /knowledge hub/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^members$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /shared knowledge/i })).not.toBeInTheDocument();
    // Still-available destinations keep rendering.
    expect(screen.getByRole("link", { name: /^billing$/i })).toBeInTheDocument();
  });

  it("hides release-gated surfaces from the mobile navigation menu while they are unavailable", () => {
    expect(DASHBOARD_RELEASE_AVAILABILITY).toEqual({
      "hermes-launcher": false,
      "knowledge-hub": false,
      members: false,
    });

    render(<DashboardNav />);

    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));

    expect(screen.queryByRole("link", { name: /knowledge hub/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^members$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /shared knowledge/i })).not.toBeInTheDocument();
    // Non-gated account links still appear in the mobile menu.
    expect(screen.getByRole("link", { name: /api keys/i })).toBeInTheDocument();
  });

  it("restores Knowledge Hub and Shared knowledge together when only their surface is available", async () => {
    // Dormant behavior: both Collection surfaces (Knowledge Hub and the
    // Collection-backed Shared knowledge alias) must key off the knowledge-hub
    // availability surface, while Members keys off its own surface. If either
    // item were wired to the wrong surface, only this mixed policy exposes it.
    releaseBoundaryMock.knowledgeHubAvailable = true;
    try {
      vi.resetModules();
      const { DashboardNav: EnabledDashboardNav } = await import("./DashboardNav");

      render(<EnabledDashboardNav />);
      fireEvent.click(screen.getByText("J").closest("button")!);

      expect(screen.getByRole("link", { name: /knowledge hub/i })).toHaveAttribute(
        "href",
        "/dashboard/agents?section=knowledge-hub",
      );
      expect(screen.getByRole("link", { name: /shared knowledge/i })).toHaveAttribute(
        "href",
        "/dashboard/agents?section=knowledge",
      );
      expect(screen.queryByRole("link", { name: /^members$/i })).not.toBeInTheDocument();

      // The mobile menu follows the same per-surface filtering.
      fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
      const knowledgeLinks = screen.getAllByRole("link", { name: /knowledge hub/i });
      const sharedKnowledgeLinks = screen.getAllByRole("link", { name: /shared knowledge/i });
      expect(knowledgeLinks).toHaveLength(2);
      expect(sharedKnowledgeLinks).toHaveLength(2);
      expect(screen.queryByRole("link", { name: /^members$/i })).not.toBeInTheDocument();
    } finally {
      releaseBoundaryMock.knowledgeHubAvailable = false;
      vi.resetModules();
    }
  });
});
