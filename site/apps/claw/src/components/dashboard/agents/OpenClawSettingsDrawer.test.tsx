import React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { buildSdkAgent } from "@/test/factories";
import { renderWithClient } from "@/test/utils";
import { toAgentViewModel } from "./agentViewModel";
import { OpenClawSettingsDrawer } from "./OpenClawSettingsDrawer";

function renderDrawer(overrides: Partial<React.ComponentProps<typeof OpenClawSettingsDrawer>> = {}) {
  const onSaveConfig = vi.fn().mockResolvedValue(undefined);
  const config = {
    llm: { model: "gpt-test" },
    channels: {
      slack: {
        work: { enabled: true, token: "xoxb-work" },
        personal: { enabled: false, token: "xoxb-personal" },
      },
    },
  };
  const props: React.ComponentProps<typeof OpenClawSettingsDrawer> = {
    open: true,
    onClose: vi.fn(),
    agent: toAgentViewModel(buildSdkAgent({ state: "RUNNING" })),
    config,
    configSchema: {
      schema: {
        type: "object",
        properties: {
          llm: {
            title: "Model settings",
            description: "Configure provider and model behavior.",
            type: "object",
            properties: {
              model: { title: "Model", type: "string" },
            },
          },
          channels: {
            title: "Channels",
            description: "Messaging platforms your agent can join.",
            type: "object",
            properties: {
              slack: {
                title: "Slack",
                type: "object",
                additionalProperties: {
                  type: "object",
                  properties: {
                    enabled: { title: "Enabled", type: "boolean" },
                    token: { title: "Token", type: "string" },
                  },
                },
              },
            },
          },
        },
      },
      uiHints: {
        llm: { label: "Model settings", order: 1 },
        channels: { label: "Channels", order: 2 },
      },
    },
    connected: true,
    connecting: false,
    hydrating: false,
    onSaveConfig,
    isDesktopViewport: true,
    ...overrides,
  };

  return {
    props,
    onSaveConfig,
    ...renderWithClient(<OpenClawSettingsDrawer {...props} />),
  };
}

describe("OpenClawSettingsDrawer", () => {
  it("shows settings hydration instead of a gateway reconnect", () => {
    renderDrawer({
      configSchema: null,
      connected: false,
      connecting: true,
      hydrating: true,
    });

    expect(screen.getByText("Loading settings")).toBeInTheDocument();
    expect(screen.queryByText("Connecting gateway")).not.toBeInTheDocument();
  });

  it("keeps loading visible while the connected gateway fetches its schema", () => {
    renderDrawer({
      configSchema: null,
      connected: true,
      connecting: false,
      hydrating: false,
    });

    expect(screen.getByText("Loading settings")).toBeInTheDocument();
  });

  it("reserves gateway connection copy for a real cold connection", () => {
    renderDrawer({
      configSchema: null,
      connected: false,
      connecting: true,
      hydrating: false,
    });

    expect(screen.getByText("Connecting gateway")).toBeInTheDocument();
  });

  it("renders only the selected OpenClaw section", () => {
    renderDrawer();

    expect(screen.getAllByText("Model settings").length).toBeGreaterThan(0);
    expect(screen.getByText("Configure provider and model behavior.")).toBeInTheDocument();
    expect(screen.queryByText("Messaging platforms your agent can join.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Model settings" })).toHaveClass(
      "border-[var(--selection-accent-border)]",
      "bg-[var(--selection-accent-soft)]",
    );
    expect(screen.getByRole("button", { name: "Model settings" })).not.toHaveClass("border-l-2");

    fireEvent.click(screen.getByRole("button", { name: "Channels" }));

    expect(screen.getByText("Messaging platforms your agent can join.")).toBeInTheDocument();
    expect(screen.queryByText("Configure provider and model behavior.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Channels" })).toHaveClass(
      "border-[var(--selection-accent-border)]",
      "bg-[var(--selection-accent-soft)]",
    );
  });

  it("keeps dynamic channel maps collapsed until expanded", () => {
    renderDrawer();

    fireEvent.click(screen.getByRole("button", { name: "Channels" }));

    expect(screen.getByText("Slack")).toBeInTheDocument();
    expect(screen.getByText("2 configured")).toBeInTheDocument();
    expect(screen.queryByText("work")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("xoxb-work")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /2 configured/i }));

    expect(screen.getByText("work")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("xoxb-work")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "work" }));

    expect(screen.getByDisplayValue("xoxb-work")).toHaveClass("border-input", "bg-input-background");
  });

  it("uses switches for boolean settings", () => {
    renderDrawer();

    fireEvent.click(screen.getByRole("button", { name: "Channels" }));
    fireEvent.click(screen.getByRole("button", { name: /2 configured/i }));
    fireEvent.click(screen.getByRole("button", { name: "work" }));

    const enabledSwitch = screen.getByRole("switch", { name: "Enabled" });
    expect(enabledSwitch).toBeChecked();

    fireEvent.click(enabledSwitch);

    expect(enabledSwitch).not.toBeChecked();
  });

  it("saves only the active section patch", async () => {
    const { onSaveConfig } = renderDrawer();

    fireEvent.click(screen.getByRole("button", { name: "Channels" }));
    fireEvent.click(screen.getByRole("button", { name: /save section/i }));

    await waitFor(() => expect(onSaveConfig).toHaveBeenCalledWith({
      channels: {
        slack: {
          work: { enabled: true, token: "xoxb-work" },
          personal: { enabled: false, token: "xoxb-personal" },
        },
      },
    }));
  });

  it("does not report success when the save boundary blocks the change", async () => {
    const onSaveConfig = vi.fn(async () => false);
    renderDrawer({ onSaveConfig });

    fireEvent.click(screen.getByRole("button", { name: /save section/i }));

    await waitFor(() => expect(onSaveConfig).toHaveBeenCalledOnce());
    expect(screen.queryByText(/saved section/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save section/i })).toBeEnabled();
  });
});
