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
    fireEvent.change(screen.getByPlaceholderText(/paste token from botfather/i), { target: { value: "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.change(screen.getByPlaceholderText("123456789"), { target: { value: "123456789" } });
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => expect(saveConfig).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button", { name: /finish/i }));

    expect(retryAndRefreshSessions).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });
});
