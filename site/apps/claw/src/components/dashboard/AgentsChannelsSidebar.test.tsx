import { fireEvent, render, screen } from "@testing-library/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/agents",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  Reorder: { Group: "div", Item: "div" },
  motion: {
    button: ({ children, initial: _initial, animate: _animate, transition: _transition, whileTap: _whileTap, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
      initial?: unknown;
      animate?: unknown;
      transition?: unknown;
      whileTap?: unknown;
    }) => <button {...props}>{children}</button>,
    div: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    span: "span",
  },
  useDragControls: () => ({ start: vi.fn() }),
}));

vi.mock("@hypercli/shared-ui", () => ({
  HyperCLILogo: ({ className }: { className?: string }) => <div aria-hidden="true" className={className} />,
  Switch: () => null,
  ThemeToggle: () => <button type="button">Theme</button>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { AgentsChannelsSidebar, AgentsSidebarDashboardLinks } from "./AgentsChannelsSidebar";

describe("AgentsSidebarDashboardLinks", () => {
  it("omits navigation already available in the roster", () => {
    render(<AgentsSidebarDashboardLinks accountInitial="J" />);

    fireEvent.click(screen.getByRole("button", { name: "Account links" }));

    expect(screen.queryByRole("menuitem", { name: /dashboard/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^agents$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /shared knowledge/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^members$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^settings$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /api keys/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /plans/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /billing/i })).toBeInTheDocument();
    expect(document.querySelector(".agents-dashboard-links")).toHaveClass("bg-[var(--agent-roster-background)]");
  });

  it("places Home above My Agents and workspace tools under Administration", () => {
    const onOpenHome = vi.fn();
    const onOpenKnowledge = vi.fn();
    const onOpenMembers = vi.fn();
    render(
      <AgentsChannelsSidebar
        variant="v3"
        threads={[]}
        selectedThreadId={null}
        onSelectThread={vi.fn()}
        showChannels={false}
        onOpenHome={onOpenHome}
        onOpenKnowledge={onOpenKnowledge}
        onOpenMembers={onOpenMembers}
        knowledgeActive
      />,
    );

    const home = screen.getByRole("button", { name: "Home" });
    const myAgents = screen.getByRole("heading", { name: /My Agents/ });
    const sharedKnowledge = screen.getByRole("button", { name: "Shared Knowledge" });
    const members = screen.getByRole("button", { name: "Members" });
    const usage = screen.getByRole("link", { name: "Usage" });
    const settings = screen.getByRole("link", { name: "Settings" });
    const administration = screen.getByRole("region", { name: "Administration" });

    expect(home.compareDocumentPosition(myAgents) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(myAgents.compareDocumentPosition(administration) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(administration).toContainElement(sharedKnowledge);
    expect(administration).toContainElement(members);
    expect(administration).toContainElement(usage);
    expect(administration).toContainElement(settings);
    expect(home.firstElementChild).toHaveClass("w-7");
    expect(myAgents.firstElementChild).toHaveTextContent(/My Agents/);
    expect(administration.firstElementChild).toHaveClass("pl-5", "pr-3");
    expect(screen.queryByRole("button", { name: /My Agents/ })).not.toBeInTheDocument();
    expect(sharedKnowledge.firstElementChild).toHaveClass("w-7");
    expect(sharedKnowledge).toHaveAttribute("aria-current", "page");
    expect(usage).toHaveAttribute("href", "/usage");
    expect(settings).toHaveAttribute("href", "/dashboard/settings");
    expect(home).not.toHaveAttribute("aria-current");

    fireEvent.click(home);
    fireEvent.click(sharedKnowledge);
    fireEvent.click(members);
    expect(onOpenHome).toHaveBeenCalledOnce();
    expect(onOpenKnowledge).toHaveBeenCalledOnce();
    expect(onOpenMembers).toHaveBeenCalledOnce();
  });

  it("also omits redundant navigation from the compact account menu", () => {
    render(<AgentsSidebarDashboardLinks compact accountInitial="J" />);

    fireEvent.click(screen.getByRole("button", { name: "Account links" }));
    expect(screen.queryByRole("menuitem", { name: /^Settings$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /api keys/i })).toBeInTheDocument();
  });
});
