import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AgentChannel, AgentChannelsProvider } from "@hypercli.com/sdk/channels";
import type { AgentConnectorsProvider, AgentRuntimeDescriptor } from "@hypercli.com/sdk/connectors";
import { describe, expect, it, vi } from "vitest";

import { OpenClawChannelSettingsPanel } from "./OpenClawChannelSettingsPanel";

vi.mock("@hypercli/shared-ui", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const runtime: AgentRuntimeDescriptor = {
  provider: "openclaw",
  version: "2026.7.17",
  protocol: "gateway-v3",
  capabilities: ["channels.status", "config.patch"],
};

function groupedChannel(channelId: string, rawRuntimeStatus: unknown = {}): AgentChannel {
  return {
    channelId,
    label: channelId,
    defaultAccountId: "work",
    rawChannelStatus: {},
    accounts: [
      {
        accountId: "personal",
        accountDisplayName: "Personal",
        configured: true,
        running: false,
        authenticated: true,
        healthState: "degraded",
        rawRuntimeStatus: {},
      },
      {
        accountId: "work",
        accountDisplayName: "Work bot",
        configured: true,
        running: true,
        authenticated: true,
        healthState: "healthy",
        rawRuntimeStatus,
      },
    ],
  };
}

function channelsProvider(config: unknown = { enabled: true }): AgentChannelsProvider {
  return {
    capabilities: { configure: true, logout: true, removeConfig: true, probe: true, multipleAccounts: true },
    list: vi.fn(async () => []),
    read: vi.fn(async (options = {}) => ({
      observedAt: Date.now(),
      channels: [groupedChannel(options.channelId ?? "telegram")],
    })),
    readConfig: vi.fn(async ({ channelId, accountId }) => ({ channelId, accountId, config })),
    update: vi.fn(async () => undefined),
    removeConfig: vi.fn(async () => undefined),
  };
}

function connectorsProvider(): AgentConnectorsProvider {
  return {
    runtime,
    list: vi.fn(async () => []),
    startSetup: vi.fn(),
    pollSetup: vi.fn(),
    configure: vi.fn(async () => undefined),
    approveAuthorization: vi.fn(async (request) => ({
      connectorId: request.connectorId,
      protocol: request.protocol,
      state: "complete" as const,
    })),
  };
}

function telegramPrivacyModeRow(): HTMLElement {
  return screen.getByRole("button", { name: "How to change Telegram privacy mode" }).closest("div") as HTMLElement;
}

describe("OpenClawChannelSettingsPanel", () => {
  it("reads the default account, hydrates safe Telegram fields, and never hydrates the token", async () => {
    const provider = channelsProvider({
      enabled: true,
      botToken: "123456:secret-current-value",
      dmPolicy: "allowlist",
      allowFrom: ["123456789"],
      groupPolicy: "open",
      groupAllowFrom: ["987654321"],
      groups: { "-100123": { requireMention: false } },
    });

    render(<OpenClawChannelSettingsPanel channelId="telegram" channel={groupedChannel("telegram")} provider={provider} runtime={runtime} connected />);

    expect(screen.queryByText(/OpenClaw runtime/i)).not.toBeInTheDocument();
    await waitFor(() => expect(provider.readConfig).toHaveBeenCalledWith({ channelId: "telegram", accountId: "work" }));
    expect(await screen.findByLabelText("Telegram direct-message policy")).toHaveValue("allowlist");
    expect(screen.getByLabelText("Telegram allowed sender IDs")).toHaveValue("123456789");
    expect(screen.getByLabelText("Telegram group IDs")).toHaveValue("-100123");
    expect(screen.getByLabelText("Telegram mention behavior")).toHaveValue("not-required");
    expect(screen.getByLabelText("Telegram configured account")).toHaveValue("work");
    expect(screen.queryByLabelText("Telegram new bot token")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("123456:secret-current-value");

    fireEvent.click(screen.getByRole("button", { name: "Replace bot token" }));
    const replacement = screen.getByLabelText("Telegram new bot token");
    expect(replacement).toHaveValue("");
    fireEvent.change(replacement, { target: { value: "new-sensitive-value" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(provider.update).toHaveBeenCalledWith(expect.objectContaining({
      channelId: "telegram",
      accountId: "work",
      patch: expect.objectContaining({ botToken: "new-sensitive-value" }),
    })));
    expect(screen.queryByLabelText("Telegram new bot token")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("new-sensitive-value");
  });

  it("approves a configured Telegram pairing code through the selected runtime account", async () => {
    const provider = channelsProvider({ enabled: true, dmPolicy: "pairing" });
    const authorizationProvider = connectorsProvider();

    render(
      <OpenClawChannelSettingsPanel
        channelId="telegram"
        channel={groupedChannel("telegram")}
        provider={provider}
        connectorsProvider={authorizationProvider}
        runtime={runtime}
        connected
      />,
    );

    const code = await screen.findByLabelText("Telegram authorization code");
    expect(screen.queryByText("1. Request access")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I approved it elsewhere" })).not.toBeInTheDocument();
    fireEvent.change(code, { target: { value: "INVALID!" } });
    expect(screen.getByRole("button", { name: "Approve pairing" })).toBeDisabled();

    fireEvent.change(code, { target: { value: "abcd2345" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve pairing" }));

    await waitFor(() => expect(authorizationProvider.approveAuthorization).toHaveBeenCalledWith({
      connectorId: "telegram",
      protocol: "short-code",
      code: "ABCD2345",
      accountId: "work",
    }));
    expect(await screen.findByText("Pairing code approved.")).toBeInTheDocument();
  });

  it("probes through the channel reader and refreshes after the test", async () => {
    const provider = channelsProvider();
    const onRefresh = vi.fn(async () => undefined);
    render(<OpenClawChannelSettingsPanel channelId="discord" channel={groupedChannel("discord")} provider={provider} runtime={runtime} connected onRefresh={onRefresh} />);

    await screen.findByLabelText("Discord server ID");
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => expect(provider.read).toHaveBeenCalledWith({ channelId: "discord", probe: true }));
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(await screen.findByText("Connection test passed. Connection status refreshed.")).toBeInTheDocument();
  });

  it.each([
    [true, "Disabled"],
    [false, "Enabled"],
    [undefined, "Not reported"],
  ])("shows Telegram privacy mode from the account probe (%s)", async (canReadAllGroupMessages, expected) => {
    const rawRuntimeStatus = {
      probe: {
        ok: true,
        bot: canReadAllGroupMessages === undefined ? {} : { canReadAllGroupMessages },
      },
    };

    render(<OpenClawChannelSettingsPanel channelId="telegram" channel={groupedChannel("telegram", rawRuntimeStatus)} provider={channelsProvider()} runtime={runtime} connected />);

    await screen.findByLabelText("Telegram direct-message policy");
    expect(screen.getByLabelText("Enable Telegram integration")).toBeChecked();
    expect(telegramPrivacyModeRow()).toHaveTextContent(expected);
  });

  it("explains how to change Telegram privacy mode", async () => {
    render(<OpenClawChannelSettingsPanel channelId="telegram" channel={groupedChannel("telegram")} provider={channelsProvider()} runtime={runtime} connected />);

    await screen.findByLabelText("Telegram direct-message policy");
    fireEvent.focus(screen.getByRole("button", { name: "How to change Telegram privacy mode" }));

    expect(await screen.findByText(/Open BotFather, send \/setprivacy/i)).toBeInTheDocument();
    expect(screen.getByText(/choose Enable to limit group messages or Disable to receive all group messages/i)).toBeInTheDocument();
  });

  it("updates Telegram privacy mode from the latest connection test", async () => {
    const provider = channelsProvider();
    vi.mocked(provider.read!).mockResolvedValue({
      observedAt: Date.now(),
      channels: [groupedChannel("telegram", {
        probe: { ok: true, bot: { canReadAllGroupMessages: false } },
      })],
    });

    render(<OpenClawChannelSettingsPanel channelId="telegram" channel={groupedChannel("telegram")} provider={provider} runtime={runtime} connected />);

    await screen.findByLabelText("Telegram direct-message policy");
    const privacyMode = telegramPrivacyModeRow();
    expect(privacyMode).toHaveTextContent("Not reported");

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => expect(privacyMode).toHaveTextContent("Enabled"));
  });

  it("updates root channel config when the runtime default account is not account-scoped", async () => {
    const provider = channelsProvider({ enabled: true });
    vi.mocked(provider.readConfig!).mockResolvedValue({
      channelId: "discord",
      config: { enabled: true, guilds: { "100": { users: ["200"] } } },
    });
    render(<OpenClawChannelSettingsPanel channelId="discord" channel={groupedChannel("discord")} provider={provider} runtime={runtime} connected />);

    expect(await screen.findByLabelText("Discord server ID")).toHaveValue("100");
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => expect(provider.update).toHaveBeenCalledWith({
      channelId: "discord",
      patch: { enabled: true },
    }));
    expect(await screen.findByText("Settings saved.")).toBeInTheDocument();
  });

  it("edits Slack access policy and channel mention rules without exposing stored tokens", async () => {
    const provider = channelsProvider({
      enabled: true,
      mode: "socket",
      botToken: "xoxb-stored-secret",
      appToken: "xapp-stored-secret",
      dmPolicy: "allowlist",
      allowFrom: ["U0123456789"],
      groupPolicy: "allowlist",
      channels: { C0123456789: { enabled: true, requireMention: true, systemPrompt: "private" } },
    });
    render(<OpenClawChannelSettingsPanel channelId="slack" channel={groupedChannel("slack", { mode: "socket" })} provider={provider} connectorsProvider={connectorsProvider()} runtime={runtime} connected />);

    expect(await screen.findByLabelText("Slack direct-message policy")).toHaveValue("allowlist");
    expect(screen.getByLabelText("Slack allowed user IDs")).toHaveValue("U0123456789");
    expect(screen.getByLabelText("Slack channel policy")).toHaveValue("allowlist");
    expect(screen.getByLabelText("Slack channel ID 1")).toHaveValue("C0123456789");
    expect(screen.getByLabelText("Slack channel mention behavior 1")).toHaveValue("required");
    expect(document.body.textContent).not.toContain("xoxb-stored-secret");
    expect(document.body.textContent).not.toContain("xapp-stored-secret");
    expect(document.body.textContent).not.toContain("private");

    fireEvent.change(screen.getByLabelText("Slack channel mention behavior 1"), { target: { value: "not-required" } });
    fireEvent.click(screen.getByRole("button", { name: "Add channel" }));
    fireEvent.change(screen.getByLabelText("Slack channel ID 2"), { target: { value: "C9876543210" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => expect(provider.update).toHaveBeenCalledWith({
      channelId: "slack",
      accountId: "work",
      patch: {
        enabled: true,
        dmPolicy: "allowlist",
        allowFrom: ["U0123456789"],
        groupPolicy: "allowlist",
        channels: {
          C0123456789: { requireMention: false },
          C9876543210: { enabled: true, requireMention: true },
        },
      },
    }));
  });

  it("validates Slack token prefixes and stable channel IDs", async () => {
    const provider = channelsProvider({ enabled: true, mode: "socket" });
    render(<OpenClawChannelSettingsPanel channelId="slack" channel={groupedChannel("slack", { mode: "socket" })} provider={provider} runtime={runtime} connected />);

    await screen.findByLabelText("Slack direct-message policy");
    fireEvent.change(screen.getByLabelText("Slack channel policy"), { target: { value: "allowlist" } });
    fireEvent.click(screen.getByRole("button", { name: "Add channel" }));
    fireEvent.change(screen.getByLabelText("Slack channel ID 1"), { target: { value: "#general" } });
    fireEvent.click(screen.getByRole("button", { name: "Replace bot token" }));
    fireEvent.change(screen.getByLabelText("Slack new bot token"), { target: { value: "wrong-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/bot tokens must start with xoxb-/i);
    expect(provider.update).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Slack new bot token"), { target: { value: "xoxb-replacement" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/channel IDs must be uppercase C/i);
  });

  it("approves Slack pairing through the selected account", async () => {
    const provider = channelsProvider({ enabled: true, mode: "socket", dmPolicy: "pairing" });
    const authorizationProvider = connectorsProvider();
    render(<OpenClawChannelSettingsPanel channelId="slack" channel={groupedChannel("slack", { mode: "socket" })} provider={provider} connectorsProvider={authorizationProvider} runtime={runtime} connected />);

    const code = await screen.findByLabelText("Slack authorization code");
    fireEvent.change(code, { target: { value: "abcd2345" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve pairing" }));

    await waitFor(() => expect(authorizationProvider.approveAuthorization).toHaveBeenCalledWith({
      connectorId: "slack",
      protocol: "short-code",
      code: "ABCD2345",
      accountId: "work",
    }));
  });

  it("requires inline confirmation before removing an account configuration", async () => {
    const provider = channelsProvider();
    render(<OpenClawChannelSettingsPanel channelId="slack" channel={groupedChannel("slack", {
      botTokenStatus: "available",
      botTokenSource: "environment",
      appTokenStatus: "missing",
    })} provider={provider} runtime={runtime} connected />);

    await screen.findByLabelText("Slack direct-message policy");
    expect(screen.getByText("Available · environment")).toBeInTheDocument();
    expect(screen.getByText("Missing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove configuration" }));
    expect(provider.removeConfig).not.toHaveBeenCalled();
    const confirm = screen.getByRole("button", { name: "Confirm remove" });
    expect(confirm).toHaveFocus();
    fireEvent.click(confirm);

    await waitFor(() => expect(provider.removeConfig).toHaveBeenCalledWith("slack", "work"));
    expect(await screen.findByText("Local configuration removed. Inherited or environment-backed settings still configure this account.")).toBeInTheDocument();
  });

  it("reports successful removal when runtime status and refresh are unavailable", async () => {
    const provider = channelsProvider();
    vi.mocked(provider.read!).mockRejectedValue(new Error("status unavailable"));
    const onRefresh = vi.fn(async () => { throw new Error("refresh unavailable"); });
    const channel: AgentChannel = {
      channelId: "slack",
      label: "Slack",
      rawChannelStatus: {},
      accounts: [{ accountId: "default", configured: true, healthState: "unknown", rawRuntimeStatus: {} }],
    };
    render(<OpenClawChannelSettingsPanel channelId="slack" channel={channel} provider={provider} runtime={runtime} connected onRefresh={onRefresh} />);

    await screen.findByText("Socket Mode credentials");
    fireEvent.click(screen.getByRole("button", { name: "Remove configuration" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm remove" }));

    await waitFor(() => expect(provider.removeConfig).toHaveBeenCalledWith("slack"));
    expect(await screen.findByText(/configuration removed.*status refresh was unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/could not remove/i)).not.toBeInTheDocument();
  });

  it("recognizes HTTP Slack accounts without offering Socket Mode app-token replacement", async () => {
    const provider = channelsProvider({ enabled: true, mode: "http" });
    render(<OpenClawChannelSettingsPanel channelId="slack" channel={groupedChannel("slack", {
      mode: "http",
      botTokenStatus: "available",
      botTokenSource: "config",
      signingSecretStatus: "configured_unavailable",
      signingSecretSource: "secret-ref",
    })} provider={provider} runtime={runtime} connected />);

    await screen.findByLabelText("Slack direct-message policy");
    expect(screen.getByText("HTTP Request URLs credentials")).toBeInTheDocument();
    expect(screen.getByText("Signing secret")).toBeInTheDocument();
    expect(screen.getByText("Configured, unavailable · secret-ref")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Replace app token" })).not.toBeInTheDocument();
  });

  it("reports the selected account probe failure instead of unconditional success", async () => {
    const provider = channelsProvider();
    vi.mocked(provider.read!).mockResolvedValue({
      observedAt: Date.now(),
      channels: [groupedChannel("slack", {
        mode: "socket",
        healthState: "degraded",
      })],
    });
    const failed = groupedChannel("slack");
    failed.accounts[1] = {
      ...failed.accounts[1]!,
      healthState: "degraded",
      lastError: "Slack bot identity is unavailable",
    };
    vi.mocked(provider.read!).mockResolvedValue({ observedAt: Date.now(), channels: [failed] });
    render(<OpenClawChannelSettingsPanel channelId="slack" channel={groupedChannel("slack", { mode: "socket" })} provider={provider} runtime={runtime} connected />);

    await screen.findByText("Socket Mode credentials");
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Slack bot identity is unavailable");
  });

  it("offers explicit WhatsApp re-pair without invoking it during ordinary settings", async () => {
    const provider = channelsProvider({ enabled: true });
    const onOpenPairing = vi.fn();
    render(
      <OpenClawChannelSettingsPanel
        channelId="whatsapp"
        channel={groupedChannel("whatsapp", { statusState: "connected", mode: "linked" })}
        provider={provider}
        runtime={runtime}
        connected
        onOpenPairing={onOpenPairing}
      />,
    );

    await screen.findByText("Ordinary settings changes do not restart pairing. Use Re-pair only when the linked WhatsApp account must be replaced.");
    expect(onOpenPairing).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(provider.update).toHaveBeenCalledWith({ channelId: "whatsapp", accountId: "work", patch: { enabled: true } }));
    expect(onOpenPairing).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Re-pair WhatsApp" }));
    expect(onOpenPairing).toHaveBeenCalledOnce();
  });
});
