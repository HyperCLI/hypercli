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

    render(
      <ApiKeysManager
        apiBaseUrl="https://api.dev.hypercli.com/api"
        getToken={async () => "app-token"}
      />,
    );

    await screen.findByText("No API keys yet");

    fireEvent.click(screen.getByRole("button", { name: "Create Key" }));
    fireEvent.change(screen.getByPlaceholderText("e.g. frontend-prod"), {
      target: { value: "team-dev" },
    });
    fireEvent.click(screen.getByText("Full access").closest("button")!);
    fireEvent.click(screen.getAllByRole("button", { name: "Create Key" }).at(-1)!);

    expect(await screen.findByText("hyper_api_live_from_create")).toBeInTheDocument();
    expect(sdkMocks.create).toHaveBeenCalledWith("team-dev", ["*:*"]);

    fireEvent.click(screen.getByRole("button", { name: "Copy API key" }));

    await waitFor(() => {
      expect(clipboardWrite).toHaveBeenCalledWith("hyper_api_live_from_create");
    });
  });
});
