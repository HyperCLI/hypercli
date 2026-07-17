import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { AgentChannelSummary, AgentChannelsProvider, AgentChannelsSnapshot } from "@hypercli.com/sdk/channels";
import type { AgentConnectorsProvider } from "@hypercli.com/sdk/connectors";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import type { AgentGatewaySession } from "@/components/dashboard/agents/AgentGatewayProvider";
import { renderWithClient } from "@/test/utils";
import { IntegrationsDirectoryPanel } from "./IntegrationsDirectoryPanel";

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
    ...overrides,
  } as unknown as AgentGatewaySession;
}

function renderPanel(overrides: Partial<ComponentProps<typeof IntegrationsDirectoryPanel>> = {}) {
  return renderWithClient(
    <IntegrationsDirectoryPanel
      initialCategory="channels"
      initialPluginId="telegram"
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

    expect(await screen.findByText("Telegram")).toBeInTheDocument();
    expect(screen.queryByText("Bot API via grammY")).not.toBeInTheDocument();
    expect(screen.getByText("Discord")).toBeInTheDocument();
    expect(screen.getByText("Slack")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.queryByText("HubSpot")).not.toBeInTheDocument();
    expect(screen.queryByText("Google Drive")).not.toBeInTheDocument();
    expect(container.querySelector(".max-w-6xl")).toBeInTheDocument();
  });

  it("uses the shared runtime inventory instead of synthesizing unavailable channels", async () => {
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
    expect(screen.queryByText("Telegram")).not.toBeInTheDocument();
  });

  it("does not advertise Telegram when the runtime status is empty", async () => {
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

    expect(await screen.findByText("GitHub")).toBeInTheDocument();
    expect(screen.queryByText("Telegram")).not.toBeInTheDocument();
    expect(screen.queryByText("This workspace reports no communication channels.")).not.toBeInTheDocument();
  });

  it("shows an explicit state when the runtime has no channel provider", () => {
    renderPanel({
      channelsProvider: null,
      gatewaySession: gatewaySession({ channelsProvider: null, connectorsProvider: null }),
      initialPluginId: null,
    });
    expect(screen.getByText("No integrations reported")).toBeInTheDocument();
  });

  it("uses the shared runtime connector card and generated setup guidance", async () => {
    const session = gatewaySession();
    renderPanel({ gatewaySession: session });

    fireEvent.click(await screen.findByRole("button", { name: /start setup/i }));

    expect((await screen.findAllByText("Runtime-generated telegram setup.")).length).toBeGreaterThan(0);
    expect(session.connectorsProvider!.startSetup).toHaveBeenCalledWith({ connectorId: "telegram", mode: "config" });
    expect(session.generateConnectorWorkflow).toHaveBeenCalledWith("telegram");
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
    expect(screen.getByText("OpenClaw runtime · vtest")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start setup/i })).not.toBeInTheDocument();
    expect(await screen.findByLabelText("Telegram allowed sender IDs")).toHaveValue("123456");
    expect(provider.update).not.toHaveBeenCalled();
  });

  it("shows an explicit runtime state for an unsupported channel", async () => {
    renderPanel({
      initialPluginId: "discord",
      reportedChannels: [],
      reportedChannelSnapshot: { observedAt: 1, channels: [] },
      reportedChannelsReady: true,
    });

    expect(await screen.findByRole("heading", { name: "Discord is not available" })).toBeInTheDocument();
    expect(screen.getByText("This OpenClaw runtime does not report support for Discord.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start setup/i })).not.toBeInTheDocument();
  });

  it("does not use OpenClaw channel controls for another runtime", async () => {
    renderPanel({
      gatewaySession: gatewaySession({
        backend: "hermes",
        connectorRuntime: { provider: "hermes", version: "1.0", capabilities: ["channels.status"] },
        connectorsProvider: { ...connectorsProvider, runtime: { provider: "hermes", version: "1.0", capabilities: ["channels.status"] } },
      }),
    });

    expect(await screen.findByText("Telegram controls are not available for the hermes runtime yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start setup/i })).not.toBeInTheDocument();
  });

  it("keeps stale saved configuration removable when runtime support disappears", async () => {
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

    expect(await screen.findByText(/saved configuration exists/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove configuration" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm remove" }));

    await waitFor(() => expect(provider.removeConfig).toHaveBeenCalledWith("discord"));
    expect(onRefreshChannels).toHaveBeenCalledWith(true);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Discord is not available" })).not.toBeInTheDocument());
  });

  it("opens GitHub with the shared runtime connector card", async () => {
    renderPanel({ initialPluginId: "github", gatewaySession: gatewaySession() });

    expect(await screen.findByText("Connect GitHub for this workspace.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start connection/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open in integrations/i })).not.toBeInTheDocument();
  });

  it.each(["discord", "slack", "whatsapp"] as const)("opens %s with the shared runtime connector card", async (integrationId) => {
    renderPanel({ initialPluginId: integrationId, gatewaySession: gatewaySession() });

    expect(await screen.findByRole("button", { name: /start setup/i })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`connect ${integrationId}`, "i"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open in integrations/i })).not.toBeInTheDocument();
  });

  it("keeps the shell pairing path available from the WhatsApp runtime card", async () => {
    const onOpenShell = vi.fn();
    renderPanel({ initialPluginId: "whatsapp", gatewaySession: gatewaySession(), onOpenShell });

    fireEvent.click(await screen.findByRole("button", { name: /start setup/i }));
    fireEvent.click(await screen.findByRole("button", { name: /open pairing setup/i }));

    expect(onOpenShell).toHaveBeenCalledTimes(1);
  });
});
