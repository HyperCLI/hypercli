import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

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
  ThemeToggle: ({ showLabel }: { showLabel?: boolean }) => <button type="button">{showLabel ? "Theme" : ""}</button>,
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
    expect(screen.getByRole("link", { name: /^members$/i })).toHaveAttribute(
      "href",
      "/dashboard/agents?section=members",
    );
  });
});
