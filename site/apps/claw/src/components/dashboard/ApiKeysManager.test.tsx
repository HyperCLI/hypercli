import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiKeysManager } from "../../../../../packages/shared-ui/src/components/ApiKeysManager";

const sdkMocks = vi.hoisted(() => ({
  list: vi.fn(),
  disable: vi.fn(),
  rename: vi.fn(),
}));

vi.mock("@hypercli.com/sdk/browser", () => ({
  BrowserHyperCLI: vi.fn().mockImplementation(() => ({
    keys: sdkMocks,
  })),
}));

describe("ApiKeysManager", () => {
  beforeEach(() => {
    sdkMocks.list.mockReset();
    sdkMocks.disable.mockReset();
    sdkMocks.rename.mockReset();
    sdkMocks.list.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (navigator as Navigator & { clipboard?: Clipboard }).clipboard;
  });

  it("shows and copies the one-time API key returned by the create endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          key_id: "key-123",
          name: "team-dev",
          tags: ["*:*"],
          key: "hyper_api_live_from_create",
          is_active: true,
          created_at: "2026-05-26T00:00:00Z",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    const clipboardWrite = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal("fetch", fetchMock);
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
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.dev.hypercli.com/api/keys",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer app-token",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ name: "team-dev", tags: ["*:*"] }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy API key" }));

    await waitFor(() => {
      expect(clipboardWrite).toHaveBeenCalledWith("hyper_api_live_from_create");
    });
  });
});
