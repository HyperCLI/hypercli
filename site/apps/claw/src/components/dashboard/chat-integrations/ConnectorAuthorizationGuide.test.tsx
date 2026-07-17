import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AgentConnectorsProvider } from "@hypercli.com/sdk/connectors";
import { describe, expect, it, vi } from "vitest";

import {
  activeConnectorAuthorizationFlow,
  ConnectorAuthorizationGuide,
  type ConnectorAuthorizationFlow,
} from "./ConnectorAuthorizationGuide";

const flow: ConnectorAuthorizationFlow = {
  protocol: "short-code",
  visibleWhen: {
    all: [{ inputSlot: "discord.guildId", operator: "equals", value: "authorize" }],
  },
  identityLabel: "allowed user ID",
  identityRequirement: "optional",
  codeLength: 8,
  codePattern: /^[A-HJ-NP-Z2-9]{8}$/,
  expiresInMinutes: 60,
  firstEventProcessed: false,
};

function provider(): AgentConnectorsProvider {
  return {
    runtime: { provider: "test", capabilities: [] },
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

describe("ConnectorAuthorizationGuide", () => {
  it("selects authorization flows from shared input conditions", () => {
    expect(activeConnectorAuthorizationFlow([flow], {
      "discord.guildId": { content: null, valid: true, value: "authorize" },
    })).toBe(flow);
    expect(activeConnectorAuthorizationFlow([flow], {
      "discord.guildId": { content: null, valid: true, value: "skip" },
    })).toBeNull();
  });

  it("runs the same short-code flow for any connector advertising it", async () => {
    const connectorsProvider = provider();
    const onApproved = vi.fn();
    render(
      <ConnectorAuthorizationGuide
        connectorId="signal"
        displayName="Signal"
        flow={flow}
        provider={connectorsProvider}
        accountId="primary"
        onApproved={onApproved}
      />,
    );

    expect(screen.getByText("No allowed user ID is required")).toBeInTheDocument();
    expect(screen.getByText(/first message is not processed/i)).toBeInTheDocument();
    expect(screen.getByText(/expires after 60 minutes/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve code" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Signal authorization code"), { target: { value: "ABCD2345" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve code" }));

    await waitFor(() => expect(connectorsProvider.approveAuthorization).toHaveBeenCalledWith({
      connectorId: "signal",
      protocol: "short-code",
      code: "ABCD2345",
      accountId: "primary",
      notify: true,
    }));
    expect(await screen.findByText("Code approved")).toBeInTheDocument();
    expect(onApproved).toHaveBeenCalledTimes(1);
  });
});
