import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AgentConnectorsProvider } from "@hypercli.com/sdk/connectors";
import { describe, expect, it, vi } from "vitest";

import { TelegramChatConnectorCard } from "./TelegramChatConnectorCard";
import type { ConnectorWorkflow } from "@/lib/connector-workflow";

const telegramSchema = {
  schema: {},
  uiHints: {
    "channels.telegram": {},
  },
};
const validToken = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function chooseAccessOptions({
  dmPolicy = "runtime-default",
  groupPolicy = "runtime-default",
}: {
  dmPolicy?: string;
  groupPolicy?: string;
} = {}) {
  fireEvent.change(screen.getByLabelText("Telegram DM policy"), { target: { value: dmPolicy } });
  fireEvent.change(screen.getByLabelText("Telegram group policy"), { target: { value: groupPolicy } });
}
const generatedWorkflow: ConnectorWorkflow = {
  schema: "hypercli.connector-workflow.v1",
  connectorId: "telegram",
  runtimeFingerprint: "openclaw:test",
  summary: "Follow the Telegram steps reported for this runtime.",
  steps: [{
    id: "create-bot",
    title: "Create a Telegram bot",
    instructions: "Use the runtime-recommended Telegram bot flow, then enter the resulting token securely below.",
    kind: "input",
    inputSlots: ["telegram.botToken"],
    approvalRequired: false,
  }],
};

describe("TelegramChatConnectorCard", () => {
  it("uses runtime-provided setup instructions before generated guidance", async () => {
    const onGenerateConnectorWorkflow = vi.fn(async () => generatedWorkflow);
    const connectorsProvider = {
      runtime: { provider: "openclaw", version: "2026.7.16", capabilities: ["channels"] },
      list: vi.fn(async () => []),
      startSetup: vi.fn(async () => ({
        connectorId: "telegram",
        mode: "config" as const,
        instructions: "Use the Telegram setup flow reported by this runtime.",
        provenance: { provider: "openclaw", version: "2026.7.16", capabilities: ["channels"] },
      })),
      pollSetup: vi.fn(),
      configure: vi.fn(),
    } satisfies AgentConnectorsProvider;

    render(
      <TelegramChatConnectorCard
        connected
        connectorsProvider={connectorsProvider}
        config={null}
        configSchema={null}
        onGenerateConnectorWorkflow={onGenerateConnectorWorkflow}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start setup/i }));

    expect((await screen.findAllByText("Use the Telegram setup flow reported by this runtime.")).length).toBeGreaterThan(0);
    expect(connectorsProvider.startSetup).toHaveBeenCalledWith({ connectorId: "telegram", mode: "config" });
    expect(onGenerateConnectorWorkflow).not.toHaveBeenCalled();
  });

  it("opens runtime-generated guidance with secure inputs one step at a time", async () => {
    const { container } = render(
      <TelegramChatConnectorCard
        connected
        config={null}
        configSchema={telegramSchema}
        agentName="Research Pilot"
        onSaveConfig={vi.fn(async () => undefined)}
        onGenerateConnectorWorkflow={vi.fn(async () => generatedWorkflow)}
      />,
    );

    expect(screen.queryByText(/Do not paste bot tokens into chat/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/enter bot token/i)).not.toBeInTheDocument();
    expect(container.querySelector("[data-telegram-body]")).toBeNull();
    expect(container.querySelector('[data-integration-brand-pulse="idle"]')).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /start setup/i }));

    expect(container.querySelector("[data-telegram-body]")).toBeInTheDocument();
    expect(container.querySelector('[data-integration-brand-pulse="active"]')).toBeInTheDocument();
    expect(screen.getAllByText("Connect Telegram").length).toBeGreaterThan(0);
    expect(screen.queryByText("Group replies")).not.toBeInTheDocument();
    expect(screen.queryByText("BotFather setup")).not.toBeInTheDocument();
    expect((await screen.findAllByText(generatedWorkflow.summary)).length).toBeGreaterThan(0);
    expect(screen.getByText("Create a Telegram bot")).toBeInTheDocument();
    expect(screen.queryByText(/@BotFather/i)).not.toBeInTheDocument();
    expect(screen.getByText("Bot token")).toBeInTheDocument();
    const tokenInput = screen.getByPlaceholderText(/enter bot token/i);
    expect(tokenInput).toBeInTheDocument();
    expect(tokenInput.closest("[data-workflow-step]")).toHaveAttribute("data-workflow-step", "create-bot");
    expect(screen.queryByText("Allowed user IDs")).not.toBeInTheDocument();
    expect(screen.getByText(/never sent to the setup planner/i)).toBeInTheDocument();
    expect(screen.queryByText(/step \d+ of/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /complete step/i })).toBeDisabled();

    fireEvent.change(tokenInput, { target: { value: validToken } });
    expect(screen.getByRole("button", { name: /complete step/i })).toBeDisabled();
    chooseAccessOptions({ dmPolicy: "allowlist" });
    expect(screen.getByPlaceholderText("123456789").closest("[data-workflow-step]")).toHaveAttribute("data-workflow-step", "create-bot");
    fireEvent.change(screen.getByPlaceholderText("123456789"), { target: { value: "123456789" } });
    expect(screen.getByRole("button", { name: /complete step/i })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /complete step/i }));
    expect(container.querySelector('[data-workflow-step="create-bot"]')).toHaveAttribute("data-step-complete", "true");
  });

  it("does not send the bot token to the workflow generator", async () => {
    const onGenerateConnectorWorkflow = vi.fn(async () => generatedWorkflow);
    render(
      <TelegramChatConnectorCard
        connected
        config={null}
        configSchema={telegramSchema}
        agentName="Research Pilot"
        onSaveConfig={vi.fn(async () => undefined)}
        onGenerateConnectorWorkflow={onGenerateConnectorWorkflow}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start setup/i }));
    await waitFor(() => expect(onGenerateConnectorWorkflow).toHaveBeenCalledWith("telegram"));
    fireEvent.change(screen.getByPlaceholderText(/enter bot token/i), { target: { value: validToken } });
    expect(onGenerateConnectorWorkflow).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(onGenerateConnectorWorkflow.mock.calls)).not.toContain(validToken);
  });

  it("blocks save until the bot token format is valid", () => {
    const onSaveConfig = vi.fn(async (_patch: Record<string, unknown>) => undefined);

    render(
      <TelegramChatConnectorCard
        connected
        config={null}
        configSchema={telegramSchema}
        onSaveConfig={onSaveConfig}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start setup/i }));
    chooseAccessOptions();
    fireEvent.change(screen.getByPlaceholderText(/enter bot token/i), { target: { value: "not-a-token" } });

    expect(screen.getByRole("button", { name: /complete step/i })).toBeDisabled();
    expect(onSaveConfig).not.toHaveBeenCalled();
  });

  it("reveals Telegram access fields through policy-driven progression", () => {
    const onSaveConfig = vi.fn(async () => undefined);

    render(
      <TelegramChatConnectorCard
        connected
        config={null}
        configSchema={telegramSchema}
        onSaveConfig={onSaveConfig}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start setup/i }));
    fireEvent.change(screen.getByPlaceholderText(/enter bot token/i), { target: { value: validToken } });
    expect(screen.getByLabelText("Telegram DM policy")).toHaveValue("");
    expect(screen.getByLabelText("Telegram group policy")).toHaveValue("");
    expect(screen.queryByText("Allowed user IDs")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Telegram allowed group sender IDs")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Telegram group IDs")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Telegram mention behavior")).not.toBeInTheDocument();

    chooseAccessOptions({ dmPolicy: "allowlist", groupPolicy: "allowlist" });
    expect(screen.getByLabelText("Telegram DM policy")).toBeInTheDocument();
    expect(screen.getByLabelText("Telegram group policy")).toBeInTheDocument();
    expect(screen.getByText("Allowed user IDs")).toBeInTheDocument();
    expect(screen.getByLabelText("Telegram allowed group sender IDs")).toBeInTheDocument();
    expect(screen.getByLabelText("Telegram group IDs")).toBeInTheDocument();
    expect(screen.queryByLabelText("Telegram mention behavior")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Telegram group IDs"), { target: { value: "-1001234567890" } });
    expect(screen.getByLabelText("Telegram mention behavior")).toHaveValue("");
    expect(screen.queryByText("Ready to save")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save settings/i })).toBeDisabled();
    expect(onSaveConfig).not.toHaveBeenCalled();
  });

  it("keeps optional pre-authorized sender IDs available for pairing", async () => {
    const onSaveConfig = vi.fn(async () => undefined);
    render(
      <TelegramChatConnectorCard
        connected
        config={null}
        configSchema={telegramSchema}
        onSaveConfig={onSaveConfig}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start setup/i }));
    fireEvent.change(screen.getByPlaceholderText(/enter bot token/i), { target: { value: validToken } });
    chooseAccessOptions({ dmPolicy: "pairing", groupPolicy: "disabled" });

    expect(screen.queryByText("Allowed user IDs")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pre-authorize a user/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save settings/i })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /pre-authorize a user/i }));
    expect(screen.getByText("Allowed user IDs")).toBeInTheDocument();
    expect(screen.getByText(/optional for pre-authorized pairing senders/i)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("123456789"), { target: { value: "123456789" } });
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => expect(onSaveConfig).toHaveBeenCalledWith({
      channels: {
        telegram: {
          enabled: true,
          botToken: validToken,
          dmPolicy: "pairing",
          allowFrom: ["123456789"],
          groupPolicy: "disabled",
        },
      },
    }));
  });

  it("keeps short-code authorization in the setup flow after configuration", async () => {
    const approveAuthorization = vi.fn(async () => ({
      connectorId: "telegram",
      protocol: "short-code" as const,
      state: "complete" as const,
    }));
    const connectorsProvider = {
      runtime: { provider: "openclaw", capabilities: ["channels", "config.patch"] },
      list: vi.fn(async () => [{
        connectorId: "telegram",
        configured: false,
        authenticated: false,
        usable: false,
        setupModes: ["config" as const],
      }]),
      startSetup: vi.fn(async () => ({
        connectorId: "telegram",
        mode: "config" as const,
        provenance: { provider: "openclaw", capabilities: ["channels", "config.patch"] },
      })),
      pollSetup: vi.fn(),
      configure: vi.fn(async () => undefined),
      approveAuthorization,
    } satisfies AgentConnectorsProvider;
    const onReconnectGateway = vi.fn();

    render(
      <TelegramChatConnectorCard
        connected
        connectorsProvider={connectorsProvider}
        config={null}
        configSchema={telegramSchema}
        onReconnectGateway={onReconnectGateway}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start setup/i }));
    fireEvent.change(await screen.findByPlaceholderText(/enter bot token/i), { target: { value: validToken } });
    chooseAccessOptions({ dmPolicy: "pairing", groupPolicy: "disabled" });
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    expect(await screen.findByText("No allowed user ID is required")).toBeInTheDocument();
    expect(screen.getByText(/first message is not processed/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /finish/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Telegram authorization code"), { target: { value: "ABCD2345" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve code" }));

    await waitFor(() => expect(approveAuthorization).toHaveBeenCalledWith({
      connectorId: "telegram",
      protocol: "short-code",
      code: "ABCD2345",
      notify: true,
    }));
    expect(screen.getByRole("button", { name: /finish/i })).toBeEnabled();
  });

  it("writes no access policy when the user explicitly keeps runtime defaults", async () => {
    const onSaveConfig = vi.fn(async () => undefined);
    render(
      <TelegramChatConnectorCard
        connected
        config={null}
        configSchema={telegramSchema}
        onSaveConfig={onSaveConfig}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start setup/i }));
    fireEvent.change(screen.getByPlaceholderText(/enter bot token/i), { target: { value: validToken } });
    chooseAccessOptions();
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => expect(onSaveConfig).toHaveBeenCalledWith({
      channels: { telegram: { enabled: true, botToken: validToken } },
    }));
  });

  it("adds public access only when the user explicitly chooses an open DM policy", async () => {
    const onSaveConfig = vi.fn(async () => undefined);
    render(
      <TelegramChatConnectorCard
        connected
        config={null}
        configSchema={telegramSchema}
        onSaveConfig={onSaveConfig}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start setup/i }));
    fireEvent.change(screen.getByPlaceholderText(/enter bot token/i), { target: { value: validToken } });
    chooseAccessOptions({ dmPolicy: "open", groupPolicy: "disabled" });
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => expect(onSaveConfig).toHaveBeenCalledWith({
      channels: {
        telegram: {
          enabled: true,
          botToken: validToken,
          dmPolicy: "open",
          allowFrom: ["*"],
          groupPolicy: "disabled",
        },
      },
    }));
  });

  it("does not submit dependent values after their controlling policies hide them", async () => {
    const onSaveConfig = vi.fn(async () => undefined);
    render(
      <TelegramChatConnectorCard
        connected
        config={null}
        configSchema={telegramSchema}
        onSaveConfig={onSaveConfig}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start setup/i }));
    fireEvent.change(screen.getByPlaceholderText(/enter bot token/i), { target: { value: validToken } });
    chooseAccessOptions({ dmPolicy: "allowlist", groupPolicy: "allowlist" });
    fireEvent.change(screen.getByPlaceholderText("123456789"), { target: { value: "123456789" } });
    fireEvent.change(screen.getByLabelText("Telegram allowed group sender IDs"), { target: { value: "987654321" } });
    fireEvent.change(screen.getByLabelText("Telegram group IDs"), { target: { value: "-1001234567890" } });
    fireEvent.change(screen.getByLabelText("Telegram mention behavior"), { target: { value: "required" } });

    fireEvent.change(screen.getByLabelText("Telegram DM policy"), { target: { value: "disabled" } });
    fireEvent.change(screen.getByLabelText("Telegram group policy"), { target: { value: "disabled" } });
    expect(screen.queryByText("Allowed user IDs")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Telegram allowed group sender IDs")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Telegram group IDs")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Telegram mention behavior")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));
    await waitFor(() => expect(onSaveConfig).toHaveBeenCalledWith({
      channels: {
        telegram: {
          enabled: true,
          botToken: validToken,
          dmPolicy: "disabled",
          groupPolicy: "disabled",
        },
      },
    }));
  });

  it("saves Telegram config, waits for a Telegram message, and refreshes sessions on finish", async () => {
    const onSaveConfig = vi.fn(async () => undefined);
    const onChannelProbe = vi.fn(async () => ({
      channels: {
        telegram: { configured: true, running: true, username: "helper_bot", probe: { ok: true } },
      },
    }));
    const onReconnectGateway = vi.fn();

    render(
      <TelegramChatConnectorCard
        connected
        config={null}
        configSchema={telegramSchema}
        onSaveConfig={onSaveConfig}
        onChannelProbe={onChannelProbe}
        onReconnectGateway={onReconnectGateway}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start setup/i }));
    fireEvent.change(screen.getByPlaceholderText(/enter bot token/i), { target: { value: validToken } });
    chooseAccessOptions({ dmPolicy: "allowlist", groupPolicy: "allowlist" });
    fireEvent.change(screen.getByPlaceholderText("123456789"), { target: { value: "123456789" } });
    fireEvent.change(screen.getByLabelText("Telegram group IDs"), { target: { value: "-1001234567890" } });
    fireEvent.change(screen.getByLabelText("Telegram mention behavior"), { target: { value: "required" } });
    expect(screen.queryByText("Ready to save")).not.toBeInTheDocument();
    expect(screen.queryByText("Group replies")).not.toBeInTheDocument();
    expect(screen.queryByText("Require @mention")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => expect(onSaveConfig).toHaveBeenCalledWith({
      channels: {
        telegram: {
          enabled: true,
          botToken: validToken,
          dmPolicy: "allowlist",
          allowFrom: ["123456789"],
          groupPolicy: "allowlist",
          groups: { "-1001234567890": { requireMention: true } },
        },
      },
    }));
    expect(await screen.findByText("Message Telegram")).toBeInTheDocument();
    expect(screen.getByText("Open your bot")).toBeInTheDocument();
    expect(screen.getByText("Send a message")).toBeInTheDocument();
    expect(screen.getByText("Finish here")).toBeInTheDocument();
    expect(screen.getByText(/The session appears after the message arrives/i)).toBeInTheDocument();
    expect(screen.getByText(/Click Finish after sending it to refresh sessions/i)).toBeInTheDocument();
    expect(screen.queryByText(/restart|reload|reconnect/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /finish/i })).toBeEnabled();
    expect(screen.queryByText(/Testing/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Telegram is connected for this workspace/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Inbound test/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /i sent it/i })).not.toBeInTheDocument();
    expect(onChannelProbe).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue(validToken)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /finish/i }));
    expect(onReconnectGateway).toHaveBeenCalledTimes(1);
  });

  it("stays on the final Telegram message step if the gateway restarts while saving", async () => {
    const onSaveConfig = vi.fn(async () => {
      throw new Error("gateway closed (1012): restart");
    });
    const onReconnectGateway = vi.fn();

    const { rerender } = render(
      <TelegramChatConnectorCard
        connected
        config={null}
        configSchema={telegramSchema}
        onSaveConfig={onSaveConfig}
        onReconnectGateway={onReconnectGateway}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start setup/i }));
    fireEvent.change(screen.getByPlaceholderText(/enter bot token/i), { target: { value: validToken } });
    chooseAccessOptions();
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    expect(await screen.findByText("Message Telegram")).toBeInTheDocument();
    expect(screen.queryByText("Allowed Telegram user IDs")).not.toBeInTheDocument();
    expect(screen.queryByText(/Could not save Telegram settings/i)).not.toBeInTheDocument();

    rerender(
      <TelegramChatConnectorCard
        connected={false}
        config={null}
        configSchema={null}
        onSaveConfig={onSaveConfig}
        onReconnectGateway={onReconnectGateway}
      />,
    );

    expect(screen.getByText("Message Telegram")).toBeInTheDocument();
    expect(screen.getByText("Open your bot")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /finish/i })).toBeEnabled();
    expect(screen.queryByText(/Start or reconnect the agent before saving Telegram settings/i)).not.toBeInTheDocument();
  });

  it("asks the agent to update only non-secret allowlist settings when config patching is protected", async () => {
    const onSaveConfig = vi.fn(async () => {
      throw new Error("config path is protected");
    });
    const onAgentConfigUpdate = vi.fn(async (_prompt: string, _displayContent: string) => undefined);
    const onChannelProbe = vi.fn(async () => ({ channels: { telegram: { configured: true, running: true, probe: { ok: true } } } }));

    render(
      <TelegramChatConnectorCard
        connected
        config={{ channels: { telegram: { enabled: true, botToken: "stored", dmPolicy: "pairing" } } }}
        configSchema={telegramSchema}
        onSaveConfig={onSaveConfig}
        onAgentConfigUpdate={onAgentConfigUpdate}
        onChannelProbe={onChannelProbe}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /reconfigure/i }));
    fireEvent.change(screen.getByLabelText("Telegram DM policy"), { target: { value: "allowlist" } });
    fireEvent.change(screen.getByPlaceholderText("123456789"), { target: { value: "123456789" } });
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    expect(await screen.findByRole("button", { name: /ask agent to apply access settings/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ask agent to apply access settings/i }));

    await waitFor(() => expect(onAgentConfigUpdate).toHaveBeenCalledTimes(1));
    expect(onAgentConfigUpdate.mock.calls[0][0]).toContain("channels.telegram.dmPolicy = \"allowlist\"");
    expect(onAgentConfigUpdate.mock.calls[0][0]).toContain("channels.telegram.allowFrom = [\"123456789\"]");
    expect(onAgentConfigUpdate.mock.calls[0][0]).toContain("Preserve the existing channels.telegram.botToken exactly as-is.");
    expect(onAgentConfigUpdate.mock.calls[0][0]).not.toMatch(/restart|reload/i);
    expect(onAgentConfigUpdate.mock.calls[0][0]).not.toContain("@@hypercli.ui-action");
    expect(onAgentConfigUpdate.mock.calls[0][0]).not.toContain(validToken);
    expect(onChannelProbe).not.toHaveBeenCalled();
    expect(await screen.findByText(/The session appears after the message arrives/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Telegram is connected for this workspace/i)).not.toBeInTheDocument());
    expect(screen.queryByText(/Inbound test/i)).not.toBeInTheDocument();
  });

  it("shows the Telegram access link when a configured bot username is known", async () => {
    render(
      <TelegramChatConnectorCard
        connected
        config={{ channels: { telegram: { enabled: true, botToken: "stored", username: "helper_bot" } } }}
        configSchema={telegramSchema}
        onSaveConfig={vi.fn(async () => undefined)}
      />,
    );

    expect(await screen.findByRole("link", { name: /open @helper_bot on telegram/i })).toHaveAttribute("href", "https://t.me/helper_bot");
    expect(screen.getByRole("link", { name: /^open telegram$/i })).toHaveAttribute("href", "https://t.me/helper_bot");
    expect(screen.getByText(/Telegram settings are saved. Reconfigure the bot token if you need to update it./i)).toBeInTheDocument();
    expect(screen.queryByText(/Test the connection from here/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^test$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Telegram is connected for this workspace/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Inbound test/i)).not.toBeInTheDocument();
  });

  it("keeps the existing bot token when reconfiguring a saved Telegram channel", async () => {
    const onSaveConfig = vi.fn(async (_patch: Record<string, unknown>) => undefined);

    render(
      <TelegramChatConnectorCard
        connected
        config={{ channels: { telegram: { enabled: true, botToken: "stored", dmPolicy: "pairing" } } }}
        configSchema={telegramSchema}
        onSaveConfig={onSaveConfig}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /reconfigure/i }));
    expect(screen.getByLabelText("Telegram DM policy")).toHaveValue("pairing");
    expect(screen.getByLabelText("Telegram group policy")).toHaveValue("runtime-default");
    expect(screen.queryByLabelText("Telegram mention behavior")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Telegram DM policy"), { target: { value: "allowlist" } });
    fireEvent.change(screen.getByPlaceholderText("123456789"), { target: { value: "123456789" } });
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => expect(onSaveConfig).toHaveBeenCalledWith({
      channels: {
        telegram: {
          enabled: true,
          dmPolicy: "allowlist",
          allowFrom: ["123456789"],
        },
      },
    }));
    expect(JSON.stringify(onSaveConfig.mock.calls[0][0])).not.toContain("botToken");
  });

  it("disconnects Telegram from the card", async () => {
    const onSaveConfig = vi.fn(async () => undefined);

    render(
      <TelegramChatConnectorCard
        connected
        config={{ channels: { telegram: { enabled: true, botToken: "stored" } } }}
        configSchema={telegramSchema}
        onSaveConfig={onSaveConfig}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));

    await waitFor(() => expect(onSaveConfig).toHaveBeenCalledWith({ channels: { telegram: null } }));
  });
});
