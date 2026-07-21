import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { IntegrationChatCardHost } from "./IntegrationChatCardHost";

vi.mock("@/hooks/useAgentAuth", () => ({
  useAgentAuth: () => ({ getToken: vi.fn(async () => "token"), isAuthenticated: true, isLoading: false }),
}));

const telegramSchema = {
  schema: {},
  uiHints: {
    "channels.telegram": {},
  },
};

describe("IntegrationChatCardHost", () => {
  it.each(["discord", "whatsapp"] as const)("renders the %s channel card", async (integrationId) => {
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

  it("renders the integrations Slack card in chat", async () => {
    render(
      <IntegrationChatCardHost
        action={{ version: 1, type: "integration.connect", integrationId: "slack" }}
        chat={{ connected: true, config: null, saveConfig: vi.fn(async () => undefined) } as never}
      />,
    );

    expect(await screen.findByText("Connect Slack")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Advanced mode/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start setup/i })).not.toBeInTheDocument();
  });

  it("uses the Slack override when hosted relay setup state is provided", async () => {
    render(
      <IntegrationChatCardHost
        action={{ version: 1, type: "integration.connect", integrationId: "slack" }}
        chat={{
          connected: true,
          config: null,
          saveConfig: vi.fn(async () => undefined),
        } as never}
        slackRelaySetup={{
          mode: "prompt",
          handle: "hyperdev",
          hostedAvailable: true,
          connected: true,
          workspace: "Test Workspace",
          attached: false,
          checking: false,
          configuring: false,
          error: null,
          connectHref: "/slack/start",
          onChooseHosted: vi.fn(),
          onChooseSelfHosted: vi.fn(),
          onBackToChoice: vi.fn(),
          onRefreshHosted: vi.fn(),
          onConfigureHosted: vi.fn(),
        }}
      />,
    );

    expect(await screen.findByText("Express mode")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue Express setup/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Advanced mode/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start setup/i })).not.toBeInTheDocument();
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
          generateConnectorWorkflow: vi.fn(async () => ({
            schema: "hypercli.connector-workflow.v1",
            connectorId: "telegram",
            runtimeFingerprint: "openclaw:test",
            summary: "Configure Telegram.",
            steps: [{
              id: "settings",
              title: "Enter settings",
              instructions: "Enter the protected settings.",
              kind: "input",
              inputSlots: ["telegram.botToken"],
              approvalRequired: false,
            }],
          })),
          channelsStatus: vi.fn(async () => ({
            channels: { telegram: { configured: true, running: true, probe: { ok: true } } },
          })),
          retry,
          retryAndRefreshSessions,
        } as never}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start setup/i }));
    fireEvent.change(await screen.findByPlaceholderText(/enter bot token/i), { target: { value: "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ" } });
    fireEvent.change(screen.getByLabelText("Telegram DM policy"), { target: { value: "runtime-default" } });
    fireEvent.change(screen.getByLabelText("Telegram group policy"), { target: { value: "runtime-default" } });
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => expect(saveConfig).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button", { name: /step 2: test the connection/i }));
    fireEvent.click(screen.getByRole("button", { name: /^test connection$/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^continue$/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
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
