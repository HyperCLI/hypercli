import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ComponentProps, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Agent } from "@/app/dashboard/agents/types";
import { AGENT_ROSTER_ORDER_STORAGE_KEY } from "@/hooks/useAgentRosterOrder";
import { renderWithClient } from "@/test/utils";

const clipboardMocks = vi.hoisted(() => ({
  writeClipboardText: vi.fn(async () => true),
}));

vi.mock("./FirstAgentSetupWizard", () => {
  const starterFiles = () => ["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "BOOTSTRAP.md"]
    .map((name) => {
      const content = `# ${name}\n\n${name} content`;
      return {
        name,
        size: content.length,
        type: "text/markdown",
        arrayBuffer: async () => new TextEncoder().encode(content).buffer as ArrayBuffer,
      };
    });
  const unreadableStarterFiles = () => starterFiles().map((file, index) => index === 0
    ? { ...file, arrayBuffer: async () => { throw new Error("browser file read failed"); } }
    : file);

  return {
    FirstAgentSetupWizard: ({ onCreateAgent, onClose }: {
    onCreateAgent: (params: {
      name: string;
      iconIndex: number;
      size: "small";
      files: Array<{
        name: string;
        size: number;
        type: string;
        arrayBuffer: () => Promise<ArrayBuffer>;
      }>;
      enableDesktop: boolean;
      knowledgeCollectionId: string | null;
    }) => Promise<string | null>;
    onClose?: () => void;
  }) => (
    <div>
      <div>First agent setup wizard</div>
      {onClose ? <button type="button" onClick={onClose}>Close agent creation</button> : null}
      <button
        type="button"
        onClick={() => { void onCreateAgent({
          name: "Created Agent",
          iconIndex: 0,
          size: "small",
          files: starterFiles(),
          enableDesktop: false,
          knowledgeCollectionId: "knowledge-collection-1",
        }); }}
      >
        Finish setup
      </button>
      <button
        type="button"
        onClick={() => { void onCreateAgent({
          name: "Created Agent",
          iconIndex: 0,
          size: "small",
          files: starterFiles(),
          enableDesktop: false,
          knowledgeCollectionId: null,
        }); }}
      >
        Finish setup with starter files
      </button>
      <button
        type="button"
        onClick={() => { void onCreateAgent({
          name: "Unreadable Agent",
          iconIndex: 0,
          size: "small",
          files: unreadableStarterFiles(),
          enableDesktop: false,
          knowledgeCollectionId: null,
        }); }}
      >
        Finish setup with unreadable files
      </button>
    </div>
    ),
  };
});

vi.mock("@hypercli/shared-ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hypercli/shared-ui")>()),
  Button: ({ children, asChild, ...props }: ComponentProps<"button"> & { asChild?: boolean }) => (
    asChild ? <>{children}</> : <button {...props}>{children}</button>
  ),
  HyperCLILogo: ({ className }: { className?: string }) => <div aria-hidden="true" className={className} />,
  Input: (props: ComponentProps<"input">) => <input {...props} />,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  ThemeSelector: () => <div>Theme</div>,
  Switch: ({ checked, onCheckedChange, ...props }: ComponentProps<"button"> & {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
  }) => (
    <button
      {...props}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
    />
  ),
  ConfirmDialog: ({
    open,
    title,
    message,
    confirmLabel,
    loading,
    onCancel,
    onConfirm,
  }: {
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    loading?: boolean;
    onCancel: () => void;
    onConfirm: () => void;
  }) => open ? (
    <div role="dialog" aria-label={title}>
      <p>{message}</p>
      <button type="button" disabled={loading} onClick={onCancel}>Cancel</button>
      <button type="button" disabled={loading} onClick={onConfirm}>{confirmLabel}</button>
    </div>
  ) : null,
  writeClipboardText: clipboardMocks.writeClipboardText,
}));

const sdkMocks = vi.hoisted(() => ({
  userGet: vi.fn(),
  userUpdate: vi.fn(),
  userGetProfileImage: vi.fn(),
  userUploadProfileImage: vi.fn(),
  userDeleteProfileImage: vi.fn(),
}));

const agentClientMocks = vi.hoisted(() => ({
  startAgent: vi.fn(async () => undefined),
  waitForCreatedAgentStopped: vi.fn(async (client: { waitForState: (...args: unknown[]) => Promise<unknown> }, created: { id: string }) => (
    client.waitForState(created.id, ["STOPPED"])
  )),
  createAgentClient: vi.fn(() => {
    const files = new Map<string, Uint8Array>();
    return {
      fileWriteBytes: vi.fn(async (_agentId: string, path: string, content: ArrayBuffer) => {
        files.set(path, new Uint8Array(content).slice());
      }),
      fileReadBytes: vi.fn(async (_agentId: string, path: string) => files.get(path)?.slice() ?? new Uint8Array()),
      fileDelete: vi.fn(async (_agentId: string, path: string) => {
        files.delete(path);
      }),
      waitForState: vi.fn(async () => ({ id: "created-agent", state: "STOPPED" })),
      start: vi.fn(async () => ({ state: "RUNNING", waitRunning: vi.fn(async () => undefined) })),
    };
  }),
}));

vi.mock("@hypercli.com/sdk/browser", () => ({
  BrowserHyperCLI: vi.fn(function BrowserHyperCLI() {
    return {
      user: {
        get: sdkMocks.userGet,
        update: sdkMocks.userUpdate,
        getProfileImage: sdkMocks.userGetProfileImage,
        uploadProfileImage: sdkMocks.userUploadProfileImage,
        deleteProfileImage: sdkMocks.userDeleteProfileImage,
      },
    };
  }),
}));

// The hosted relay base is deployment config; without it the dashboard cannot
// build a Slack launch env at all. Keep the rest of the module real so the
// URLs under assertion come from the SDK builder, not from a stub.
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  SLACK_RELAY_BASE_URL: "https://api.hypercli.com",
}));

vi.mock("@/lib/agent-client", () => ({
  createAgentClient: agentClientMocks.createAgentClient,
  startAgent: agentClientMocks.startAgent,
  waitForCreatedAgentStopped: agentClientMocks.waitForCreatedAgentStopped,
  createBrowserHyperCLIClient: vi.fn(() => ({
    user: {
      get: sdkMocks.userGet,
      update: sdkMocks.userUpdate,
      getProfileImage: sdkMocks.userGetProfileImage,
      uploadProfileImage: sdkMocks.userUploadProfileImage,
      deleteProfileImage: sdkMocks.userDeleteProfileImage,
    },
  })),
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

import { AgentDesktopEmptyState, AgentEmptyState, AgentFilesEmptyState, AgentIntegrationsEmptyState, AgentList, AgentScheduledEmptyState, AgentSettingsPanel, AgentSkillsEmptyState, ErrorBanner, LaunchFirstAgentEmptyState } from "./AgentPanels";

function createInMemoryAgentClient() {
  const files = new Map<string, Uint8Array>();
  return {
    fileWriteBytes: vi.fn(async (_agentId: string, path: string, content: ArrayBuffer) => {
      files.set(path, new Uint8Array(content).slice());
    }),
    fileReadBytes: vi.fn(async (_agentId: string, path: string) => files.get(path)?.slice() ?? new Uint8Array()),
    fileDelete: vi.fn(async (_agentId: string, path: string) => {
      files.delete(path);
    }),
    waitForState: vi.fn(async () => ({ id: "created-agent", state: "STOPPED" })),
    start: vi.fn(async () => ({ state: "RUNNING", waitRunning: vi.fn(async () => undefined) })),
  };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.clearAllMocks();
  releaseBoundaryMock.knowledgeHubAvailable = false;
  releaseBoundaryMock.membersAvailable = false;
  agentClientMocks.startAgent.mockResolvedValue(undefined);
  sdkMocks.userGet.mockResolvedValue({
    userId: "user-1234567890abcdef",
    email: "test@example.com",
    name: "John Smith",
    isActive: true,
    createdAt: "2026-05-05T00:00:00Z",
  });
  sdkMocks.userUpdate.mockResolvedValue({
    userId: "user-1234567890abcdef",
    email: "test@example.com",
    name: "John Smith",
    isActive: true,
    createdAt: "2026-05-05T00:00:00Z",
  });
  sdkMocks.userGetProfileImage.mockResolvedValue({
    id: "user-1234567890abcdef",
    avatarUrl: null,
    s3Key: null,
  });
  sdkMocks.userUploadProfileImage.mockResolvedValue({
    id: "user-1234567890abcdef",
    avatarUrl: "https://cdn.example.test/account.png",
    s3Key: "prod/user-1234567890abcdef/user-1234567890abcdef.png",
  });
  sdkMocks.userDeleteProfileImage.mockResolvedValue({
    id: "user-1234567890abcdef",
    avatarUrl: null,
    s3Key: null,
  });
  agentClientMocks.createAgentClient.mockReturnValue(createInMemoryAgentClient());
});

const agent: Agent = {
  id: "agent-1",
  name: "Test Agent",
  managed: true,
  isLaunchable: true,
  user_id: "user-1",
  state: "RUNNING",
  cpu_millicores: 4000,
  memory_mib: 4096,
  hostname: "agent.example.com",
  started_at: "2026-05-05T00:00:00Z",
  stopped_at: null,
  archived_at: null,
  created_at: "2026-05-05T00:00:00Z",
  updated_at: "2026-05-05T00:00:00Z",
  launchEpoch: 0,
  clusterId: null,
  launchConfig: {
    image: "ghcr.io/hypercli/hypercli-openclaw:prod",
    env: {
      OPENCLAW_DESKTOP_ENABLED: "0",
      OPENCLAW_CRON_ENABLED: "0",
      HYPER_API_BASE: "https://api.hypercli.com",
      HYPER_WORKSPACES_BOOT_SYNC: "1",
      HYPER_WORKSPACES_DIR: "/home/node/shared",
      HYPER_WORKSPACES_SYNC_READY_ONLY: "1",
      OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES: "0",
      FOO: "bar",
      HYPER_CUSTOM_FLAG: "visible",
    },
    routes: {
      openclaw: { port: 18789, auth: false, prefix: "" },
    },
    sync_root: "/home/node",
    sync_uid: 1000,
    sync_gid: 1000,
  },
  meta: null,
};

const stoppedAgent: Agent = {
  ...agent,
  id: "agent-stopped",
  name: "Stopped Agent",
  state: "STOPPED",
};

const failedAgent: Agent = {
  ...agent,
  id: "agent-failed",
  name: "Failed Agent",
  state: "FAILED",
};

const startingAgent: Agent = {
  ...agent,
  id: "agent-starting",
  name: "Starting Agent",
  state: "STARTING",
};

function agentThread(item: Agent) {
  const displayName = item.displayName?.trim() || item.name;
  return {
    id: item.id,
    sessionKey: item.id,
    participants: [{ id: item.id, name: displayName, type: "agent" as const }],
    kind: "user-agent" as const,
    title: displayName,
    lastMessage: item.state === "RUNNING" ? "Connected" : item.state.toLowerCase(),
    lastMessageBy: item.id,
    lastMessageAt: Date.now(),
    messageCount: 0,
    unreadCount: 0,
    isActive: item.state === "RUNNING",
  };
}

function createAgentListProps(overrides: Partial<ComponentProps<typeof AgentList>> = {}): ComponentProps<typeof AgentList> {
  return {
    sidebarCollapsed: true,
    isDesktopViewport: true,
    mobileShowChat: false,
    agents: [agent],
    selectedAgentId: null,
    setSelectedAgentId: vi.fn(),
    setMobileShowChat: vi.fn(),
    setSidebarCollapsed: vi.fn(),
    syntheticThreads: [agentThread(agent)],
    getToken: vi.fn(async () => "token"),
    createOpenClawAgent: vi.fn(async () => ({ id: "created-agent" })),
    associateCreatedAgent: vi.fn(async () => undefined),
    fetchAgents: vi.fn(),
    setError: vi.fn(),
    sidebarCreatorSignal: 0,
    setPendingAgentDelete: vi.fn(),
    ...overrides,
  };
}

function renderAgentList(overrides: Partial<ComponentProps<typeof AgentList>> = {}) {
  const props = createAgentListProps(overrides);
  renderWithClient(<AgentList {...props} />);
  return props;
}

function renderAgentSettingsPanel(overrides: Partial<ComponentProps<typeof AgentSettingsPanel>> = {}) {
  const props: ComponentProps<typeof AgentSettingsPanel> = {
    agent,
    user: {
      id: "user-1234567890abcdef",
      email: "test@example.com",
      name: "John Smith",
      walletAddress: "0x1234567890abcdef",
    },
    openclawConfig: {
      agents: {
        defaults: {
          model: {
            primary: "openai/gpt-5-mini",
          },
          memorySearch: {
            enabled: true,
            sync: {
              onSessionStart: false,
              onSearch: false,
              watch: false,
              watchDebounceMs: 30000,
              intervalMinutes: 0,
            },
          },
        },
      },
      models: {
        providers: {
          openai: {
            name: "OpenAI",
            models: [{ id: "gpt-5-mini", name: "GPT-5 Mini" }],
          },
          anthropic: {
            name: "Anthropic",
            models: [{ id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" }],
          },
        },
      },
    },
    openclawModels: [
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", providerId: "google", providerName: "Google" },
    ],
    onLogout: vi.fn(),
    onDeleteAgent: vi.fn(),
    ...overrides,
  };

  const renderResult = renderWithClient(<AgentSettingsPanel {...props} />);
  return { props, ...renderResult };
}

describe("LaunchFirstAgentEmptyState", () => {
  it("delegates launch requests to the page-owned launcher", () => {
    const onCreate = vi.fn();

    render(<LaunchFirstAgentEmptyState onCreate={onCreate} />);

    fireEvent.click(screen.getByRole("button", { name: /^Create an agent/ }));
    expect(onCreate).toHaveBeenCalledOnce();
    expect(screen.getByTestId("agent-launch-entry")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Launch your first agent" })).toHaveClass("whitespace-nowrap");
    expect(screen.queryByText(/Every plan starts with a 7-day free trial/)).not.toBeInTheDocument();
    expect(screen.queryByText("First agent setup wizard")).not.toBeInTheDocument();
  });

  it("does not expose an anonymous draft in the authenticated empty state", () => {
    window.sessionStorage.setItem("hypercli-first-agent-draft", JSON.stringify({
      source: "first-agent-setup",
      name: "private-draft",
      iconIndex: 0,
      category: "General",
      plan: "pro",
    }));

    render(<LaunchFirstAgentEmptyState onCreate={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Launch your first agent" })).toBeInTheDocument();
    expect(screen.queryByText("private-draft")).not.toBeInTheDocument();
  });

  it("ignores stale Collection-scoped empty-state props while Knowledge Hub is unavailable", () => {
    const onCreate = vi.fn();
    const onCreateWorkspace = vi.fn();

    render(
      <LaunchFirstAgentEmptyState
        onCreate={onCreate}
        workspaceName="Stale Collection"
        hasAccountAgents
        onCreateWorkspace={onCreateWorkspace}
      />,
    );

    expect(screen.getByRole("heading", { name: "Launch another agent" })).toBeInTheDocument();
    expect(screen.queryByText(/Collection/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Create an agent/ }));
    expect(onCreate).toHaveBeenCalledOnce();
    expect(onCreateWorkspace).not.toHaveBeenCalled();
  });

  it("replaces the blocked agent action with a friendly Collection setup CTA", () => {
    releaseBoundaryMock.knowledgeHubAvailable = true;
    const onCreate = vi.fn();
    const onCreateWorkspace = vi.fn();

    render(
      <LaunchFirstAgentEmptyState
        onCreate={onCreate}
        creationDisabledReason="Select a Collection before launching an agent."
        onCreateWorkspace={onCreateWorkspace}
      />,
    );

    const createWorkspace = screen.getByRole("button", { name: /create your first collection/i });
    expect(createWorkspace).toBeEnabled();
    expect(screen.getByText("One quick step, then you can launch your first agent.")).toBeInTheDocument();
    expect(screen.queryByText("Select a Collection before launching an agent.")).not.toBeInTheDocument();

    fireEvent.click(createWorkspace);
    expect(onCreateWorkspace).toHaveBeenCalledOnce();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("keeps the selection guard when Collections exist but none is selected", () => {
    releaseBoundaryMock.knowledgeHubAvailable = true;
    render(
      <LaunchFirstAgentEmptyState
        onCreate={vi.fn()}
        creationDisabledReason="Select a Collection before launching an agent."
      />,
    );

    expect(screen.getByRole("button", { name: /^Create an agent/ })).toBeDisabled();
    expect(screen.getAllByText("Select a Collection before launching an agent.").length).toBeGreaterThan(0);
  });

  it("keeps first-agent onboarding copy for the account General Collection", () => {
    releaseBoundaryMock.knowledgeHubAvailable = true;
    render(
      <LaunchFirstAgentEmptyState
        onCreate={vi.fn()}
        workspaceName="General"
      />,
    );

    expect(screen.getByRole("heading", { name: "Launch your first agent" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Welcome to.*General/i })).not.toBeInTheDocument();
  });

  it("welcomes established users to an empty Collection by name", () => {
    releaseBoundaryMock.knowledgeHubAvailable = true;
    render(
      <LaunchFirstAgentEmptyState
        onCreate={vi.fn()}
        workspaceName="Personal Workspace"
        hasAccountAgents
      />,
    );

    expect(screen.getByRole("heading", { name: "Welcome to Personal Workspace" })).toBeInTheDocument();
    expect(screen.queryByText("Collection roster")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message agent" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Message agent" })).toHaveAttribute(
      "placeholder",
      "Launch an agent to start chatting...",
    );
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });
});

describe("AgentEmptyState", () => {
  it("uses comfortable mobile spacing inside a scroll-safe empty-state boundary", () => {
    render(<AgentEmptyState onCreate={vi.fn()} launchLabel="Launch agent" onLaunchAction={vi.fn()} />);

    expect(screen.getByTestId("agent-launch-empty-state")).toHaveClass("min-h-0", "overflow-x-hidden", "overflow-y-auto");
    expect(screen.getByRole("heading", { name: "Your business, one chat" })).toHaveClass("text-[30px]", "md:text-[38px]", "break-words");
    expect(document.querySelectorAll('[data-slot="agent-feature-empty-state-example"]')).toHaveLength(3);
    expect(screen.getByText(/Ask questions across Slack/).parentElement).toHaveClass("min-h-16", "items-center", "text-[13px]", "text-left", "md:flex-col", "md:min-h-[118px]");
    expect(screen.getByRole("button", { name: "Launch agent" })).toHaveClass("h-12", "md:h-10");
    expect(screen.getByTestId("agent-launch-entry")).toHaveAccessibleName("Launch agent");
  });
});

describe("anonymous agent previews", () => {
  const previews: Array<{
    title: string;
    description: string;
    imageAlt: string;
    imageSrc: string;
    disabled: boolean;
    renderPreview: (onLaunchAction: () => void) => ReactNode;
  }> = [
    {
      title: "Your business, one chat",
      description: "One conversation that reaches Slack, email, docs, and your CRM — and acts on what it finds.",
      imageAlt: "Agent summarizing a customer renewal call and highlighting risk",
      imageSrc: "/images/team-trial/feature-image-01.png",
      disabled: false,
      renderPreview: (onLaunchAction: () => void) => (
        <AgentEmptyState onCreate={vi.fn()} onLaunchAction={onLaunchAction} launchLabel="Launch agent" anonymousPreview />
      ),
    },
    {
      title: "Your files, working for you",
      description: "Ask in plain language. Your agent reads thousands of documents and returns the answer, not a folder.",
      imageAlt: "Chat composer attaching a vendor contract PDF",
      imageSrc: "/images/team-trial/feature-image-02.png",
      disabled: false,
      renderPreview: (onLaunchAction: () => void) => (
        <AgentFilesEmptyState onCreate={vi.fn()} onLaunchAction={onLaunchAction} launchLabel="Launch agent" anonymousPreview />
      ),
    },
    {
      title: "Your stack, unified",
      description: "One request, every tool. Your agent pulls the data, updates the records, and closes the loop.",
      imageAlt: "Connected Gmail, HubSpot, Linear, and Slack workflow",
      imageSrc: "/images/team-trial/feature-image-03.png",
      disabled: false,
      renderPreview: (onLaunchAction: () => void) => (
        <AgentIntegrationsEmptyState onCreate={vi.fn()} onLaunchAction={onLaunchAction} launchLabel="Launch agent" anonymousPreview />
      ),
    },
    {
      title: "Your expertise, reusable",
      description: "Package a workflow once. Anyone on the team runs it with a single command.",
      imageAlt: "Agent skills catalog with active and available skills",
      imageSrc: "/images/team-trial/feature-image-04.png",
      disabled: false,
      renderPreview: (onLaunchAction: () => void) => (
        <AgentSkillsEmptyState onCreate={vi.fn()} onLaunchAction={onLaunchAction} launchLabel="Launch agent" anonymousPreview />
      ),
    },
    {
      title: "Your work, on autopilot",
      description: "Reports, monitors, and follow-ups run on their own — and land where your team already works.",
      imageAlt: "Recurring weekday standup automation schedule",
      imageSrc: "/images/team-trial/feature-image-05.png",
      disabled: true,
      renderPreview: () => <AgentScheduledEmptyState anonymousPreview />,
    },
    {
      title: "Your agent's desktop",
      description: "No API, no problem. Your agent works inside browser tools the same way your team does.",
      imageAlt: "Remote desktop opening inside a HyperCLI browser tab",
      imageSrc: "/images/team-trial/feature-image-06.png",
      disabled: false,
      renderPreview: (onLaunchAction: () => void) => (
        <AgentDesktopEmptyState onCreate={vi.fn()} onLaunchAction={onLaunchAction} launchLabel="Launch agent" anonymousPreview />
      ),
    },
  ];

  it.each(previews)("renders $title as an image-led card", ({ title, description, imageAlt, imageSrc, disabled, renderPreview }) => {
    const onLaunchAction = vi.fn();
    render(renderPreview(onLaunchAction));

    const preview = document.querySelector('[data-slot="agent-anonymous-feature-preview"]');
    expect(preview).toHaveClass("aspect-[1.1]", "rounded-[3.08cqw]");
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByText(description)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: imageAlt })).toHaveAttribute("src", imageSrc);

    const launchButton = screen.getByRole("button", { name: "Launch agent" });
    expect(launchButton).toHaveProperty("disabled", disabled);
    fireEvent.click(launchButton);
    expect(onLaunchAction).toHaveBeenCalledTimes(disabled ? 0 : 1);
  });
});

describe("AgentScheduledEmptyState", () => {
  it("presents scheduled workflows as coming soon while they are under review", () => {
    render(<AgentScheduledEmptyState />);

    expect(screen.getByTestId("agent-scheduled-empty-state")).toHaveClass("overflow-y-auto");
    expect(screen.getByRole("heading", { name: "Scheduled work is coming soon" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Coming soon" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Launch agent" })).not.toBeInTheDocument();
  });
});

describe("AgentDesktopEmptyState", () => {
  it("launches Desktop when it is enabled", () => {
    const onLaunchAction = vi.fn();
    render(
      <AgentDesktopEmptyState
        onCreate={vi.fn()}
        desktopEnabled
        settingsHref="/dashboard/agents?view=settings&settings=agent&agentId=agent-1#agent-desktop-setting"
        onLaunchAction={onLaunchAction}
      />,
    );

    expect(screen.getByRole("heading", { name: "Your agent's desktop" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Launch desktop" }));
    expect(onLaunchAction).toHaveBeenCalledOnce();
  });

  it("links directly to the Desktop setting when it is disabled", () => {
    const onLaunchAction = vi.fn();
    const settingsHref = "/dashboard/agents?view=settings&settings=agent&agentId=agent-1#agent-desktop-setting";
    render(
      <AgentDesktopEmptyState
        onCreate={vi.fn()}
        desktopEnabled={false}
        settingsHref={settingsHref}
        onLaunchAction={onLaunchAction}
      />,
    );

    expect(screen.getByRole("link", { name: "Enable in settings" })).toHaveAttribute("href", settingsHref);
    expect(onLaunchAction).not.toHaveBeenCalled();
  });
});

describe("AgentList", () => {
  it("does not render the desktop agents/channels sidebar below the desktop breakpoint", () => {
    renderAgentList({ isDesktopViewport: false });

    expect(screen.queryByRole("button", { name: /select test agent/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /launch agent/i })).not.toBeInTheDocument();
  });

  it("renders the shared collapsed rail when mobile navigation requests it", () => {
    const props = renderAgentList({ isDesktopViewport: false, renderMobileNavigation: true });

    expect(screen.getByRole("button", { name: "Select Test Agent" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand agents sidebar" }));
    expect(props.setSidebarCollapsed).toHaveBeenCalledWith(false);
  });

  it("selects an agent directly from the mobile rail", () => {
    const supportAgent = { ...agent, id: "agent-2", name: "Support Agent" };
    const props = renderAgentList({
      isDesktopViewport: false,
      renderMobileNavigation: true,
      agents: [agent, supportAgent],
      syntheticThreads: [agentThread(agent), agentThread(supportAgent)],
    });

    expect(screen.queryByRole("button", { name: /^Move / })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select Support Agent" }));

    expect(props.setSelectedAgentId).toHaveBeenCalledWith("agent-2");
    expect(props.setMobileShowChat).toHaveBeenCalledWith(true);
    expect(props.setSidebarCollapsed).not.toHaveBeenCalled();
  });

  it("renders every account agent independently of hidden Collection state", () => {
    const supportAgent = { ...agent, id: "agent-2", name: "Support Agent" };
    const agents = [agent, supportAgent, stoppedAgent];
    renderAgentList({
      sidebarCollapsed: false,
      agents,
      syntheticThreads: agents.map(agentThread),
    });

    expect(screen.getAllByText("Test Agent").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Support Agent").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Stopped Agent").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Collection/)).not.toBeInTheDocument();
  });

  it("renders the agent profile image in the collapsed roster", () => {
    const profileImageUrl = "https://cdn.example.test/agent.png";
    renderAgentList({ agents: [{ ...agent, avatarUrl: profileImageUrl }] });

    const button = screen.getByRole("button", { name: "Select Test Agent" });
    expect(button.querySelector("img")).toHaveAttribute("src", profileImageUrl);
  });

  it("delegates mobile navigation launch requests without opening an out-of-sheet portal", () => {
    const onOpenAgentLauncher = vi.fn();
    renderAgentList({
      isDesktopViewport: false,
      renderMobileNavigation: true,
      onOpenAgentLauncher,
    });

    fireEvent.click(screen.getByRole("button", { name: "Launch agent" }));
    expect(onOpenAgentLauncher).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("First agent setup wizard")).not.toBeInTheDocument();
  });

  it("lets the expanded mobile agents pane return to the workspace pane", () => {
    const supportAgent = { ...agent, id: "agent-2", name: "Support Agent" };
    const props = renderAgentList({
      sidebarCollapsed: false,
      isDesktopViewport: false,
      renderMobileNavigation: true,
      embeddedInNavigation: true,
      agents: [agent, supportAgent],
      syntheticThreads: [agentThread(agent), agentThread(supportAgent)],
    });

    expect(screen.queryByRole("button", { name: /^Move / })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(props.setSidebarCollapsed).toHaveBeenCalledWith(true);
  });

  it("expands the agents/channels sidebar when an agent is selected", () => {
    const props = renderAgentList();
    const shell = document.querySelector(".agents-roster-shell");

    expect(shell).toHaveClass("w-12");
    expect(shell).not.toHaveClass("w-52");

    fireEvent.click(screen.getByRole("button", { name: /select test agent/i }));
    expect(props.setSidebarCollapsed).toHaveBeenCalledWith(false);
    expect(props.setSelectedAgentId).toHaveBeenCalledWith("agent-1");
    expect(props.setMobileShowChat).toHaveBeenCalledWith(true);
  });

  it("only collapses the expanded agents/channels sidebar from its explicit collapse control", () => {
    const props = renderAgentList({ sidebarCollapsed: false });
    const shell = document.querySelector(".agents-roster-shell");

    expect(shell).toHaveClass("w-52");
    expect(shell).not.toHaveClass("w-12");

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(props.setSidebarCollapsed).toHaveBeenCalledWith(true);
  });

  it("shows the offline-agent toggle inside the shared navigation body", () => {
    const agents = [agent, stoppedAgent];
    const props = renderAgentList({
      sidebarCollapsed: false,
      embeddedInNavigation: true,
      agents,
      syntheticThreads: agents.map(agentThread),
    });

    expect(document.querySelector(".agents-roster-header")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Show offline agents" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("heading", { name: "Agents" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/dashboard/agents?view=overview");
    expect(screen.queryByRole("link", { name: /Alt Home/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(props.setSidebarCollapsed).toHaveBeenCalledWith(true);
  });

  it("hides the Knowledge Hub navigation entry while the surface is unavailable", () => {
    const onOpenKnowledgeHub = vi.fn();
    renderAgentList({
      sidebarCollapsed: false,
      embeddedInNavigation: true,
      onOpenKnowledgeHub,
      knowledgeHubActive: true,
    });

    expect(screen.queryByRole("button", { name: /Knowledge Hub/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Knowledge Hub/i })).not.toBeInTheDocument();
    expect(onOpenKnowledgeHub).not.toHaveBeenCalled();
  });

  it("shows Administration actions in the embedded collapsed rail", () => {
    renderAgentList({ embeddedInNavigation: true });

    expect(document.querySelector(".agents-roster-header")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand agents sidebar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Test Agent" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/dashboard/agents?view=overview");
    expect(screen.queryByRole("link", { name: /Alt Home/i })).not.toBeInTheDocument();
    // Release-gated surfaces stay hidden while unavailable.
    expect(screen.queryByRole("link", { name: "Knowledge Hub" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Members" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Launch agent" })).toBeInTheDocument();
    expect(screen.queryByText("Shared")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Usage" })).toHaveAttribute("href", "/dashboard/agents?view=usage");
    fireEvent.click(screen.getByRole("button", { name: "Account links" }));
    expect(screen.getByRole("menuitem", { name: "Settings" })).toBeInTheDocument();
  });

  it("places primary navigation above My Agents and Administration below it", () => {
    renderAgentList({ sidebarCollapsed: false });

    const rosterHeader = document.querySelector(".agents-roster-header");
    const actions = document.querySelector(".agents-roster-actions");
    const sectionHeader = document.querySelector(".agents-roster-section-header");
    const search = screen.getByRole("button", { name: "Search agents" });
    const collapse = screen.getByRole("button", { name: "Collapse sidebar" });

    expect(actions).toContainElement(collapse);
    expect(sectionHeader).toContainElement(screen.getByRole("heading", { name: /^My Agents/ }));
    expect(screen.queryByRole("button", { name: /^My Agents/ })).not.toBeInTheDocument();
    expect(sectionHeader).toContainElement(search);
    const myAgentsLabel = screen.getByText(/^My Agents\(\d+\)$/);
    expect(myAgentsLabel).toHaveClass("text-[13px]", "text-text-secondary");
    expect(myAgentsLabel).not.toHaveClass("uppercase");
    expect(screen.getByText("Administration")).toBeInTheDocument();
    expect(sectionHeader).toHaveClass("pl-7", "pr-3");
    expect(sectionHeader?.querySelector(".h-px")).not.toBeInTheDocument();
    expect(document.querySelector(".agents-roster-administration")).toBeInTheDocument();
    const agentList = document.querySelector(".agents-roster-agent-list");
    const home = document.querySelector(".agents-roster-home");
    const administration = document.querySelector(".agents-roster-administration");
    expect(actions?.nextElementSibling).toBe(home);
    expect(home?.nextElementSibling).toBe(sectionHeader);
    expect(agentList?.nextElementSibling).toBe(administration);
    expect(rosterHeader).not.toContainElement(search);
    expect(rosterHeader).not.toContainElement(collapse);

    fireEvent.click(search);
    const searchRow = document.querySelector(".agents-roster-search");
    expect(searchRow).toContainElement(screen.getByPlaceholderText("Search Agents"));
    expect(searchRow?.firstElementChild).toHaveClass("px-4", "pb-3", "pt-2");
    expect(sectionHeader).toContainElement(screen.getByRole("button", { name: "Close search" }));
    expect(document.querySelector(".agents-roster-section-header")).toBeInTheDocument();
  });

  it("opens the launch agent wizard from the expanded agents list button", () => {
    renderAgentList({ sidebarCollapsed: false });

    fireEvent.click(screen.getByRole("button", { name: /launch agent/i }));
    expect(screen.getByText("First agent setup wizard")).toBeInTheDocument();
  });

  it("closes the launcher after a delegated creation succeeds", async () => {
    const onCreateAgent = vi.fn(async () => "created-agent");
    renderAgentList({ sidebarCollapsed: false, onCreateAgent });

    fireEvent.click(screen.getByRole("button", { name: "Launch agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));

    await waitFor(() => expect(screen.queryByText("First agent setup wizard")).not.toBeInTheDocument());
    expect(onCreateAgent).toHaveBeenCalledOnce();
  });

  it("waits for stopped storage, verifies the workspace, clears stale config, then starts once", async () => {
    const operations: string[] = [];
    const storedFiles = new Map<string, Uint8Array>();
    const createOpenClawAgent = vi.fn(async (_token: string, _options?: Record<string, unknown>) => {
      operations.push("create-creating");
      return { id: "created-agent", state: "CREATING" };
    });
    const fileWriteBytes = vi.fn(async (_agentId: string, path: string, content: ArrayBuffer) => {
      operations.push(`write:${path}`);
      storedFiles.set(path, new Uint8Array(content).slice());
    });
    const fileReadBytes = vi.fn(async (_agentId: string, path: string) => {
      operations.push(`read:${path}`);
      return storedFiles.get(path)?.slice() ?? new Uint8Array();
    });
    const fileDelete = vi.fn(async (_agentId: string, path: string) => {
      operations.push(`delete:${path}`);
      storedFiles.delete(path);
    });
    const waitForState = vi.fn(async () => {
      operations.push("wait-stopped");
      return { id: "created-agent", state: "STOPPED" };
    });
    agentClientMocks.startAgent.mockImplementation(async () => {
      operations.push("start");
    });
    agentClientMocks.createAgentClient.mockReturnValue({
      fileWriteBytes,
      fileReadBytes,
      fileDelete,
      waitForState,
      start: vi.fn(),
    });
    const fetchAgents = vi.fn(async () => {
      operations.push("refresh");
      return true;
    });
    const setSelectedAgentId = vi.fn();
    renderAgentList({
      sidebarCollapsed: false,
      createOpenClawAgent,
      fetchAgents,
      setSelectedAgentId,
    });

    fireEvent.click(screen.getByRole("button", { name: "Launch agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish setup with starter files" }));

    await waitFor(() => expect(setSelectedAgentId).toHaveBeenCalledWith("created-agent"));
    expect(createOpenClawAgent).toHaveBeenCalledOnce();
    expect(createOpenClawAgent.mock.calls[0]?.[1]).not.toHaveProperty("start");
    expect(createOpenClawAgent.mock.calls[0]?.[1]).not.toHaveProperty("config");
    expect(fileWriteBytes).toHaveBeenCalledWith(
      "created-agent",
      ".openclaw/workspace/AGENTS.md",
      expect.anything(),
    );
    expect(fileWriteBytes.mock.calls.map((call) => call[1])).toEqual([
      ".openclaw/workspace/AGENTS.md",
      ".openclaw/workspace/BOOTSTRAP.md",
    ]);
    expect(fileReadBytes.mock.calls.map((call) => call[1])).toEqual(
      fileWriteBytes.mock.calls.map((call) => call[1]),
    );
    expect(fileWriteBytes.mock.calls[0]).toHaveLength(3);
    expect(fileDelete).toHaveBeenCalledWith("created-agent", ".openclaw/openclaw.json");
    expect(fileDelete).toHaveBeenCalledWith("created-agent", ".openclaw/workspace/SOUL.md");
    expect(fileDelete).toHaveBeenCalledWith("created-agent", ".openclaw/workspace/IDENTITY.md");
    expect(fileDelete).toHaveBeenCalledWith("created-agent", ".openclaw/workspace/USER.md");
    expect(fileDelete).toHaveBeenCalledWith("created-agent", ".openclaw/workspace/MEMORY.md");
    expect(waitForState).toHaveBeenCalledWith("created-agent", ["STOPPED"]);
    expect(agentClientMocks.startAgent).toHaveBeenCalledWith(expect.any(String), "created-agent");
    expect(agentClientMocks.startAgent).toHaveBeenCalledOnce();
    expect(operations).toEqual([
      "create-creating",
      "wait-stopped",
      "refresh",
      "write:.openclaw/workspace/AGENTS.md",
      "read:.openclaw/workspace/AGENTS.md",
      "write:.openclaw/workspace/BOOTSTRAP.md",
      "read:.openclaw/workspace/BOOTSTRAP.md",
      "delete:.openclaw/openclaw.json",
      "delete:.openclaw/workspace/SOUL.md",
      "delete:.openclaw/workspace/IDENTITY.md",
      "delete:.openclaw/workspace/USER.md",
      "delete:.openclaw/workspace/MEMORY.md",
      "refresh",
      "start",
      "refresh",
    ]);
  });

  it("does not create an Agent when a canonical workspace file cannot be read", async () => {
    const createOpenClawAgent = vi.fn(async () => ({ id: "should-not-exist" }));
    const setError = vi.fn();
    renderAgentList({
      sidebarCollapsed: false,
      createOpenClawAgent,
      setError,
    });

    fireEvent.click(screen.getByRole("button", { name: "Launch agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish setup with unreadable files" }));

    await waitFor(() => expect(setError).toHaveBeenCalledWith(
      expect.stringContaining("AGENTS.md could not be read as UTF-8 Markdown: browser file read failed"),
    ));
    expect(createOpenClawAgent).not.toHaveBeenCalled();
  });

  it("associates a created agent before selecting it", async () => {
    releaseBoundaryMock.knowledgeHubAvailable = true;
    const operations: string[] = [];
    const createOpenClawAgent = vi.fn(async () => {
      operations.push("create");
      return { id: "created-agent" };
    });
    const associateCreatedAgent = vi.fn(async () => {
      operations.push("associate");
    });
    agentClientMocks.startAgent.mockImplementation(async () => {
      operations.push("start");
    });
    const fetchAgents = vi.fn(async () => {
      operations.push("refresh");
    });
    const setSelectedAgentId = vi.fn();
    renderAgentList({
      sidebarCollapsed: false,
      createOpenClawAgent,
      associateCreatedAgent,
      fetchAgents,
      setSelectedAgentId,
    });

    fireEvent.click(screen.getByRole("button", { name: "Launch agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));

    await waitFor(() => expect(setSelectedAgentId).toHaveBeenCalledWith("created-agent"));
    expect(associateCreatedAgent).toHaveBeenCalledWith("created-agent", "knowledge-collection-1");
    expect(operations).toEqual(["create", "refresh", "associate", "refresh", "start", "refresh"]);
  });

  it("does not select an agent when Collection association fails", async () => {
    releaseBoundaryMock.knowledgeHubAvailable = true;
    const setSelectedAgentId = vi.fn();
    const setError = vi.fn();
    renderAgentList({
      sidebarCollapsed: false,
      associateCreatedAgent: vi.fn(async () => { throw new Error("Roster refresh failed"); }),
      setSelectedAgentId,
      setError,
    });

    fireEvent.click(screen.getByRole("button", { name: "Launch agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));

    await waitFor(() => expect(setError).toHaveBeenCalledWith(
      "Agent was created, but Collection assignment did not complete: Roster refresh failed",
    ));
    expect(setSelectedAgentId).not.toHaveBeenCalled();
  });

  it("does not select an associated agent when the account roster cannot refresh", async () => {
    releaseBoundaryMock.knowledgeHubAvailable = true;
    const setSelectedAgentId = vi.fn();
    const setError = vi.fn();
    const associateCreatedAgent = vi.fn(async () => undefined);
    renderAgentList({
      sidebarCollapsed: false,
      associateCreatedAgent,
      fetchAgents: vi.fn(async () => false),
      setSelectedAgentId,
      setError,
    });

    fireEvent.click(screen.getByRole("button", { name: "Launch agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));

    await waitFor(() => expect(setError).toHaveBeenCalledWith(
      "Agent was created, but agents could not be refreshed.",
    ));
    expect(associateCreatedAgent).toHaveBeenCalledWith("created-agent", "knowledge-collection-1");
    expect(setSelectedAgentId).not.toHaveBeenCalled();
  });

  it("blocks launch entry points without Collection admin access", async () => {
    releaseBoundaryMock.knowledgeHubAvailable = true;
    const props = renderAgentList({
      sidebarCollapsed: false,
      sidebarCreatorSignal: 1,
      agentCreationDisabledReason: "Collection admin access is required to add agents.",
    });

    const launch = screen.getByRole("button", { name: "Launch agent" });
    expect(launch).toBeDisabled();
    expect(screen.getByText("Collection admin access is required to add agents.")).toBeInTheDocument();
    await waitFor(() => expect(props.setError).toHaveBeenCalledWith("Collection admin access is required to add agents."));
    expect(screen.queryByText("First agent setup wizard")).not.toBeInTheDocument();
  });

  it("ignores a stale Collection assignment from the launcher while Knowledge Hub is unavailable", async () => {
    const associateCreatedAgent = vi.fn(async () => undefined);
    const setSelectedAgentId = vi.fn();
    renderAgentList({
      sidebarCollapsed: false,
      associateCreatedAgent,
      setSelectedAgentId,
    });

    fireEvent.click(screen.getByRole("button", { name: "Launch agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));

    await waitFor(() => expect(setSelectedAgentId).toHaveBeenCalledWith("created-agent"));
    expect(associateCreatedAgent).not.toHaveBeenCalled();
    expect(screen.queryByText(/Collection/)).not.toBeInTheDocument();
  });

  it("shows an Agents-only loading status instead of stale roster agents", () => {
    renderAgentList({ rosterLoading: true });

    expect(document.querySelector(".agents-roster-shell")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Loading agents");
    // Collection-scoped announcements must never surface while Knowledge Hub is hidden.
    expect(screen.queryByText(/Collection/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select Test Agent" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Launch agent" })).toBeDisabled();
  });

  it("opens a signaled launcher after temporary roster loading finishes", async () => {
    const props = createAgentListProps({ sidebarCollapsed: false, rosterLoading: true, sidebarCreatorSignal: 1 });
    const view = renderWithClient(<AgentList {...props} />);

    expect(screen.queryByText("First agent setup wizard")).not.toBeInTheDocument();
    view.rerender(<AgentList {...props} rosterLoading={false} />);

    expect(await screen.findByText("First agent setup wizard")).toBeInTheDocument();
  });

  it("keeps the launcher mounted while a higher-priority flow is active", async () => {
    const props = createAgentListProps({
      sidebarCollapsed: false,
      sidebarCreatorSignal: 1,
      agentLauncherSuspended: true,
    });
    const view = renderWithClient(<AgentList {...props} />);

    const overlay = await screen.findByTestId("agent-launcher-overlay");
    expect(overlay).toHaveAttribute("aria-hidden", "true");
    expect(overlay).toHaveClass("invisible", "pointer-events-none");
    expect(screen.getByText("First agent setup wizard")).toBeInTheDocument();

    view.rerender(<AgentList {...props} agentLauncherSuspended={false} />);
    expect(overlay).not.toHaveAttribute("aria-hidden");
    expect(overlay).not.toHaveClass("invisible", "pointer-events-none");
    expect(screen.getByText("First agent setup wizard")).toBeInTheDocument();
  });

  it("keeps a query-triggered agent launcher closed after dismissal", async () => {
    renderAgentList({ sidebarCollapsed: false, sidebarCreatorSignal: 1 });

    expect(screen.getByText("First agent setup wizard")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close agent creation" }));
    await waitFor(() => expect(screen.queryByText("First agent setup wizard")).not.toBeInTheDocument());
  });

  it("closes the agent launcher when an agent is selected", async () => {
    const props = renderAgentList({ sidebarCreatorSignal: 1 });

    expect(await screen.findByText("First agent setup wizard")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /select test agent/i, hidden: true }));

    await waitFor(() => expect(screen.queryByText("First agent setup wizard")).not.toBeInTheDocument());
    expect(props.setSelectedAgentId).toHaveBeenCalledWith("agent-1");
  });

  it("keeps expanded launch and agent rows compact when reordering is available", () => {
    const agents = [agent, failedAgent];
    renderAgentList({
      sidebarCollapsed: false,
      agents,
      syntheticThreads: agents.map(agentThread),
    });

    const launch = screen.getByRole("button", { name: "Launch agent" });
    expect(launch).toHaveClass("items-center", "gap-1", "pl-1", "pr-2", "py-2");
    expect(launch).not.toHaveClass("border-l-2");
    expect(launch).not.toHaveClass("border-r");
    expect(launch.children[0]).toHaveClass("h-5", "w-5", "rounded-full");
    expect(launch).toHaveTextContent("Create a new workspace");
    const row = screen.getByRole("button", { name: "Select Test Agent" });
    expect(row).toHaveClass("items-center", "gap-1", "pl-1", "pr-2", "py-2");
    expect(row).toHaveClass("border-r", "border-border");
    expect(row).not.toHaveClass("border-l-2");
    expect(screen.getByRole("button", { name: "Move Test Agent" })).toHaveClass(
      "absolute",
      "right-1",
      "w-6",
      "opacity-0",
      "group-hover/row:bg-surface-high",
      "group-hover/row:text-foreground",
      "group-hover/row:opacity-100",
    );
    expect(document.querySelector(".agents-roster-section-header")).toHaveClass("pl-7", "pr-3");
    expect(document.querySelector(".agents-roster-administration")).toBeInTheDocument();
    expect(document.querySelector(".agents-roster-expanded .agents-roster-header")).toHaveClass("bg-background");
    expect(document.querySelector(".agents-roster-expanded .agents-roster-scroll")).toHaveClass("bg-[var(--agent-roster-background)]");
  });

  it("uses display names and omits a redundant sender from agent status", () => {
    const displayAgent: Agent = {
      ...agent,
      id: "agent-marketing",
      name: "rapid-forge-engine",
      displayName: "Marketing",
      managed: false,
    };
    const agents = [agent, displayAgent];
    renderAgentList({
      sidebarCollapsed: false,
      agents,
      syntheticThreads: agents.map(agentThread),
    });

    expect(screen.getAllByText("Marketing")).not.toHaveLength(0);
    expect(screen.getAllByText((_, element) => (
      element?.tagName === "P" && element.textContent === "Connected"
    ))).not.toHaveLength(0);
    expect(screen.queryByText("Test Agent: Connected")).not.toBeInTheDocument();
    expect(screen.queryByText(/rapid-forge-engine/)).not.toBeInTheDocument();
  });

  it("does not expose display-name editing from the agent roster", () => {
    const displayAgent: Agent = {
      ...agent,
      name: "rapid-forge-engine",
      displayName: "Marketing",
      managed: false,
    };
    renderAgentList({
      sidebarCollapsed: false,
      agents: [displayAgent],
      syntheticThreads: [agentThread(displayAgent)],
    });

    expect(screen.queryByRole("button", { name: "Rename agent" })).not.toBeInTheDocument();
  });

  it("shows the launch agent button in the collapsed rail", () => {
    renderAgentList();

    fireEvent.click(screen.getByRole("button", { name: /launch agent/i }));
    expect(screen.getByText("First agent setup wizard")).toBeInTheDocument();
    const overlay = screen.getByTestId("agent-launcher-overlay");
    expect(screen.getByTestId("agent-launcher-dialog")).toHaveClass(
      "h-[calc(100dvh-0.75rem)]",
      "w-[calc(100%-0.75rem)]",
      "max-w-none",
      "sm:h-[calc(100dvh-2rem)]",
    );
    expect(overlay).toHaveClass("bg-black/85", "backdrop-blur-[2px]");
    expect(document.body).toContainElement(overlay);
    expect(document.querySelector(".agents-roster-shell")).not.toContainElement(overlay);
  });

  it("opens Administration actions from the collapsed rail", () => {
    const onOpenAccountSettings = vi.fn();
    const onOpenHome = vi.fn();
    const onOpenMembers = vi.fn();
    const onOpenUsage = vi.fn();
    renderAgentList({
      onOpenAccountSettings,
      accountSettingsActive: true,
      onOpenHome,
      homeActive: true,
      onOpenMembers,
      onOpenUsage,
    });

    const dividers = document.querySelectorAll(".agents-roster-rail-divider");

    expect(dividers).toHaveLength(2);
    expect(dividers[0]).toHaveAttribute("aria-hidden", "true");
    expect(dividers[0]).toHaveClass("my-2");
    expect(document.querySelector(".agents-roster-rail .agents-roster-scroll")).toHaveClass("flex-col", "overflow-hidden");
    expect(document.querySelector(".agents-roster-rail-primary")).toHaveClass("shrink-0", "gap-2");
    expect(document.querySelector(".agents-roster-rail-agents")).toHaveClass("w-full", "shrink", "overflow-y-auto", "py-1");
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("button", { name: "Alt Home" })).not.toBeInTheDocument();
    expect(screen.queryByText("Shared")).not.toBeInTheDocument();
    // Release-gated surfaces stay hidden while unavailable.
    expect(screen.queryByRole("button", { name: "Members" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Usage" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Settings" })).not.toBeInTheDocument();
    expect(onOpenAccountSettings).not.toHaveBeenCalled();
    const primary = document.querySelector(".agents-roster-rail-primary");
    const home = document.querySelector(".agents-roster-rail-home");
    const agents = document.querySelector(".agents-roster-rail-agents");
    const administration = document.querySelector(".agents-roster-rail-administration");
    expect(primary?.nextElementSibling).toBe(home);
    expect(home?.nextElementSibling).toBe(dividers[0]);
    expect(dividers[0]?.nextElementSibling).toBe(agents);
    expect(agents?.nextElementSibling).toBe(dividers[1]);
    expect(dividers[1]?.nextElementSibling).toBe(administration);

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

  it("shows Knowledge Hub and Members in the collapsed rail when the surfaces are available", () => {
    releaseBoundaryMock.knowledgeHubAvailable = true;
    releaseBoundaryMock.membersAvailable = true;
    const onOpenKnowledgeHub = vi.fn();
    const onOpenMembers = vi.fn();
    renderAgentList({
      embeddedInNavigation: true,
      onOpenKnowledgeHub,
      knowledgeHubActive: false,
      onOpenMembers,
      membersActive: false,
    });

    // Collapsed rail renders compact buttons with aria-labels.
    expect(screen.getByRole("button", { name: "Knowledge Hub" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Members" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Knowledge Hub" }));
    fireEvent.click(screen.getByRole("button", { name: "Members" }));
    expect(onOpenKnowledgeHub).toHaveBeenCalledOnce();
    expect(onOpenMembers).toHaveBeenCalledOnce();
  });

  it("shows Knowledge Hub and Members in the expanded sidebar when the surfaces are available", () => {
    releaseBoundaryMock.knowledgeHubAvailable = true;
    releaseBoundaryMock.membersAvailable = true;
    const onOpenKnowledgeHub = vi.fn();
    const onOpenMembers = vi.fn();
    renderAgentList({
      sidebarCollapsed: false,
      onOpenKnowledgeHub,
      onOpenMembers,
    });

    expect(screen.getByRole("button", { name: "Knowledge Hub" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Members" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Knowledge Hub" }));
    fireEvent.click(screen.getByRole("button", { name: "Members" }));
    expect(onOpenKnowledgeHub).toHaveBeenCalledOnce();
    expect(onOpenMembers).toHaveBeenCalledOnce();
  });

  it("opens account settings from the collapsed account menu", () => {
    const operations: string[] = [];
    renderAgentList({
      onOpenAccountSettings: () => operations.push("settings"),
      setSidebarCollapsed: (collapsed) => operations.push(collapsed ? "collapse" : "expand"),
    });

    fireEvent.click(screen.getByRole("button", { name: "Account links" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Settings" }));

    expect(operations).toEqual(["settings"]);
  });

  it("shows stopped agents in the collapsed rail by default", () => {
    renderAgentList({
      agents: [agent, stoppedAgent, failedAgent, startingAgent],
      selectedAgentId: stoppedAgent.id,
      syntheticThreads: [agent, stoppedAgent, failedAgent, startingAgent].map(agentThread),
    });

    expect(screen.getByRole("button", { name: "Select Test Agent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Stopped Agent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Failed Agent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Starting Agent" })).toBeInTheDocument();
  });

  it("does not expose reordering from the collapsed rail", () => {
    const agents = [agent, failedAgent, startingAgent];
    renderAgentList({
      agents,
      syntheticThreads: agents.map(agentThread),
    });

    expect(screen.queryByRole("button", { name: /^Move / })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Select / }).map((button) => button.getAttribute("aria-label"))).toEqual([
      "Select Test Agent",
      "Select Failed Agent",
      "Select Starting Agent",
    ]);
  });

  it("persists expanded roster order across remounts", async () => {
    const agents = [agent, failedAgent, startingAgent];
    const props = createAgentListProps({
      sidebarCollapsed: false,
      agents,
      syntheticThreads: agents.map(agentThread),
    });
    const first = renderWithClient(<AgentList {...props} />);

    fireEvent.keyDown(screen.getByRole("button", { name: "Move Starting Agent" }), { key: "ArrowUp" });

    await waitFor(() => expect(
      screen.getAllByRole("button", { name: /^Select / }).map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Select Test Agent",
      "Select Starting Agent",
      "Select Failed Agent",
    ]));
    expect(JSON.parse(window.localStorage.getItem(AGENT_ROSTER_ORDER_STORAGE_KEY) ?? "null")).toEqual({
      version: 1,
      agentIds: [agent.id, startingAgent.id, failedAgent.id],
    });

    first.unmount();
    renderWithClient(<AgentList {...props} />);

    expect(screen.getAllByRole("button", { name: /^Move / }).map((button) => button.getAttribute("aria-label"))).toEqual([
      "Move Test Agent",
      "Move Starting Agent",
      "Move Failed Agent",
    ]);
  });

  it("keeps agent hover cards available without collapsed reorder controls", () => {
    const agents = [agent, failedAgent];
    renderAgentList({
      agents,
      syntheticThreads: agents.map(agentThread),
    });

    expect(screen.queryByRole("button", { name: /^Move / })).not.toBeInTheDocument();
    expect(screen.getAllByText("agent.example.com")).toHaveLength(2);
  });

  it("shows offline agents by default and remembers when they are hidden", async () => {
    const agents = [agent, stoppedAgent, failedAgent, startingAgent];
    const baseProps = createAgentListProps({
      sidebarCollapsed: false,
      agents,
      syntheticThreads: agents.map(agentThread),
    });

    function Harness() {
      const [collapsed, setCollapsed] = useState(false);
      return <AgentList {...baseProps} sidebarCollapsed={collapsed} setSidebarCollapsed={setCollapsed} />;
    }
    renderWithClient(<Harness />);

    expect(screen.queryByText("Available Agents")).not.toBeInTheDocument();
    expect(screen.getAllByText("Stopped Agent").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Failed Agent").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Starting Agent").length).toBeGreaterThan(0);

    const hideOffline = screen.getByRole("switch", { name: "Show offline agents" });
    expect(hideOffline).toHaveAttribute("aria-checked", "true");
    expect(hideOffline.parentElement).toHaveTextContent("Show Offline(1)");
    fireEvent.click(hideOffline);

    await waitFor(() => expect(screen.queryAllByText("Stopped Agent")).toHaveLength(0));
    expect(screen.getByRole("switch", { name: "Show offline agents" })).toHaveAttribute("aria-checked", "false");

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    const expandSidebar = await screen.findByRole("button", { name: "Expand agents sidebar" });
    expect(screen.queryByRole("button", { name: "Select Stopped Agent" })).not.toBeInTheDocument();
    fireEvent.click(expandSidebar);
    const showOffline = await screen.findByRole("switch", { name: "Show offline agents" });
    expect(screen.queryByText("Stopped Agent")).not.toBeInTheDocument();
    fireEvent.click(showOffline);
    expect(screen.getAllByText("Stopped Agent").length).toBeGreaterThan(0);

    renderWithClient(<AgentList {...baseProps} sidebarCollapsed={false} setSidebarCollapsed={vi.fn()} />);
    expect(screen.getAllByRole("switch", { name: "Show offline agents" }).at(-1)).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getAllByRole("switch", { name: "Show offline agents" }).at(-1)!);
    renderWithClient(<AgentList {...baseProps} sidebarCollapsed={false} setSidebarCollapsed={vi.fn()} />);
    expect(screen.getAllByRole("switch", { name: "Show offline agents" }).at(-1)).toHaveAttribute("aria-checked", "false");
  });

  it("shows a selected stopped agent by default", () => {
    renderAgentList({
      sidebarCollapsed: false,
      agents: [agent, stoppedAgent],
      selectedAgentId: stoppedAgent.id,
      syntheticThreads: [agent, stoppedAgent].map(agentThread),
    });

    expect(screen.getAllByText("Stopped Agent").length).toBeGreaterThan(0);
    expect(screen.getByRole("switch", { name: "Show offline agents" })).toBeInTheDocument();
  });

  it("reorders agents from the drag handle without selecting them", async () => {
    const agents = [agent, failedAgent, startingAgent];
    const setSelectedAgentId = vi.fn();
    const baseProps = createAgentListProps({
      sidebarCollapsed: false,
      agents,
      setSelectedAgentId,
      syntheticThreads: agents.map(agentThread),
    });

    function Harness() {
      const [collapsed, setCollapsed] = useState(false);
      return <AgentList {...baseProps} sidebarCollapsed={collapsed} setSidebarCollapsed={setCollapsed} />;
    }
    renderWithClient(<Harness />);

    expect(screen.getAllByRole("button", { name: /^Move / }).map((button) => button.getAttribute("aria-label"))).toEqual([
      "Move Test Agent",
      "Move Failed Agent",
      "Move Starting Agent",
    ]);

    const startingHandle = screen.getByRole("button", { name: "Move Starting Agent" });
    fireEvent.click(startingHandle);
    expect(setSelectedAgentId).not.toHaveBeenCalled();
    fireEvent.keyDown(startingHandle, { key: "ArrowUp" });

    await waitFor(() => expect(
      screen.getAllByRole("button", { name: /^Move / }).map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Move Test Agent",
      "Move Starting Agent",
      "Move Failed Agent",
    ]));

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.queryByRole("button", { name: /^Move / })).not.toBeInTheDocument();
    await waitFor(() => expect(
      screen.getAllByRole("button", { name: /^Select / }).map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Select Test Agent",
      "Select Starting Agent",
      "Select Failed Agent",
    ]));
  });

  it("links to user settings from the expanded account menu", () => {
    renderAgentList({ sidebarCollapsed: false });

    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /account/i }));
    expect(screen.getByRole("menuitem", { name: /^Settings$/i })).toHaveAttribute("href", "/dashboard/agents?view=settings");
  });

  it("shows sign out as the last account menu option", () => {
    const onLogout = vi.fn();
    renderAgentList({ sidebarCollapsed: false, onLogout });

    fireEvent.click(screen.getByRole("button", { name: /account/i }));
    const menuItems = screen.getAllByRole("menuitem");

    expect(menuItems.at(-1)).toHaveTextContent("Sign out");
    fireEvent.click(menuItems[menuItems.length - 1]);
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("shows a sign-in action instead of private account links for anonymous visitors", () => {
    const onLogin = vi.fn();
    renderAgentList({ sidebarCollapsed: false, onLogin, onLogout: undefined });

    fireEvent.click(screen.getByRole("button", { name: /account/i }));

    expect(screen.getByRole("menuitem", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "API Keys" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign in" }));
    expect(onLogin).toHaveBeenCalledTimes(1);
  });
});

describe("AgentSettingsPanel", () => {
  it("renders the settings sidebar with general content", () => {
    renderAgentSettingsPanel();

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: /settings sections/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "General" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Agent" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Billing" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Usage" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Team" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Profile" })).toBeInTheDocument();
    expect(screen.getByText("Full Name")).toBeInTheDocument();
    expect(screen.getByDisplayValue("John Smith")).toBeInTheDocument();
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByDisplayValue("test@example.com")).toBeDisabled();
    expect(screen.getByText("User UUID")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "User UUID" })).toHaveValue("user-1234567890abcdef");
    expect(screen.getByText("Your account identifier for support and account administration.")).toBeInTheDocument();
    expect(screen.queryByText(/Collection/)).not.toBeInTheDocument();
    expect(screen.getByText("Avatar")).toBeInTheDocument();
    expect(screen.getByText("Upload Image")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.queryByRole("heading", { name: "Agent Settings" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("John Smith"), { target: { value: "Jane Smith" } });
    expect(screen.getByRole("button", { name: "Discard" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    expect(screen.getByRole("button", { name: "Agent" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("heading", { name: "Profile" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Agent Settings" })).toBeInTheDocument();
    expect(screen.getByText("Agent name")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Agent name" })).toHaveValue("Test Agent");
    expect(screen.getByText("Display name")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Agent display name" })).toHaveValue("Test Agent");
    expect(screen.getByRole("textbox", { name: "Agent display name" })).not.toHaveAttribute("readonly");
    expect(screen.getByText(/spaces become dashes.*slack/i)).toBeInTheDocument();
    expect(screen.queryByText("Slack handle")).not.toBeInTheDocument();
    expect(screen.getByText("Default model")).toBeInTheDocument();
    expect(screen.queryByText("Shared knowledge")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Shared knowledge sync selection" })).not.toBeInTheDocument();
    expect(screen.queryByText("Visibility")).not.toBeInTheDocument();
    expect(screen.getByText("Auto-archive idle projects")).toBeInTheDocument();
    expect(screen.getByText("Agent runtime")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stop agent/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Danger Zone" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete agent" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start agent/i })).not.toBeInTheDocument();
  });

  it("uses canonical theme surfaces for settings groups and controls", () => {
    renderAgentSettingsPanel();

    const profileGroup = screen.getByText("Full Name").closest("section");
    expect(profileGroup).toHaveClass("divide-border", "border-border", "bg-surface-low/30");
    expect(profileGroup).not.toHaveClass("divide-foreground", "border-foreground");
    expect(screen.getByDisplayValue("John Smith")).toHaveClass("border-input", "bg-input-background");

    fireEvent.click(screen.getByRole("button", { name: "Usage" }));
    const usageCard = screen.getByText("Usage dashboard").closest("a");
    expect(usageCard).toHaveClass("rounded-xl", "border-border", "bg-surface-low/40");
    expect(usageCard).not.toHaveClass("border-foreground");

    fireEvent.click(screen.getByRole("button", { name: "Team" }));
    const teamGroup = screen.getByText("Shared channels").closest("section");
    expect(teamGroup).toHaveClass("divide-border", "border-border", "bg-surface-low/30");
    expect(teamGroup).not.toHaveClass("divide-foreground", "border-foreground");
    expect(screen.queryByText(/Collection/)).not.toBeInTheDocument();
  });

  it("offers cleanup instead of restart for a failed runtime", () => {
      const onStartAgent = vi.fn();
      const onStopAgent = vi.fn();
      renderAgentSettingsPanel({
        agent: { ...agent, state: "FAILED" },
        onStartAgent,
        onStopAgent,
      });

      fireEvent.click(screen.getByRole("button", { name: "Agent" }));

      const cleanupButton = screen.getByRole("button", { name: "Clean up failed launch" });
      expect(cleanupButton).toBeEnabled();
      expect(screen.queryByRole("button", { name: "Start agent" })).not.toBeInTheDocument();
      fireEvent.click(cleanupButton);
      expect(onStopAgent).toHaveBeenCalledTimes(1);
      expect(onStartAgent).not.toHaveBeenCalled();
  });

  it("offers start and archive after cleanup reaches stopped", () => {
    const onStartAgent = vi.fn();
    const onArchiveAgent = vi.fn();
    renderAgentSettingsPanel({
      agent: { ...agent, state: "STOPPED" },
      onStartAgent,
      onArchiveAgent,
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));

    fireEvent.click(screen.getByRole("button", { name: "Archive agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Start agent" }));
    expect(onArchiveAgent).toHaveBeenCalledTimes(1);
    expect(onStartAgent).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Restore agent" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clean up failed launch" })).not.toBeInTheDocument();
  });

  it("offers restore instead of start for an archived agent", () => {
    const onStartAgent = vi.fn();
    const onRestoreAgent = vi.fn();
    renderAgentSettingsPanel({
      agent: { ...agent, state: "ARCHIVED" },
      onStartAgent,
      onRestoreAgent,
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore agent" }));

    expect(onRestoreAgent).toHaveBeenCalledTimes(1);
    expect(onStartAgent).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Start agent" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive agent" })).not.toBeInTheDocument();
  });

  it("renders archiving as cleanup rather than startup", () => {
    renderAgentSettingsPanel({ agent: { ...agent, state: "ARCHIVING" } });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));

    expect(screen.getByText("Agent is archiving")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archiving agent" })).toBeDisabled();
    expect(screen.getByText("Archiving...")).toBeInTheDocument();
    expect(screen.queryByText("Starting...")).not.toBeInTheDocument();
  });

  it.each(["STOPPED", "ARCHIVED"] as const)("opens the delete confirmation for a %s agent", (state) => {
    const onDeleteAgent = vi.fn();
    renderAgentSettingsPanel({ agent: { ...agent, state }, onDeleteAgent });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete agent" }));

    expect(onDeleteAgent).toHaveBeenCalledTimes(1);
  });

  it("renders the mobile settings section tabs without duplicate header controls", () => {
    renderAgentSettingsPanel({
      isDesktopViewport: false,
    });

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    const navigation = screen.getByRole("navigation", { name: /settings sections/i });
    expect(navigation).toHaveClass("h-11", "rounded-xl", "border-border", "bg-surface-low");
    expect(screen.getByRole("button", { name: "General" })).toHaveClass("rounded-lg", "bg-surface-high");
    expect(screen.queryByRole("button", { name: /open agents sidebar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open workspace sidebar/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Team" }));
    expect(screen.getByRole("button", { name: "Team" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Team" })).toHaveClass("bg-surface-high");
    expect(screen.getByRole("heading", { name: "Team" })).toBeInTheDocument();
    expect(screen.getByText("Shared channels")).toBeInTheDocument();
    expect(screen.queryByText(/Collection/)).not.toBeInTheDocument();
  });

  it("preserves Collection-specific agent settings inside the dormant enabled workflow", () => {
    releaseBoundaryMock.knowledgeHubAvailable = true;
    renderAgentSettingsPanel();

    expect(screen.getByText("Share this ID when someone adds you directly to a Collection.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    expect(screen.getByText("Shared knowledge")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Shared knowledge sync selection" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Visibility" })).toHaveValue("");
    expect(screen.getByText("Collection members")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Team" }));
    expect(screen.getByText("Collection members")).toBeInTheDocument();
  });

  it("signs out from general settings", () => {
    const onLogout = vi.fn();
    renderAgentSettingsPanel({ onLogout });

    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));

    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("copies the resolved account UUID from general settings", async () => {
    renderAgentSettingsPanel({
      getToken: vi.fn(async () => "token"),
      user: {
        id: "did:privy:account-login-id",
        email: "test@example.com",
        name: "John Smith",
      },
    });

    await waitFor(() => expect(screen.getByRole("textbox", { name: "User UUID" })).toHaveValue("user-1234567890abcdef"));
    fireEvent.click(screen.getByRole("button", { name: "Copy user UUID" }));

    await waitFor(() => expect(clipboardMocks.writeClipboardText).toHaveBeenCalledWith("user-1234567890abcdef"));
    expect(screen.getByRole("button", { name: "User UUID copied" })).toHaveTextContent("Copied");
  });

  it("loads and saves the profile name through the SDK", async () => {
    const getToken = vi.fn(async () => "token");
    const onProfileNameChange = vi.fn();
    sdkMocks.userGet.mockResolvedValueOnce({
      userId: "user-1234567890abcdef",
      email: "test@example.com",
      name: "Server Name",
      isActive: true,
      createdAt: "2026-05-05T00:00:00Z",
    });
    sdkMocks.userUpdate.mockResolvedValueOnce({
      userId: "user-1234567890abcdef",
      email: "test@example.com",
      name: "Jane Smith",
      isActive: true,
      createdAt: "2026-05-05T00:00:00Z",
    });

    renderAgentSettingsPanel({ getToken, onProfileNameChange });

    expect(await screen.findByDisplayValue("Server Name")).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("Server Name"), { target: { value: "Jane Smith" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(sdkMocks.userUpdate).toHaveBeenCalledWith({ name: "Jane Smith" });
    });
    expect(onProfileNameChange).toHaveBeenCalledWith("Jane Smith");
    expect(screen.getByText("Profile updated.")).toBeInTheDocument();
  });

  it("loads and uploads the account profile avatar through the SDK", async () => {
    const getToken = vi.fn(async () => "token");
    const onProfileAvatarChange = vi.fn();
    sdkMocks.userGetProfileImage.mockResolvedValueOnce({
      id: "user-1234567890abcdef",
      avatarUrl: "https://cdn.example.test/current.png",
      s3Key: "prod/user-1234567890abcdef/user-1234567890abcdef.png",
    });
    const { container } = renderAgentSettingsPanel({ getToken, onProfileAvatarChange });

    await waitFor(() => expect(sdkMocks.userGetProfileImage).toHaveBeenCalledOnce());
    const input = container.querySelector<HTMLInputElement>('input[type="file"][accept*="image/webp"]');
    expect(input).not.toBeNull();
    const file = new File(["avatar"], "avatar.webp", { type: "image/webp" });
    fireEvent.change(input!, { target: { files: [file] } });
    const localAvatarUrl = screen.getByAltText("Profile avatar").getAttribute("src");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(sdkMocks.userUploadProfileImage).toHaveBeenCalledWith(file));
    expect(onProfileAvatarChange).toHaveBeenLastCalledWith("https://cdn.example.test/account.png", file);
    expect(screen.getByAltText("Profile avatar")).toHaveAttribute("src", localAvatarUrl);
    expect(screen.getByText("Profile updated.")).toBeInTheDocument();
  });

  it("rejects account profile images larger than 2MB before upload", async () => {
    const getToken = vi.fn(async () => "token");
    const { container } = renderAgentSettingsPanel({ getToken });
    await waitFor(() => expect(sdkMocks.userGetProfileImage).toHaveBeenCalledOnce());
    const input = container.querySelector<HTMLInputElement>('input[type="file"][accept*="image/webp"]');
    const file = new File(
      [new Uint8Array(2 * 1024 * 1024 + 1)],
      "avatar.webp",
      { type: "image/webp" },
    );

    fireEvent.change(input!, { target: { files: [file] } });

    expect(screen.getByText("Image must be 2MB or smaller.")).toBeInTheDocument();
    expect(sdkMocks.userUploadProfileImage).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("explains when account profile images are unavailable in the current environment", async () => {
    const getToken = vi.fn(async () => "token");
    sdkMocks.userUploadProfileImage.mockRejectedValueOnce(
      Object.assign(new Error("API Error 404: Not Found"), { statusCode: 404 }),
    );
    const { container } = renderAgentSettingsPanel({ getToken });
    await waitFor(() => expect(sdkMocks.userGetProfileImage).toHaveBeenCalledOnce());
    const input = container.querySelector<HTMLInputElement>('input[type="file"][accept*="image/webp"]');
    const file = new File(["avatar"], "avatar.webp", { type: "image/webp" });

    fireEvent.change(input!, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Profile image updates are not available in this environment.")).toBeInTheDocument();
  });

  it("removes the persisted account profile avatar through the SDK", async () => {
    const getToken = vi.fn(async () => "token");
    const onProfileAvatarChange = vi.fn();
    sdkMocks.userGetProfileImage.mockResolvedValueOnce({
      id: "user-1234567890abcdef",
      avatarUrl: "https://cdn.example.test/current.png",
      s3Key: "prod/user-1234567890abcdef/user-1234567890abcdef.png",
    });
    renderAgentSettingsPanel({ getToken, onProfileAvatarChange });

    const remove = await screen.findByRole("button", { name: "Remove" });
    fireEvent.click(remove);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(sdkMocks.userDeleteProfileImage).toHaveBeenCalledOnce());
    expect(onProfileAvatarChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByText("Profile updated.")).toBeInTheDocument();
  });

  it("uploads a managed agent avatar through the page callback", async () => {
    const onUploadAgentAvatar = vi.fn(async () => "https://cdn.example.test/agent.png");
    const { container } = renderAgentSettingsPanel({ onUploadAgentAvatar });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"][accept*="image/webp"]');
    expect(input).not.toBeNull();
    const file = new File(["avatar"], "agent.webp", { type: "image/webp" });
    fireEvent.change(input!, { target: { files: [file] } });
    const localAvatarUrl = screen.getByAltText("Agent avatar").getAttribute("src");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onUploadAgentAvatar).toHaveBeenCalledWith("agent-1", file));
    expect(screen.getByAltText("Agent avatar")).toHaveAttribute("src", localAvatarUrl);
    expect(screen.getByText("Agent settings updated.")).toBeInTheDocument();
  });

  it("rejects unsupported agent avatar formats before upload", () => {
    const onUploadAgentAvatar = vi.fn(async () => "https://cdn.example.test/agent.png");
    const { container } = renderAgentSettingsPanel({ onUploadAgentAvatar });
    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"][accept*="image/webp"]');
    const file = new File(["svg"], "agent.svg", { type: "image/svg+xml" });

    fireEvent.change(input!, { target: { files: [file] } });

    expect(screen.getByText("Choose a PNG, JPEG, WebP, or GIF image.")).toBeInTheDocument();
    expect(onUploadAgentAvatar).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("removes a persisted managed agent avatar through the page callback", async () => {
    const onDeleteAgentAvatar = vi.fn(async () => undefined);
    const onRequestProductUse = vi.fn(() => false);
    renderAgentSettingsPanel({
      agent: { ...agent, avatarUrl: "https://cdn.example.test/agent.png" },
      onDeleteAgentAvatar,
      onRequestProductUse,
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onDeleteAgentAvatar).toHaveBeenCalledWith("agent-1"));
    expect(onRequestProductUse).not.toHaveBeenCalled();
    expect(screen.getByText("Agent settings updated.")).toBeInTheDocument();
  });

  it("does not offer removal for a metadata-only agent avatar", () => {
    const onDeleteAgentAvatar = vi.fn(async () => undefined);
    renderAgentSettingsPanel({
      agent: {
        ...agent,
        avatarUrl: null,
        meta: { ui: { avatar: { image: "https://cdn.example.test/fallback.png" } } },
      },
      onDeleteAgentAvatar,
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));

    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(onDeleteAgentAvatar).not.toHaveBeenCalled();
  });

  it("restores the metadata avatar after removing a profile image", async () => {
    const onDeleteAgentAvatar = vi.fn(async () => undefined);
    renderAgentSettingsPanel({
      agent: {
        ...agent,
        avatarUrl: "https://cdn.example.test/profile.png",
        meta: { ui: { avatar: { image: "https://cdn.example.test/fallback.png" } } },
      },
      onDeleteAgentAvatar,
    });
    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onDeleteAgentAvatar).toHaveBeenCalledWith("agent-1"));
    expect(screen.getByAltText("Agent avatar")).toHaveAttribute("src", "https://cdn.example.test/fallback.png");
  });

  it("saves the managed agent name independently from its handle-backed display name", async () => {
    const onUpdateAgentProfile = vi.fn(async () => undefined);
    renderAgentSettingsPanel({ onUpdateAgentProfile });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Agent name" }), { target: { value: "Renamed Agent" } });
    expect(screen.getByRole("textbox", { name: "Agent display name" })).toHaveValue("Test Agent");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onUpdateAgentProfile).toHaveBeenCalledWith("agent-1", { name: "Renamed Agent" });
    });
    expect(screen.getByText("Agent settings updated.")).toBeInTheDocument();
  });

  it("requests access before saving agent settings", () => {
    const onUpdateAgentProfile = vi.fn(async () => undefined);
    const onRequestProductUse = vi.fn(() => false);
    renderAgentSettingsPanel({ onUpdateAgentProfile, onRequestProductUse });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Agent name" }), {
      target: { value: "Renamed Agent" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(onRequestProductUse).toHaveBeenCalledOnce();
    expect(onUpdateAgentProfile).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Agent name" })).toHaveValue("Renamed Agent");
    expect(screen.queryByText("Agent settings updated.")).not.toBeInTheDocument();
  });

  it("preserves unsaved settings when the selected agent display name changes", async () => {
    const initialAgent = { ...agent, handle: "research-pilot", displayName: "research-pilot" };
    const { props, rerender } = renderAgentSettingsPanel({ agent: initialAgent });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Agent name" }), {
      target: { value: "Unsaved canonical name" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Additional env" }), {
      target: { value: "CUSTOM_FLAG=unsaved" },
    });

    rerender(<AgentSettingsPanel {...props} agent={{ ...initialAgent, handle: "marketing", displayName: "marketing" }} />);

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Agent display name" })).toHaveValue("Marketing");
    });
    expect(screen.getByRole("textbox", { name: "Agent name" })).toHaveValue("Unsaved canonical name");
    expect(screen.getByRole("textbox", { name: "Additional env" })).toHaveValue("CUSTOM_FLAG=unsaved");
  });

  it("treats unknown management provenance as managed", async () => {
    const onUpdateAgentProfile = vi.fn(async () => undefined);
    renderAgentSettingsPanel({
      agent: { ...agent, managed: null },
      onUpdateAgentProfile,
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Agent display name" }), { target: { value: "@Local_Alias" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onUpdateAgentProfile).toHaveBeenCalledWith("agent-1", { handle: "local_alias" });
    });
  });

  it("clears a managed display handle back to its agent name", async () => {
    const onUpdateAgentProfile = vi.fn(async () => undefined);
    renderAgentSettingsPanel({
      agent: { ...agent, handle: "research-pilot", displayName: "research-pilot" },
      onUpdateAgentProfile,
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Agent display name" }), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onUpdateAgentProfile).toHaveBeenCalledWith("agent-1", { handle: null });
    });
    expect(screen.getByRole("textbox", { name: "Agent display name" })).toHaveValue("Test Agent");
  });

  it("turns a friendly managed display name into a Slack-safe handle", async () => {
    const onUpdateAgentProfile = vi.fn(async () => undefined);
    renderAgentSettingsPanel({ onUpdateAgentProfile });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Agent display name" }), {
      target: { value: "best one in the world" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onUpdateAgentProfile).toHaveBeenCalledWith("agent-1", { handle: "best-one-in-the-world" });
    });
    expect(screen.getByRole("textbox", { name: "Agent display name" })).toHaveValue("Best One In The World");
    expect(screen.getByText("Agent settings updated.")).toBeInTheDocument();
  });

  it("dismisses invalid managed display-name feedback after five seconds", () => {
    const onUpdateAgentProfile = vi.fn(async () => undefined);
    renderAgentSettingsPanel({ onUpdateAgentProfile });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Agent display name" }), {
      target: { value: "Friendly Alias!" },
    });
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

      const message = "Display names must start with a letter or number and contain 2-64 letters, numbers, spaces, underscores, or dashes.";
      expect(screen.getByText(message)).toBeInTheDocument();
      expect(onUpdateAgentProfile).not.toHaveBeenCalled();

      act(() => vi.advanceTimersByTime(4999));
      expect(screen.getByText(message)).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(1));
      expect(screen.queryByText(message)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves Docker image and user additional env while preserving managed launch env", async () => {
    const onUpdateAgentLaunchConfig = vi.fn(async (
      _agentId: string,
      _launchConfig: Record<string, unknown>,
    ) => undefined);
    renderAgentSettingsPanel({
      agent: {
        ...agent,
        launchConfig: {
          ...agent.launchConfig,
          env: {
            ...(agent.launchConfig?.env as Record<string, string>),
            OPENCLAW_GATEWAY_TOKEN: "legacy-token-must-not-replay",
          },
          workspacesSync: { enabled: true, readyOnly: true },
        },
      },
      onUpdateAgentLaunchConfig,
      reportedChannelsReady: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));

    expect(screen.getByRole("textbox", { name: "Agent Docker image" })).toHaveValue("ghcr.io/hypercli/hypercli-openclaw:prod");
    expect(screen.getByRole("textbox", { name: "Additional env" })).toHaveValue("FOO=bar\nHYPER_CUSTOM_FLAG=visible");
    expect(screen.queryByDisplayValue(/OPENCLAW_GATEWAY_TOKEN/)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(/HYPER_API_BASE/)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(/HYPER_WORKSPACES_BOOT_SYNC/)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(/OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES/)).not.toBeInTheDocument();

    const showHyperEnv = screen.getByRole("checkbox", { name: "Show saved HYPER_* variables (dangerous)" });
    expect(showHyperEnv).not.toBeChecked();
    expect(screen.queryByRole("textbox", { name: "Managed HYPER environment variables" })).not.toBeInTheDocument();
    fireEvent.click(showHyperEnv);
    const savedHyperEnv = screen.getByRole("textbox", { name: "Managed HYPER environment variables" });
    expect(savedHyperEnv).not.toHaveAttribute("readonly");
    expect(savedHyperEnv).toHaveValue(
      "HYPER_API_BASE=https://api.hypercli.com\n"
      + "HYPER_WORKSPACES_BOOT_SYNC=1\n"
      + "HYPER_WORKSPACES_SYNC_READY_ONLY=1",
    );
    fireEvent.change(savedHyperEnv, {
      target: {
        value: "HYPER_API_BASE=https://api.dev.hypercli.com\n"
          + "HYPER_WORKSPACES_BOOT_SYNC=1\n"
          + "HYPER_WORKSPACES_SYNC_READY_ONLY=1",
      },
    });

    fireEvent.change(screen.getByRole("textbox", { name: "Agent Docker image" }), {
      target: { value: "ghcr.io/hypercli/hypercli-openclaw:custom" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Additional env" }), {
      target: { value: "FOO=baz\nCUSTOM_FLAG=1\nHYPER_CUSTOM_FLAG=edited" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onUpdateAgentLaunchConfig).toHaveBeenCalledWith("agent-1", {
        image: "ghcr.io/hypercli/hypercli-openclaw:custom",
        env: {
          OPENCLAW_CRON_ENABLED: "0",
          OPENCLAW_DESKTOP_ENABLED: "0",
          HYPER_API_BASE: "https://api.dev.hypercli.com",
          HYPER_WORKSPACES_BOOT_SYNC: "1",
          HYPER_WORKSPACES_DIR: "/home/node/shared",
          HYPER_WORKSPACES_SYNC_READY_ONLY: "1",
          OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES: "0",
          FOO: "baz",
          CUSTOM_FLAG: "1",
          HYPER_CUSTOM_FLAG: "edited",
        },
        routes: {
          openclaw: { port: 18789, auth: false, prefix: "" },
          },
          sync_root: "/home/node",
          sync_uid: 1000,
          sync_gid: 1000,
        });
    });
    const savedLaunchConfig = onUpdateAgentLaunchConfig.mock.calls[0]?.[1];
    expect(savedLaunchConfig).not.toHaveProperty("workspacesSync");
    expect(savedLaunchConfig?.env).not.toHaveProperty("OPENCLAW_GATEWAY_TOKEN");
    expect(screen.getByText("Agent settings updated.")).toBeInTheDocument();
  });

  it("enables Slack with canonical hosted relay environment values", async () => {
    const onUpdateAgentLaunchConfig = vi.fn(async (
      _agentId: string,
      _launchConfig: Record<string, unknown>,
    ) => undefined);
    renderAgentSettingsPanel({ onUpdateAgentLaunchConfig });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    const slackSwitch = screen.getByRole("switch", { name: "Enable Slack" });
    expect(slackSwitch).not.toBeChecked();

    fireEvent.click(slackSwitch);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onUpdateAgentLaunchConfig).toHaveBeenCalledWith("agent-1", expect.objectContaining({
        env: expect.objectContaining({
          HYPER_SLACK_APP_ENABLED: "1",
          HYPER_SLACK_RELAY_URL: "wss://api.hypercli.com/slack/ws",
          HYPER_SLACK_API_URL: "https://api.hypercli.com/slack/api/",
          // Without this the pod dies at boot: the entrypoint hard-throws on a
          // truthy HYPER_SLACK_APP_ENABLED with no gateway id.
          HYPER_SLACK_GATEWAY_ID: "agent:agent-1",
        }),
      }));
    });
  });

  it("saves OpenClaw cron launch setting", async () => {
    const onUpdateAgentLaunchConfig = vi.fn(async () => undefined);
    renderAgentSettingsPanel({ onUpdateAgentLaunchConfig });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    const cronSwitch = screen.getByRole("switch", { name: "Enable cron" });
    expect(cronSwitch).not.toBeChecked();

    fireEvent.click(cronSwitch);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onUpdateAgentLaunchConfig).toHaveBeenCalledWith("agent-1", expect.objectContaining({
        env: expect.objectContaining({
          OPENCLAW_CRON_ENABLED: "1",
        }),
      }));
    });
  });

  it("does not materialize missing cron env when saving unrelated launch settings", async () => {
    const onUpdateAgentLaunchConfig = vi.fn(async () => undefined);
    const { OPENCLAW_CRON_ENABLED: _cronEnabled, ...envWithoutCron } = agent.launchConfig?.env as Record<string, string>;

    renderAgentSettingsPanel({
      agent: {
        ...agent,
        launchConfig: {
          ...agent.launchConfig,
          env: envWithoutCron,
        },
      },
      onUpdateAgentLaunchConfig,
      reportedChannelsReady: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    expect(screen.getByRole("switch", { name: "Enable cron" })).toBeChecked();

    fireEvent.change(screen.getByRole("textbox", { name: "Agent Docker image" }), {
      target: { value: "ghcr.io/hypercli/hypercli-openclaw:custom" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onUpdateAgentLaunchConfig).toHaveBeenCalledOnce());
    const calls = onUpdateAgentLaunchConfig.mock.calls as unknown as Array<[string, { env?: Record<string, string> }]>;
    const savedLaunchConfig = calls[0]?.[1];
    expect(savedLaunchConfig?.env).not.toHaveProperty("OPENCLAW_CRON_ENABLED");
  });

  it("writes cron env when toggling from a missing saved value", async () => {
    const onUpdateAgentLaunchConfig = vi.fn(async () => undefined);
    const { OPENCLAW_CRON_ENABLED: _cronEnabled, ...envWithoutCron } = agent.launchConfig?.env as Record<string, string>;

    renderAgentSettingsPanel({
      agent: {
        ...agent,
        launchConfig: {
          ...agent.launchConfig,
          env: envWithoutCron,
        },
      },
      onUpdateAgentLaunchConfig,
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    const cronSwitch = screen.getByRole("switch", { name: "Enable cron" });
    expect(cronSwitch).toBeChecked();

    fireEvent.click(cronSwitch);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onUpdateAgentLaunchConfig).toHaveBeenCalledWith("agent-1", expect.objectContaining({
        env: expect.objectContaining({
          OPENCLAW_CRON_ENABLED: "0",
        }),
      }));
    });
  });

  it("saves Hermes cron launch setting without OpenClaw env", async () => {
    const onUpdateAgentLaunchConfig = vi.fn(async (
      _agentId: string,
      _launchConfig: Record<string, unknown>,
    ) => undefined);
    renderAgentSettingsPanel({
      agent: {
        ...agent,
        runtime: "hermes-agent",
        hasDesktop: false,
        launchConfig: {
          image: "ghcr.io/hypercli/hypercli-hermes-agent:latest",
          env: {
            HERMES_CRON_ENABLED: "1",
            CUSTOM_FLAG: "kept",
          },
          routes: {
            hermes: { port: 8642, auth: false, prefix: "" },
          },
          sync_root: "/home/hermes",
          sync_uid: 10000,
          sync_gid: 10000,
        },
      },
      onUpdateAgentLaunchConfig,
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    const cronSwitch = screen.getByRole("switch", { name: "Enable cron" });
    expect(cronSwitch).toBeChecked();
    expect(screen.queryByRole("switch", { name: "Enable desktop route" })).not.toBeInTheDocument();

    fireEvent.click(cronSwitch);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onUpdateAgentLaunchConfig).toHaveBeenCalledOnce());
    const savedLaunchConfig = onUpdateAgentLaunchConfig.mock.calls[0]?.[1] as { env?: Record<string, string> };
    expect(savedLaunchConfig?.env).toEqual({
      HERMES_CRON_ENABLED: "0",
      CUSTOM_FLAG: "kept",
    });
    expect(savedLaunchConfig?.env).not.toHaveProperty("OPENCLAW_CRON_ENABLED");
  });

  it("hides and removes hosted Slack environment values when Slack is disabled", async () => {
    const onUpdateAgentLaunchConfig = vi.fn(async (
      _agentId: string,
      _launchConfig: Record<string, unknown>,
    ) => undefined);
    renderAgentSettingsPanel({
      agent: {
        ...agent,
        launchConfig: {
          ...agent.launchConfig,
          env: {
            ...(agent.launchConfig?.env as Record<string, string>),
            HYPER_SLACK_APP_ENABLED: "1",
            HYPER_SLACK_RELAY_URL: "wss://old.example.test/slack/ws",
            HYPER_SLACK_API_URL: "https://old.example.test/slack/api/",
            HYPER_SLACK_GATEWAY_ID: "agent:agent-1",
          },
        },
      },
      onUpdateAgentLaunchConfig,
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    expect(screen.getByRole("textbox", { name: "Additional env" })).not.toHaveValue(
      expect.stringContaining("HYPER_SLACK_"),
    );
    const slackSwitch = screen.getByRole("switch", { name: "Enable Slack" });
    expect(slackSwitch).toBeChecked();

    fireEvent.click(slackSwitch);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onUpdateAgentLaunchConfig).toHaveBeenCalledOnce());
    const savedLaunchConfig = onUpdateAgentLaunchConfig.mock.calls[0]?.[1];
    expect(savedLaunchConfig?.env).not.toHaveProperty("HYPER_SLACK_APP_ENABLED");
    expect(savedLaunchConfig?.env).not.toHaveProperty("HYPER_SLACK_RELAY_URL");
    expect(savedLaunchConfig?.env).not.toHaveProperty("HYPER_SLACK_API_URL");
    expect(savedLaunchConfig?.env).not.toHaveProperty("HYPER_SLACK_GATEWAY_ID");
  });

  it("rejects manual overrides of hosted Slack environment values", async () => {
    const onUpdateAgentLaunchConfig = vi.fn(async (
      _agentId: string,
      _launchConfig: Record<string, unknown>,
    ) => undefined);
    renderAgentSettingsPanel({ onUpdateAgentLaunchConfig });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Additional env" }), {
      target: { value: "HYPER_SLACK_RELAY_URL=wss://unsafe.example.test/ws" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText(
      "HYPER_SLACK_RELAY_URL is managed by the Slack setting and cannot be edited here.",
    )).toBeInTheDocument();
    expect(onUpdateAgentLaunchConfig).not.toHaveBeenCalled();
  });

  it("saves a changed Docker image without writing runtime channel config", async () => {
    const onUpdateAgentLaunchConfig = vi.fn(async () => undefined);
    renderAgentSettingsPanel({
      onUpdateAgentLaunchConfig,
      reportedChannelsReady: true,
      reportedChannels: [
        { channelId: "telegram", configured: true, healthState: "healthy" },
        { channelId: "discord", configured: false, healthState: "unknown" },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Agent Docker image" }), {
      target: { value: "ghcr.io/hypercli/hypercli-openclaw:custom" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByRole("dialog", { name: "Remove channels and change image?" })).toBeInTheDocument();
    expect(screen.getByText(/permanently removing setup for Telegram/i)).toBeInTheDocument();
    expect(onUpdateAgentLaunchConfig).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove channels and save" }));

    await waitFor(() => {
      expect(onUpdateAgentLaunchConfig).toHaveBeenCalledTimes(1);
    });
    const calls = (onUpdateAgentLaunchConfig as unknown as {
      mock: { calls: Array<[unknown, Record<string, unknown>]> };
    }).mock.calls;
    const submittedLaunchConfig = calls[0]?.[1] ?? {};
    expect(submittedLaunchConfig).not.toHaveProperty("config");
  });

  it("blocks Docker image changes until the live channel preflight succeeds", () => {
    const onUpdateAgentLaunchConfig = vi.fn(async () => undefined);
    renderAgentSettingsPanel({ onUpdateAgentLaunchConfig, reportedChannelsReady: false });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Agent Docker image" }), {
      target: { value: "ghcr.io/hypercli/hypercli-openclaw:custom" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByText(/wait for its channels to load before changing the Docker image/i)).toBeInTheDocument();
    expect(onUpdateAgentLaunchConfig).not.toHaveBeenCalled();
  });

  it("lists OpenClaw models without exposing runtime model writes", async () => {
    const onUpdateAgentLaunchConfig = vi.fn(async () => undefined);
    renderAgentSettingsPanel({ onUpdateAgentLaunchConfig });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    const modelSelect = screen.getByRole("combobox", { name: "Default model" });

    expect(modelSelect).toHaveValue("openai/gpt-5-mini");
    expect(screen.getByRole("option", { name: "GPT-5 Mini (OpenAI)" })).toHaveValue("openai/gpt-5-mini");
    expect(screen.getByRole("option", { name: "Claude Sonnet 4.5 (Anthropic)" })).toHaveValue("anthropic/claude-sonnet-4-5");
    expect(screen.getByRole("option", { name: "Gemini 2.5 Pro (Google)" })).toHaveValue("google/gemini-2.5-pro");
    expect(modelSelect).toBeDisabled();
  });

  it("renders a blocked stopped runtime as startable instead of starting", () => {
    renderAgentSettingsPanel({
      agent: { ...agent, state: "STOPPED" },
      agentStarting: false,
      agentStartBlocked: true,
      agentStartBlockedReason: "Agent is finishing shutdown",
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));

    const startButton = screen.getByRole("button", { name: /start agent/i });
    expect(startButton).toBeDisabled();
    expect(startButton).toHaveTextContent("Start agent");
    expect(screen.queryByText("Starting...")).not.toBeInTheDocument();
  });

  it("renders a stopping runtime as stopping instead of starting", () => {
    renderAgentSettingsPanel({
      agent: { ...agent, state: "STOPPING" },
      agentStopping: false,
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));

    const stopButton = screen.getByRole("button", { name: "Stop agent" });
    expect(stopButton).toBeDisabled();
    expect(stopButton).toHaveTextContent("Stopping...");
    expect(screen.getByText("Agent is stopping")).toBeInTheDocument();
    expect(screen.queryByText("Starting...")).not.toBeInTheDocument();
  });

  it("keeps an archiving runtime busy through the terminal archive boundary", () => {
    renderAgentSettingsPanel({
      agent: { ...agent, state: "ARCHIVING" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));

    const archiveButton = screen.getByRole("button", { name: "Archiving agent" });
    expect(archiveButton).toBeDisabled();
    expect(archiveButton).toHaveTextContent("Archiving...");
    expect(screen.getByText("Agent is archiving")).toBeInTheDocument();
    expect(screen.queryByText("Starting...")).not.toBeInTheDocument();
  });

  it.each(["CREATING", "STARTING"] as const)(
    "allows %s startup to be cancelled",
    (state) => {
      const onStopAgent = vi.fn();
      renderAgentSettingsPanel({
        agent: { ...agent, state },
        agentStarting: true,
        onStopAgent,
      });

      fireEvent.click(screen.getByRole("button", { name: "Agent" }));
      const stopButton = screen.getByRole("button", { name: "Stop agent" });
      expect(stopButton).toBeEnabled();
      fireEvent.click(stopButton);
      expect(onStopAgent).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps a restoring runtime busy until it reaches stopped", () => {
    renderAgentSettingsPanel({
      agent: { ...agent, state: "RESTORING" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));

    const restoreButton = screen.getByRole("button", { name: "Restoring agent" });
    expect(restoreButton).toBeDisabled();
    expect(restoreButton).toHaveTextContent("Restoring...");
    expect(screen.getByText("Agent is restoring files")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop agent" })).not.toBeInTheDocument();
  });

  it("confirms Desktop activation and shows one restarting lifecycle action", async () => {
    let finishRestart: (() => void) | null = null;
    const activatedAgent: Agent = {
      ...agent,
      launchEpoch: 1,
      updated_at: "2026-05-05T00:01:00Z",
      launchConfig: {
        ...agent.launchConfig,
        env: {
          ...(agent.launchConfig?.env as Record<string, string>),
          OPENCLAW_DESKTOP_ENABLED: "1",
        },
        routes: {
          ...(agent.launchConfig?.routes as Record<string, unknown>),
          desktop: { port: 3000, auth: true, prefix: "desktop" },
        },
      },
    };
    const onUpdateAgentLaunchConfig = vi.fn(async () => undefined);
    const onEnableDesktopAndRestart = vi.fn(() => new Promise<Agent>((resolve) => {
      finishRestart = () => resolve(activatedAgent);
    }));
    const { props, rerender } = renderAgentSettingsPanel({ onEnableDesktopAndRestart, onUpdateAgentLaunchConfig });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    const desktopSwitch = screen.getByRole("switch", { name: "Enable desktop route" });
    expect(desktopSwitch).not.toBeChecked();

    fireEvent.click(desktopSwitch);
    expect(screen.getByRole("alertdialog", { name: "Enable Desktop access?" })).toBeInTheDocument();
    expect(screen.getByText("Desktop access requires your agent to restart before it becomes available.")).toBeInTheDocument();
    expect(desktopSwitch).not.toBeChecked();
    expect(onEnableDesktopAndRestart).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog", { name: "Enable Desktop access?" })).not.toBeInTheDocument();
    expect(desktopSwitch).not.toBeChecked();

    fireEvent.click(desktopSwitch);
    const confirmButton = screen.getByRole("button", { name: "Enable and Restart" });
    act(() => {
      confirmButton.click();
      confirmButton.click();
    });

    await waitFor(() => expect(onEnableDesktopAndRestart).toHaveBeenCalledOnce());
    expect(onUpdateAgentLaunchConfig).not.toHaveBeenCalled();
    expect(onEnableDesktopAndRestart).toHaveBeenCalledWith("agent-1", expect.objectContaining({
      env: expect.objectContaining({
        OPENCLAW_CRON_ENABLED: "0",
        OPENCLAW_DESKTOP_ENABLED: "1",
      }),
      routes: expect.objectContaining({
        desktop: { port: 3000, auth: true, prefix: "desktop" },
      }),
    }));
    const restartingButton = screen.getByRole("button", { name: "Restarting agent" });
    expect(restartingButton).toBeDisabled();
    expect(restartingButton).toHaveAttribute("aria-busy", "true");
    expect(restartingButton).toHaveTextContent("Restarting...");
    expect(screen.getByText("Agent is restarting")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Enabling Desktop access. Agent restarting.");
    expect(screen.queryByRole("button", { name: "Stop agent" })).not.toBeInTheDocument();
    expect(desktopSwitch).toBeDisabled();
    expect(desktopSwitch).not.toBeChecked();

    await act(async () => finishRestart?.());

    await waitFor(() => expect(desktopSwitch).toBeChecked());
    expect(screen.getByText("Desktop access enabled.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restarting agent" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();

    rerender(<AgentSettingsPanel {...props} agent={{
      ...agent,
      launchEpoch: 2,
      updated_at: "2026-05-05T00:02:00Z",
    }} />);

    await waitFor(() => expect(desktopSwitch).not.toBeChecked());
  });

  it("does not report Desktop activation when the restarted snapshot remains disabled", async () => {
    const onEnableDesktopAndRestart = vi.fn(async (): Promise<Agent> => ({
      ...agent,
      launchEpoch: 1,
      updated_at: "2026-05-05T00:01:00Z",
    }));
    renderAgentSettingsPanel({ onEnableDesktopAndRestart });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    const desktopSwitch = screen.getByRole("switch", { name: "Enable desktop route" });
    fireEvent.click(desktopSwitch);
    fireEvent.click(screen.getByRole("button", { name: "Enable and Restart" }));

    expect(await screen.findByText("The agent restarted, but Desktop access did not become available.")).toBeInTheDocument();
    expect(desktopSwitch).not.toBeChecked();
    expect(screen.queryByText("Desktop access enabled.")).not.toBeInTheDocument();
  });

  it("reflects persisted Desktop config when restart fails after the update", async () => {
    const desktopEnabledAgent: Agent = {
      ...agent,
      state: "STOPPED",
      updated_at: "2026-05-05T00:01:00Z",
      launchConfig: {
        ...agent.launchConfig,
        env: {
          ...(agent.launchConfig?.env as Record<string, string>),
          OPENCLAW_DESKTOP_ENABLED: "1",
        },
        routes: {
          ...(agent.launchConfig?.routes as Record<string, unknown>),
          desktop: { port: 3000, auth: true, prefix: "desktop" },
        },
      },
    };
    let rerenderPanel!: ReturnType<typeof renderAgentSettingsPanel>["rerender"];
    let panelProps!: ComponentProps<typeof AgentSettingsPanel>;
    const onEnableDesktopAndRestart = vi.fn(async (): Promise<Agent> => {
      rerenderPanel(<AgentSettingsPanel {...panelProps} agent={desktopEnabledAgent} />);
      throw new Error("Desktop access was enabled, but the agent could not restart.");
    });
    const rendered = renderAgentSettingsPanel({ onEnableDesktopAndRestart });
    rerenderPanel = rendered.rerender;
    panelProps = rendered.props;

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    const desktopSwitch = screen.getByRole("switch", { name: "Enable desktop route" });
    fireEvent.click(desktopSwitch);
    fireEvent.click(screen.getByRole("button", { name: "Enable and Restart" }));

    expect(await screen.findByText("Desktop access was enabled, but the agent could not restart.")).toBeInTheDocument();
    await waitFor(() => expect(desktopSwitch).toBeChecked());
  });

  it("keeps stopped-agent Desktop changes in the normal save flow", async () => {
    const onUpdateAgentLaunchConfig = vi.fn(async () => undefined);
    const onEnableDesktopAndRestart = vi.fn(async (): Promise<Agent> => agent);
    renderAgentSettingsPanel({
      agent: { ...agent, state: "STOPPED" },
      onEnableDesktopAndRestart,
      onUpdateAgentLaunchConfig,
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    const desktopSwitch = screen.getByRole("switch", { name: "Enable desktop route" });
    fireEvent.click(desktopSwitch);

    expect(screen.queryByRole("alertdialog", { name: "Enable Desktop access?" })).not.toBeInTheDocument();
    expect(desktopSwitch).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onUpdateAgentLaunchConfig).toHaveBeenCalledOnce());
    expect(onEnableDesktopAndRestart).not.toHaveBeenCalled();
  });

  it("saves desktop and workspace launch settings as managed config", async () => {
    releaseBoundaryMock.knowledgeHubAvailable = true;
    const onUpdateAgentLaunchConfig = vi.fn(async () => undefined);
    renderAgentSettingsPanel({ onUpdateAgentLaunchConfig });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.click(screen.getByRole("switch", { name: "Enable desktop route" }));
    fireEvent.click(screen.getByRole("switch", { name: "Ready files only" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Shared knowledge sync selection" }), {
      target: { value: "team-docs" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onUpdateAgentLaunchConfig).toHaveBeenCalledWith("agent-1", expect.objectContaining({
        env: expect.objectContaining({
          OPENCLAW_CRON_ENABLED: "0",
          OPENCLAW_DESKTOP_ENABLED: "1",
          HYPER_WORKSPACES_BOOT_SYNC: "1",
          HYPER_WORKSPACES_DIR: "/home/node/shared",
          HYPER_WORKSPACES_SYNC_READY_ONLY: "0",
          HYPER_WORKSPACES_SYNC_WORKSPACE: "team-docs",
        }),
        routes: expect.objectContaining({
          openclaw: { port: 18789, auth: false, prefix: "" },
          desktop: { port: 3000, auth: true, prefix: "desktop" },
        }),
      }));
    });
  });

  it("removes the desktop route and persists a disabled desktop env flag", async () => {
    const onUpdateAgentLaunchConfig = vi.fn(async () => undefined);
    renderAgentSettingsPanel({
      agent: {
        ...agent,
        launchConfig: {
          ...agent.launchConfig,
          env: {
            ...(agent.launchConfig?.env as Record<string, string>),
            OPENCLAW_DESKTOP_ENABLED: "1",
          },
          routes: {
            ...(agent.launchConfig?.routes as Record<string, unknown>),
            desktop: { port: 3000, auth: true, prefix: "desktop" },
          },
        },
      },
      onUpdateAgentLaunchConfig,
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    expect(screen.getByRole("switch", { name: "Enable desktop route" })).toBeChecked();

    fireEvent.click(screen.getByRole("switch", { name: "Enable desktop route" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onUpdateAgentLaunchConfig).toHaveBeenCalledWith("agent-1", expect.objectContaining({
        env: expect.objectContaining({
          OPENCLAW_CRON_ENABLED: "0",
          OPENCLAW_DESKTOP_ENABLED: "0",
        }),
        routes: {
          openclaw: { port: 18789, auth: false, prefix: "" },
        },
      }));
    });
  });

  it("rehydrates the desktop toggle from saved desktop launch config after refresh", () => {
    const initialAgent = {
      ...agent,
      launchConfig: {
        ...agent.launchConfig,
        env: {
          ...(agent.launchConfig?.env as Record<string, string>),
          OPENCLAW_DESKTOP_ENABLED: "0",
        },
      },
    };
    const refreshedAgent = {
      ...initialAgent,
      launchConfig: {
        ...initialAgent.launchConfig,
        env: {
          ...(initialAgent.launchConfig?.env as Record<string, string>),
          OPENCLAW_DESKTOP_ENABLED: "1",
        },
        routes: {
          ...((initialAgent.launchConfig as Record<string, unknown>).routes as Record<string, unknown>),
          desktop: { port: 3000, auth: true, prefix: "desktop" },
        },
      },
    };
    const { rerender, props } = renderAgentSettingsPanel({ agent: initialAgent });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    expect(screen.getByRole("switch", { name: "Enable desktop route" })).not.toBeChecked();

    rerender(<AgentSettingsPanel {...props} agent={refreshedAgent} />);

    expect(screen.getByRole("switch", { name: "Enable desktop route" })).toBeChecked();
  });

  it("rehydrates the cron toggle from saved launch env after refresh", () => {
    const initialAgent = {
      ...agent,
      launchConfig: {
        ...agent.launchConfig,
        env: {
          ...(agent.launchConfig?.env as Record<string, string>),
          OPENCLAW_CRON_ENABLED: "0",
        },
      },
    };
    const refreshedAgent = {
      ...initialAgent,
      launchConfig: {
        ...initialAgent.launchConfig,
        env: {
          ...(initialAgent.launchConfig?.env as Record<string, string>),
          OPENCLAW_CRON_ENABLED: "1",
        },
      },
    };
    const { rerender, props } = renderAgentSettingsPanel({ agent: initialAgent });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    expect(screen.getByRole("switch", { name: "Enable cron" })).not.toBeChecked();

    rerender(<AgentSettingsPanel {...props} agent={refreshedAgent} />);

    expect(screen.getByRole("switch", { name: "Enable cron" })).toBeChecked();
  });

  it("keeps the desktop toggle disabled when saved env disables a stale desktop route", () => {
    renderAgentSettingsPanel({
      agent: {
        ...agent,
        launchConfig: {
          ...agent.launchConfig,
          env: {
            ...(agent.launchConfig?.env as Record<string, string>),
            OPENCLAW_DESKTOP_ENABLED: "0",
          },
          routes: {
            ...(agent.launchConfig?.routes as Record<string, unknown>),
            desktop: { port: 3000, auth: true, prefix: "desktop" },
          },
        },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));

    expect(screen.getByRole("switch", { name: "Enable desktop route" })).not.toBeChecked();
  });

  it("renders usage when selected", () => {
    renderAgentSettingsPanel();

    fireEvent.click(screen.getByRole("button", { name: "Usage" }));
    expect(screen.getByRole("button", { name: "Usage" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "Usage" })).toBeInTheDocument();
    expect(screen.getByText("Usage dashboard")).toBeInTheDocument();
    expect(screen.getByText("API keys")).toBeInTheDocument();
  });

  it("supports opening a controlled settings section", () => {
    const onSectionChange = vi.fn();
    renderAgentSettingsPanel({ activeSection: "index", onSectionChange });

    expect(screen.getByRole("button", { name: "Index" })).toHaveAttribute("aria-current", "page");
    const heading = screen.getByRole("heading", { name: "Memory index" });
    expect(heading).toBeInTheDocument();
    expect(heading.parentElement?.parentElement).toHaveClass("overflow-x-hidden", "overflow-y-auto");
    expect(screen.getByText("Memory search").parentElement?.parentElement).toHaveClass("min-h-0", "py-4");

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    expect(onSectionChange).toHaveBeenCalledWith("agent");
  });

  it("hides its legacy section navigation when embedded", () => {
    renderAgentSettingsPanel({ activeSection: "index", showSectionNavigation: false });

    expect(screen.queryByRole("navigation", { name: "Settings sections" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Memory index" })).toBeInTheDocument();
  });

  it("saves memory index settings through launch env only", async () => {
    const onUpdateAgentLaunchConfig = vi.fn(async () => undefined);
    renderAgentSettingsPanel({ onUpdateAgentLaunchConfig });

    fireEvent.click(screen.getByRole("button", { name: "Index" }));
    fireEvent.click(screen.getByRole("switch", { name: "Sync on session start" }));
    fireEvent.click(screen.getByRole("switch", { name: "Sync on search" }));
    fireEvent.click(screen.getByRole("switch", { name: "Watch memory files" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Watch debounce seconds" }), {
      target: { value: "60" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Interval sync minutes" }), {
      target: { value: "120" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onUpdateAgentLaunchConfig).toHaveBeenCalledTimes(1));
    expect(onUpdateAgentLaunchConfig).toHaveBeenCalledWith("agent-1", {
      image: "ghcr.io/hypercli/hypercli-openclaw:prod",
      env: {
        OPENCLAW_DESKTOP_ENABLED: "0",
        OPENCLAW_CRON_ENABLED: "0",
        HYPER_API_BASE: "https://api.hypercli.com",
        HYPER_WORKSPACES_BOOT_SYNC: "1",
        HYPER_WORKSPACES_DIR: "/home/node/shared",
        HYPER_WORKSPACES_SYNC_READY_ONLY: "1",
        OPENCLAW_MEMORY_SEARCH_ENABLED: "1",
        OPENCLAW_MEMORY_SEARCH_SYNC_ON_SESSION_START: "1",
        OPENCLAW_MEMORY_SEARCH_SYNC_ON_SEARCH: "1",
        OPENCLAW_MEMORY_SEARCH_SYNC_WATCH: "1",
        OPENCLAW_MEMORY_SEARCH_SYNC_WATCH_DEBOUNCE_MS: "60000",
        OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES: "120",
        FOO: "bar",
        HYPER_CUSTOM_FLAG: "visible",
      },
      routes: {
        openclaw: { port: 18789, auth: false, prefix: "" },
      },
      sync_root: "/home/node",
      sync_uid: 1000,
      sync_gid: 1000,
    });
  });

  it("disables memory index edits when launch config updates are unavailable", async () => {
    renderAgentSettingsPanel({ onUpdateAgentLaunchConfig: undefined });

    fireEvent.click(screen.getByRole("button", { name: "Index" }));

    expect(screen.getByRole("switch", { name: "Watch memory files" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });
});

describe("ErrorBanner", () => {
  it("renders capacity errors with inventory and a plan catalog CTA", () => {
    const onOpenPlanCatalog = vi.fn();

    render(
      <ErrorBanner
        error="API Error 429: No available 'large' entitlement slots. Requested tier inventory: 1 free / 2 total (used 1). Available slots on this account: large 1 free / 2 total, medium 0 free / 0 total, small 0 free / 0 total. Stop an existing agent or purchase more capacity."
        onDismiss={vi.fn()}
        onOpenPlanCatalog={onOpenPlanCatalog}
      />,
    );

    expect(screen.getByText("Large capacity unavailable")).toBeInTheDocument();
    expect(screen.getByText("Requested 1 free / 2 total")).toBeInTheDocument();
    expect(screen.getByText("large: 1 free / 2 total")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /add capacity/i }));

    expect(onOpenPlanCatalog).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/No available 'large' entitlement slots/)).not.toBeInTheDocument();
  });
});
