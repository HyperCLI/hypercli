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
  it("renders only the selected OpenClaw section", () => {
    renderDrawer();

    expect(screen.getAllByText("Model settings").length).toBeGreaterThan(0);
    expect(screen.getByText("Configure provider and model behavior.")).toBeInTheDocument();
    expect(screen.queryByText("Messaging platforms your agent can join.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Channels" }));

    expect(screen.getByText("Messaging platforms your agent can join.")).toBeInTheDocument();
    expect(screen.queryByText("Configure provider and model behavior.")).not.toBeInTheDocument();
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

    expect(screen.getByDisplayValue("xoxb-work")).toBeInTheDocument();
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
});
