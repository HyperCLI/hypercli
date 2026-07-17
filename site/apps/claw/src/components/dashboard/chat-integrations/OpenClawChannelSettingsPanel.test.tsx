import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AgentChannel, AgentChannelsProvider } from "@hypercli.com/sdk/channels";
import type { AgentConnectorsProvider, AgentRuntimeDescriptor } from "@hypercli.com/sdk/connectors";
import { describe, expect, it, vi } from "vitest";

import { OpenClawChannelSettingsPanel } from "./OpenClawChannelSettingsPanel";

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
    read: vi.fn(async () => ({ observedAt: Date.now(), channels: [] })),
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

describe("OpenClawChannelSettingsPanel", () => {
  it("labels the runtime, reads the default account, hydrates safe Telegram fields, and never hydrates the token", async () => {
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

    expect(screen.getByText("OpenClaw runtime · v2026.7.17 · gateway-v3")).toBeInTheDocument();
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
    expect(await screen.findByText("Connection test complete. Runtime status refreshed.")).toBeInTheDocument();
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

  it("requires inline confirmation before removing an account configuration", async () => {
    const provider = channelsProvider();
    render(<OpenClawChannelSettingsPanel channelId="slack" channel={groupedChannel("slack", {
      botTokenStatus: "available",
      botTokenSource: "environment",
      appTokenStatus: "missing",
    })} provider={provider} runtime={runtime} connected />);

    await screen.findByText("Slack uses Socket Mode credentials independently. Replace only the values that need to rotate.");
    expect(screen.getByText("Available · environment")).toBeInTheDocument();
    expect(screen.getByText("Missing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove configuration" }));
    expect(provider.removeConfig).not.toHaveBeenCalled();
    const confirm = screen.getByRole("button", { name: "Confirm remove" });
    expect(confirm).toHaveFocus();
    fireEvent.click(confirm);

    await waitFor(() => expect(provider.removeConfig).toHaveBeenCalledWith("slack", "work"));
    expect(await screen.findByText("Configuration removed.")).toBeInTheDocument();
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
