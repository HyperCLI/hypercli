import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { AgentChannelSummary, AgentChannelsProvider, AgentChannelsSnapshot } from "@hypercli.com/sdk/channels";
import type { AgentConnectorsProvider } from "@hypercli.com/sdk/connectors";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentGatewaySession } from "@/components/dashboard/agents/AgentGatewayProvider";
import { renderWithClient } from "@/test/utils";
import { IntegrationsDirectoryPanel } from "./IntegrationsDirectoryPanel";

const authMocks = vi.hoisted(() => ({
  getToken: vi.fn(),
  isAuthenticated: true,
  isLoading: false,
}));

const sdkMocks = vi.hoisted(() => ({
  getSlackInstallStatus: vi.fn(),
  attachSlackRelayAgent: vi.fn(),
}));

vi.mock("@/hooks/useAgentAuth", () => ({
  useAgentAuth: () => authMocks,
}));

vi.mock("@hypercli.com/sdk/agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hypercli.com/sdk/agents")>();
  return {
    ...actual,
    getSlackInstallStatus: sdkMocks.getSlackInstallStatus,
    attachSlackRelayAgent: sdkMocks.attachSlackRelayAgent,
  };
});

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    SLACK_APP_HANDLE: "hyperdev",
    SLACK_RELAY_BASE_URL: "https://api.agents.dev.hypercli.com",
  };
});

const runtimeChannelSummaries: AgentChannelSummary[] = ["telegram", "discord", "slack", "whatsapp"].map((channelId) => ({
  channelId,
  configured: false,
  healthState: "unknown" as const,
}));

function runtimeSnapshot(channels = runtimeChannelSummaries): AgentChannelsSnapshot {
  const labels: Record<string, string> = {
    telegram: "Telegram",
    discord: "Discord",
    slack: "Slack",
    whatsapp: "WhatsApp",
  };
  return {
    observedAt: 1,
    channels: channels.map((channel) => ({
      channelId: channel.channelId,
      label: labels[channel.channelId] ?? channel.channelId,
      rawChannelStatus: { configured: channel.configured },
      accounts: [{
        accountId: channel.accountId ?? "default",
        configured: channel.configured,
        running: channel.running,
        authenticated: channel.authenticated,
        healthState: channel.healthState,
        rawRuntimeStatus: {},
      }],
    })),
  };
}

const channelsProvider: AgentChannelsProvider = {
  capabilities: {
    configure: true,
    logout: true,
    removeConfig: true,
    probe: true,
    multipleAccounts: true,
  },
  list: vi.fn(async () => runtimeChannelSummaries),
  read: vi.fn(async () => runtimeSnapshot()),
  readConfig: vi.fn(async ({ channelId, accountId }) => ({ channelId, accountId, config: { enabled: true } })),
  update: vi.fn(async () => undefined),
  configure: vi.fn(async () => undefined),
  removeConfig: vi.fn(async () => undefined),
};

const connectorsProvider: AgentConnectorsProvider = {
  runtime: { provider: "openclaw", version: "test", capabilities: ["channels.status"] },
  list: vi.fn(async (options) => options?.connectorId === "github" ? [{
    connectorId: "github",
    configured: false,
    authenticated: false,
    usable: false,
    setupModes: ["managed-auth"],
  }] : []),
  startSetup: vi.fn(async (request) => ({
    connectorId: request.connectorId,
    mode: request.mode ?? "config",
    provenance: { provider: "openclaw", capabilities: [] },
  })),
  pollSetup: vi.fn(),
  configure: vi.fn(async () => undefined),
};

function gatewaySession(overrides: Record<string, unknown> = {}) {
  return {
    backend: "openclaw",
    connected: true,
    config: null,
    configSchema: { schema: {}, uiHints: { "channels.telegram": {} } },
    channelsProvider,
    connectorsProvider,
    connectorRuntime: connectorsProvider.runtime,
    saveConfig: vi.fn(async () => undefined),
    channelsStatus: vi.fn(async () => ({ channels: {} })),
    webLoginStart: vi.fn(async () => ({ connected: false, message: "Scan", qrDataUrl: "data:image/png;base64,cXI=" })),
    webLoginWait: vi.fn(() => new Promise<never>(() => undefined)),
    generateConnectorWorkflow: vi.fn(async (connectorId: "github" | "telegram" | "discord" | "slack" | "whatsapp") => ({
      schema: "hypercli.connector-workflow.v1" as const,
      connectorId,
      runtimeFingerprint: "openclaw:test",
      summary: `Runtime-generated ${connectorId} setup.`,
      steps: [{
        id: "verify",
        title: "Verify connection",
        instructions: "Check the runtime status.",
        kind: "verify" as const,
        approvalRequired: false,
      }],
    })),
    runConnectorShellProposal: vi.fn(async () => undefined),
    ensureSlackSupport: vi.fn(async () => ({
      plugin: { id: "slack", name: "Slack", installed: true, enabled: true, state: "enabled" },
      changed: false,
      restartRequired: false,
      restarted: false,
    })),
    ...overrides,
  } as unknown as AgentGatewaySession;
}

function renderPanel(overrides: Partial<ComponentProps<typeof IntegrationsDirectoryPanel>> = {}) {
  return renderWithClient(
    <IntegrationsDirectoryPanel
      initialCategory="channels"
      initialPluginId="telegram"
      agentId="agent-1"
      agentName="Agent"
      gatewaySession={gatewaySession()}
      channelsProvider={channelsProvider}
      reportedChannels={runtimeChannelSummaries}
      reportedChannelSnapshot={runtimeSnapshot()}
      reportedChannelsReady
      config={null}
      connected
      onSaveConfig={vi.fn(async () => undefined)}
      onChannelProbe={vi.fn(async () => ({}))}
      onOpenShell={vi.fn()}
      {...overrides}
    />,
  );
}

describe("IntegrationsDirectoryPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.getToken.mockResolvedValue("jwt-token");
    authMocks.isAuthenticated = true;
    authMocks.isLoading = false;
    sdkMocks.getSlackInstallStatus.mockResolvedValue({
      connected: false,
      teamId: null,
      teamName: null,
      botUserId: null,
      updatedAt: null,
    });
    sdkMocks.attachSlackRelayAgent.mockResolvedValue({
      connected: true,
      agentId: "agent-1",
      gatewayId: "agent:agent-1",
      config: { enabled: true, mode: "relay" },
      restartRequired: true,
      teamId: "T123",
      teamName: "Test Workspace",
      botUserId: "U123",
    });
  });

  it("uses the integrations back label by default", async () => {
    renderPanel();
    expect(await screen.findByRole("button", { name: /back to integrations/i })).toBeInTheDocument();
  });

  it("uses the chat back label and callback for chat-opened details", async () => {
    const onDetailBack = vi.fn();
    renderPanel({ detailBackLabel: "Back to chat", onDetailBack });
    fireEvent.click(await screen.findByRole("button", { name: /back to chat/i }));
    expect(onDetailBack).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /back to chat/i })).not.toBeInTheDocument();
  });

  it("renders core setup options alongside channels reported by the runtime", async () => {
    const { container } = renderPanel({ initialCategory: null, initialPluginId: null });

    expect(await screen.findByRole("heading", { name: "All integrations" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Channels" })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search integrations...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("Telegram")).toBeInTheDocument();
    expect(screen.queryByText(/grammY/i)).not.toBeInTheDocument();
    expect(screen.getByText("Discord")).toBeInTheDocument();
    expect(screen.getByText("Slack")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Messaging" }));
    expect(screen.getByRole("heading", { name: "Messaging integrations" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Messaging" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("GitHub")).not.toBeInTheDocument();
    expect(screen.queryByText("HubSpot")).not.toBeInTheDocument();
    expect(screen.queryByText("Google Drive")).not.toBeInTheDocument();
    expect(container.querySelector(".max-w-6xl")).toBeInTheDocument();
  });

  it("keeps supported setup channels visible when the runtime reports only one channel", async () => {
    const emptyProvider: AgentChannelsProvider = {
      ...channelsProvider,
      list: vi.fn(async () => []),
    };
    renderPanel({
      channelsProvider: emptyProvider,
      reportedChannels: [{ channelId: "discord", configured: false, healthState: "unknown" }],
      reportedChannelsReady: true,
      initialCategory: null,
      initialPluginId: null,
    });

    expect(await screen.findByText("Discord")).toBeInTheDocument();
    expect(screen.getByText("Telegram")).toBeInTheDocument();
    expect(screen.getByText("Slack")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
  });

  it("keeps supported setup channels visible when runtime status is empty", async () => {
    const emptyProvider: AgentChannelsProvider = {
      ...channelsProvider,
      list: vi.fn(async () => []),
    };
    renderPanel({
      channelsProvider: emptyProvider,
      reportedChannels: [],
      reportedChannelsReady: true,
      initialCategory: null,
      initialPluginId: null,
    });

    expect(await screen.findByText("Telegram")).toBeInTheDocument();
    expect(screen.getByText("Discord")).toBeInTheDocument();
    expect(screen.getByText("Slack")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.queryByText("This workspace reports no integrations.")).not.toBeInTheDocument();
  });

  it("does not mark unconfigured unhealthy channels as needing attention", async () => {
    renderPanel({
      initialCategory: null,
      initialPluginId: null,
      reportedChannels: [{ channelId: "slack", configured: false, healthState: "unhealthy", lastError: "not configured" }],
      reportedChannelSnapshot: runtimeSnapshot([{ channelId: "slack", configured: false, healthState: "unhealthy", lastError: "not configured" }]),
      reportedChannelsReady: true,
    });

    expect(await screen.findByRole("button", { name: /Slack.*Set up/i })).toBeInTheDocument();
    expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
  });

  it("shows an explicit state when the runtime has no channel provider", () => {
    renderPanel({
      channelsProvider: null,
      gatewaySession: gatewaySession({ channelsProvider: null, connectorsProvider: null }),
      initialPluginId: null,
    });
    expect(screen.getByText("No integrations reported")).toBeInTheDocument();
  });

  it("waits for the gateway before mounting integration setup", () => {
    renderPanel({
      connected: false,
      channelsProvider: null,
      gatewaySession: gatewaySession({ connected: false, channelsProvider: null, connectorsProvider: null }),
      reportedChannels: [],
      reportedChannelSnapshot: { observedAt: 1, channels: [] },
      reportedChannelsReady: true,
      initialCategory: null,
      initialPluginId: null,
    });

    expect(screen.getByText("Waiting for gateway")).toBeInTheDocument();
    expect(screen.getByText("Start the agent gateway to manage integrations.")).toBeInTheDocument();
    expect(document.querySelector('[data-loading-stage="gateway"]')).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "All integrations" })).not.toBeInTheDocument();
    expect(screen.queryByText("Slack")).not.toBeInTheDocument();
    expect(sdkMocks.getSlackInstallStatus).not.toHaveBeenCalled();
    expect(screen.queryByText("No integrations reported")).not.toBeInTheDocument();
  });

  it("allows hosted Slack setup before the gateway connects", async () => {
    renderPanel({
      connected: false,
      channelsProvider: null,
      gatewaySession: gatewaySession({ connected: false, channelsProvider: null, connectorsProvider: null }),
      reportedChannels: [],
      reportedChannelSnapshot: { observedAt: 1, channels: [] },
      reportedChannelsReady: true,
      initialPluginId: "slack",
    });

    expect((await screen.findAllByText("Create Slack app")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /^HyperCLI Slack App$/i })).toBeInTheDocument();
    expect(screen.queryByText("Waiting for gateway")).not.toBeInTheDocument();
    expect(sdkMocks.getSlackInstallStatus).not.toHaveBeenCalled();
  });

  it("uses the shared runtime connector card and generated setup guidance", async () => {
    const session = gatewaySession();
    renderPanel({ gatewaySession: session });

    expect((await screen.findAllByText("Runtime-generated telegram setup.")).length).toBeGreaterThan(0);
    expect(session.connectorsProvider!.startSetup).toHaveBeenCalledWith({ connectorId: "telegram", mode: "config" });
    expect(session.generateConnectorWorkflow).toHaveBeenCalledWith("telegram");
    expect(screen.queryByRole("button", { name: /start setup/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^back$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open in integrations/i })).not.toBeInTheDocument();
  });

  it("opens configured runtime channels in dedicated settings without replaying setup", async () => {
    const configured = [{ channelId: "telegram", accountId: "default", configured: true, running: true, healthState: "healthy" as const }];
    const provider: AgentChannelsProvider = {
      ...channelsProvider,
      list: vi.fn(async () => configured),
      read: vi.fn(async () => runtimeSnapshot(configured)),
      readConfig: vi.fn(async ({ channelId }) => ({
        channelId,
        config: { enabled: true, dmPolicy: "allowlist", allowFrom: ["123456"] },
      })),
      update: vi.fn(async () => undefined),
    };
    renderPanel({
      channelsProvider: provider,
      gatewaySession: gatewaySession({ channelsProvider: provider }),
      reportedChannels: configured,
      reportedChannelSnapshot: runtimeSnapshot(configured),
      reportedChannelsReady: true,
      onRefreshChannels: vi.fn(async () => runtimeSnapshot(configured)),
    });

    expect(await screen.findByRole("heading", { name: "Telegram configuration" })).toBeInTheDocument();
    expect(screen.queryByText(/OpenClaw runtime/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start setup/i })).not.toBeInTheDocument();
    expect(await screen.findByLabelText("Telegram allowed sender IDs")).toHaveValue("123456");
    expect(provider.update).not.toHaveBeenCalled();
  });

  it("opens setup for a supported channel omitted from runtime status", async () => {
    renderPanel({
      initialPluginId: "discord",
      reportedChannels: [],
      reportedChannelSnapshot: { observedAt: 1, channels: [] },
      reportedChannelsReady: true,
    });

    expect((await screen.findAllByText("Runtime-generated discord setup.")).length).toBeGreaterThan(0);
    expect(screen.getByText(/connect discord/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start setup/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^back$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Discord is not available" })).not.toBeInTheDocument();
  });

  it("does not use OpenClaw channel controls for another runtime", async () => {
    renderPanel({
      gatewaySession: gatewaySession({
        backend: "hermes",
        connectorRuntime: { provider: "hermes", version: "1.0", capabilities: ["channels.status"] },
        connectorsProvider: { ...connectorsProvider, runtime: { provider: "hermes", version: "1.0", capabilities: ["channels.status"] } },
      }),
    });

    expect(await screen.findByText("Telegram controls are not available for this agent yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start setup/i })).not.toBeInTheDocument();
  });

  it("keeps saved configuration manageable when live runtime status disappears", async () => {
    const provider: AgentChannelsProvider = {
      ...channelsProvider,
      removeConfig: vi.fn(async () => undefined),
    };
    const onRefreshChannels = vi.fn(async () => ({ observedAt: 2, channels: [] }));
    renderPanel({
      initialPluginId: "discord",
      channelsProvider: provider,
      gatewaySession: gatewaySession({ channelsProvider: provider }),
      config: { channels: { discord: { enabled: true } } },
      reportedChannels: [],
      reportedChannelSnapshot: { observedAt: 1, channels: [] },
      reportedChannelsReady: true,
      onRefreshChannels,
    });

    expect(await screen.findByRole("heading", { name: "Discord configuration" })).toBeInTheDocument();
    expect(screen.getByText(/status is not currently reported/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Discord is not available" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove configuration" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm remove" }));

    await waitFor(() => expect(provider.removeConfig).toHaveBeenCalledWith("discord"));
    expect(onRefreshChannels).toHaveBeenCalledWith(true);
    expect(await screen.findByText(/configuration removed/i)).toBeInTheDocument();
  });

  it("opens configured Slack without auto-preparing support", async () => {
    const ensureSlackSupport = vi.fn(async () => ({
      plugin: { id: "slack", name: "Slack", installed: true, enabled: true, state: "enabled" },
      changed: true,
      restartRequired: true,
      restarted: true,
    }));
    renderPanel({
      initialPluginId: "slack",
      gatewaySession: gatewaySession({ ensureSlackSupport }),
      config: { channels: { slack: { enabled: true } } },
      reportedChannels: [],
      reportedChannelSnapshot: { observedAt: 1, channels: [] },
      reportedChannelsReady: true,
    });

    expect(await screen.findByRole("heading", { name: "Slack configuration" })).toBeInTheDocument();
    expect(ensureSlackSupport).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /install Slack support/i })).not.toBeInTheDocument();
  });

  it("prompts for Slack setup mode without checking hosted status first", async () => {
    const ensureSlackSupport = vi.fn(async () => ({
      plugin: { id: "slack", name: "Slack", installed: true, enabled: true, state: "enabled" },
      changed: false,
      restartRequired: false,
      restarted: false,
    }));
    renderPanel({
      initialPluginId: "slack",
      gatewaySession: gatewaySession({ ensureSlackSupport }),
      config: null,
      reportedChannels: [],
      reportedChannelSnapshot: { observedAt: 1, channels: [] },
      reportedChannelsReady: true,
    });

    expect((await screen.findAllByText("Create Slack app")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /HyperCLI Slack App$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Self-hosted Socket Mode/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Self-hosted" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Slack Bot token")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Slack App token")).not.toBeInTheDocument();
    expect(sdkMocks.getSlackInstallStatus).not.toHaveBeenCalled();
    expect(ensureSlackSupport).not.toHaveBeenCalled();
  });

  it("checks Slack hosted status only after the hosted app path is selected", async () => {
    const ensureSlackSupport = vi.fn(async () => ({
      plugin: { id: "slack", name: "Slack", installed: true, enabled: true, state: "enabled" },
      changed: false,
      restartRequired: false,
      restarted: false,
    }));
    renderPanel({
      initialPluginId: "slack",
      gatewaySession: gatewaySession({ ensureSlackSupport }),
      config: null,
      reportedChannels: [],
      reportedChannelSnapshot: { observedAt: 1, channels: [] },
      reportedChannelsReady: true,
    });

    fireEvent.click(await screen.findByRole("button", { name: /^HyperCLI Slack App$/i }));

    await waitFor(() => expect(sdkMocks.getSlackInstallStatus).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("link", { name: /Connect Slack/i })).toHaveAttribute(
      "href",
      "/slack/start",
    );
    expect(ensureSlackSupport).not.toHaveBeenCalled();
  });

  it("opens hosted Slack status after returning from OAuth success", async () => {
    sdkMocks.getSlackInstallStatus.mockResolvedValue({
      connected: true,
      teamId: "T123",
      teamName: "Test Workspace",
      botUserId: "U123",
      updatedAt: "2026-07-19T18:56:53+00:00",
    });
    const ensureSlackSupport = vi.fn(async () => ({
      plugin: { id: "slack", name: "Slack", installed: true, enabled: true, state: "enabled" },
      changed: false,
      restartRequired: false,
      restarted: false,
    }));
    renderPanel({
      initialPluginId: "slack",
      slackOAuthResult: "success",
      gatewaySession: gatewaySession({ ensureSlackSupport }),
      config: null,
      reportedChannels: [],
      reportedChannelSnapshot: { observedAt: 1, channels: [] },
      reportedChannelsReady: true,
    });

    await waitFor(() => expect(sdkMocks.getSlackInstallStatus).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Connected to Test Workspace.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Attach agent" })).toBeInTheDocument();
    expect(ensureSlackSupport).not.toHaveBeenCalled();
  });

  it("opens hosted Slack with an error after returning from OAuth failure", async () => {
    renderPanel({
      initialPluginId: "slack",
      slackOAuthResult: "failure",
      slackOAuthError: "access_denied",
      config: null,
      reportedChannels: [],
      reportedChannelSnapshot: { observedAt: 1, channels: [] },
      reportedChannelsReady: true,
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("access_denied");
    expect(sdkMocks.getSlackInstallStatus).not.toHaveBeenCalled();
  });

  it("prepares Slack support when self-hosted setup is selected", async () => {
    const ensureSlackSupport = vi.fn(async () => ({
      plugin: { id: "slack", name: "Slack", installed: true, enabled: true, state: "enabled" },
      changed: false,
      restartRequired: false,
      restarted: false,
    }));
    renderPanel({
      initialPluginId: "slack",
      gatewaySession: gatewaySession({ ensureSlackSupport }),
      config: null,
      reportedChannels: [],
      reportedChannelSnapshot: { observedAt: 1, channels: [] },
      reportedChannelsReady: true,
    });

    fireEvent.click(await screen.findByRole("button", { name: "Self-hosted" }));
    expect((await screen.findAllByText(/Runtime-generated slack setup./i)).length).toBeGreaterThan(0);
    expect(await screen.findByLabelText("Slack Bot token")).toBeInTheDocument();
    expect(screen.getByLabelText("Slack App token")).toBeInTheDocument();
    await waitFor(() => expect(ensureSlackSupport).toHaveBeenCalledTimes(1));
    expect(sdkMocks.getSlackInstallStatus).not.toHaveBeenCalled();
  });

  it("configures Slack relay when the hosted app is connected", async () => {
    sdkMocks.getSlackInstallStatus.mockResolvedValue({
      connected: true,
      teamId: "T123",
      teamName: "Test Workspace",
      botUserId: "U123",
      updatedAt: "2026-07-19T13:30:00+00:00",
    });
    const ensureSlackSupport = vi.fn();
    const configure = vi.fn(async () => undefined);
    const provider = { ...channelsProvider, configure };
    const onRefreshChannels = vi.fn(async () => ({ observedAt: 2, channels: [] }));
    renderPanel({
      initialPluginId: "slack",
      gatewaySession: gatewaySession({ ensureSlackSupport }),
      channelsProvider: provider,
      config: null,
      reportedChannels: [],
      reportedChannelSnapshot: { observedAt: 1, channels: [] },
      reportedChannelsReady: true,
      onRefreshChannels,
    });

    fireEvent.click(await screen.findByRole("button", { name: /^HyperCLI Slack App$/i }));
    expect(await screen.findByText("Connected to Test Workspace.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Attach agent" }));

    await waitFor(() => expect(sdkMocks.attachSlackRelayAgent).toHaveBeenCalledWith({
      relayBaseUrl: "https://api.agents.dev.hypercli.com",
      token: "jwt-token",
      agentId: "agent-1",
    }));
    expect(ensureSlackSupport).not.toHaveBeenCalled();
    expect(configure).not.toHaveBeenCalled();
    expect(onRefreshChannels).toHaveBeenCalledWith(true);
  });

  it("hydrates saved Slack account IDs when runtime status is unavailable", async () => {
    renderPanel({
      initialPluginId: "slack",
      config: { channels: { slack: { accounts: { primary: { enabled: true }, alerts: { enabled: true } } } } },
      reportedChannels: [],
      reportedChannelSnapshot: { observedAt: 1, channels: [] },
      reportedChannelsReady: true,
    });

    const selector = await screen.findByLabelText("Slack configured account");
    expect(selector).toHaveTextContent("primary");
    expect(selector).toHaveTextContent("alerts");
  });

  it("selects the saved default Slack account when runtime status is unavailable", async () => {
    renderPanel({
      initialPluginId: "slack",
      config: { channels: { slack: { defaultAccount: "alerts", accounts: { primary: { enabled: true }, alerts: { enabled: true } } } } },
      reportedChannels: [],
      reportedChannelSnapshot: { observedAt: 1, channels: [] },
      reportedChannelsReady: true,
    });

    expect(await screen.findByLabelText("Slack configured account")).toHaveValue("alerts");
  });

  it("opens GitHub with the shared runtime connector card", async () => {
    renderPanel({ initialPluginId: "github", gatewaySession: gatewaySession() });

    expect(await screen.findByText("Runtime-generated github setup.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start connection/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open in integrations/i })).not.toBeInTheDocument();
  });

  it.each(["discord"] as const)("opens %s with the shared runtime connector card", async (integrationId) => {
    renderPanel({ initialPluginId: integrationId, gatewaySession: gatewaySession() });

    expect((await screen.findAllByText(`Runtime-generated ${integrationId} setup.`)).length).toBeGreaterThan(0);
    expect(screen.getByText(new RegExp(`connect ${integrationId}`, "i"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start setup/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^back$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open in integrations/i })).not.toBeInTheDocument();
  });

  it("automatically configures WhatsApp and displays its QR code", async () => {
    const session = gatewaySession();
    renderPanel({ initialPluginId: "whatsapp", gatewaySession: session });

    expect(await screen.findByRole("img", { name: /whatsapp pairing qr code/i })).toBeInTheDocument();
    expect(session.webLoginStart).toHaveBeenCalledWith({ force: false, timeoutMs: 25_000, verbose: true });
    expect(session.generateConnectorWorkflow).not.toHaveBeenCalledWith("whatsapp");
    expect(screen.queryByRole("button", { name: /enable channel/i })).not.toBeInTheDocument();
  });

  it("keeps configured but offline WhatsApp accounts in the QR pairing flow", async () => {
    const offlineWhatsApp = [{
      channelId: "whatsapp",
      configured: true,
      running: false,
      healthState: "unknown" as const,
    }];
    const config = { channels: { whatsapp: { enabled: true } } };
    const session = gatewaySession({ config });
    renderPanel({
      initialPluginId: "whatsapp",
      gatewaySession: session,
      config,
      reportedChannels: offlineWhatsApp,
      reportedChannelSnapshot: runtimeSnapshot(offlineWhatsApp),
    });

    expect(await screen.findByRole("img", { name: /whatsapp pairing qr code/i })).toBeInTheDocument();
    expect(session.webLoginStart).toHaveBeenCalledWith({ force: true, timeoutMs: 25_000, verbose: true });
    expect(screen.queryByRole("heading", { name: /whatsapp configuration/i })).not.toBeInTheDocument();
  });

  it("keeps the shell pairing path as a WhatsApp recovery fallback", async () => {
    const onOpenShell = vi.fn();
    const session = gatewaySession({
      webLoginStart: vi.fn(async () => {
        throw new Error("Web login provider is unavailable");
      }),
    });
    renderPanel({ initialPluginId: "whatsapp", gatewaySession: session, onOpenShell });

    fireEvent.click(await screen.findByRole("button", { name: /use shell instead/i }));

    expect(onOpenShell).toHaveBeenCalledTimes(1);
  });
});
