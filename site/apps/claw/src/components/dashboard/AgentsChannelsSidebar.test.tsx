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
  it("links the roster account menu to global shared knowledge", () => {
    render(
      <AgentsSidebarDashboardLinks
        accountInitial="J"
        knowledgeActive
        knowledgeHref="/dashboard/agents?section=knowledge&agentId=agent-1&session=session-2"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Account links" }));

    expect(screen.getByRole("menuitem", { name: /shared knowledge/i })).toHaveAttribute(
      "href",
      "/dashboard/agents?section=knowledge&agentId=agent-1&session=session-2",
    );
  });

  it("uses the shared knowledge callback when the roster owns section navigation", () => {
    const onOpenKnowledge = vi.fn();
    render(<AgentsSidebarDashboardLinks accountInitial="J" onOpenKnowledge={onOpenKnowledge} />);

    fireEvent.click(screen.getByRole("button", { name: "Account links" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /shared knowledge/i }));

    expect(onOpenKnowledge).toHaveBeenCalledOnce();
  });

  it("places Home above My Agents and Shared Knowledge under Administration", () => {
    const onOpenHome = vi.fn();
    const onOpenKnowledge = vi.fn();
    render(
      <AgentsChannelsSidebar
        variant="v3"
        threads={[]}
        selectedThreadId={null}
        onSelectThread={vi.fn()}
        showChannels={false}
        onOpenHome={onOpenHome}
        onOpenKnowledge={onOpenKnowledge}
        knowledgeActive
      />,
    );

    const home = screen.getByRole("button", { name: "Home" });
    const myAgents = screen.getByRole("heading", { name: /My Agents/ });
    const sharedKnowledge = screen.getByRole("button", { name: "Shared Knowledge" });
    const administration = screen.getByRole("region", { name: "Administration" });

    expect(home.compareDocumentPosition(myAgents) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(myAgents.compareDocumentPosition(administration) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(administration).toContainElement(sharedKnowledge);
    expect(home.firstElementChild).toHaveClass("w-7");
    expect(myAgents.firstElementChild).toHaveTextContent(/My Agents/);
    expect(administration.firstElementChild).toHaveClass("pl-5", "pr-3");
    expect(screen.queryByRole("button", { name: /My Agents/ })).not.toBeInTheDocument();
    expect(sharedKnowledge.firstElementChild).toHaveClass("w-7");
    expect(sharedKnowledge).toHaveAttribute("aria-current", "page");
    expect(home).not.toHaveAttribute("aria-current");

    fireEvent.click(home);
    fireEvent.click(sharedKnowledge);
    expect(onOpenHome).toHaveBeenCalledOnce();
    expect(onOpenKnowledge).toHaveBeenCalledOnce();
  });
});
