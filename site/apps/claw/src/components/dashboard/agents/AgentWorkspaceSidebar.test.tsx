import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Agent } from "@/app/dashboard/agents/types";
import { renderWithClient } from "@/test/utils";
import { AgentWorkspaceSidebar } from "./AgentWorkspaceSidebar";

vi.mock("@hypercli/shared-ui", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/HyperCLILogoLink", () => ({
  HyperCLILogoLink: () => <div>HyperCLI</div>,
}));

const agent: Agent = {
  id: "agent-1",
  name: "Test Agent",
  user_id: "user-1",
  pod_id: "pod-1",
  pod_name: "agent-1",
  state: "RUNNING",
  cpu_millicores: 4000,
  memory_mib: 4096,
  hostname: "agent.example.com",
  started_at: "2026-05-05T00:00:00Z",
  stopped_at: null,
  last_error: null,
  created_at: "2026-05-05T00:00:00Z",
  updated_at: "2026-05-05T00:00:00Z",
  gatewayToken: null,
  meta: null,
};

function renderAgentWorkspaceSidebar(overrides: Partial<ComponentProps<typeof AgentWorkspaceSidebar>> = {}) {
  const props: ComponentProps<typeof AgentWorkspaceSidebar> = {
    selectedAgent: agent,
    activeTab: "chat",
    isDesktopViewport: true,
    onCreateSession: vi.fn(async () => undefined),
    onOpenFiles: vi.fn(),
    onOpenIntegrations: vi.fn(),
    onOpenSkills: vi.fn(),
    onOpenKnowledge: vi.fn(),
    onOpenScheduled: vi.fn(),
    onOpenLogs: vi.fn(),
    onOpenShell: vi.fn(),
    onOpenOpenClaw: vi.fn(),
    onOpenSettings: vi.fn(),
    onUpgrade: vi.fn(),
    ...overrides,
  };

  renderWithClient(<AgentWorkspaceSidebar {...props} />);
  return props;
}

describe("AgentWorkspaceSidebar", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("shows the selected agent name in the expanded header", () => {
    renderAgentWorkspaceSidebar();

    expect(screen.getByText("Test Agent")).toBeInTheDocument();
  });

  it("renders shared knowledge after scheduled in the workspace list", () => {
    renderAgentWorkspaceSidebar();

    const labels = screen.getAllByRole("button").map((button) => button.textContent ?? "");
    expect(labels.findIndex((label) => label.includes("Shared Knowledge"))).toBeGreaterThan(labels.findIndex((label) => label.includes("Scheduled")));
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
        onOpenKnowledge={vi.fn()}
        onOpenScheduled={vi.fn()}
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
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(onSelectSession).toHaveBeenCalledWith("session-new");
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

    expect(screen.getByTitle("Telegram channel")).toBeInTheDocument();
    expect(screen.queryByTitle("OpenAI channel")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Telegram DM" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Browser session" })).toBeInTheDocument();
  });

  it("does not collapse a selected channel session into the main session", () => {
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

    const mainProject = screen.getByRole("button", { name: "Main Session" });
    const telegramProject = screen.getByRole("button", { name: "Telegram DM" });

    expect(mainProject).not.toHaveAttribute("aria-current", "page");
    expect(telegramProject).toHaveAttribute("aria-current", "page");
  });

  it("does not synthesize a duplicate main session for scoped main selections", () => {
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

    const mainProjects = screen.getAllByRole("button", { name: "Main Session" });
    expect(mainProjects).toHaveLength(1);
    expect(mainProjects[0]).toHaveAttribute("aria-current", "page");
  });

  it("keeps the default session visible when a channel session is selected", () => {
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

    expect(screen.getByRole("button", { name: "Main Session" })).not.toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Telegram DM" })).toHaveAttribute("aria-current", "page");
  });

  it("disables destructive actions for read-only channel sessions", () => {
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
    });

    fireEvent.click(screen.getByRole("button", { name: "Session options for Telegram DM" }));

    expect(screen.getByRole("button", { name: "Rename" })).toBeEnabled();
    const deleteButton = screen.getByRole("button", { name: "Delete" });
    expect(deleteButton).toBeDisabled();
    expect(deleteButton).toHaveAttribute("title", "Telegram conversations are read-only here. Reply from Telegram.");
  });

  it("shows and highlights the current session when it is the only session", () => {
    renderAgentWorkspaceSidebar({
      sessions: [],
      selectedSessionKey: "main",
    });

    expect(screen.getByText("Sessions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Main Session" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByText(/^main$/)).not.toBeInTheDocument();
  });

  it("shows disabled sessions before the session list is fetched", () => {
    const onSelectSession = vi.fn();
    renderAgentWorkspaceSidebar({
      sessions: [],
      sessionsFetched: false,
      selectedSessionKey: "main",
      onSelectSession,
    });

    expect(screen.getByText("Sessions")).toBeInTheDocument();
    const project = screen.getByRole("button", { name: "Main Session" });
    expect(project).toBeDisabled();
    expect(project).toHaveAttribute("title", "Sessions are loading.");
    fireEvent.click(project);
    expect(onSelectSession).not.toHaveBeenCalled();
  });

  it("shows cached session rows disabled before fresh sessions are fetched", () => {
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

    const project = screen.getByRole("button", { name: "Cached session" });
    expect(project).toBeDisabled();
    expect(project).toHaveAttribute("title", "Sessions are loading.");
    fireEvent.click(project);
    expect(onSelectSession).not.toHaveBeenCalled();
  });

  it("keeps sessions disabled while the workspace is disabled", () => {
    const onSelectSession = vi.fn();
    renderAgentWorkspaceSidebar({
      disabled: true,
      disabledReason: "Fetching messages, files, and config.",
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
      sessionsFetched: true,
      selectedSessionKey: "main",
      onSelectSession,
    });

    expect(screen.getByText("Sessions")).toBeInTheDocument();
    const project = screen.getByRole("button", { name: "Main Session" });
    expect(project).toBeDisabled();
    expect(project).toHaveAttribute("title", "Fetching messages, files, and config.");
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

  it("shows the default session with a product label when the gateway lists main", () => {
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

    expect(screen.getByRole("button", { name: "Main Session" })).toHaveAttribute("aria-current", "page");
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
    expect(activeProject).toHaveAttribute("title", "New Session");
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

    expect(screen.getByRole("button", { name: "Main Session" })).toHaveAttribute("aria-current", "page");
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

    const project = screen.getByTitle("New Session - Creating...");
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

    expect(screen.getByTitle("Alpha")).not.toHaveAttribute("aria-busy");
    const thinkingSession = screen.getByTitle("Beta - Thinking...");
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

    expect(screen.getByRole("button", { name: "Main Session" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Working session" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Session options for Working session" })).not.toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: /move to channels/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
    expect(screen.getByText("Rename session")).toBeInTheDocument();
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
    expect(screen.getByText("Delete session?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete session" }));

    await waitFor(() => expect(onDeleteSession).toHaveBeenCalledWith("session-1"));
  });

  it("does not render the desktop workspace sidebar below the desktop breakpoint", () => {
    renderAgentWorkspaceSidebar({ isDesktopViewport: false });

    expect(screen.queryByRole("button", { name: /new session/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Workspace")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /advanced/i })).not.toBeInTheDocument();
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

    const advanced = screen.getByRole("button", { name: /advanced/i });
    expect(advanced).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /new session/i }));
    fireEvent.click(screen.getByRole("button", { name: /files/i }));
    fireEvent.click(screen.getByRole("button", { name: /integrations/i }));
    fireEvent.click(screen.getByRole("button", { name: /skills/i }));
    fireEvent.click(screen.getByRole("button", { name: /shared knowledge/i }));
    fireEvent.click(screen.getByRole("button", { name: /scheduled/i }));
    fireEvent.click(advanced);
    expect(props.onCreateSession).not.toHaveBeenCalled();
    expect(props.onOpenFiles).not.toHaveBeenCalled();
    expect(props.onOpenIntegrations).not.toHaveBeenCalled();
    expect(props.onOpenSkills).not.toHaveBeenCalled();
    expect(props.onOpenScheduled).not.toHaveBeenCalled();
    expect(props.onOpenSettings).not.toHaveBeenCalled();
    expect(props.onOpenOpenClaw).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /settings/i })).not.toBeInTheDocument();
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
    expect(newProject).toHaveAttribute("title", "Agent must be running");
    fireEvent.click(newProject);
    fireEvent.click(screen.getByRole("button", { name: /files/i }));
    fireEvent.click(screen.getByRole("button", { name: /integrations/i }));
    fireEvent.click(screen.getByRole("button", { name: /skills/i }));
    fireEvent.click(screen.getByRole("button", { name: /shared knowledge/i }));
    fireEvent.click(screen.getByRole("button", { name: /scheduled/i }));

    expect(props.onCreateSession).not.toHaveBeenCalled();
    expect(props.onOpenFiles).toHaveBeenCalledTimes(1);
    expect(props.onOpenFiles).toHaveBeenCalledWith();
    expect(props.onOpenIntegrations).toHaveBeenCalledTimes(1);
    expect(props.onOpenSkills).toHaveBeenCalledTimes(1);
    expect(props.onOpenKnowledge).toHaveBeenCalledTimes(1);
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

    expect(screen.getByText("Tokens today")).toBeInTheDocument();
    expect(screen.getByText("1.2K / 5K")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /upgrade/i })).toBeInTheDocument();
    expect(screen.queryByText("Purchased plans")).not.toBeInTheDocument();
  });
});
