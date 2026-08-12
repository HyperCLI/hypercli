import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState, type ComponentProps, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Agent } from "@/app/dashboard/agents/types";
import { renderWithClient } from "@/test/utils";
import { AgentWorkspaceSidebar, CollectionCreationDialog } from "./AgentWorkspaceSidebar";

type SidebarSession = NonNullable<ComponentProps<typeof AgentWorkspaceSidebar>["sessions"]>[number];

const mocks = vi.hoisted(() => {
  const marketingWorkspace = {
    id: "workspace-marketing",
    name: "Marketing",
    slug: "marketing",
    description: null,
    displayName: null,
    displaySlug: null,
    role: "admin",
    createdAt: null,
    updatedAt: null,
  };
  const productWorkspace = {
    ...marketingWorkspace,
    id: "workspace-product",
    name: "Product",
    slug: "product",
    role: "contributor",
  };
  const workspacesClient = {
    grant: vi.fn(),
  };
  return {
    marketingWorkspace,
    productWorkspace,
    workspacesClient,
    preloadShell: vi.fn(),
    workspaceContext: {
      principalId: "user-1" as string | null,
      workspacesClient: workspacesClient as typeof workspacesClient | null,
      workspaces: [marketingWorkspace, productWorkspace],
      selectedWorkspace: marketingWorkspace as typeof marketingWorkspace | null,
      selectedWorkspaceId: marketingWorkspace.id as string | null,
      isLoading: false,
      error: null as string | null,
      selectWorkspace: vi.fn(),
      createWorkspace: vi.fn(),
      refreshWorkspaces: vi.fn(),
    },
  };
});

vi.mock("@/components/dashboard/WorkspaceContext", () => ({
  useWorkspace: () => mocks.workspaceContext,
  workspaceDisplayName: (workspace: { displayName?: string | null; name: string }) => workspace.displayName?.trim() || workspace.name,
}));

vi.mock("@/lib/agent-shell-terminal-loader", () => ({
  preloadAgentShellTerminalRuntime: mocks.preloadShell,
}));

vi.mock("@hypercli/shared-ui", () => ({
  Alert: ({ children }: { children: ReactNode }) => <div role="alert">{children}</div>,
  AlertDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({ children, ...props }: ComponentProps<"button">) => <button {...props}>{children}</button>,
  Dialog: ({ children, open }: { children: ReactNode; open?: boolean }) => open ? <>{children}</> : null,
  DialogContent: ({ children, "data-testid": testId }: { children: ReactNode; "data-testid"?: string }) => <div role="dialog" aria-label="New Collection" data-testid={testId}>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div role="menu">{children}</div>,
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({ children, disabled, onSelect }: {
    children: ReactNode;
    disabled?: boolean;
    onSelect?: (event: { preventDefault: () => void }) => void;
  }) => (
    <button type="button" role="menuitem" disabled={disabled} onClick={() => onSelect?.({ preventDefault: () => undefined })}>
      {children}
    </button>
  ),
  Input: (props: ComponentProps<"input">) => <input {...props} />,
  Label: ({ children, ...props }: ComponentProps<"label">) => <label {...props}>{children}</label>,
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children, ...props }: ComponentProps<"button">) => <button type="button" {...props}>{children}</button>,
  SelectValue: () => <span>Member</span>,
  Tabs: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  Textarea: (props: ComponentProps<"textarea">) => <textarea {...props} />,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/HyperCLILogoLink", () => ({
  HyperCLILogoLink: ({ className }: { className?: string }) => (
    <div data-testid="hypercli-logo-full" className={className}>HyperCLI</div>
  ),
}));

const agent: Agent = {
  id: "agent-1",
  name: "Test Agent",
  user_id: "user-1",
  state: "RUNNING",
  cpu_millicores: 4000,
  memory_mib: 4096,
  hostname: "agent.example.com",
  started_at: "2026-05-05T00:00:00Z",
  stopped_at: null,
  created_at: "2026-05-05T00:00:00Z",
  updated_at: "2026-05-05T00:00:00Z",
  launchEpoch: 0,
  meta: null,
};

function agentWorkspaceSidebarProps(overrides: Partial<ComponentProps<typeof AgentWorkspaceSidebar>> = {}) {
  return {
    selectedAgent: agent,
    activeTab: "chat",
    isDesktopViewport: true,
    onCreateSession: vi.fn(async () => undefined),
    onOpenFiles: vi.fn(),
    onOpenIntegrations: vi.fn(),
    onOpenSkills: vi.fn(),
    onOpenScheduled: vi.fn(),
    onOpenDesktop: vi.fn(),
    onOpenDesktopPreview: vi.fn(),
    onOpenLogs: vi.fn(),
    onOpenShell: vi.fn(),
    onOpenOpenClaw: vi.fn(),
    onOpenSettings: vi.fn(),
    onUpgrade: vi.fn(),
    ...overrides,
  } satisfies ComponentProps<typeof AgentWorkspaceSidebar>;
}

function renderAgentWorkspaceSidebar(overrides: Partial<ComponentProps<typeof AgentWorkspaceSidebar>> = {}) {
  const props = agentWorkspaceSidebarProps(overrides);

  renderWithClient(<AgentWorkspaceSidebar {...props} />);
  return props;
}

function renderCollectionCreationDialog() {
  renderWithClient(<CollectionCreationDialog open onOpenChange={vi.fn()} />);
}

function expectSessionBefore(firstName: string, secondName: string): void {
  const first = screen.getByRole("button", { name: firstName, exact: true });
  const second = screen.getByRole("button", { name: secondName, exact: true });
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
}

describe("AgentWorkspaceSidebar", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.workspaceContext.workspacesClient = mocks.workspacesClient;
    mocks.workspaceContext.principalId = "user-1";
    mocks.workspaceContext.workspaces = [mocks.marketingWorkspace, mocks.productWorkspace];
    mocks.workspaceContext.selectedWorkspace = mocks.marketingWorkspace;
    mocks.workspaceContext.selectedWorkspaceId = mocks.marketingWorkspace.id;
    mocks.workspaceContext.isLoading = false;
    mocks.workspaceContext.error = null;
    mocks.workspaceContext.selectWorkspace.mockReset();
    mocks.workspaceContext.createWorkspace.mockReset().mockResolvedValue(mocks.productWorkspace);
    mocks.workspacesClient.grant.mockReset().mockResolvedValue({ id: "grant-1" });
    mocks.preloadShell.mockReset();
  });

  it("uses the full HyperCLI logo instead of a Collection picker", () => {
    renderAgentWorkspaceSidebar();

    expect(screen.getByTestId("hypercli-logo-full")).toHaveTextContent("HyperCLI");
    expect(screen.queryByRole("button", { name: /current collection/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Collections")).not.toBeInTheDocument();
  });

  it("creates a Collection from the creation dialog", async () => {
    renderCollectionCreationDialog();

    const dialog = screen.getByTestId("collection-creation-dialog");
    expect(dialog).toHaveAccessibleName("New Collection");
    fireEvent.change(within(dialog).getByTestId("collection-name-input"), { target: { value: "Support" } });
    fireEvent.change(within(dialog).getByLabelText(/Description/), { target: { value: "Support playbooks" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    fireEvent.click(within(dialog).getByTestId("collection-create-submit"));

    await waitFor(() => expect(mocks.workspaceContext.createWorkspace).toHaveBeenCalledWith({
      name: "Support",
      description: "Support playbooks",
    }));
  });

  it("collects email invites and grants direct access by user UUID", async () => {
    renderCollectionCreationDialog();

    const dialog = screen.getByTestId("collection-creation-dialog");
    fireEvent.change(within(dialog).getByTestId("collection-name-input"), { target: { value: "Support" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    fireEvent.change(within(dialog).getByLabelText("Email addresses"), {
      target: { value: "lucy@example.com, andrew@example.com," },
    });
    fireEvent.change(within(dialog).getByLabelText("User UUID"), {
      target: { value: "9dbb6364-9a44-46d7-8de3-c71fd1e01234" },
    });

    expect(within(dialog).getByText("lucy@example.com")).toBeInTheDocument();
    expect(within(dialog).getByText("andrew@example.com")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByTestId("collection-create-submit"));

    await waitFor(() => expect(mocks.workspacesClient.grant).toHaveBeenCalledWith(
      "workspace-product",
      {
        subjectType: "user",
        subjectId: "9dbb6364-9a44-46d7-8de3-c71fd1e01234",
        role: "contributor",
      },
    ));
  });

  it("retries a failed UUID grant without creating a second Collection", async () => {
    mocks.workspacesClient.grant
      .mockRejectedValueOnce(new Error("User UUID was not found."))
      .mockResolvedValueOnce({ id: "grant-1" });
    renderCollectionCreationDialog();

    const dialog = screen.getByTestId("collection-creation-dialog");
    fireEvent.change(within(dialog).getByTestId("collection-name-input"), { target: { value: "Support" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    fireEvent.change(within(dialog).getByLabelText("User UUID"), { target: { value: "user-2" } });
    fireEvent.click(within(dialog).getByTestId("collection-create-submit"));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("User UUID was not found.");
    fireEvent.click(within(dialog).getByTestId("collection-create-submit"));

    await waitFor(() => expect(mocks.workspacesClient.grant).toHaveBeenCalledTimes(2));
    expect(mocks.workspaceContext.createWorkspace).toHaveBeenCalledTimes(1);
  });

  it("forces the desktop workspace sidebar expanded without a collapse control", () => {
    window.localStorage.setItem("agents.workspaceCollapsed.v2", "1");
    renderAgentWorkspaceSidebar({ forceExpanded: true });

    expect(document.querySelector(".agent-workspace-shell")).toHaveAttribute("data-collapsed", "false");
    expect(screen.queryByRole("button", { name: /workspace sidebar/i })).not.toBeInTheDocument();
  });

  it("reports controlled collapse changes without using its independent stored state", () => {
    window.localStorage.setItem("agents.workspaceCollapsed.v2", "0");
    const onCollapsedChange = vi.fn();
    renderAgentWorkspaceSidebar({ collapsed: true, onCollapsedChange });

    const shell = document.querySelector(".agent-workspace-shell");
    expect(shell).toHaveAttribute("data-collapsed", "true");
    expect(shell).toHaveClass("w-12");
    expect(screen.queryByTestId("hypercli-logo-full")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand workspace sidebar" }));
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
  });

  it("expands the collapsed workspace sidebar when an option is selected", () => {
    const onCollapsedChange = vi.fn();
    const props = renderAgentWorkspaceSidebar({ collapsed: true, onCollapsedChange });

    fireEvent.click(screen.getByRole("button", { name: "Files" }));

    expect(onCollapsedChange).toHaveBeenCalledWith(false);
    expect(props.onOpenFiles).toHaveBeenCalledTimes(1);
  });

  it("expands the collapsed workspace sidebar before rendering the Advanced menu", () => {
    const props = agentWorkspaceSidebarProps();
    function Harness() {
      const [collapsed, setCollapsed] = useState(true);
      return <AgentWorkspaceSidebar {...props} collapsed={collapsed} onCollapsedChange={setCollapsed} />;
    }
    renderWithClient(<Harness />);

    expect(document.querySelector(".agent-workspace-shell")).toHaveAttribute("data-collapsed", "true");
    expect(document.querySelector(".agent-workspace-advanced [role='menu']")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));

    expect(document.querySelector(".agent-workspace-shell")).toHaveAttribute("data-collapsed", "false");
    const advancedMenu = document.querySelector<HTMLElement>(".agent-workspace-advanced [role='menu']");
    expect(advancedMenu).toHaveClass("bottom-full", "left-3", "right-3");
    fireEvent.click(within(advancedMenu!).getByRole("menuitem", { name: "Agent Settings" }));
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    const reopenedMenu = document.querySelector<HTMLElement>(".agent-workspace-advanced [role='menu']");
    fireEvent.click(within(reopenedMenu!).getByRole("menuitem", { name: "OpenClaw Settings" }));
    expect(props.onOpenOpenClaw).toHaveBeenCalledTimes(1);
  });

  it("matches the active state for Agent Settings", () => {
    renderAgentWorkspaceSidebar({ settingsActive: true });

    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));

    expect(screen.getByRole("menuitem", { name: "Agent Settings" })).toHaveClass("bg-surface-low", "text-foreground");
    expect(screen.getByRole("menuitem", { name: "OpenClaw Settings" })).not.toHaveClass("bg-surface-low");
  });

  it("keeps the shared header visible while only the navigation body is collapsed", () => {
    renderAgentWorkspaceSidebar({ collapsed: true, embeddedInNavigation: true });

    expect(screen.getByTestId("hypercli-logo-full")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /current workspace/i })).not.toBeInTheDocument();
    expect(document.querySelector(".agent-desktop-navigation-header")).toHaveClass("w-64", "-top-16", "-left-52", "justify-start", "pl-4");
    expect(screen.getByTestId("hypercli-logo-full")).toHaveClass("h-[24px]", "w-[124px]");
    expect(document.querySelector(".agent-workspace-shell")).not.toHaveClass("border-r");
    expect(screen.queryByRole("button", { name: /workspace sidebar/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Setup")).not.toBeInTheDocument();
  });

  it("keeps the expanded embedded workspace body title-free", () => {
    renderAgentWorkspaceSidebar({ collapsed: false, embeddedInNavigation: true });

    expect(screen.queryByText("Setup")).not.toBeInTheDocument();
    expect(document.querySelector(".agent-desktop-navigation-header")).toHaveClass("w-64", "-top-16", "-left-12");
    expect(screen.getByRole("button", { name: "Files" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /workspace sidebar/i })).not.toBeInTheDocument();
  });

  it("respects controlled collapse and exposes a close action in embedded mobile navigation", () => {
    const onClose = vi.fn();
    renderAgentWorkspaceSidebar({
      isDesktopViewport: false,
      renderMobile: true,
      collapsed: false,
      embeddedInNavigation: true,
      onClose,
    });

    expect(document.querySelector(".agent-workspace-shell")).toHaveAttribute("data-collapsed", "false");
    const closeButton = screen.getByRole("button", { name: "Close navigation" });
    expect(closeButton).toHaveClass("absolute", "right-2");
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not render shared knowledge in the agent workspace list", () => {
    renderAgentWorkspaceSidebar();

    expect(screen.queryByRole("button", { name: /shared knowledge/i })).not.toBeInTheDocument();
  });

  it("opens the Desktop page for the selected agent", () => {
    const props = renderAgentWorkspaceSidebar();

    fireEvent.click(screen.getByRole("button", { name: "Desktop" }));
    expect(props.onOpenDesktop).toHaveBeenCalledWith(expect.objectContaining({ id: "agent-1" }));
    expect(props.onUpgrade).not.toHaveBeenCalled();
  });

  it("opens the Desktop page when Desktop is not enabled", () => {
    const props = renderAgentWorkspaceSidebar({
      selectedAgent: { ...agent, hasDesktop: false },
    });

    fireEvent.click(screen.getByRole("button", { name: "Desktop" }));
    expect(props.onOpenDesktop).toHaveBeenCalledWith(expect.objectContaining({ id: "agent-1" }));
    expect(props.onUpgrade).not.toHaveBeenCalled();
  });

  it("marks the Desktop page as active", () => {
    renderAgentWorkspaceSidebar({ activeTab: "desktop" });

    expect(screen.getByRole("button", { name: "Desktop" })).toHaveAttribute("aria-current", "page");
  });

  it("warms the Shell runtime only from Shell-specific navigation intent", () => {
    const onShellIntent = vi.fn();
    const onShellIntentEnd = vi.fn();
    const props = renderAgentWorkspaceSidebar({ onShellIntent, onShellIntentEnd });
    const advanced = screen.getByRole("button", { name: "Advanced" });

    fireEvent.pointerEnter(advanced);
    expect(mocks.preloadShell).not.toHaveBeenCalled();
    expect(onShellIntent).not.toHaveBeenCalled();
    fireEvent.click(advanced);
    fireEvent.pointerLeave(document.querySelector(".agent-workspace-advanced")!);
    expect(onShellIntentEnd).not.toHaveBeenCalled();

    const shell = screen.getByRole("menuitem", { name: "Shell" });
    fireEvent.pointerEnter(shell);
    expect(mocks.preloadShell).not.toHaveBeenCalled();
    expect(onShellIntent).toHaveBeenCalledTimes(1);
    fireEvent.click(shell);

    expect(props.onOpenShell).toHaveBeenCalledTimes(1);
    expect(onShellIntent).toHaveBeenCalledTimes(1);

    fireEvent.pointerLeave(document.querySelector(".agent-workspace-advanced")!);
    expect(onShellIntentEnd).toHaveBeenCalledTimes(1);
  });

  it("creates a session from the primary workspace action and highlights the selected session", async () => {
    const onCreateSession = vi.fn(async () => {
      selectedSessionKey = "session-new";
      sessions = [{
        key: "session-new",
        clientMode: "openclaw",
        clientDisplayName: "New Session",
        createdAt: 2,
        lastMessageAt: 30,
        title: "New Session",
        messageCount: 0,
        raw: {},
      }, ...sessions];
    });
    let selectedSessionKey = "main";
    let sessions = [{
      key: "main",
      clientMode: "openclaw",
      clientDisplayName: "Main Session",
      createdAt: 1,
      lastMessageAt: 20,
      title: "Main Session",
      messageCount: 0,
      raw: {},
    }];
    const renderSidebar = () => (
      <AgentWorkspaceSidebar
        selectedAgent={agent}
        activeTab="chat"
        isDesktopViewport
        sessions={sessions}
        sessionsFetched
        selectedSessionKey={selectedSessionKey}
        onCreateSession={onCreateSession}
        onOpenFiles={vi.fn()}
        onOpenIntegrations={vi.fn()}
        onOpenSkills={vi.fn()}
        onOpenScheduled={vi.fn()}
        onOpenDesktop={vi.fn()}
        onOpenLogs={vi.fn()}
        onOpenShell={vi.fn()}
        onOpenOpenClaw={vi.fn()}
        onOpenSettings={vi.fn()}
        onUpgrade={vi.fn()}
      />
    );
    const view = renderWithClient(renderSidebar());

    fireEvent.click(screen.getByRole("button", { name: /new session/i }));
    await waitFor(() => expect(onCreateSession).toHaveBeenCalledTimes(1));
    view.rerender(renderSidebar());

    const activeProject = screen.getAllByRole("button", { name: "New Session" })
      .find((button) => button.getAttribute("aria-current") === "page");
    expect(activeProject).toBeInTheDocument();
  });

  it("uses a wait cursor while a new session is being created", async () => {
    let finishCreating!: () => void;
    const onCreateSession = vi.fn(() => new Promise<void>((resolve) => {
      finishCreating = resolve;
    }));
    renderAgentWorkspaceSidebar({ onCreateSession, sessionsFetched: true });

    fireEvent.click(screen.getByRole("button", { name: "New Session" }));

    const creatingButton = await screen.findByRole("button", { name: "Creating Session" });
    expect(creatingButton).toBeDisabled();
    expect(creatingButton).toHaveClass("cursor-wait");

    finishCreating();
    await waitFor(() => expect(screen.getByRole("button", { name: "New Session" })).toBeEnabled());
  });

  it("renders sessions and opens the selected session by display name", () => {
    const onSelectSession = vi.fn();
    renderAgentWorkspaceSidebar({
      sessions: [
        {
          key: "session-old",
          clientMode: "browser",
          clientDisplayName: "Old chat",
          createdAt: 1,
          lastMessageAt: 10,
          title: "Old chat",
          messageCount: 1,
          raw: {},
        },
        {
          key: "session-new",
          clientMode: "browser",
          clientDisplayName: "New chat",
          createdAt: 1,
          lastMessageAt: 20,
          title: "",
          messageCount: 1,
          raw: {},
        },
      ],
      selectedSessionKey: "session-new",
      onSelectSession,
    });

    expect(screen.getByText("Sessions")).toBeInTheDocument();
    const selectedSession = screen.getByRole("button", { name: "New chat" });
    const selectedSessionRow = selectedSession.closest("[data-session-pinned]");
    expect(selectedSession).toHaveClass("px-2");
    expect(selectedSessionRow?.querySelector("[data-session-options]")).toHaveClass("absolute", "right-0");
    fireEvent.click(selectedSession);
    expect(onSelectSession).toHaveBeenCalledWith("session-new");
  });

  it("pins an older session ahead of newer unpinned sessions", async () => {
    const onSetSessionPinned = vi.fn();
    const sessions: SidebarSession[] = [
      {
        key: "session-old",
        clientMode: "browser",
        clientDisplayName: "Old chat",
        createdAt: 1,
        lastMessageAt: 10,
        title: "Old chat",
        messageCount: 1,
        raw: {},
      },
      {
        key: "session-recent",
        clientMode: "browser",
        clientDisplayName: "Recent chat",
        createdAt: 1,
        lastMessageAt: 20,
        title: "Recent chat",
        messageCount: 1,
        raw: {},
      },
    ];
    const props = agentWorkspaceSidebarProps({
      sessions,
      selectedSessionKey: "session-recent",
      pinnedSessionKeys: [],
      onSetSessionPinned,
    });
    const view = renderWithClient(<AgentWorkspaceSidebar {...props} />);

    expectSessionBefore("Recent chat", "Old chat");
    fireEvent.click(screen.getByRole("button", { name: "Session options for Old chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Pin", exact: true }));
    expect(onSetSessionPinned).toHaveBeenCalledWith("session-old", true);

    view.rerender(<AgentWorkspaceSidebar {...props} pinnedSessionKeys={["session-old"]} />);
    expectSessionBefore("Old chat", "Recent chat");
    expect(screen.getByText("Old chat - Pinned session")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Old chat", exact: true }).closest("[data-session-pinned]"))
      .toHaveAttribute("data-session-pinned", "true");

    fireEvent.click(screen.getByRole("button", { name: "Session options for Old chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Unpin", exact: true }));
    expect(onSetSessionPinned).toHaveBeenLastCalledWith("session-old", false);
    view.rerender(<AgentWorkspaceSidebar {...props} pinnedSessionKeys={[]} />);
    expect(screen.queryByText("Old chat - Pinned session")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Old chat", exact: true }).closest("[data-session-pinned]"))
      .toHaveAttribute("data-session-pinned", "false");
    expectSessionBefore("Recent chat", "Old chat");
    await waitFor(() => expect(document.querySelector("[data-session-unpin-animation]")).not.toBeInTheDocument());
  });

  it("matches an unscoped pin to a scoped session key", () => {
    renderAgentWorkspaceSidebar({
      sessions: [
        {
          key: "agent:default:session-alpha",
          clientMode: "openclaw",
          clientDisplayName: "Alpha",
          createdAt: 1,
          lastMessageAt: 10,
          title: "Alpha",
          messageCount: 1,
          raw: {},
        },
        {
          key: "session-recent",
          clientMode: "openclaw",
          clientDisplayName: "Recent",
          createdAt: 1,
          lastMessageAt: 20,
          title: "Recent",
          messageCount: 1,
          raw: {},
        },
      ],
      pinnedSessionKeys: ["session-alpha"],
      onSetSessionPinned: vi.fn(),
    });

    expectSessionBefore("Alpha", "Recent");
    fireEvent.click(screen.getByRole("button", { name: "Session options for Alpha" }));
    expect(screen.getByRole("button", { name: "Unpin", exact: true })).toBeEnabled();
  });

  it("keeps pinned sessions visible before the recent-session limit", () => {
    const sessions: SidebarSession[] = Array.from({ length: 10 }, (_, index) => ({
      key: `session-${index}`,
      clientMode: "openclaw",
      clientDisplayName: index === 9 ? "Old pinned chat" : `Chat ${index}`,
      createdAt: index,
      lastMessageAt: 100 - index,
      title: index === 9 ? "Old pinned chat" : `Chat ${index}`,
      messageCount: 1,
      raw: {},
    }));
    renderAgentWorkspaceSidebar({
      sessions,
      selectedSessionKey: "session-0",
      pinnedSessionKeys: ["session-9"],
      onSetSessionPinned: vi.fn(),
    });

    expectSessionBefore("Old pinned chat", "Chat 0");
    expect(screen.getByRole("button", { name: "Old pinned chat", exact: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show more" })).toBeInTheDocument();
  });

  it("marks sessions started from connected chat channels", () => {
    renderAgentWorkspaceSidebar({
      sessions: [
        {
          key: "telegram:489595440",
          clientMode: "openclaw",
          clientDisplayName: "Telegram DM",
          createdAt: 1,
          lastMessageAt: 30,
          title: "Telegram DM",
          messageCount: 1,
          sourceChannelId: "telegram",
          raw: {},
        },
        {
          key: "session-openai",
          clientMode: "openclaw",
          clientDisplayName: "Model-side session",
          createdAt: 1,
          lastMessageAt: 20,
          title: "Model-side session",
          messageCount: 1,
          sourceChannelId: "openai",
          raw: {},
        },
        {
          key: "session-browser",
          clientMode: "browser",
          clientDisplayName: "Browser session",
          createdAt: 1,
          lastMessageAt: 10,
          title: "Browser session",
          messageCount: 1,
          raw: {},
        },
      ],
      selectedSessionKey: "telegram:489595440",
    });

    expect(screen.getByText("Telegram DM - Telegram channel")).toBeInTheDocument();
    expect(screen.queryByText(/OpenAI channel/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Telegram DM" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Browser session" })).toBeInTheDocument();
  });

  it("does not collapse a selected channel session into the hidden main session", () => {
    renderAgentWorkspaceSidebar({
      sessions: [
        {
          key: "main",
          clientMode: "openclaw",
          clientDisplayName: "Main Session",
          createdAt: 1,
          lastMessageAt: 10,
          title: "Main Session",
          messageCount: 1,
          raw: {},
        },
        {
          key: "agent:default:main",
          clientMode: "openclaw",
          clientDisplayName: "Telegram DM",
          createdAt: 1,
          lastMessageAt: 20,
          title: "Telegram DM",
          messageCount: 1,
          sourceChannelId: "telegram",
          raw: {},
        },
      ],
      selectedSessionKey: "agent:default:main",
    });

    const telegramProject = screen.getByRole("button", { name: "Telegram DM" });

    expect(screen.queryByRole("button", { name: "Main Session" })).not.toBeInTheDocument();
    expect(telegramProject).toHaveAttribute("aria-current", "page");
  });

  it("does not render main for scoped main selections", () => {
    renderAgentWorkspaceSidebar({
      sessions: [
        {
          key: "main",
          gatewaySessionKey: "agent:default:main",
          clientMode: "openclaw",
          clientDisplayName: "Main Session",
          createdAt: 1,
          lastMessageAt: 20,
          title: "Main Session",
          messageCount: 1,
          raw: {},
        },
      ],
      selectedSessionKey: "agent:default:main",
    });

    expect(screen.queryByRole("button", { name: "Main Session" })).not.toBeInTheDocument();
  });

  it("does not synthesize an unindexed selected dashboard session", () => {
    renderAgentWorkspaceSidebar({
      sessions: [],
      sessionsFetched: true,
      selectedSessionKey: "dashboard:019789ab-cdef-4abc-8def-0123456789ab",
    });

    expect(screen.queryByText("Sessions")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New Session" })).toBeInTheDocument();
    expect(screen.queryByText("dashboard:019789ab-cdef-4abc-8def-0123456789ab")).not.toBeInTheDocument();
  });

  it("shows the active implicit initial session before the gateway indexes it", () => {
    const sessionKey = "dashboard:019789ab-cdef-4abc-8def-0123456789ab";
    const initialSession: SidebarSession = {
      key: sessionKey,
      clientMode: "openclaw",
      clientDisplayName: "New Session",
      createdAt: 10,
      lastMessageAt: 10,
      title: "New Session",
      messageCount: 0,
      raw: { key: sessionKey, title: "New Session" },
    };
    const onSelectSession = vi.fn();

    renderAgentWorkspaceSidebar({
      sessions: [],
      activeUnindexedInitialSession: initialSession,
      sessionsFetched: true,
      selectedSessionKey: sessionKey,
      onSelectSession,
    });

    expect(screen.getByText("Sessions")).toBeInTheDocument();
    const initialSessionButton = screen.getByRole("button", { name: "New Session", current: "page" });
    expect(initialSessionButton.closest('[data-session-provisional="true"]')).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Session options for New Session" })).not.toBeInTheDocument();
    fireEvent.click(initialSessionButton);
    expect(onSelectSession).toHaveBeenCalledWith(sessionKey);
  });

  it("replaces the implicit initial row with its indexed session", () => {
    const sessionKey = "dashboard:019789ab-cdef-4abc-8def-0123456789ab";
    const initialSession: SidebarSession = {
      key: sessionKey,
      clientMode: "openclaw",
      clientDisplayName: "New Session",
      createdAt: 10,
      lastMessageAt: 10,
      title: "New Session",
      messageCount: 0,
      raw: { key: sessionKey, title: "New Session" },
    };

    renderAgentWorkspaceSidebar({
      sessions: [{
        ...initialSession,
        key: `agent:default:${sessionKey}`,
        clientDisplayName: "Release planning",
        title: "Release planning",
        messageCount: 1,
      }],
      activeUnindexedInitialSession: initialSession,
      sessionsFetched: true,
      selectedSessionKey: sessionKey,
    });

    expect(screen.getByRole("button", { name: "Release planning", current: "page" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New Session", current: "page" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Session options for Release planning" })).toBeInTheDocument();
  });

  it("shows indexed dashboard sessions while hiding empty main and heartbeat sessions", () => {
    renderAgentWorkspaceSidebar({
      sessions: [
        {
          key: "main",
          clientMode: "openclaw",
          clientDisplayName: "Main Session",
          createdAt: 0,
          lastMessageAt: 0,
          title: "Main Session",
          messageCount: 0,
          raw: {},
        },
        {
          key: "agent:default:heartbeat",
          clientMode: "openclaw",
          clientDisplayName: "agent:default:heartbeat",
          createdAt: 1,
          lastMessageAt: 30,
          title: "",
          messageCount: 1,
          raw: {},
        },
        {
          key: "dashboard:019789ab-cdef-4abc-8def-0123456789ab",
          clientMode: "openclaw",
          clientDisplayName: "Dashboard Session",
          createdAt: 2,
          lastMessageAt: 20,
          title: "Dashboard Session",
          messageCount: 1,
          raw: {},
        },
      ],
      sessionsFetched: true,
      selectedSessionKey: "dashboard:019789ab-cdef-4abc-8def-0123456789ab",
    });

    expect(screen.queryByRole("button", { name: "Main Session" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Previous conversation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "agent:default:heartbeat" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dashboard Session" })).toHaveAttribute("aria-current", "page");
  });

  it("hides recoverable legacy main history", () => {
    renderAgentWorkspaceSidebar({
      sessions: [{
        key: "main",
        gatewaySessionKey: "agent:default:main",
        clientMode: "openclaw",
        clientDisplayName: "Main Session",
        createdAt: 1,
        lastMessageAt: 20,
        title: "Main Session",
        messageCount: 1,
        raw: {},
      }],
      selectedSessionKey: "main",
    });

    expect(screen.queryByRole("button", { name: "Previous conversation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Main Session" })).not.toBeInTheDocument();
    expect(screen.queryByText("agent:default:main")).not.toBeInTheDocument();
  });

  it("keeps a channel session selected without exposing the default session", () => {
    renderAgentWorkspaceSidebar({
      sessions: [
        {
          key: "telegram:489595440",
          clientMode: "openclaw",
          clientDisplayName: "Telegram DM",
          createdAt: 1,
          lastMessageAt: 20,
          title: "Telegram DM",
          messageCount: 1,
          sourceChannelId: "telegram",
          readOnly: true,
          raw: {},
        },
      ],
      selectedSessionKey: "telegram:489595440",
    });

    expect(screen.queryByRole("button", { name: "Main Session" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Telegram DM" })).toHaveAttribute("aria-current", "page");
  });

  it("disables destructive actions for read-only channel sessions", () => {
    const onSetSessionPinned = vi.fn();
    renderAgentWorkspaceSidebar({
      sessions: [
        {
          key: "telegram:489595440",
          clientMode: "openclaw",
          clientDisplayName: "Telegram DM",
          createdAt: 1,
          lastMessageAt: 20,
          title: "Telegram DM",
          messageCount: 1,
          sourceChannelId: "telegram",
          readOnly: true,
          readOnlyReason: "Telegram conversations are read-only here. Reply from Telegram.",
          raw: {},
        },
      ],
      selectedSessionKey: "telegram:489595440",
      onSetSessionPinned,
    });

    fireEvent.click(screen.getByRole("button", { name: "Session options for Telegram DM" }));

    const pinButton = screen.getByRole("button", { name: "Pin", exact: true });
    expect(pinButton).toBeEnabled();
    fireEvent.click(pinButton);
    expect(onSetSessionPinned).toHaveBeenCalledWith("telegram:489595440", true);
    fireEvent.click(screen.getByRole("button", { name: "Session options for Telegram DM" }));
    expect(screen.getByRole("button", { name: "Rename" })).toBeEnabled();
    const deleteButton = screen.getByRole("button", { name: "Delete" });
    expect(deleteButton).toBeDisabled();
    expect(screen.getByText("Telegram conversations are read-only here. Reply from Telegram.")).toBeInTheDocument();
  });

  it("does not render actions for the hidden main session", () => {
    renderAgentWorkspaceSidebar({
      sessions: [{
        key: "main",
        clientMode: "openclaw",
        clientDisplayName: "Main Session",
        createdAt: 0,
        lastMessageAt: 0,
        title: "Main Session",
        messageCount: 0,
        raw: {},
      }],
      selectedSessionKey: "main",
    });

    expect(screen.queryByRole("button", { name: "Main Session" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Session options for Main Session" })).not.toBeInTheDocument();
  });

  it("does not synthesize the internal main session when it is the selected session", () => {
    renderAgentWorkspaceSidebar({
      sessions: [],
      selectedSessionKey: "main",
    });

    expect(screen.queryByText("Sessions")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Main Session" })).not.toBeInTheDocument();
    expect(screen.queryByText(/^main$/)).not.toBeInTheDocument();
  });

  it("shows a loader instead of unresolved placeholders before sessions are fetched", () => {
    const onSelectSession = vi.fn();
    renderAgentWorkspaceSidebar({
      sessions: [],
      sessionsFetched: false,
      selectedSessionKey: "main",
      onSelectSession,
    });

    expect(screen.getByText("Sessions")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading sessions" })).not.toHaveTextContent("Sessions are loading.");
    expect(screen.queryByRole("button", { name: "Main Session" })).not.toBeInTheDocument();
    expect(onSelectSession).not.toHaveBeenCalled();
  });

  it("does not render a selected generated-session placeholder before titles are fetched", () => {
    renderAgentWorkspaceSidebar({
      sessions: [],
      sessionsFetched: false,
      selectedSessionKey: "session-d2679a25-8a10-4c47-9d3b-97ebe94135e7",
    });

    const newSessionButtons = screen.getAllByRole("button", { name: "New Session" });
    expect(newSessionButtons).toHaveLength(1);
    expect(newSessionButtons[0]).not.toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Sessions")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading sessions" })).toBeInTheDocument();
  });

  it("reveals a stored session title without flashing its placeholder", () => {
    const initialProps = agentWorkspaceSidebarProps({
      sessions: [],
      sessionsFetched: false,
      selectedSessionKey: "session-d2679a25-8a10-4c47-9d3b-97ebe94135e7",
    });
    const { rerender } = renderWithClient(<AgentWorkspaceSidebar {...initialProps} />);

    expect(screen.getByRole("status", { name: "Loading sessions" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New Session", current: "page" })).not.toBeInTheDocument();

    rerender(<AgentWorkspaceSidebar
      {...initialProps}
      sessions={[{
        key: "session-d2679a25-8a10-4c47-9d3b-97ebe94135e7",
        clientMode: "openclaw",
        clientDisplayName: "Release planning",
        createdAt: 1,
        lastMessageAt: 20,
        title: "Release planning",
        messageCount: 2,
        raw: { label: "Release planning" },
      }]}
      sessionsFetched
    />);

    expect(screen.getByRole("button", { name: "Release planning" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("status", { name: "Loading sessions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New Session", current: "page" })).not.toBeInTheDocument();
  });

  it("keeps the session row mounted while its title advances", () => {
    const sessionKey = "session-d2679a25-8a10-4c47-9d3b-97ebe94135e7";
    const initialProps = agentWorkspaceSidebarProps({
      sessions: [{
        key: sessionKey,
        clientMode: "openclaw",
        clientDisplayName: "New Session",
        createdAt: 1,
        lastMessageAt: 20,
        title: "New Session",
        messageCount: 0,
        raw: {},
      }],
      sessionsFetched: true,
      selectedSessionKey: sessionKey,
    });
    const { rerender } = renderWithClient(<AgentWorkspaceSidebar {...initialProps} />);
    const row = screen.getByRole("button", { name: "New Session", current: "page" });

    rerender(<AgentWorkspaceSidebar
      {...initialProps}
      sessions={[{
        ...initialProps.sessions![0],
        clientDisplayName: "Plan the release rollout",
        title: "Plan the release rollout",
      }]}
    />);

    expect(screen.getByRole("button", { name: "Plan the release rollout" })).toBe(row);
    expect(row.querySelector('[data-session-title="Plan the release rollout"]')).toBeInTheDocument();

    rerender(<AgentWorkspaceSidebar
      {...initialProps}
      sessions={[{
        ...initialProps.sessions![0],
        clientDisplayName: "Release Rollout",
        title: "Release Rollout",
        raw: { label: "Release Rollout" },
      }]}
    />);

    expect(screen.getByRole("button", { name: "Release Rollout" })).toBe(row);
    expect(row.querySelector('[data-session-title="Release Rollout"]')).toBeInTheDocument();
  });

  it("shows a loader instead of cached rows before fresh sessions are fetched", () => {
    const onSelectSession = vi.fn();
    renderAgentWorkspaceSidebar({
      sessions: [{
        key: "session-cached",
        clientMode: "openclaw",
        clientDisplayName: "Cached session",
        createdAt: 1,
        lastMessageAt: 20,
        title: "Cached session",
        messageCount: 2,
        raw: {},
      }],
      sessionsFetched: false,
      selectedSessionKey: "session-cached",
      onSelectSession,
    });

    expect(screen.getByRole("status", { name: "Loading sessions" })).not.toHaveTextContent("Sessions are loading.");
    expect(screen.queryByRole("button", { name: "Cached session" })).not.toBeInTheDocument();
    expect(onSelectSession).not.toHaveBeenCalled();
  });

  it.each(["STOPPED", "FAILED"] as const)("does not keep sessions loading when the selected agent is %s", (state) => {
    const onSelectSession = vi.fn();
    renderAgentWorkspaceSidebar({
      selectedAgent: { ...agent, state },
      sessions: [{
        key: "session-cached",
        clientMode: "openclaw",
        clientDisplayName: "Cached session",
        createdAt: 1,
        lastMessageAt: 20,
        title: "Cached session",
        messageCount: 2,
        raw: {},
      }],
      sessionsFetched: false,
      selectedSessionKey: "session-cached",
      onSelectSession,
    });

    expect(screen.queryByRole("status", { name: "Loading sessions" })).not.toBeInTheDocument();
    const cachedSession = screen.getByRole("button", { name: "Cached session" });
    expect(cachedSession).toBeDisabled();
    expect(screen.getAllByText("Agent must be running").length).toBeGreaterThan(0);
    expect(screen.queryByText("Sessions are loading.")).not.toBeInTheDocument();
    fireEvent.click(cachedSession);
    expect(onSelectSession).not.toHaveBeenCalled();
  });

  it("keeps sessions disabled while the workspace is disabled", () => {
    const onSelectSession = vi.fn();
    renderAgentWorkspaceSidebar({
      disabled: true,
      disabledReason: "Fetching messages, files, and config.",
      sessions: [{
        key: "dashboard:019789ab-cdef-4abc-8def-0123456789ab",
        clientMode: "openclaw",
        clientDisplayName: "Draft session",
        createdAt: 1,
        lastMessageAt: 20,
        title: "Draft session",
        messageCount: 0,
        raw: {},
      }],
      sessionsFetched: true,
      selectedSessionKey: "dashboard:019789ab-cdef-4abc-8def-0123456789ab",
      onSelectSession,
    });

    expect(screen.getByText("Sessions")).toBeInTheDocument();
    const project = screen.getByRole("button", { name: "Draft session" });
    expect(project).toBeDisabled();
    expect(screen.getAllByText("Fetching messages, files, and config.").length).toBeGreaterThan(0);
    fireEvent.click(project);
    expect(onSelectSession).not.toHaveBeenCalled();
  });

  it("does not show sessions when no agent is selected", () => {
    renderAgentWorkspaceSidebar({
      selectedAgent: null,
      sessions: [],
      selectedSessionKey: "main",
    });

    expect(screen.queryByText("Sessions")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Main Session" })).not.toBeInTheDocument();
  });

  it("hides the internal main session when the gateway lists main", () => {
    renderAgentWorkspaceSidebar({
      sessions: [{
        key: "main",
        clientMode: "openclaw",
        clientDisplayName: "main",
        createdAt: 1,
        lastMessageAt: 20,
        title: "",
        messageCount: 0,
        raw: {},
      }],
      selectedSessionKey: "main",
    });

    expect(screen.queryByRole("button", { name: "Main Session" })).not.toBeInTheDocument();
    expect(screen.queryByText(/^main$/)).not.toBeInTheDocument();
  });

  it("highlights the active session without exposing generated gateway session keys", () => {
    const generatedKey = "agent:default:session-d2679a25-8a10-4c47-9d3b-97ebe94135e7";
    renderAgentWorkspaceSidebar({
      activeTab: "files",
      sessions: [{
        key: generatedKey,
        clientMode: "openclaw",
        clientDisplayName: generatedKey,
        createdAt: 1,
        lastMessageAt: 20,
        title: "",
        messageCount: 0,
        raw: {},
      }],
      selectedSessionKey: "session-d2679a25-8a10-4c47-9d3b-97ebe94135e7",
    });

    const activeProject = screen.getAllByRole("button", { name: "New Session" })
      .find((button) => button.getAttribute("aria-current") === "page");
    expect(activeProject).toBeInTheDocument();
    expect(screen.queryByText(/agent:default:session-d2679a25/i)).not.toBeInTheDocument();
  });

  it("falls back from heartbeat and internal control text session names", () => {
    renderAgentWorkspaceSidebar({
      sessions: [
        {
          key: "main",
          clientMode: "openclaw",
          clientDisplayName: "HEARTBEAT_OK",
          createdAt: 1,
          lastMessageAt: 30,
          title: "HEARTBEAT",
          messageCount: 0,
          raw: {},
        },
        {
          key: "session-d2679a25-8a10-4c47-9d3b-97ebe94135e7",
          clientMode: "openclaw",
          clientDisplayName: "Read HEARTBEAT.md if it exists and reply HEARTBEAT_OK",
          createdAt: 1,
          lastMessageAt: 20,
          title: "Read HEARTBEAT.md if it exists",
          messageCount: 0,
          raw: {},
        },
      ],
      selectedSessionKey: "main",
    });

    expect(screen.queryByRole("button", { name: "Main Session" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New Session" }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/HEARTBEAT/i)).not.toBeInTheDocument();
  });

  it("does not expose generated session keys as display names", () => {
    const generatedKey = "session-d2679a25-8a10-4c47-9d3b-97ebe94135e7";
    renderAgentWorkspaceSidebar({
      sessions: [{
        key: generatedKey,
        clientMode: "openclaw",
        clientDisplayName: generatedKey,
        createdAt: 1,
        lastMessageAt: 20,
        title: "",
        messageCount: 0,
        raw: {},
      }],
      selectedSessionKey: generatedKey,
    });

    const activeProject = screen.getAllByRole("button", { name: "New Session" })
      .find((button) => button.getAttribute("aria-current") === "page");
    expect(activeProject).toBeInTheDocument();
  });

  it("shows a pending state while a new session is being created", () => {
    renderAgentWorkspaceSidebar({
      sessions: [{
        key: "session-new",
        clientMode: "openclaw",
        clientDisplayName: "New Session",
        createdAt: 1,
        lastMessageAt: 20,
        title: "New Session",
        messageCount: 0,
        raw: {},
      }],
      creatingSessionKeys: ["agent:default:session-new"],
      selectedSessionKey: "session-new",
    });

    const project = screen.getAllByRole("button", { name: /New Session/i })
      .find((button) => button.getAttribute("aria-busy") === "true");
    expect(project).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Creating...")).toBeInTheDocument();
  });

  it("shows a thinking state for sessions with in-flight replies", () => {
    renderAgentWorkspaceSidebar({
      sessions: [
        {
          key: "session-alpha",
          clientMode: "openclaw",
          clientDisplayName: "Alpha",
          createdAt: 1,
          lastMessageAt: 20,
          title: "Alpha",
          messageCount: 1,
          raw: {},
        },
        {
          key: "session-beta",
          clientMode: "openclaw",
          clientDisplayName: "Beta",
          createdAt: 1,
          lastMessageAt: 10,
          title: "Beta",
          messageCount: 1,
          raw: {},
        },
      ],
      thinkingSessionKeys: ["agent:default:session-beta"],
      selectedSessionKey: "session-alpha",
    });

    expect(screen.getByRole("button", { name: "Alpha" })).not.toHaveAttribute("aria-busy");
    const thinkingSession = screen.getAllByRole("button", { name: /Beta/i })
      .find((button) => button.getAttribute("aria-busy") === "true");
    expect(thinkingSession).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText("Session is thinking")).toBeInTheDocument();
    expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
  });

  it("does not render ephemeral generated sessions", () => {
    const generatedSessionKey = "agent:default:session-019789ab-cdef-7abc-8def-0123456789ab";
    renderAgentWorkspaceSidebar({
      sessions: [
        {
          key: generatedSessionKey,
          clientMode: "openclaw",
          clientDisplayName: "New Session",
          createdAt: 1,
          lastMessageAt: 20,
          title: "",
          messageCount: 0,
          ephemeral: true,
          raw: {},
        },
      ],
      selectedSessionKey: "main",
    });

    expect(screen.queryByRole("button", { name: "Main Session" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Working session" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Session options for Working session" })).not.toBeInTheDocument();
  });

  it("does not render OpenClaw subagent sessions", () => {
    const selectedSubagentKey = "agent:copilot:acp:opaque-child";
    renderAgentWorkspaceSidebar({
      sessions: [
        {
          key: "agent:main:subagent:research",
          clientMode: "openclaw",
          clientDisplayName: "Research task",
          createdAt: 1,
          lastMessageAt: 30,
          title: "Research task",
          messageCount: 1,
          raw: {},
        },
        {
          key: selectedSubagentKey,
          spawnedBy: "agent:main:main",
          clientMode: "openclaw",
          clientDisplayName: "ACP task",
          createdAt: 1,
          lastMessageAt: 20,
          title: "ACP task",
          messageCount: 1,
          raw: {},
        },
      ],
      selectedSessionKey: selectedSubagentKey,
    });

    expect(screen.queryByRole("button", { name: "Main Session" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Research task" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ACP task" })).not.toBeInTheDocument();
    expect(screen.queryByText(selectedSubagentKey)).not.toBeInTheDocument();
  });

  it("renames a recent session from the session menu modal", async () => {
    const onRenameSession = vi.fn(async () => undefined);
    renderAgentWorkspaceSidebar({
      sessions: [{
        key: "session-1",
        clientMode: "browser",
        clientDisplayName: "What is an agent",
        createdAt: 1,
        lastMessageAt: 20,
        title: "What is an agent",
        messageCount: 1,
        raw: {},
      }],
      selectedSessionKey: "session-1",
      onRenameSession,
    });

    fireEvent.click(screen.getByRole("button", { name: "Session options for What is an agent" }));

    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
    const dialog = screen.getByRole("dialog", { name: "Rename session" });
    expect(dialog).toHaveClass("isolate", "bg-background");
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    const input = screen.getByDisplayValue("What is an agent");
    fireEvent.change(input, { target: { value: "Renamed chat" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(onRenameSession).toHaveBeenCalledWith("session-1", "Renamed chat"));
  });

  it("confirms deleting a recent session", async () => {
    const onDeleteSession = vi.fn(async () => undefined);
    renderAgentWorkspaceSidebar({
      sessions: [{
        key: "session-1",
        clientMode: "browser",
        clientDisplayName: "What is an agent",
        createdAt: 1,
        lastMessageAt: 20,
        title: "What is an agent",
        messageCount: 1,
        raw: {},
      }],
      selectedSessionKey: "session-1",
      onDeleteSession,
    });

    fireEvent.click(screen.getByRole("button", { name: "Session options for What is an agent" }));
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    const dialog = screen.getByRole("dialog", { name: "Delete session?" });
    expect(dialog).toHaveClass("isolate", "bg-background");
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    fireEvent.click(screen.getByRole("button", { name: "Delete session" }));

    await waitFor(() => expect(onDeleteSession).toHaveBeenCalledWith("session-1"));
  });

  it("does not render the desktop workspace sidebar below the desktop breakpoint", () => {
    renderAgentWorkspaceSidebar({ isDesktopViewport: false });

    expect(screen.queryByRole("button", { name: /new session/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Workspace")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /advanced/i })).not.toBeInTheDocument();
  });

  it("marks the selected agent section with the accent treatment", () => {
    renderAgentWorkspaceSidebar({ activeTab: "files" });

    const files = screen.getByRole("button", { name: "Files" });
    expect(files).toHaveAttribute("aria-current", "page");
    expect(files).toHaveClass(
      "bg-[rgb(var(--selection-accent-rgb)_/_0.12)]",
      "ring-[rgb(var(--selection-accent-rgb)_/_0.28)]",
    );
    const integrations = screen.getByRole("button", { name: "Integrations" });
    expect(integrations).not.toHaveAttribute("aria-current");
    expect(integrations).not.toHaveClass("ring-1", "bg-[rgb(var(--selection-accent-rgb)_/_0.12)]");
  });

  it("disables the scheduled section when it is not enabled", () => {
    const props = renderAgentWorkspaceSidebar({
      scheduledDisabled: true,
      scheduledDisabledReason: "Scheduled workflows are not available yet.",
    });

    const scheduled = screen.getByRole("button", { name: /scheduled/i });
    expect(scheduled).toBeDisabled();

    fireEvent.click(scheduled);
    expect(props.onOpenScheduled).not.toHaveBeenCalled();
  });

  it("disables the advanced dropdown while the workspace is in the empty state", () => {
    const props = renderAgentWorkspaceSidebar({ selectedAgent: null });

    expect(screen.getByRole("button", { name: /new session/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /files/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /integrations/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /skills/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /scheduled/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Desktop" })).toBeDisabled();

    const advanced = screen.getByRole("button", { name: /advanced/i });
    expect(advanced).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /new session/i }));
    fireEvent.click(screen.getByRole("button", { name: /files/i }));
    fireEvent.click(screen.getByRole("button", { name: /integrations/i }));
    fireEvent.click(screen.getByRole("button", { name: /skills/i }));
    fireEvent.click(screen.getByRole("button", { name: /scheduled/i }));
    fireEvent.click(advanced);
    expect(props.onCreateSession).not.toHaveBeenCalled();
    expect(props.onOpenFiles).not.toHaveBeenCalled();
    expect(props.onOpenIntegrations).not.toHaveBeenCalled();
    expect(props.onOpenSkills).not.toHaveBeenCalled();
    expect(props.onOpenScheduled).not.toHaveBeenCalled();
    expect(props.onOpenOpenClaw).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /settings/i })).not.toBeInTheDocument();
  });

  it("enables safe feature previews while keeping live agent controls disabled", () => {
    const props = renderAgentWorkspaceSidebar({
      selectedAgent: null,
      allowAgentlessFeaturePreviews: true,
    });

    expect(screen.getByRole("button", { name: /new session/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /files/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /integrations/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /skills/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /scheduled/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Desktop" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /advanced/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /files/i }));
    fireEvent.click(screen.getByRole("button", { name: /integrations/i }));
    fireEvent.click(screen.getByRole("button", { name: /skills/i }));
    fireEvent.click(screen.getByRole("button", { name: /scheduled/i }));
    fireEvent.click(screen.getByRole("button", { name: "Desktop" }));
    expect(props.onOpenFiles).toHaveBeenCalledOnce();
    expect(props.onOpenIntegrations).toHaveBeenCalledOnce();
    expect(props.onOpenSkills).toHaveBeenCalledOnce();
    expect(props.onOpenScheduled).toHaveBeenCalledOnce();
    expect(props.onOpenDesktopPreview).toHaveBeenCalledOnce();
    expect(props.onCreateSession).not.toHaveBeenCalled();
  });

  it("keeps agentless previews disabled while the workspace itself is disabled", () => {
    renderAgentWorkspaceSidebar({
      selectedAgent: null,
      allowAgentlessFeaturePreviews: true,
      disabled: true,
      disabledReason: "Workspace is loading.",
    });

    expect(screen.getByRole("button", { name: /files/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /integrations/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /skills/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /scheduled/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Desktop" })).toBeDisabled();
  });

  it("keeps workspace sections enabled for a selected stopped agent", () => {
    const props = renderAgentWorkspaceSidebar({
      selectedAgent: {
        ...agent,
        state: "STOPPED",
      },
      sessionsFetched: true,
    });

    const newProject = screen.getByRole("button", { name: /new session/i });
    expect(newProject).toBeDisabled();
    expect(screen.getByRole("button", { name: "Desktop" })).toBeEnabled();
    fireEvent.click(newProject);
    fireEvent.click(screen.getByRole("button", { name: /files/i }));
    fireEvent.click(screen.getByRole("button", { name: /integrations/i }));
    fireEvent.click(screen.getByRole("button", { name: /skills/i }));
    fireEvent.click(screen.getByRole("button", { name: /scheduled/i }));

    expect(props.onCreateSession).not.toHaveBeenCalled();
    expect(props.onOpenFiles).toHaveBeenCalledTimes(1);
    expect(props.onOpenFiles).toHaveBeenCalledWith();
    expect(props.onOpenIntegrations).toHaveBeenCalledTimes(1);
    expect(props.onOpenSkills).toHaveBeenCalledTimes(1);
    expect(props.onOpenScheduled).toHaveBeenCalledTimes(1);
    expect(props.onOpenScheduled).toHaveBeenCalledWith();
  });

  it("keeps the upgrade action available while the workspace is disabled", () => {
    const props = renderAgentWorkspaceSidebar({
      disabled: true,
      disabledReason: "Fetching messages, files, and config.",
    });

    const upgrade = screen.getByRole("button", { name: /upgrade/i });
    expect(upgrade).not.toBeDisabled();

    fireEvent.click(upgrade);
    expect(props.onUpgrade).toHaveBeenCalledTimes(1);
  });

  it("shows daily token usage and upgrade without plan indicators", () => {
    renderAgentWorkspaceSidebar({
      tokenUsed: 1_200,
      tokenLimit: 5_000,
    });

    const usageLabel = screen.getByText("Tokens today");
    const usageValue = screen.getByText("1.2K / 5K");
    expect(usageLabel).toHaveClass("shrink-0", "whitespace-nowrap");
    expect(usageValue).toHaveClass("shrink-0", "whitespace-nowrap", "tabular-nums");
    expect(usageLabel.parentElement).toHaveClass("gap-1.5", "text-[11px]", "leading-none");
    expect(screen.getByRole("button", { name: /upgrade/i })).toBeInTheDocument();
    expect(screen.queryByText("7-day free trial on Team")).not.toBeInTheDocument();
    expect(screen.queryByText("Purchased plans")).not.toBeInTheDocument();
  });

  it("shows an unknown limit when the selected agent has no token entitlement", () => {
    renderAgentWorkspaceSidebar({
      tokenUsed: 1_200,
      tokenLimit: null,
    });

    expect(screen.getByText("1.2K / --")).toBeInTheDocument();
  });

  it("offers a seven-day trial before registration", () => {
    const onStartTrial = vi.fn();
    const props = renderAgentWorkspaceSidebar({
      isAuthenticated: false,
      tokenUsed: null,
      tokenLimit: null,
      onStartTrial,
    });

    expect(screen.getByText("7-day free trial on Team")).toBeInTheDocument();
    expect(screen.getByText("Tokens today")).toBeInTheDocument();
    expect(screen.getByText("0 / --")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /upgrade/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start free trial" }));
    expect(onStartTrial).toHaveBeenCalledTimes(1);
    expect(props.onUpgrade).not.toHaveBeenCalled();
  });

  it("keeps the trial action available for an eligible signed-in account", () => {
    const onStartTrial = vi.fn();
    renderAgentWorkspaceSidebar({
      isAuthenticated: true,
      canStartTrial: true,
      onStartTrial,
    });

    expect(screen.getByText("7-day free trial on Team")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start free trial" }));
    expect(onStartTrial).toHaveBeenCalledOnce();
  });

  it("shows and manages an active Team trial", () => {
    const onManageTrial = vi.fn();
    renderAgentWorkspaceSidebar({
      activeTrial: {
        subscriptionId: "sub-team",
        planId: "team",
        planName: "Team",
        endsAt: new Date("2026-08-12T12:00:00Z"),
        totalDays: 7,
        secondsRemaining: 6 * 86_400,
        timeRemainingLabel: "6 days left",
      },
      onManageTrial,
    });

    expect(screen.getByText("Team trial · 6 days left")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Manage trial" }));
    expect(onManageTrial).toHaveBeenCalledOnce();
  });
});
