import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AgentConnectorsProvider } from "@hypercli.com/sdk/connectors";
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
      setupModes: ["config"],
    }]),
    startSetup: vi.fn(async () => ({
      connectorId: channelId,
      mode: "config",
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

describe("ChannelChatConnectorCard", () => {
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

  it("reveals Discord member access after a server ID and omits it again when hidden", async () => {
    const connectorsProvider = provider("discord");
    render(
      <ChannelChatConnectorCard
        channelId="discord"
        connected
        config={null}
        connectorsProvider={connectorsProvider}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /start setup/i }));
    const tokenInput = await screen.findByLabelText("Discord Bot token");
    expect(screen.queryByLabelText("Discord Allowed user ID")).not.toBeInTheDocument();

    fireEvent.change(tokenInput, { target: { value: "discord-secret-token" } });
    fireEvent.change(screen.getByLabelText("Discord Server ID"), { target: { value: "123456" } });
    expect(screen.getByRole("button", { name: /complete step/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Discord Allowed user ID"), { target: { value: "789012" } });
    expect(screen.getByRole("button", { name: /complete step/i })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Discord Server ID"), { target: { value: "" } });
    expect(screen.queryByLabelText("Discord Allowed user ID")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));
    await waitFor(() => expect(connectorsProvider.configure).toHaveBeenCalledWith("discord", {
      enabled: true,
      token: "discord-secret-token",
    }));
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

  it("requires approval before running a generated WhatsApp setup command", async () => {
    const connectorsProvider = provider("whatsapp");
    const onRunShellProposal = vi.fn(async () => undefined);
    const onGenerateConnectorWorkflow = vi.fn(async () => workflow("whatsapp", [{
      id: "whatsapp-login",
      title: "Start pairing",
      instructions: "Run the runtime login command and follow the pairing prompt.",
      kind: "action",
      operation: "whatsapp.shell-proposal",
      command: "openclaw channels login --channel whatsapp",
      approvalRequired: true,
    }]));

    render(
      <ChannelChatConnectorCard
        channelId="whatsapp"
        connected
        config={null}
        connectorsProvider={connectorsProvider}
        onGenerateConnectorWorkflow={onGenerateConnectorWorkflow}
        onRunShellProposal={onRunShellProposal}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /start setup/i }));
    expect(await screen.findByText("openclaw channels login --channel whatsapp")).toBeInTheDocument();
    expect(onRunShellProposal).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    await waitFor(() => expect(onRunShellProposal).toHaveBeenCalledWith("openclaw channels login --channel whatsapp"));

    fireEvent.click(screen.getByRole("button", { name: /enable channel/i }));
    await waitFor(() => expect(connectorsProvider.configure).toHaveBeenCalledWith("whatsapp", { enabled: true }));
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
});
