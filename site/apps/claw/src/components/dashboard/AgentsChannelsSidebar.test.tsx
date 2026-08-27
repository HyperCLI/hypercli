import { act, fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const releaseBoundaryMock = vi.hoisted(() => ({
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

import { AgentsChannelsSidebar, AgentsSidebarDashboardLinks } from "./AgentsChannelsSidebar";

beforeEach(() => {
  releaseBoundaryMock.knowledgeHubAvailable = false;
  releaseBoundaryMock.membersAvailable = false;
});

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-color-mode");
});

describe("AgentsChannelsSidebar release-gated surfaces", () => {
  it("shows Knowledge Hub and Members navigation items when the surfaces are available", () => {
    releaseBoundaryMock.knowledgeHubAvailable = true;
    releaseBoundaryMock.membersAvailable = true;
    const onOpenKnowledgeHub = vi.fn();
    const onOpenMembers = vi.fn();
    render(
      <AgentsChannelsSidebar
        variant="v3"
        threads={[]}
        selectedThreadId={null}
        onSelectThread={vi.fn()}
        showChannels={false}
        onOpenKnowledgeHub={onOpenKnowledgeHub}
        onOpenMembers={onOpenMembers}
      />,
    );

    expect(screen.getByRole("button", { name: "Knowledge Hub" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Members" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Knowledge Hub" }));
    fireEvent.click(screen.getByRole("button", { name: "Members" }));
    expect(onOpenKnowledgeHub).toHaveBeenCalledOnce();
    expect(onOpenMembers).toHaveBeenCalledOnce();
  });

  it("keeps Knowledge Hub and Members hidden when only one surface is available", () => {
    releaseBoundaryMock.knowledgeHubAvailable = true;
    releaseBoundaryMock.membersAvailable = false;
    render(
      <AgentsChannelsSidebar
        variant="v3"
        threads={[]}
        selectedThreadId={null}
        onSelectThread={vi.fn()}
        showChannels={false}
      />,
    );

    // Without an onOpen callback the item renders as a link.
    expect(screen.getByRole("link", { name: "Knowledge Hub" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Members" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Members" })).not.toBeInTheDocument();
  });
});

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
    // Release-gated surfaces stay hidden while unavailable.
    expect(screen.queryByRole("button", { name: "Members" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /knowledge hub/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Usage" })).toBeInTheDocument();
    const homeButton = screen.getByRole("button", { name: "Home" });
    expect(homeButton).toHaveClass("gap-1", "pl-1", "pr-2");
    expect(homeButton).not.toHaveClass("border-l-2", "border-l-transparent");
    expect(homeButton.firstElementChild).toHaveClass("w-5");
    expect(screen.queryByRole("button", { name: /Alt Home/i })).not.toBeInTheDocument();
    expect(document.querySelector(".agents-roster-home")).toHaveTextContent("Home");
    expect(document.querySelector(".agents-roster-home")).not.toHaveTextContent("Knowledge Hub");
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
    fireEvent.click(screen.getByRole("button", { name: "Usage" }));
    expect(onOpenHome).toHaveBeenCalledOnce();
    expect(onOpenMembers).not.toHaveBeenCalled();
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

  it("disables launch controls when the selected Collection is read-only", () => {
    const onOpenAgentLauncher = vi.fn();
    render(
      <AgentsChannelsSidebar
        variant="v3"
        threads={[]}
        selectedThreadId={null}
        onSelectThread={vi.fn()}
        showChannels={false}
        onOpenAgentLauncher={onOpenAgentLauncher}
        agentCreationDisabledReason="Collection admin access is required to add agents."
      />,
    );

    const launch = screen.getByRole("button", { name: "Launch agent" });
    expect(launch).toBeDisabled();
    expect(screen.getByText("Collection admin access is required to add agents.")).toBeInTheDocument();
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
    expect(secondary.tagName).toBe("BUTTON");
    fireEvent.click(secondary);
    expect(onSelectThread).toHaveBeenCalledWith("agent-2");
    expect(screen.queryByRole("button", { name: "Delete agent" })).not.toBeInTheDocument();
    expect(onDeleteThread).not.toHaveBeenCalled();
    expect(onSelectThread).toHaveBeenCalledOnce();
    const primary = screen.getByRole("button", { name: "Select Primary Agent" });
    const primaryRow = primary.closest("[data-roster-id]");
    expect(primary).toHaveAttribute("aria-current", "page");
    expect(primaryRow).toHaveClass("items-center", "gap-1", "pl-1", "pr-2", "py-2");
    expect(primaryRow).toHaveClass(
      "transition-[background-color]",
      "duration-200",
      "ease-out",
      "bg-[rgb(var(--selection-accent-rgb)_/_0.1)]",
    );
    const name = primaryRow?.querySelector(".agents-roster-agent-name");
    const status = primaryRow?.querySelector(".agents-roster-agent-status");
    const time = primaryRow?.querySelector(".agents-roster-agent-time");
    const activity = primaryRow?.querySelector(".agents-roster-agent-activity");
    expect(name).toHaveClass("font-semibold");
    expect(status).toHaveTextContent("Connected");
    expect(status).toHaveClass("text-[10px]", "font-normal", "text-text-secondary");
    expect(time).toHaveClass("text-text-secondary");
    expect(time).not.toHaveClass("text-text-muted/75");
    expect(activity).toHaveClass("h-2", "w-2");
    expect(activity?.previousElementSibling).toContainElement(name as HTMLElement | null);
    expect(status?.nextElementSibling).toHaveClass("leading-3", "group-hover/row:opacity-0");
    expect(status?.nextElementSibling).not.toHaveClass("group-hover/row:hidden");
  });

  it.each([
    ["aurora-light", "light"],
    ["aurora-dark", "dark"],
  ] as const)("keeps row actions and editing controls accessible in the %s theme", async (theme, mode) => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.setAttribute("data-color-mode", mode);
    const onSelectThread = vi.fn();
    const { container } = render(
      <AgentsChannelsSidebar
        variant="v3"
        threads={[surfaceActionThread("agent-1", "Buzz Agent")]}
        selectedThreadId={null}
        onSelectThread={onSelectThread}
        onRenameThread={vi.fn()}
        showChannels={false}
        threadSurfaceActions={(thread) => [{
          id: "shell",
          href: `/dashboard/agents?agentId=${thread.id}&tab=shell`,
        }]}
      />,
    );

    const select = screen.getByRole("button", { name: "Select Buzz Agent" });
    const row = select.closest("[data-roster-id]");
    const rename = screen.getByRole("button", { name: "Rename agent" });
    const shell = screen.getByRole("link", { name: "Open Shell" });

    expect(row).toContainElement(select);
    expect(row).toContainElement(rename);
    expect(row).toContainElement(shell);
    expect(select).not.toContainElement(rename);
    expect(select).not.toContainElement(shell);
    expect(select.querySelector("button, a, input, [role='button']")).toBeNull();

    fireEvent.click(rename);

    const editor = screen.getByRole("textbox");
    expect(row).toContainElement(editor);
    expect(select).not.toContainElement(editor);
    expect(onSelectThread).not.toHaveBeenCalled();

    let violations: Awaited<ReturnType<typeof axe>>["violations"] = [];
    await act(async () => {
      const results = await axe(container, {
        runOnly: { type: "rule", values: ["nested-interactive"] },
      });
      violations = results.violations;
    });
    expect(violations).toEqual([]);
  });

  function surfaceActionThread(id: string, name: string) {
    return {
      id,
      sessionKey: "main",
      participants: [{ id, name, type: "agent" as const }],
      kind: "user-agent" as const,
      lastMessage: "Connected",
      lastMessageBy: id,
      lastMessageAt: Date.now(),
      messageCount: 0,
      unreadCount: 0,
      isActive: true,
    };
  }

  it("renders hover surface actions on rows the caller marks as buzz-backed", () => {
    render(
      <AgentsChannelsSidebar
        variant="v3"
        threads={[surfaceActionThread("agent-1", "Buzz Agent"), surfaceActionThread("agent-2", "Plain Agent")]}
        selectedThreadId={null}
        onSelectThread={vi.fn()}
        showChannels={false}
        threadSurfaceActions={(thread) =>
          thread.id === "agent-1"
            ? (["shell", "logs", "activity"] as const).map((tab) => ({
                id: tab,
                href: `/dashboard/agents?agentId=${thread.id}&tab=${tab}`,
              }))
            : undefined
        }
      />,
    );

    const buzzRow = screen.getByRole("button", { name: "Select Buzz Agent" }).closest("[data-roster-id]");
    expect(buzzRow?.querySelector("a[aria-label='Open Shell']")).toBeInTheDocument();
    expect(buzzRow?.querySelector("a[aria-label='Open Logs']")).toBeInTheDocument();
    expect(buzzRow?.querySelector("a[aria-label='Open Activity']")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Shell" })).toHaveTextContent("Shell");
    expect(screen.getByRole("link", { name: "Open Logs" })).toHaveTextContent("Logs");
    expect(screen.getByRole("link", { name: "Open Activity" })).toHaveTextContent("Activity");

    const plainRow = screen.getByRole("button", { name: "Select Plain Agent" }).closest("[data-roster-id]");
    expect(plainRow?.querySelector("a[aria-label='Open Activity']")).not.toBeInTheDocument();
    expect(plainRow?.querySelector("a[aria-label='Open Shell']")).not.toBeInTheDocument();
  });

  it("routes surface actions to their workspace hrefs without triggering row select", () => {
    const onSelectThread = vi.fn();
    render(
      <AgentsChannelsSidebar
        variant="v3"
        threads={[surfaceActionThread("agent-1", "Buzz Agent")]}
        selectedThreadId={null}
        onSelectThread={onSelectThread}
        showChannels={false}
        threadSurfaceActions={(thread) => [
          { id: "shell", href: `/dashboard/agents?agentId=${thread.id}&tab=shell` },
          { id: "logs", href: `/dashboard/agents?agentId=${thread.id}&tab=logs` },
          { id: "activity", href: `/dashboard/agents?agentId=${thread.id}&tab=activity` },
        ]}
      />,
    );

    const activity = screen.getByRole("link", { name: "Open Activity" });
    expect(activity).toHaveAttribute("href", "/dashboard/agents?agentId=agent-1&tab=activity");
    fireEvent.click(activity);
    expect(onSelectThread).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Select Buzz Agent" }));
    expect(onSelectThread).toHaveBeenCalledWith("agent-1");
  });
});
