import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiKeysManager } from "../../../../../packages/shared-ui/src/components/ApiKeysManager";

const sdkMocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  disable: vi.fn(),
  rename: vi.fn(),
}));

vi.mock("@hypercli.com/sdk/browser", () => ({
  BrowserHyperCLI: vi.fn(function BrowserHyperCLIMock() {
    return {
    keys: sdkMocks,
    };
  }),
}));

describe("ApiKeysManager", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    sdkMocks.list.mockReset();
    sdkMocks.create.mockReset();
    sdkMocks.disable.mockReset();
    sdkMocks.rename.mockReset();
    sdkMocks.list.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (navigator as Navigator & { clipboard?: Clipboard }).clipboard;
  });

  it("shows and copies the one-time API key returned by the create endpoint", async () => {
    sdkMocks.create.mockResolvedValue({
      keyId: "key-123",
      name: "team-dev",
      tags: ["*:*"],
      apiKey: "hyper_api_live_from_create",
      apiKeyPreview: null,
      last4: null,
      isActive: true,
      createdAt: "2026-05-26T00:00:00Z",
      lastUsedAt: null,
    });
    const clipboardWrite = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWrite },
    });

    const { container } = render(
      <ApiKeysManager
        apiBaseUrl="https://api.dev.hypercli.com/api"
        getToken={async () => "app-token"}
      />,
    );

    await screen.findByRole("heading", { name: "Connect HyperCLI to your tools" });
    expect(screen.getByText(/API keys let apps, scripts, and integrations securely access HyperCLI/)).toBeInTheDocument();
    expect(container.querySelector('[data-slot="card"]')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="empty-state"]')).toBeInTheDocument();

    const emptyStateAction = screen.getByRole("button", { name: "Create API key" });
    expect(emptyStateAction).toHaveAttribute("data-slot", "button");
    fireEvent.click(emptyStateAction);
    const drawer = screen.getByRole("dialog", { name: "Create API Key" });
    expect(drawer).toHaveClass("right-0", "h-full", "sm:max-w-[400px]");
    expect(screen.getByRole("switch", { name: "Scoped Access" })).not.toBeChecked();
    expect(screen.getByText(/This key can access everything your account can/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Enter key name"), {
      target: { value: "team-dev" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Key" }));

    expect(await screen.findByRole("dialog", { name: "API key created" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("hyper_api_live_from_create")).toBeInTheDocument();
    expect(sdkMocks.create).toHaveBeenCalledWith("team-dev", ["*:*"]);

    fireEvent.click(screen.getByRole("button", { name: "Copy API key" }));

    await waitFor(() => {
      expect(clipboardWrite).toHaveBeenCalledWith("hyper_api_live_from_create");
    });
  });

  it("can force the empty presentation without changing stored keys", async () => {
    sdkMocks.list.mockResolvedValue([{
      keyId: "key-existing",
      name: "Existing key",
      tags: ["*:*"],
      apiKey: null,
      apiKeyPreview: "hyper_api_...sting",
      last4: "ting",
      isActive: true,
      createdAt: "2026-05-26T00:00:00Z",
      lastUsedAt: null,
    }]);

    render(
      <ApiKeysManager
        apiBaseUrl="https://api.dev.hypercli.com/api"
        getToken={async () => "app-token"}
        previewState="empty"
      />,
    );

    expect(await screen.findByRole("heading", { name: "Connect HyperCLI to your tools" })).toBeInTheDocument();
    expect(screen.queryByText("Existing key")).not.toBeInTheDocument();
    expect(sdkMocks.list).not.toHaveBeenCalled();
  });

  it("groups scoped permissions into shared segmented controls", async () => {
    render(
      <ApiKeysManager
        apiBaseUrl="https://api.dev.hypercli.com/api"
        getToken={async () => "app-token"}
        previewState="empty"
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Create API key" }));
    fireEvent.click(screen.getByRole("switch", { name: "Scoped Access" }));

    expect(screen.getByRole("heading", { name: "Admin" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Automation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Assets" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AI" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Models: Self" })).not.toBeInTheDocument();

    const allApiKeys = screen.getByRole("radio", { name: "API Keys: All" });
    fireEvent.click(allApiKeys);
    expect(allApiKeys).toBeChecked();
  });

  it("renders the populated key list with shared search, table, status, and actions", async () => {
    sdkMocks.list.mockResolvedValue([{
      keyId: "key-frontend",
      name: "frontend",
      tags: ["*:*"],
      apiKey: null,
      apiKeyPreview: "••••••••••••d123",
      last4: "d123",
      isActive: true,
      createdAt: "2026-04-11T10:04:00Z",
      lastUsedAt: "2026-04-12T13:10:00Z",
      expiresAt: null,
      source: "agent",
    }]);

    render(
      <ApiKeysManager
        apiBaseUrl="https://api.dev.hypercli.com/api"
        getToken={async () => "app-token"}
      />,
    );

    expect(await screen.findByText("frontend")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search API keys" })).toHaveAttribute("data-slot", "input");
    expect(screen.getByRole("button", { name: "Filter API keys" })).toHaveAttribute("data-slot", "popover-trigger");
    expect(screen.getByRole("button", { name: "Create key" })).toHaveAttribute("data-slot", "button");
    expect(screen.getByRole("columnheader", { name: "Key ID" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Source" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Access" })).toBeInTheDocument();
    expect(screen.getByText("••••••••••••d123")).toBeInTheDocument();
    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.getByText("Full access")).toHaveAttribute("data-slot", "badge");
    expect(screen.getByText("Active")).toHaveClass("text-[var(--selection-accent)]");

    fireEvent.click(screen.getByRole("button", { name: "Filter API keys" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Agent" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Active" }));
    expect(screen.getByRole("button", { name: "Filter API keys, 2 selected" })).toHaveTextContent("(2)");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Filter API keys, 2 selected" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(screen.getByRole("button", { name: "Filter API keys" })).not.toHaveTextContent("(2)");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    fireEvent.change(screen.getByRole("searchbox", { name: "Search API keys" }), {
      target: { value: "missing" },
    });
    expect(screen.getByText("No API keys match your search and filters.")).toBeInTheDocument();
  });
});
