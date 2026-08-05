import { fireEvent, render, screen } from "@testing-library/react";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/agents",
  useRouter: () => ({ push: vi.fn() }),
}));

const agentCatalogMocks = vi.hoisted(() => ({
  getToken: vi.fn().mockResolvedValue("test-token"),
  agentTypes: vi.fn().mockResolvedValue({
    types: [{ id: "test-size", name: "Test Size", cpu: 0.25, memory: 0.5 }],
    plans: [],
  }),
}));

vi.mock("@/hooks/useAgentAuth", () => ({
  useAgentAuth: () => ({ getToken: agentCatalogMocks.getToken }),
}));

vi.mock("@/lib/agent-client", () => ({
  createHyperAgentClient: () => ({ agentTypes: agentCatalogMocks.agentTypes }),
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
    div: ({ children, initial: _initial, animate: _animate, exit: _exit, transition: _transition, whileDrag: _whileDrag, layoutScroll: _layoutScroll, ...props }: HTMLAttributes<HTMLDivElement> & {
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
      whileDrag?: unknown;
      layoutScroll?: unknown;
    }) => <div {...props}>{children}</div>,
    span: "span",
  },
  useDragControls: () => ({ start: vi.fn() }),
}));

vi.mock("@hypercli/shared-ui", () => ({
  HyperCLILogo: ({ className }: { className?: string }) => <div aria-hidden="true" className={className} />,
  Switch: () => null,
  ThemeSelector: () => <div>Theme</div>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { AgentsChannelsSidebar, AgentsSidebarDashboardLinks } from "./AgentsChannelsSidebar";

describe("AgentsSidebarDashboardLinks", () => {
  it("uses the persisted profile avatar instead of the account initial", () => {
    const avatarUrl = "https://cdn.example.test/profile.png";
    render(
      <AgentsSidebarDashboardLinks
        accountInitial="J"
        accountAvatarUrl={avatarUrl}
        accountName="Jane Doe"
        accountEmail="jane@example.com"
      />,
    );

    const accountButton = screen.getByRole("button", { name: "Account links" });
    expect(accountButton.querySelector("img")).toHaveAttribute("src", avatarUrl);
    expect(accountButton).toHaveTextContent("Jane Doe");
    expect(accountButton).toHaveTextContent("jane@example.com");
  });

  it("omits navigation already available in the roster", () => {
    render(<AgentsSidebarDashboardLinks accountInitial="J" />);

    fireEvent.click(screen.getByRole("button", { name: "Account links" }));

    expect(screen.queryByRole("menuitem", { name: /dashboard/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^agents$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^shared$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^members$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /^settings$/i })).toHaveAttribute("href", "/dashboard/agents?view=settings");
    const apiKeys = screen.getByRole("menuitem", { name: /api keys/i });
    expect(apiKeys).toHaveAttribute(
      "href",
      "/dashboard/agents?view=settings&settings=api-keys",
    );
    expect(screen.getByRole("menuitem", { name: /plans/i })).toHaveAttribute(
      "href",
      "/dashboard/agents?view=settings&settings=plans",
    );
    expect(screen.getByRole("menuitem", { name: /billing/i })).toHaveAttribute(
      "href",
      "/dashboard/agents?view=settings&settings=billing",
    );
    const documentation = screen.getByRole("menuitem", { name: /documentation/i });
    expect(documentation).toHaveAttribute("href", "https://docs.hypercli.com/");
    expect(documentation).toHaveAttribute("target", "_blank");
    expect(documentation).toHaveAttribute("rel", "noopener noreferrer");
    expect(apiKeys.querySelector("svg")).toBeNull();
    expect(screen.getByRole("menuitem", { name: /^settings$/i }).querySelector("svg")).toBeNull();
    expect(documentation.querySelector("svg")).toBeNull();
    expect(document.querySelector(".agents-dashboard-links")).toHaveClass("bg-[var(--agent-roster-background)]");
  });

  it("prioritizes primary navigation and omits the legacy Shared item", () => {
    const onOpenAccountSettings = vi.fn();
    const onOpenHome = vi.fn();
    const onOpenMembers = vi.fn();
    const onOpenUsage = vi.fn();
    render(
      <AgentsChannelsSidebar
        variant="v3"
        threads={[]}
        selectedThreadId={null}
        onSelectThread={vi.fn()}
        showChannels={false}
        onOpenHome={onOpenHome}
        onOpenMembers={onOpenMembers}
        onOpenUsage={onOpenUsage}
        onOpenAccountSettings={onOpenAccountSettings}
        accountSettingsActive
      />,
    );

    const rosterScroll = document.querySelector(".agents-roster-scroll");
    const rosterActions = document.querySelector(".agents-roster-actions");
    const home = document.querySelector(".agents-roster-home");
    const sectionHeader = document.querySelector(".agents-roster-section-header");
    const agentList = document.querySelector(".agents-roster-agent-list");

    expect(rosterScroll).toHaveClass("flex-col", "overflow-hidden");
    expect(agentList).toHaveClass("shrink", "overflow-y-auto");
    const administration = screen.getByRole("region", { name: "Administration" });
    expect(administration).toHaveTextContent("Administration");
    expect(screen.queryByText("Shared")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Members" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Usage" })).toBeInTheDocument();
    const homeButton = screen.getByRole("button", { name: "Home" });
    expect(homeButton).toHaveClass("gap-1", "pl-1", "pr-2");
    expect(homeButton).not.toHaveClass("border-l-2", "border-l-transparent");
    expect(homeButton.firstElementChild).toHaveClass("w-5");
    expect(screen.queryByRole("button", { name: /Alt Home/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /knowledge hub/i })).toHaveAttribute("href", "/dashboard/agents?section=knowledge-hub");
    expect(document.querySelector(".agents-roster-home")).toHaveTextContent("HomeKnowledge Hub");
    expect(screen.queryByText("Preview")).not.toBeInTheDocument();
    expect(rosterActions?.nextElementSibling).toBe(home);
    expect(home?.nextElementSibling).toBe(sectionHeader);
    expect(agentList?.nextElementSibling).toBe(administration);
    expect(administration.firstElementChild).toHaveClass("pl-1.5", "pr-2");
    expect(administration.firstElementChild?.children).toHaveLength(1);
    expect(administration).not.toHaveTextContent("Home");
    expect(administration).not.toHaveTextContent("Settings");
    expect(onOpenAccountSettings).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    fireEvent.click(screen.getByRole("button", { name: "Members" }));
    fireEvent.click(screen.getByRole("button", { name: "Usage" }));
    expect(onOpenHome).toHaveBeenCalledOnce();
    expect(onOpenMembers).toHaveBeenCalledOnce();
    expect(onOpenUsage).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Account links" }));
    const settings = screen.getByRole("menuitem", { name: "Settings" });
    expect(settings).toHaveAttribute("aria-current", "page");
    fireEvent.click(settings);
    expect(onOpenAccountSettings).toHaveBeenCalledOnce();
  });

  it("also omits redundant navigation from the compact account menu", () => {
    render(<AgentsSidebarDashboardLinks compact accountInitial="J" />);

    fireEvent.click(screen.getByRole("button", { name: "Account links" }));
    expect(screen.getByRole("menuitem", { name: /^Settings$/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /api keys/i })).toBeInTheDocument();
  });
});

describe("AgentsChannelsSidebar", () => {
  it("renders the agent profile image in roster rows", () => {
    render(
      <AgentsChannelsSidebar
        variant="v3"
        threads={[{
          id: "agent-1",
          sessionKey: "main",
          participants: [{
            id: "agent-1",
            name: "Primary Agent",
            type: "agent",
            avatarUrl: "https://cdn.example.test/agent.png",
            meta: { ui: { avatar: { image: "https://cdn.example.test/meta.png" } } },
          }],
          kind: "user-agent",
          lastMessage: "Connected",
          lastMessageBy: "agent-1",
          lastMessageAt: 1,
          messageCount: 0,
          unreadCount: 0,
          isActive: true,
        }]}
        selectedThreadId="agent-1"
        onSelectThread={vi.fn()}
        showChannels={false}
      />,
    );

    const avatar = screen.getByAltText("Primary Agent avatar");
    expect(avatar).toHaveAttribute(
      "src",
      "https://cdn.example.test/agent.png",
    );
    expect(avatar.closest(".agents-roster-agent-avatar")).toHaveStyle({ width: "20px", height: "20px" });
  });

  it("disables launch controls when the selected Workspace is read-only", () => {
    const onOpenAgentLauncher = vi.fn();
    render(
      <AgentsChannelsSidebar
        variant="v3"
        threads={[]}
        selectedThreadId={null}
        onSelectThread={vi.fn()}
        showChannels={false}
        onOpenAgentLauncher={onOpenAgentLauncher}
        agentCreationDisabledReason="Domain admin access is required to add agents."
      />,
    );

    const launch = screen.getByRole("button", { name: "Launch agent" });
    expect(launch).toBeDisabled();
    expect(screen.getByText("Domain admin access is required to add agents.")).toBeInTheDocument();
    fireEvent.click(launch);
    expect(onOpenAgentLauncher).not.toHaveBeenCalled();
  });

  it("exposes agent rows as selectable buttons without delete actions", () => {
    const onSelectThread = vi.fn();
    const onDeleteThread = vi.fn();
    render(
      <AgentsChannelsSidebar
        variant="v3"
        threads={[
          {
            id: "agent-1",
            sessionKey: "main",
            participants: [{ id: "agent-1", name: "Primary Agent", type: "agent" }],
            kind: "user-agent",
            lastMessage: "Connected",
            lastMessageBy: "agent-1",
            lastMessageAt: Date.now(),
            messageCount: 0,
            unreadCount: 0,
            isActive: true,
          },
          {
            id: "agent-2",
            sessionKey: "main",
            participants: [{ id: "agent-2", name: "Secondary Agent", type: "agent" }],
            kind: "user-agent",
            lastMessage: "Connected",
            lastMessageBy: "agent-2",
            lastMessageAt: Date.now(),
            messageCount: 0,
            unreadCount: 0,
            isActive: true,
          },
        ]}
        selectedThreadId="agent-1"
        onSelectThread={onSelectThread}
        onDeleteThread={onDeleteThread}
        showChannels={false}
      />,
    );

    const secondary = screen.getByRole("button", { name: "Select Secondary Agent" });
    fireEvent.click(secondary);
    expect(onSelectThread).toHaveBeenCalledWith("agent-2");
    fireEvent.keyDown(secondary, { key: "Enter" });
    expect(onSelectThread).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Delete agent" })).not.toBeInTheDocument();
    expect(onDeleteThread).not.toHaveBeenCalled();
    expect(onSelectThread).toHaveBeenCalledTimes(2);
    const primary = screen.getByRole("button", { name: "Select Primary Agent" });
    expect(primary).toHaveAttribute("aria-current", "page");
    expect(primary).toHaveClass("items-center", "gap-1", "pl-1", "pr-2", "py-2");
    const name = primary.querySelector(".agents-roster-agent-name");
    const status = primary.querySelector(".agents-roster-agent-status");
    const activity = primary.querySelector(".agents-roster-agent-activity");
    expect(name).toHaveClass("font-semibold");
    expect(status).toHaveTextContent("Connected");
    expect(status).toHaveClass("text-[10px]", "font-normal", "text-text-muted");
    expect(activity).toHaveClass("h-2", "w-2");
    expect(activity?.previousElementSibling).toContainElement(name);
    expect(status?.nextElementSibling).toHaveClass("leading-3", "group-hover/row:opacity-0");
    expect(status?.nextElementSibling).not.toHaveClass("group-hover/row:hidden");
  });
});
