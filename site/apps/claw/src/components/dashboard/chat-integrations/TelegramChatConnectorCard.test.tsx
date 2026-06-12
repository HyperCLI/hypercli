import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TelegramChatConnectorCard } from "./TelegramChatConnectorCard";

const telegramSchema = {
  schema: {},
  uiHints: {
    "channels.telegram": {},
  },
};
const validToken = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function continueSetup() {
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
}

describe("TelegramChatConnectorCard", () => {
  it("opens the secure setup flow one step at a time", () => {
    const { container } = render(
      <TelegramChatConnectorCard
        connected
        config={null}
        configSchema={telegramSchema}
        agentName="Research Pilot"
        onSaveConfig={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.queryByText(/Do not paste bot tokens into chat/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/paste token from botfather/i)).not.toBeInTheDocument();
    expect(container.querySelector("[data-telegram-body]")).toBeNull();
    expect(container.querySelector('[data-integration-brand-pulse="idle"]')).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /start setup/i }));

    expect(container.querySelector("[data-telegram-body]")).toBeInTheDocument();
    expect(container.querySelector('[data-integration-brand-pulse="active"]')).toBeInTheDocument();
    expect(screen.getByText("Create bot")).toBeInTheDocument();
    expect(screen.queryByText("Group replies")).not.toBeInTheDocument();
    expect(screen.queryByText("BotFather setup")).not.toBeInTheDocument();
    expect(screen.getAllByText("Create the bot in Telegram first, then come back here.")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /message @botfather/i })).toBeInTheDocument();
    expect(screen.getByText("Create a new bot")).toBeInTheDocument();
    expect(screen.getByText("Give it a name")).toBeInTheDocument();
    expect(screen.getByText("Research Pilot")).toBeInTheDocument();
    expect(screen.getByText("Give it a username")).toBeInTheDocument();
    expect(screen.getByText("researchPilot_bot")).toBeInTheDocument();
    expect(screen.getByText("Paste the token")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/paste token from botfather/i)).toBeInTheDocument();
    expect(screen.getByText("Message it")).toBeInTheDocument();
    expect(screen.getByText(/then come back here and click Continue/i)).toBeInTheDocument();
    expect(screen.queryByText(/step \d+ of/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/paste token from botfather/i), { target: { value: validToken } });
    continueSetup();

    expect(screen.getByText("Add user ID")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("123456789")).toBeInTheDocument();
  });

  it("copies BotFather setup commands", async () => {
    const originalClipboard = navigator.clipboard;
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <TelegramChatConnectorCard
        connected
        config={null}
        configSchema={telegramSchema}
        agentName="Research Pilot"
        onSaveConfig={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start setup/i }));
    fireEvent.click(screen.getByRole("button", { name: /copy telegram command \/newbot/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("/newbot"));
    expect(screen.getByText("Copied")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /copy telegram bot name research pilot/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Research Pilot"));

    fireEvent.click(screen.getByRole("button", { name: /copy telegram bot username researchpilot_bot/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("researchPilot_bot"));

    fireEvent.click(screen.getByRole("button", { name: /copy telegram command \/start/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("/start"));

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: originalClipboard,
    });
  });

  it("blocks save until the bot token format is valid", () => {
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
    fireEvent.change(screen.getByPlaceholderText(/paste token from botfather/i), { target: { value: "not-a-token" } });

    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    expect(onSaveConfig).not.toHaveBeenCalled();
  });

  it("requires a numeric Telegram user ID for allowlist setup", () => {
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
    fireEvent.change(screen.getByPlaceholderText(/paste token from botfather/i), { target: { value: validToken } });
    continueSetup();
    expect(screen.queryByText("Choose DM access")).not.toBeInTheDocument();
    expect(screen.queryByText("Pairing")).not.toBeInTheDocument();

    expect(screen.getByText("Add user ID")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open @userinfobot/i })).toHaveAttribute("href", "https://t.me/userinfobot");
    expect(screen.getByText("Hit Start")).toBeInTheDocument();
    expect(screen.getByText("123456789")).toBeInTheDocument();
    expect(screen.getByText("Paste it here")).toBeInTheDocument();
    expect(screen.getByText(/Telegram usernames cannot be used for this allowlist/i)).toBeInTheDocument();
    expect(screen.queryByText("Ready to save")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save settings/i })).toBeDisabled();
    expect(onSaveConfig).not.toHaveBeenCalled();
  });

  it("saves Telegram config, waits for a Telegram message, and refreshes projects on finish", async () => {
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
    fireEvent.change(screen.getByPlaceholderText(/paste token from botfather/i), { target: { value: validToken } });
    continueSetup();
    fireEvent.change(screen.getByPlaceholderText("123456789"), { target: { value: "123456789" } });
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
          groups: { "*": { requireMention: true } },
        },
      },
    }));
    expect(await screen.findByText("Message Telegram")).toBeInTheDocument();
    expect(screen.getByText("Open your bot")).toBeInTheDocument();
    expect(screen.getByText("Send a message")).toBeInTheDocument();
    expect(screen.getByText("Finish here")).toBeInTheDocument();
    expect(screen.getByText(/The Telegram project appears after the first message arrives/i)).toBeInTheDocument();
    expect(screen.getByText(/Click Finish after sending it to refresh projects/i)).toBeInTheDocument();
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
    fireEvent.change(screen.getByPlaceholderText(/paste token from botfather/i), { target: { value: validToken } });
    continueSetup();
    fireEvent.change(screen.getByPlaceholderText("123456789"), { target: { value: "123456789" } });
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    expect(await screen.findByText("Message Telegram")).toBeInTheDocument();
    expect(screen.queryByText("Add user ID")).not.toBeInTheDocument();
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
    const onAgentConfigUpdate = vi.fn(async () => undefined);
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
    continueSetup();
    fireEvent.change(screen.getByPlaceholderText("123456789"), { target: { value: "123456789" } });
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    expect(await screen.findByRole("button", { name: /ask agent to update allowlist/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ask agent to update allowlist/i }));

    await waitFor(() => expect(onAgentConfigUpdate).toHaveBeenCalledTimes(1));
    expect(onAgentConfigUpdate.mock.calls[0][0]).toContain("channels.telegram.allowFrom = [\"123456789\"]");
    expect(onAgentConfigUpdate.mock.calls[0][0]).toContain("Preserve the existing channels.telegram.botToken exactly as-is.");
    expect(onAgentConfigUpdate.mock.calls[0][0]).not.toMatch(/restart|reload/i);
    expect(onAgentConfigUpdate.mock.calls[0][0]).not.toContain("@@hypercli.ui-action");
    expect(onAgentConfigUpdate.mock.calls[0][0]).not.toContain(validToken);
    expect(onChannelProbe).not.toHaveBeenCalled();
    expect(await screen.findByText(/The Telegram project appears after the first message arrives/i)).toBeInTheDocument();
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
    const onSaveConfig = vi.fn(async () => undefined);

    render(
      <TelegramChatConnectorCard
        connected
        config={{ channels: { telegram: { enabled: true, botToken: "stored", dmPolicy: "pairing" } } }}
        configSchema={telegramSchema}
        onSaveConfig={onSaveConfig}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /reconfigure/i }));
    continueSetup();
    fireEvent.change(screen.getByPlaceholderText("123456789"), { target: { value: "123456789" } });
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => expect(onSaveConfig).toHaveBeenCalledWith({
      channels: {
        telegram: {
          enabled: true,
          dmPolicy: "allowlist",
          allowFrom: ["123456789"],
          groups: { "*": { requireMention: true } },
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
