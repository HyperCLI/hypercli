import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSlackInstallStatus: vi.fn(),
  getToken: vi.fn().mockResolvedValue("token"),
}));

vi.mock("@/hooks/useAgentAuth", () => ({
  useAgentAuth: () => ({
    getToken: mocks.getToken,
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
  }),
}));

vi.mock("@/lib/api", () => ({
  SLACK_APP_HANDLE: "hyperdev",
  SLACK_RELAY_BASE_URL: "https://relay.example",
}));

vi.mock("@hypercli.com/sdk/agents", () => ({
  getSlackInstallStatus: mocks.getSlackInstallStatus,
}));

import SlackStatusPage from "./page";

describe("SlackStatusPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSlackInstallStatus.mockRejectedValue(
      new Error("GET /slack/status?token=private-slack-token returned 502"),
    );
  });

  it("uses neutral retry-led recovery and omits relay details", async () => {
    const { container } = render(<SlackStatusPage />);

    expect(await screen.findByRole("heading", { name: "Retry to check Slack" })).toBeVisible();
    expect(screen.queryByText(/GET \/slack\/status/i)).not.toBeInTheDocument();
    expect(container.querySelector('[class~="text-destructive"], [class~="bg-destructive"], [class~="border-destructive"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry status check" }));
    await waitFor(() => expect(mocks.getSlackInstallStatus).toHaveBeenCalledTimes(2));
  });

  it("keeps Slack identifiers collapsed and redacted", async () => {
    mocks.getSlackInstallStatus.mockResolvedValue({
      connected: true,
      teamId: "T-private-workspace-123",
      teamName: "Test Workspace",
      botUserId: "U-private-bot-456",
      updatedAt: "2026-08-13T12:00:00.000Z",
    });
    render(<SlackStatusPage />);

    expect(await screen.findByText("Test Workspace")).toBeVisible();
    expect(screen.queryByText(/T-private-workspace-123/)).not.toBeInTheDocument();
    expect(screen.queryByText(/U-private-bot-456/)).not.toBeInTheDocument();
    const details = screen.getByRole("button", { name: "Connection details" });
    expect(details).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(details);
    expect(screen.getByText(/Workspace reference: T\.\.\.23/)).toBeVisible();
    expect(screen.getByText(/Bot reference: U\.\.\.56/)).toBeVisible();
    expect(screen.queryByText(/T-private-workspace-123/)).not.toBeInTheDocument();
  });
});
