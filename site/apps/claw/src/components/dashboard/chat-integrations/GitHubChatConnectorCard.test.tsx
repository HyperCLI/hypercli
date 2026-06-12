import { act, fireEvent, render, screen } from "@testing-library/react";
import type { OpenClawConfigSchemaResponse } from "@hypercli.com/sdk/openclaw/gateway";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GitHubChatConnectorCard } from "./GitHubChatConnectorCard";

function schemaWith(...paths: string[]): OpenClawConfigSchemaResponse {
  return {
    schema: {},
    uiHints: Object.fromEntries(paths.map((path) => [path, {}])),
  };
}

const handlers = {
  onAuthStart: vi.fn(async () => ({ authId: "auth-1" })),
  onAuthStatus: vi.fn(async () => ({ status: "pending" })),
  onIntegrationStatus: vi.fn(async () => ({ integrations: { github: { configured: false, authenticated: false, usable: false } } })),
};

describe("GitHubChatConnectorCard", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("explains when the gateway is disconnected", () => {
    render(
      <GitHubChatConnectorCard
        connected={false}
        configSchema={schemaWith("integrations.github")}
        {...handlers}
      />,
    );

    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(screen.getAllByText(/Start or reconnect the agent/i).length).toBeGreaterThan(0);
  });

  it("allows starting while capabilities are still loading", () => {
    render(
      <GitHubChatConnectorCard
        connected
        configSchema={null}
        {...handlers}
      />,
    );

    expect(screen.getByText("Connect GitHub")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start connection/i })).toBeInTheDocument();
    expect(screen.queryByText(/has not finished reporting GitHub setup support/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Connect repositories and issues with GitHub device authorization/i)).not.toBeInTheDocument();
  });

  it("allows starting when the gateway does not advertise GitHub", async () => {
    const onAuthStart = vi.fn(async () => ({ authId: "auth-1" }));
    render(
      <GitHubChatConnectorCard
        connected
        configSchema={schemaWith("integrations.telegram")}
        {...handlers}
        onAuthStart={onAuthStart}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /start connection/i }));
    });
    expect(onAuthStart).toHaveBeenCalledWith({ integrationId: "github", scopes: ["repo", "read:org", "gist"] });
    expect(screen.queryByText(/has not advertised GitHub setup/i)).not.toBeInTheDocument();
  });

  it("falls back to an agent setup prompt when managed handlers are missing", async () => {
    const onStartAgentGitHubSetup = vi.fn(async () => undefined);
    const onOpenFullSetup = vi.fn();

    render(
      <GitHubChatConnectorCard
        connected
        configSchema={schemaWith("integrations.github")}
        onStartAgentGitHubSetup={onStartAgentGitHubSetup}
        onOpenFullSetup={onOpenFullSetup}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /start connection/i }));
    });

    expect(onStartAgentGitHubSetup).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Hold on tight.")).toBeInTheDocument();
    expect(screen.queryByText("Setting everything up")).not.toBeInTheDocument();
    expect(screen.queryByText("Ask agent")).not.toBeInTheDocument();
    expect(screen.queryByText("Setup instructions were sent to the agent.")).not.toBeInTheDocument();
    expect(screen.queryByText("Keep this card open while GitHub connects.")).not.toBeInTheDocument();
    expect(screen.queryByText("Preparing GitHub access.")).not.toBeInTheDocument();
    expect(screen.queryByText(/GitHub setup is being handled by the agent/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Setup visibility")).not.toBeInTheDocument();
    expect(screen.queryByText("Set up GitHub in this workspace.")).not.toBeInTheDocument();
    expect(screen.queryByText("Full setup instruction")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open full setup/i })).not.toBeInTheDocument();
  });

  it("shows preparing connection for install and auth progress", () => {
    render(
      <GitHubChatConnectorCard
        connected
        configSchema={null}
        agentSetupStatus={{
          phase: "installing",
          recentCommands: [
            { label: "Preparing GitHub CLI", command: "command -v gh && gh --version" },
          ],
        }}
      />,
    );

    expect(screen.getAllByText("Preparing connection").length).toBeGreaterThan(0);
    expect(screen.queryByText("Preparing GitHub tools.")).not.toBeInTheDocument();
    expect(screen.queryByText("Tool activity")).not.toBeInTheDocument();
    expect(screen.queryByText("Preparing GitHub CLI")).not.toBeInTheDocument();
    expect(screen.queryByText(/Installing GitHub tools/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Install GitHub CLI")).not.toBeInTheDocument();
    expect(screen.queryByText("Start device auth")).not.toBeInTheDocument();
    expect(screen.queryByText("The agent prepares GitHub CLI and starts device authorization without sudo or token paste.")).not.toBeInTheDocument();
  });

  it("rotates setting up title copy every six seconds", () => {
    vi.useFakeTimers();
    render(
      <GitHubChatConnectorCard
        connected
        configSchema={null}
        agentSetupStatus={{ phase: "checking", recentCommands: [] }}
      />,
    );

    expect(screen.getByText("Hold on tight.")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(6000);
    });

    expect(screen.getByText("Preparing your workspace.")).toBeInTheDocument();
  });

  it("falls back to an agent setup prompt when managed auth is unsupported", async () => {
    const onAuthStart = vi.fn(async () => {
      throw new Error("unknown method: integrations.auth.start");
    });
    const onStartAgentGitHubSetup = vi.fn(async () => undefined);

    render(
      <GitHubChatConnectorCard
        connected
        configSchema={null}
        {...handlers}
        onAuthStart={onAuthStart}
        onStartAgentGitHubSetup={onStartAgentGitHubSetup}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /start connection/i }));
    });

    expect(onAuthStart).toHaveBeenCalledTimes(1);
    expect(onStartAgentGitHubSetup).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/No sudo and no token paste/i)).not.toBeInTheDocument();
  });

  it("shows a clickable device code reported by the agent", async () => {
    vi.useFakeTimers();
    const originalClipboard = navigator.clipboard;
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const { container } = render(
      <GitHubChatConnectorCard
        connected
        configSchema={null}
        agentSetupStatus={{
          phase: "device-code",
          userCode: "8BCD-83A2",
          verificationUri: "https://github.com/login/device",
          recentCommands: [
            { label: "Starting GitHub authorization", command: "gh auth login --web", result: "Code: 8BCD-83A2" },
          ],
        }}
      />,
    );

    const codeButton = screen.getByRole("button", { name: /copy github device code 8bcd-83a2/i });
    expect(codeButton).toHaveTextContent("8BCD-83A2");
    expect(screen.getByText("Enter device code")).toBeInTheDocument();
    expect(screen.queryByText("GitHub device code")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy code/i })).not.toBeInTheDocument();
    expect(container.querySelector('[data-integration-brand-pulse="active"] .text-selection-accent')).toBeTruthy();
    expect(screen.queryByText("Setup progress")).not.toBeInTheDocument();
    expect(screen.queryByText("Setup visibility")).not.toBeInTheDocument();
    expect(screen.queryByText("Tool activity")).not.toBeInTheDocument();
    expect(screen.queryByText("Starting GitHub authorization")).not.toBeInTheDocument();
    expect(screen.getByText("Click the code to copy it, then enter it on GitHub.")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(codeButton);
    });

    expect(writeText).toHaveBeenCalledWith("8BCD-83A2");
    expect(screen.getByTestId("github-device-code-ripple")).toBeInTheDocument();
    expect(screen.getByText("Copied. Enter it on GitHub, then return here.")).toBeInTheDocument();
    const githubLinks = screen.getAllByRole("link", { name: /open github/i });
    expect(githubLinks).toHaveLength(1);
    expect(githubLinks[0]).toHaveAttribute("href", "https://github.com/login/device");

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.queryByTestId("github-device-code-ripple")).not.toBeInTheDocument();

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: originalClipboard,
    });
  });

  it("asks the agent to verify GitHub when the device-code tab regains focus", async () => {
    vi.useFakeTimers();
    const onVerifyAgentGitHubSetup = vi.fn(async () => undefined);

    render(
      <GitHubChatConnectorCard
        connected
        configSchema={null}
        agentSetupStatus={{
          phase: "device-code",
          userCode: "8BCD-83A2",
          verificationUri: "https://github.com/login/device",
          recentCommands: [],
        }}
        onVerifyAgentGitHubSetup={onVerifyAgentGitHubSetup}
      />,
    );

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(onVerifyAgentGitHubSetup).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(onVerifyAgentGitHubSetup).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(onVerifyAgentGitHubSetup).toHaveBeenCalledTimes(2);
  });

  it("shows a congratulations step after the agent reports GitHub is ready", () => {
    render(
      <GitHubChatConnectorCard
        connected
        configSchema={null}
        agentSetupStatus={{
          phase: "ready",
          userCode: "8BCD-83A2",
          verificationUri: "https://github.com/login/device",
          accountDisplayName: "octocat",
          recentCommands: [
            { label: "Checking GitHub auth", command: "gh auth status", result: "Logged in to github.com account octocat" },
          ],
        }}
      />,
    );

    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Signed in as octocat")).toBeInTheDocument();
    expect(screen.queryByText("8BCD-83A2")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /open github/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/The agent can now use GitHub CLI/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/This authenticates the workspace shell only/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Setup progress")).not.toBeInTheDocument();
    expect(screen.getByText("Congratulations")).toBeInTheDocument();
  });

  it("keeps generic managed auth failures out of the agent fallback", async () => {
    const onAuthStart = vi.fn(async () => {
      throw new Error("GitHub authorization service is temporarily unavailable.");
    });
    const onStartAgentGitHubSetup = vi.fn(async () => undefined);

    render(
      <GitHubChatConnectorCard
        connected
        configSchema={null}
        {...handlers}
        onAuthStart={onAuthStart}
        onStartAgentGitHubSetup={onStartAgentGitHubSetup}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /start connection/i }));
    });

    expect(await screen.findByText("GitHub authorization service is temporarily unavailable.")).toBeInTheDocument();
    expect(onStartAgentGitHubSetup).not.toHaveBeenCalled();
  });
});
