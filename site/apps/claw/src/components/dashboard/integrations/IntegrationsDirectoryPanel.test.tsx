import { fireEvent, screen } from "@testing-library/react";
import type { OpenClawConfigSchemaResponse } from "@hypercli.com/sdk/openclaw/gateway";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { renderWithClient } from "@/test/utils";
import { IntegrationsDirectoryPanel } from "./IntegrationsDirectoryPanel";

const configSchema: OpenClawConfigSchemaResponse = {
  schema: {},
  uiHints: { "channels.telegram": {} },
};

function schemaWithHints(...hints: string[]): OpenClawConfigSchemaResponse {
  return { schema: {}, uiHints: Object.fromEntries(hints.map((hint) => [hint, {}])) };
}

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
      availableSkillIds={new Set()}
      onOpenSkill={vi.fn()}
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
    renderPanel({ detailBackLabel: "Back to chat", onDetailBack });
    fireEvent.click(screen.getByRole("button", { name: /back to chat/i }));
    expect(onDetailBack).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /back to chat/i })).not.toBeInTheDocument();
  });

  it("shows truthful tier one states for service connectors", () => {
    renderPanel({ initialCategory: null, initialPluginId: null });
    expect(screen.getByText("HubSpot")).toBeInTheDocument();
    expect(screen.getByText("Google Drive")).toBeInTheDocument();
    expect(screen.getAllByText("Needs OAuth").length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText("Planned").length).toBeGreaterThan(0);
    expect(screen.queryByText(/connect via chat/i)).not.toBeInTheDocument();
  });

  it("hands skill-backed service cards to the Skills panel", () => {
    const onOpenSkill = vi.fn();
    renderPanel({
      initialCategory: null,
      initialPluginId: null,
      availableSkillIds: new Set(["notion"]),
      onOpenSkill,
    });

    expect(screen.getByText("Available as skill")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /notion/i }));
    expect(onOpenSkill).toHaveBeenCalledWith("notion");
  });

  it("opens the GitHub connector when gateway capability is advertised", async () => {
    const onIntegrationAuthStart = vi.fn(async () => ({
      authId: "auth-1",
      verificationUri: "https://github.com/login/device",
      userCode: "ABCD-1234",
      intervalMs: 30_000,
    }));
    const onIntegrationStatus = vi.fn(async () => ({ integrations: { github: { configured: false, authenticated: false, usable: false } } }));

    renderPanel({
      initialCategory: null,
      initialPluginId: null,
      configSchema: schemaWithHints("integrations.github"),
      onIntegrationAuthStart,
      onIntegrationAuthStatus: vi.fn(async () => ({ status: "pending" })),
      onIntegrationStatus,
      onIntegrationDisconnect: vi.fn(async () => ({ ok: true })),
    });

    const githubCard = screen.getByText("GitHub").closest("button");
    expect(githubCard).not.toBeNull();
    fireEvent.click(githubCard!);
    fireEvent.click(await screen.findByRole("button", { name: /connect github/i }));
    expect(onIntegrationAuthStart).toHaveBeenCalledWith({ integrationId: "github", scopes: ["repo", "read:org", "gist"] });
    expect(await screen.findByText("ABCD-1234")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open github/i })).toHaveAttribute("href", "https://github.com/login/device");
  });

  it("marks a fulfilled service connector as connected in the grid", async () => {
    const onIntegrationStatus = vi.fn(async () => ({
      integrations: { github: { configured: true, authenticated: true, usable: true, accountDisplayName: "octocat" } },
    }));

    renderPanel({
      initialCategory: null,
      initialPluginId: null,
      configSchema: schemaWithHints("integrations.github"),
      onIntegrationAuthStart: vi.fn(async () => ({ authId: "auth-1" })),
      onIntegrationAuthStatus: vi.fn(async () => ({ status: "pending" })),
      onIntegrationStatus,
    });

    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("GitHub").closest("button")).toHaveTextContent("Connected");
    expect(onIntegrationStatus).toHaveBeenCalledWith({ probe: false });
  });
});
