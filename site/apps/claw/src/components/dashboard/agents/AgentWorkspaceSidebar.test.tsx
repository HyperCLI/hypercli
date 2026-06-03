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

  it("creates a project from the primary workspace action and highlights the selected project", async () => {
    const onCreateSession = vi.fn(async () => {
      selectedSessionKey = "session-new";
      sessions = [{
        key: "session-new",
        clientMode: "openclaw",
        clientDisplayName: "New Project",
        createdAt: 2,
        lastMessageAt: 30,
        title: "New Project",
        messageCount: 0,
        raw: {},
      }, ...sessions];
    });
    let selectedSessionKey = "main";
    let sessions = [{
      key: "main",
      clientMode: "openclaw",
      clientDisplayName: "Main Project",
      createdAt: 1,
      lastMessageAt: 20,
      title: "Main Project",
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
        onOpenLogs={vi.fn()}
        onOpenShell={vi.fn()}
        onOpenOpenClaw={vi.fn()}
        onOpenSettings={vi.fn()}
        onUpgrade={vi.fn()}
      />
    );
    const view = renderWithClient(renderSidebar());

    fireEvent.click(screen.getByRole("button", { name: /new project/i }));
    await waitFor(() => expect(onCreateSession).toHaveBeenCalledTimes(1));
    view.rerender(renderSidebar());

    const activeProject = screen.getAllByRole("button", { name: "New Project" })
      .find((button) => button.getAttribute("aria-current") === "page");
    expect(activeProject).toBeInTheDocument();
  });

  it("renders projects and opens the selected project without using preview text as the name", () => {
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
      sessionPreviews: {
        "session-new": { key: "session-new", text: "What is an agent", role: "user", timestamp: 20 },
      },
      selectedSessionKey: "session-new",
      onSelectSession,
    });

    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.queryByText("What is an agent")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(onSelectSession).toHaveBeenCalledWith("session-new");
  });

  it("shows and highlights the current project when it is the only project", () => {
    renderAgentWorkspaceSidebar({
      sessions: [],
      selectedSessionKey: "main",
    });

    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Main Project" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByText(/^main$/)).not.toBeInTheDocument();
  });

  it("shows disabled projects before the project list is fetched", () => {
    const onSelectSession = vi.fn();
    renderAgentWorkspaceSidebar({
      sessions: [],
      sessionsFetched: false,
      selectedSessionKey: "main",
      onSelectSession,
    });

    expect(screen.getByText("Projects")).toBeInTheDocument();
    const project = screen.getByRole("button", { name: "Main Project" });
    expect(project).toBeDisabled();
    expect(project).toHaveAttribute("title", "Projects are loading.");
    fireEvent.click(project);
    expect(onSelectSession).not.toHaveBeenCalled();
  });

  it("shows cached project rows disabled before fresh projects are fetched", () => {
    const onSelectSession = vi.fn();
    renderAgentWorkspaceSidebar({
      sessions: [{
        key: "session-cached",
        clientMode: "openclaw",
        clientDisplayName: "Cached project",
        createdAt: 1,
        lastMessageAt: 20,
        title: "Cached project",
        messageCount: 2,
        raw: {},
      }],
      sessionsFetched: false,
      selectedSessionKey: "session-cached",
      onSelectSession,
    });

    const project = screen.getByRole("button", { name: "Cached project" });
    expect(project).toBeDisabled();
    expect(project).toHaveAttribute("title", "Projects are loading.");
    fireEvent.click(project);
    expect(onSelectSession).not.toHaveBeenCalled();
  });

  it("keeps projects disabled while the workspace is disabled", () => {
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

    expect(screen.getByText("Projects")).toBeInTheDocument();
    const project = screen.getByRole("button", { name: "Main Project" });
    expect(project).toBeDisabled();
    expect(project).toHaveAttribute("title", "Fetching messages, files, and config.");
    fireEvent.click(project);
    expect(onSelectSession).not.toHaveBeenCalled();
  });

  it("does not show projects when no agent is selected", () => {
    renderAgentWorkspaceSidebar({
      selectedAgent: null,
      sessions: [],
      selectedSessionKey: "main",
    });

    expect(screen.queryByText("Projects")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Main Project" })).not.toBeInTheDocument();
  });

  it("shows the default project with a product label when the gateway lists main", () => {
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

    expect(screen.getByRole("button", { name: "Main Project" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByText(/^main$/)).not.toBeInTheDocument();
  });

  it("highlights the active project without exposing generated gateway session keys", () => {
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

    const activeProject = screen.getAllByRole("button", { name: "New Project" })
      .find((button) => button.getAttribute("aria-current") === "page");
    expect(activeProject).toHaveAttribute("title", "New Project");
    expect(screen.queryByText(/agent:default:session-d2679a25/i)).not.toBeInTheDocument();
  });

  it("falls back from heartbeat and internal control text project names", () => {
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

    expect(screen.getByRole("button", { name: "Main Project" })).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByRole("button", { name: "New Project" }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/HEARTBEAT/i)).not.toBeInTheDocument();
  });

  it("does not expose chat preview text for generated project names", () => {
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
      sessionPreviews: {
        [generatedKey]: { key: generatedKey, text: "Leaked chat preview", role: "user", timestamp: 20 },
      },
      selectedSessionKey: generatedKey,
    });

    const activeProject = screen.getAllByRole("button", { name: "New Project" })
      .find((button) => button.getAttribute("aria-current") === "page");
    expect(activeProject).toBeInTheDocument();
    expect(screen.queryByText("Leaked chat preview")).not.toBeInTheDocument();
  });

  it("shows a pending state while a new project is being created", () => {
    renderAgentWorkspaceSidebar({
      sessions: [{
        key: "session-new",
        clientMode: "openclaw",
        clientDisplayName: "New Project",
        createdAt: 1,
        lastMessageAt: 20,
        title: "New Project",
        messageCount: 0,
        raw: {},
      }],
      creatingSessionKeys: ["agent:default:session-new"],
      selectedSessionKey: "session-new",
    });

    const project = screen.getByTitle("New Project - Creating...");
    expect(project).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Creating...")).toBeInTheDocument();
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
    expect(screen.getByText("Rename project")).toBeInTheDocument();
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
    expect(screen.getByText("Delete project?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));

    await waitFor(() => expect(onDeleteSession).toHaveBeenCalledWith("session-1"));
  });

  it("does not render the desktop workspace sidebar below the desktop breakpoint", () => {
    renderAgentWorkspaceSidebar({ isDesktopViewport: false });

    expect(screen.queryByRole("button", { name: /new project/i })).not.toBeInTheDocument();
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

    expect(screen.getByRole("button", { name: /new project/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /files/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /integrations/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /skills/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /scheduled/i })).toBeDisabled();

    const advanced = screen.getByRole("button", { name: /advanced/i });
    expect(advanced).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /new project/i }));
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

    const newProject = screen.getByRole("button", { name: /new project/i });
    expect(newProject).toBeDisabled();
    expect(newProject).toHaveAttribute("title", "Agent must be running");
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
