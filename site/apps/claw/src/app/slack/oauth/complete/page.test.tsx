import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigationMocks = vi.hoisted(() => ({
  useSearchParams: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: navigationMocks.useSearchParams,
}));

import SlackOauthCompletePage from "./page";

describe("SlackOauthCompletePage", () => {
  const openerPostMessage = vi.fn();
  const windowClose = vi.fn();

  beforeEach(() => {
    openerPostMessage.mockReset();
    windowClose.mockReset();
    navigationMocks.useSearchParams.mockReturnValue(new URLSearchParams("ok=true&team_id=T123"));
    Object.defineProperty(window, "opener", {
      configurable: true,
      value: { postMessage: openerPostMessage },
    });
    Object.defineProperty(window, "close", {
      configurable: true,
      value: windowClose,
    });
  });

  it("posts the oauth result to the opener and renders the success state", async () => {
    render(<SlackOauthCompletePage />);

    expect(screen.getByRole("heading", { name: "Slack connected" })).toBeInTheDocument();
    expect(screen.getByText("Team T123")).toBeInTheDocument();

    await waitFor(() => {
      expect(openerPostMessage).toHaveBeenCalledWith({
        source: "hypercli.slack-oauth",
        integrationId: "slack",
        ok: true,
        teamId: "T123",
        error: undefined,
      }, window.location.origin);
    });
  });

  it("renders the failure state when the callback reports an error", async () => {
    navigationMocks.useSearchParams.mockReturnValue(new URLSearchParams("ok=false&error=oauth_failed"));

    render(<SlackOauthCompletePage />);

    expect(screen.getByRole("heading", { name: "Slack connection failed" })).toBeInTheDocument();
    expect(screen.getByText("Error: oauth_failed")).toBeInTheDocument();

    await waitFor(() => {
      expect(openerPostMessage).toHaveBeenCalledWith({
        source: "hypercli.slack-oauth",
        integrationId: "slack",
        ok: false,
        teamId: undefined,
        error: "oauth_failed",
      }, window.location.origin);
    });
  });
});
