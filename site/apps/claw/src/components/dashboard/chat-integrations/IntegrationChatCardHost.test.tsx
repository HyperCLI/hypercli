import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { IntegrationChatCardHost } from "./IntegrationChatCardHost";

const telegramSchema = {
  schema: {},
  uiHints: {
    "channels.telegram": {},
  },
};

describe("IntegrationChatCardHost", () => {
  it.each(["discord", "slack", "whatsapp"] as const)("renders the %s channel card", async (integrationId) => {
    render(
      <IntegrationChatCardHost
        action={{ version: 1, type: "integration.connect", integrationId }}
        chat={{
          connected: true,
          config: null,
          saveConfig: vi.fn(async () => undefined),
        } as never}
      />,
    );

    expect(await screen.findByRole("button", { name: /start setup/i })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`connect ${integrationId}`, "i"))).toBeInTheDocument();
  });

  it("wires Telegram finish to gateway reconnect", async () => {
    const retry = vi.fn();
    const retryAndRefreshSessions = vi.fn();
    const saveConfig = vi.fn(async () => undefined);

    render(
      <IntegrationChatCardHost
        action={{ version: 1, type: "integration.connect", integrationId: "telegram" }}
        chat={{
          connected: true,
          config: null,
          configSchema: telegramSchema,
          saveConfig,
          channelsStatus: vi.fn(async () => ({ channels: {} })),
          retry,
          retryAndRefreshSessions,
        } as never}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start setup/i }));
    fireEvent.change(screen.getByPlaceholderText(/enter bot token/i), { target: { value: "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ" } });
    fireEvent.change(screen.getByLabelText("Telegram DM policy"), { target: { value: "runtime-default" } });
    fireEvent.change(screen.getByLabelText("Telegram group policy"), { target: { value: "runtime-default" } });
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => expect(saveConfig).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button", { name: /finish/i }));

    expect(retryAndRefreshSessions).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it.each(["github", "telegram", "discord", "slack", "whatsapp"] as const)("opens the %s integrations detail when requested from chat", async (integrationId) => {
    const onOpenIntegrationDetails = vi.fn();
    render(
      <IntegrationChatCardHost
        action={{ version: 1, type: "integration.connect", integrationId }}
        chat={{
          connected: true,
          config: null,
          configSchema: telegramSchema,
          saveConfig: vi.fn(async () => undefined),
        } as never}
        onOpenIntegrationDetails={onOpenIntegrationDetails}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /open in integrations/i }));
    expect(onOpenIntegrationDetails).toHaveBeenCalledWith(integrationId);
  });
});
