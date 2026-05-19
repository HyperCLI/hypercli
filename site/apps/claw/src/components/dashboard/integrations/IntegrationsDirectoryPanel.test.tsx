import { fireEvent, screen } from "@testing-library/react";
import type { OpenClawConfigSchemaResponse } from "@hypercli.com/sdk/openclaw/gateway";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { renderWithClient } from "@/test/utils";
import { IntegrationsDirectoryPanel } from "./IntegrationsDirectoryPanel";

const configSchema: OpenClawConfigSchemaResponse = {
  schema: {},
  uiHints: {
    "channels.telegram": {},
  },
};

function renderPanel(overrides: Partial<ComponentProps<typeof IntegrationsDirectoryPanel>> = {}) {
  return renderWithClient(
    <IntegrationsDirectoryPanel
      initialCategory="channels"
      initialPluginId="telegram"
      agentName="Agent"
      config={null}
      configSchema={configSchema}
      connected
      onSaveConfig={vi.fn(async () => undefined)}
      onChannelProbe={vi.fn(async () => ({}))}
      onOpenShell={vi.fn()}
      {...overrides}
    />,
  );
}

describe("IntegrationsDirectoryPanel", () => {
  it("uses the integrations back label by default", () => {
    renderPanel();

    expect(screen.getByRole("button", { name: /back to integrations/i })).toBeInTheDocument();
  });

  it("uses the chat back label and callback for chat-opened details", () => {
    const onDetailBack = vi.fn();
    renderPanel({
      detailBackLabel: "Back to chat",
      onDetailBack,
    });

    fireEvent.click(screen.getByRole("button", { name: /back to chat/i }));

    expect(onDetailBack).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /back to chat/i })).not.toBeInTheDocument();
  });

  it("uses the shared loading visual while app skills load", async () => {
    renderPanel({
      initialCategory: "skills",
      initialPluginId: null,
      onLoadSkills: vi.fn(() => new Promise<never>(() => undefined)),
    });

    expect(await screen.findByRole("status", { name: /loading skills reading available app skills/i })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /agent workspace loading/i })).toBeInTheDocument();
  });
});
