import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AgentChannelsProvider } from "@hypercli.com/sdk/channels";
import type { AgentConnectorsProvider } from "@hypercli.com/sdk/connectors";
import type { OpenClawWhatsAppProgressEvent } from "@hypercli.com/sdk/openclaw/whatsapp";
import { describe, expect, it, vi } from "vitest";

import type { ConnectorId, ConnectorWorkflow } from "@/lib/connector-workflow";
import { ChannelChatConnectorCard, type AdditionalChannelConnectorId } from "./ChannelChatConnectorCard";

function provider(
  channelId: AdditionalChannelConnectorId,
  options: { configured?: boolean; usable?: boolean; instructions?: string } = {},
): AgentConnectorsProvider {
  const runtime = { provider: "openclaw", version: "2026.7.16", capabilities: ["channels.status", "config.patch"] };
  return {
    runtime,
    list: vi.fn(async () => [{
      connectorId: channelId,
      configured: options.configured ?? false,
      authenticated: options.usable ?? false,
      usable: options.usable ?? false,
      setupModes: ["config" as const],
    }]),
    startSetup: vi.fn(async () => ({
      connectorId: channelId,
      mode: "config" as const,
      ...(options.instructions ? { instructions: options.instructions } : {}),
      provenance: runtime,
    })),
    pollSetup: vi.fn(),
    configure: vi.fn(async () => undefined),
  };
}

function workflow(connectorId: AdditionalChannelConnectorId, steps: ConnectorWorkflow["steps"]): ConnectorWorkflow {
  return {
    schema: "hypercli.connector-workflow.v1",
    connectorId,
    runtimeFingerprint: `openclaw:${connectorId}`,
    summary: `Follow the ${connectorId} setup reported for this runtime.`,
    steps,
  };
}

function channelsProvider(options: {
  defaultAccountId?: string;
  accounts?: Array<{
    accountId: string;
    accountDisplayName?: string;
    configured: boolean;
    running?: boolean;
    healthState: "healthy" | "degraded" | "unhealthy" | "unknown";
    lastError?: string;
  }>;
  rootConfig?: boolean;
} = {}): AgentChannelsProvider {
  const accounts = options.accounts ?? [{
    accountId: "default",
    accountDisplayName: "Workspace bot",
    configured: true,
    running: true,
    healthState: "healthy" as const,
  }];
  return {
    capabilities: { configure: true, logout: true, removeConfig: true, probe: true, multipleAccounts: true },
    list: vi.fn(async () => []),
    read: vi.fn(async ({ channelId } = {}) => ({
      observedAt: Date.now(),
      channels: [{
        channelId: channelId ?? "slack",
        defaultAccountId: options.defaultAccountId ?? accounts[0]?.accountId,
        rawChannelStatus: {},
        accounts: accounts.map((account) => ({ ...account, rawRuntimeStatus: {} })),
      }],
    })),
    readConfig: vi.fn(async ({ channelId, accountId }) => ({
      channelId,
      ...(options.rootConfig ? {} : { accountId }),
      config: { enabled: true },
    })),
    configure: vi.fn(async () => undefined),
    removeConfig: vi.fn(async () => undefined),
  };
}

describe("ChannelChatConnectorCard", () => {
  it("uses the selection accent for controls while retaining integration branding", () => {
    const { container } = render(
      <ChannelChatConnectorCard channelId="discord" connected config={null} connectorsProvider={provider("discord")} />,
    );

    const card = container.querySelector("section") as HTMLElement;
    expect(screen.getByText("Connect Discord")).toHaveStyle({ color: "var(--integration-discord)" });
    expect(card.style.getPropertyValue("--channel-accent")).toBe("var(--selection-accent)");
    expect(card.style.getPropertyValue("--channel-accent-foreground")).toBe("var(--selection-accent-foreground)");
  });

  it("renders the full-color Slack logo", () => {
    const { container } = render(
      <ChannelChatConnectorCard channelId="slack" connected config={null} connectorsProvider={provider("slack")} />,
    );

    const logo = container.querySelector("svg");
    expect(Array.from(logo?.querySelectorAll("path") ?? [], (path) => path.getAttribute("fill"))).toEqual([
      "#e01e5a",
      "#36c5f0",
      "#2eb67d",
      "#ecb22e",
    ]);
  });

  it("keeps Discord credentials out of generated guidance and saves the approved config", async () => {
    const connectorsProvider = provider("discord");
    const onGenerateConnectorWorkflow = vi.fn(async (_connectorId: ConnectorId) => workflow("discord", [{
      id: "discord-token",
      title: "Create the runtime-compatible bot",
      instructions: "Use the current Discord application flow, then enter the token in the protected field.",
      kind: "input",
      inputSlots: ["discord.token"],
      approvalRequired: false,
    }]));

    render(
      <ChannelChatConnectorCard
        channelId="discord"
        connected
        config={null}
        connectorsProvider={connectorsProvider}
        onGenerateConnectorWorkflow={onGenerateConnectorWorkflow}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /start setup/i }));
    expect(await screen.findByText("Create the runtime-compatible bot")).toBeInTheDocument();

    const token = "discord-secret-token";
    fireEvent.change(screen.getByLabelText("Discord Bot token"), { target: { value: token } });
    fireEvent.change(screen.getByLabelText("Discord Server ID"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("Discord Allowed user ID"), { target: { value: "789012" } });
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => expect(connectorsProvider.configure).toHaveBeenCalledWith("discord", {
      enabled: true,
      token,
      groupPolicy: "allowlist",
      guilds: { "123456": { requireMention: true, users: ["789012"] } },
    }));
    expect(JSON.stringify(onGenerateConnectorWorkflow.mock.calls)).not.toContain(token);
    expect(await screen.findByText("Settings saved")).toBeInTheDocument();
  });

  it("tests the saved connection from the workflow verification step", async () => {
    const connectorsProvider = provider("discord", { usable: true });
    const onGenerateConnectorWorkflow = vi.fn(async () => workflow("discord", [{
      id: "discord-token",
      title: "Enter Discord settings",
      instructions: "Enter the token securely.",
      kind: "input",
      inputSlots: ["discord.token"],
      approvalRequired: false,
    }, {
      id: "verify",
      title: "Verify connection",
      instructions: "Test the saved connection.",
      kind: "verify",
      operation: "discord.verify",
      approvalRequired: false,
    }]));

    render(
      <ChannelChatConnectorCard
        channelId="discord"
        connected
        config={null}
        connectorsProvider={connectorsProvider}
        onGenerateConnectorWorkflow={onGenerateConnectorWorkflow}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /start setup/i }));
    fireEvent.change(await screen.findByLabelText("Discord Bot token"), { target: { value: "discord-secret-token" } });
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));
    expect(await screen.findByText(/run the connection check below/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /step 2: verify connection/i }));
    fireEvent.click(screen.getByRole("button", { name: /^test connection$/i }));

    await waitFor(() => expect(connectorsProvider.list).toHaveBeenCalledWith({ connectorId: "discord", probe: true }));
    expect(await screen.findByText("Connection test passed.")).toBeInTheDocument();
    expect(screen.getByText("Discord is online for this workspace.")).toBeInTheDocument();
  });

  it("reveals Discord member access after a server ID and omits it again when hidden", async () => {
    const connectorsProvider = provider("discord");
    render(
      <ChannelChatConnectorCard
        channelId="discord"
        connected
        config={null}
        connectorsProvider={connectorsProvider}
        onGenerateConnectorWorkflow={vi.fn(async () => workflow("discord", []))}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /start setup/i }));
    const tokenInput = await screen.findByLabelText("Discord Bot token");
    expect(screen.queryByLabelText("Discord Allowed user ID")).not.toBeInTheDocument();

    fireEvent.change(tokenInput, { target: { value: "discord-secret-token" } });
    fireEvent.change(screen.getByLabelText("Discord Server ID"), { target: { value: "123456" } });
    expect(screen.getByRole("button", { name: /next step: test the connection/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Discord Allowed user ID"), { target: { value: "789012" } });
    expect(screen.getByRole("button", { name: /next step: test the connection/i })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Discord Server ID"), { target: { value: "" } });
    expect(screen.queryByLabelText("Discord Allowed user ID")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));
    await waitFor(() => expect(connectorsProvider.configure).toHaveBeenCalledWith("discord", {
      enabled: true,
      token: "discord-secret-token",
    }));
  });

  it("does not display static channel settings while generation is pending", async () => {
    render(
      <ChannelChatConnectorCard
        channelId="discord"
        connected
        config={null}
        onSaveConfig={vi.fn(async () => undefined)}
        onGenerateConnectorWorkflow={vi.fn(() => new Promise<ConnectorWorkflow>(() => undefined))}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /start setup/i }));

    expect(await screen.findByText(/preparing guidance for this workspace version/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Discord Bot token")).not.toBeInTheDocument();
  });

  it("uses Slack instructions supplied by the runtime before generated guidance", async () => {
    const instructions = "Use the Slack Socket Mode flow supported by this runtime version.";
    const connectorsProvider = provider("slack", { instructions });
    const onGenerateConnectorWorkflow = vi.fn(async () => workflow("slack", []));

    render(
      <ChannelChatConnectorCard
        channelId="slack"
        connected
        config={null}
        connectorsProvider={connectorsProvider}
        onGenerateConnectorWorkflow={onGenerateConnectorWorkflow}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /start setup/i }));

    expect((await screen.findAllByText(instructions)).length).toBeGreaterThan(0);
    expect(onGenerateConnectorWorkflow).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /next step: enter slack settings/i }));
    const botTokenInput = screen.getByLabelText("Slack Bot token");
    expect(botTokenInput).toHaveAttribute("type", "password");
    expect(botTokenInput.closest("[data-workflow-step]")).toHaveAttribute("data-workflow-step", "required-settings");
    expect(screen.getByLabelText("Slack App token")).toHaveAttribute("type", "password");
  });

  it("saves new Slack connections explicitly in Socket Mode through the channel provider", async () => {
    const connectorsProvider = provider("slack", { instructions: "Create a Slack app for Socket Mode." });
    const channelProvider = channelsProvider();
    render(
      <ChannelChatConnectorCard
        channelId="slack"
        connected
        config={null}
        connectorsProvider={connectorsProvider}
        channelsProvider={channelProvider}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /start setup/i }));
    fireEvent.click(await screen.findByRole("button", { name: /next step: enter slack settings/i }));
    fireEvent.change(screen.getByLabelText("Slack Bot token"), { target: { value: "xoxb-secret" } });
    fireEvent.change(screen.getByLabelText("Slack App token"), { target: { value: "xapp-secret" } });
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => expect(channelProvider.configure).toHaveBeenCalledWith("slack", {
      enabled: true,
      mode: "socket",
      botToken: "xoxb-secret",
      appToken: "xapp-secret",
    }));
    expect(connectorsProvider.configure).not.toHaveBeenCalled();
  });

  it("tests the reported default Slack account instead of another healthy account", async () => {
    const channelProvider = channelsProvider({
      defaultAccountId: "work",
      accounts: [
        { accountId: "personal", configured: true, running: true, healthState: "healthy" },
        { accountId: "work", configured: true, running: true, healthState: "degraded", lastError: "Bot identity check failed" },
      ],
    });
    render(
      <ChannelChatConnectorCard
        channelId="slack"
        connected
        config={{ channels: { slack: { enabled: true } } }}
        connectorsProvider={provider("slack", { configured: true, usable: true })}
        channelsProvider={channelProvider}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /^test$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Bot identity check failed");
    expect(channelProvider.read).toHaveBeenCalledWith({ channelId: "slack", probe: true });
  });

  it("requests the WhatsApp QR through the SDK before support preparation", async () => {
    const connectorsProvider = provider("whatsapp");
    const onWhatsAppPairingStart = vi.fn(async () => ({
      connected: false,
      message: "Scan this code.",
      qrDataUrl: "data:image/png;base64,cXItMQ==",
    }));
    const onEnsureWhatsAppSupport = vi.fn(async () => undefined);
    const onWebLoginStart = vi.fn();
    const pendingWait = new Promise<never>(() => undefined);
    const onWebLoginWait = vi.fn(() => pendingWait);

    render(
      <ChannelChatConnectorCard
        channelId="whatsapp"
        connected
        config={null}
        connectorsProvider={connectorsProvider}
        onEnsureWhatsAppSupport={onEnsureWhatsAppSupport}
        onWhatsAppPairingStart={onWhatsAppPairingStart}
        onWebLoginStart={onWebLoginStart}
        onWebLoginWait={onWebLoginWait}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /start setup/i }));
    await waitFor(() => expect(onWhatsAppPairingStart).toHaveBeenCalledTimes(1));
    expect(connectorsProvider.configure).not.toHaveBeenCalled();
    expect(onWhatsAppPairingStart).toHaveBeenCalledWith(
      { force: false, timeoutMs: 25_000, verbose: true },
      expect.any(Function),
    );
    expect(onEnsureWhatsAppSupport).not.toHaveBeenCalled();
    expect(onWebLoginStart).not.toHaveBeenCalled();
    expect(await screen.findByRole("img", { name: /whatsapp pairing qr code/i })).toHaveAttribute(
      "src",
      "data:image/png;base64,cXItMQ==",
    );
    expect(onWebLoginWait).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /enable channel/i })).not.toBeInTheDocument();
    expect(screen.queryByText("openclaw channels login --channel whatsapp")).not.toBeInTheDocument();
  });

  it("restores an SDK-owned WhatsApp QR after the card remounts", async () => {
    const onWhatsAppPairingStart = vi.fn();
    render(
      <ChannelChatConnectorCard
        channelId="whatsapp"
        connected
        directSetup
        config={{ channels: { whatsapp: { enabled: true } } }}
        connectorsProvider={provider("whatsapp", { configured: true })}
        onWhatsAppPairingStart={onWhatsAppPairingStart}
        whatsAppPairingState={{
          status: "waiting",
          qrDataUrl: "data:image/png;base64,cXItMQ==",
          message: "Scan this code",
          progress: [{
            id: "operation:requesting-qr",
            kind: "operation",
            label: "Requesting a WhatsApp pairing code",
            stage: "requesting-qr",
            status: "succeeded",
          }],
          error: null,
        }}
        onWebLoginWait={vi.fn()}
      />,
    );

    expect(await screen.findByRole("img", { name: /whatsapp pairing qr code/i })).toHaveAttribute(
      "src",
      "data:image/png;base64,cXItMQ==",
    );
    expect(onWhatsAppPairingStart).not.toHaveBeenCalled();
  });

  it("shows live WhatsApp setup command execution for debugging", async () => {
    let reportCommand: ((event: OpenClawWhatsAppProgressEvent) => void) | undefined;
    let finishPreparation: (() => void) | undefined;
    const onEnsureWhatsAppSupport = vi.fn((report?: (event: OpenClawWhatsAppProgressEvent) => void) => {
      reportCommand = report;
      return new Promise<void>((resolve) => {
        finishPreparation = resolve;
      });
    });
    render(
      <ChannelChatConnectorCard
        channelId="whatsapp"
        connected
        config={null}
        connectorsProvider={provider("whatsapp")}
        onEnsureWhatsAppSupport={onEnsureWhatsAppSupport}
        onWebLoginStart={vi.fn(async () => ({ connected: false, message: "Scan", qrDataUrl: "data:image/png;base64,cXI=" }))}
        onWebLoginWait={vi.fn(() => new Promise<never>(() => undefined))}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start setup/i }));
    await waitFor(() => expect(reportCommand).toBeTypeOf("function"));
    act(() => reportCommand?.({
      id: "command:openclaw plugins list --json",
      kind: "command",
      label: "Running workspace command",
      command: "openclaw plugins list --json",
      status: "running",
    }));

    const diagnostics = screen.getByLabelText("WhatsApp setup activity");
    expect(diagnostics).toHaveTextContent("$ openclaw plugins list --json");
    expect(diagnostics).toHaveTextContent("Running");

    act(() => reportCommand?.({
      id: "command:openclaw plugins list --json",
      kind: "command",
      label: "Running workspace command",
      command: "openclaw plugins list --json",
      status: "succeeded",
      detail: "Exit code 0",
    }));
    expect(diagnostics).toHaveTextContent("Exit code 0");

    await act(async () => finishPreparation?.());
  });

  it("stops before QR generation when WhatsApp support cannot be installed", async () => {
    const onWebLoginStart = vi.fn();
    render(
      <ChannelChatConnectorCard
        channelId="whatsapp"
        connected
        config={null}
        connectorsProvider={provider("whatsapp")}
        onEnsureWhatsAppSupport={vi.fn(async () => {
          throw new Error("Could not install WhatsApp support. Network unavailable.");
        })}
        onWebLoginStart={onWebLoginStart}
        onWebLoginWait={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start setup/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not install WhatsApp support. Network unavailable.");
    expect(onWebLoginStart).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /try again/i })).toBeEnabled();
  });

  it("refreshes the WhatsApp QR code without saving configuration again", async () => {
    const connectorsProvider = provider("whatsapp");
    const onWebLoginStart = vi.fn()
      .mockResolvedValueOnce({ connected: false, message: "Scan", qrDataUrl: "data:image/png;base64,cXItMQ==" })
      .mockResolvedValueOnce({ connected: false, message: "Scan latest", qrDataUrl: "data:image/png;base64,cXItMg==" });
    const onWebLoginWait = vi.fn(() => new Promise<never>(() => undefined));
    render(
      <ChannelChatConnectorCard
        channelId="whatsapp"
        connected
        config={null}
        connectorsProvider={connectorsProvider}
        onWebLoginStart={onWebLoginStart}
        onWebLoginWait={onWebLoginWait}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start setup/i }));
    fireEvent.click(await screen.findByRole("button", { name: /refresh qr/i }));

    await waitFor(() => expect(onWebLoginStart).toHaveBeenCalledTimes(2));
    expect(onWebLoginStart).toHaveBeenLastCalledWith({ force: true, timeoutMs: 25_000, verbose: true });
    expect(connectorsProvider.configure).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("img", { name: /whatsapp pairing qr code/i })).toHaveAttribute(
      "src",
      "data:image/png;base64,cXItMg==",
    );
  });

  it("renders replacement QR codes returned while WhatsApp pairing is pending", async () => {
    const connectorsProvider = provider("whatsapp");
    const pendingWait = new Promise<never>(() => undefined);
    const onWebLoginWait = vi.fn()
      .mockResolvedValueOnce({ connected: false, message: "Scan the latest code", qrDataUrl: "data:image/png;base64,cXItMg==" })
      .mockImplementationOnce(() => pendingWait);
    render(
      <ChannelChatConnectorCard
        channelId="whatsapp"
        connected
        config={null}
        connectorsProvider={connectorsProvider}
        onWebLoginStart={vi.fn(async () => ({ connected: false, message: "Scan", qrDataUrl: "data:image/png;base64,cXItMQ==" }))}
        onWebLoginWait={onWebLoginWait}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start setup/i }));

    expect(await screen.findByRole("img", { name: /whatsapp pairing qr code/i })).toHaveAttribute(
      "src",
      "data:image/png;base64,cXItMg==",
    );
    expect(onWebLoginWait).toHaveBeenNthCalledWith(2, {
      timeoutMs: 30_000,
      currentQrDataUrl: "data:image/png;base64,cXItMg==",
    });
  });

  it("verifies WhatsApp after the phone scans the QR code", async () => {
    const channelProvider = channelsProvider();
    let finishWait: ((value: { connected: boolean; message: string }) => void) | undefined;
    const onWebLoginWait = vi.fn(() => new Promise<{ connected: boolean; message: string }>((resolve) => {
      finishWait = resolve;
    }));
    render(
      <ChannelChatConnectorCard
        channelId="whatsapp"
        connected
        config={null}
        channelsProvider={channelProvider}
        onWebLoginStart={vi.fn(async () => ({ connected: false, message: "Scan", qrDataUrl: "data:image/png;base64,cXI=" }))}
        onWebLoginWait={onWebLoginWait}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start setup/i }));
    expect(await screen.findByRole("img", { name: /whatsapp pairing qr code/i })).toBeInTheDocument();
    await act(async () => finishWait?.({ connected: true, message: "Connected" }));

    expect(await screen.findByText("WhatsApp online")).toBeInTheDocument();
    expect(channelProvider.configure).toHaveBeenCalledWith("whatsapp", { enabled: true });
    expect(channelProvider.read).toHaveBeenCalledWith({ channelId: "whatsapp", probe: true });
  });

  it("does not request a WhatsApp QR code when configuration fails", async () => {
    const channelProvider = channelsProvider();
    vi.mocked(channelProvider.configure!).mockRejectedValueOnce(new Error("Config rejected"));
    const onWebLoginStart = vi.fn();
    render(
      <ChannelChatConnectorCard
        channelId="whatsapp"
        connected
        config={null}
        channelsProvider={channelProvider}
        onWebLoginStart={onWebLoginStart}
        onWebLoginWait={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start setup/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Config rejected");
    expect(onWebLoginStart).not.toHaveBeenCalled();
  });

  it("disconnects an existing channel through the session config writer", async () => {
    const connectorsProvider = provider("slack", { configured: true, usable: true });
    const onSaveConfig = vi.fn(async (_patch: Record<string, unknown>) => undefined);

    render(
      <ChannelChatConnectorCard
        channelId="slack"
        connected
        config={{ channels: { slack: { enabled: true, botToken: "stored", appToken: "stored" } } }}
        connectorsProvider={connectorsProvider}
        onSaveConfig={onSaveConfig}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /disconnect/i }));
    await waitFor(() => expect(onSaveConfig).toHaveBeenCalledWith({ channels: { slack: null } }));
  });

  it("does not delete a root Slack configuration when multiple accounts need a choice", async () => {
    const channelProvider = channelsProvider({
      defaultAccountId: "work",
      rootConfig: true,
      accounts: [
        { accountId: "work", configured: true, running: true, healthState: "healthy" },
        { accountId: "support", configured: true, running: true, healthState: "healthy" },
      ],
    });
    render(
      <ChannelChatConnectorCard
        channelId="slack"
        connected
        config={{ channels: { slack: { enabled: true } } }}
        connectorsProvider={provider("slack", { configured: true, usable: true })}
        channelsProvider={channelProvider}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /disconnect/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("choose the account to disconnect");
    expect(channelProvider.removeConfig).not.toHaveBeenCalled();
  });

  it("keeps non-Socket Slack accounts visible and routes management to integrations", async () => {
    const onOpenIntegrationDetails = vi.fn();
    render(
      <ChannelChatConnectorCard
        channelId="slack"
        connected
        config={{ channels: { slack: { enabled: true, mode: "http" } } }}
        connectorsProvider={provider("slack", { configured: true, usable: true })}
        onOpenIntegrationDetails={onOpenIntegrationDetails}
      />,
    );

    expect(await screen.findByText("Slack configured")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reconfigure" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Manage in integrations" }));
    expect(onOpenIntegrationDetails).toHaveBeenCalledOnce();
  });
});
