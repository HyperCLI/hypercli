import { act, fireEvent, render, screen } from "@testing-library/react";
import type { AgentConnectorsProvider } from "@hypercli.com/sdk/connectors";
import type { OpenClawConfigSchemaResponse } from "@hypercli.com/sdk/openclaw/gateway";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConnectorWorkflow } from "@/lib/connector-workflow";
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

const cachedWorkflow: ConnectorWorkflow = {
  schema: "hypercli.connector-workflow.v1",
  connectorId: "github",
  runtimeFingerprint: "openclaw:test",
  summary: "Cached GitHub setup guidance.",
  steps: [],
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

  it("uses Aurora surface, typography, and action tokens", () => {
    render(
      <GitHubChatConnectorCard
        connected
        configSchema={null}
        {...handlers}
      />,
    );

    const title = screen.getByText("Connect GitHub");
    const card = title.closest("section");
    const startButton = screen.getByRole("button", { name: /start connection/i });

    expect(card).toHaveClass("rounded-2xl", "bg-surface-low", "shadow-[var(--glass-card-shadow)]");
    expect(card).not.toHaveClass("shadow-2xl");
    expect(title).toHaveClass("font-semibold", "tracking-[-0.04em]");
    expect(title).not.toHaveClass("uppercase", "font-black");
    expect(startButton).toHaveClass("h-9", "rounded-lg", "bg-button-primary");
    expect(startButton).not.toHaveClass("h-8", "rounded-full", "uppercase");
  });

  it("uses runtime-provided managed auth instructions through the connector provider", async () => {
    const runtime = { provider: "openclaw", version: "2026.7.16", capabilities: ["integrations.auth"] };
    const connectorsProvider = {
      runtime,
      list: vi.fn(async () => [{
        connectorId: "github",
        configured: false,
        authenticated: false,
        usable: false,
        setupModes: ["managed-auth" as const],
      }]),
      startSetup: vi.fn(async () => ({
        connectorId: "github",
        mode: "managed-auth" as const,
        setupId: "auth-runtime",
        instructions: "Follow the GitHub authorization steps reported by this runtime.",
        deviceUrl: "https://github.com/login/device",
        deviceCode: "ABCD-EFGH",
        provenance: runtime,
      })),
      pollSetup: vi.fn(async () => ({
        connectorId: "github",
        setupId: "auth-runtime",
        state: "pending" as const,
        provenance: runtime,
      })),
      configure: vi.fn(),
    } satisfies AgentConnectorsProvider;

    render(
      <GitHubChatConnectorCard
        connected
        connectorsProvider={connectorsProvider}
        configSchema={null}
      />,
    );

    const startButton = await screen.findByRole("button", { name: /start connection/i });
    await act(async () => {
      fireEvent.click(startButton);
    });

    expect(connectorsProvider.startSetup).toHaveBeenCalledWith({
      connectorId: "github",
      mode: "managed-auth",
      scopes: ["repo", "read:org", "gist"],
    });
    expect(screen.getByText("Follow the GitHub authorization steps reported by this runtime.")).toBeInTheDocument();
    expect(screen.getByText("ABCD-EFGH")).toBeInTheDocument();
  });

  it("keeps polling after a transient status failure and clears the used code on completion", async () => {
    vi.useFakeTimers();
    const runtime = { provider: "openclaw", version: "2026.7.16", capabilities: ["integrations.auth"] };
    const pollSetup = vi.fn()
      .mockRejectedValueOnce(new Error("temporary gateway timeout"))
      .mockResolvedValueOnce({
        connectorId: "github",
        setupId: "auth-recovery",
        state: "complete" as const,
        accountDisplayName: "octocat",
        provenance: runtime,
      });
    const connectorsProvider = {
      runtime,
      list: vi.fn(async () => [{
        connectorId: "github",
        configured: false,
        authenticated: false,
        usable: false,
        setupModes: ["managed-auth" as const],
      }]),
      startSetup: vi.fn(async () => ({
        connectorId: "github",
        mode: "managed-auth" as const,
        setupId: "auth-recovery",
        deviceUrl: "https://github.com/login/device",
        deviceCode: "ABCD-EFGH",
        pollIntervalMs: 1500,
        provenance: runtime,
      })),
      pollSetup,
      configure: vi.fn(),
    } satisfies AgentConnectorsProvider;

    render(<GitHubChatConnectorCard connected connectorsProvider={connectorsProvider} configSchema={null} />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /start connection/i }));
    });

    expect(screen.getByText("ABCD-EFGH")).toBeInTheDocument();
    expect(screen.getByText(/keep checking automatically/i)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(screen.getByText("GitHub connected")).toBeInTheDocument();
    expect(screen.queryByText("ABCD-EFGH")).not.toBeInTheDocument();
    expect(screen.queryByText(/keep checking automatically/i)).not.toBeInTheDocument();
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

  it("starts agent setup instead of showing cached guidance when managed handlers are missing", async () => {
    const onStartAgentGitHubSetup = vi.fn(async () => undefined);
    const onGenerateConnectorWorkflow = vi.fn(async () => {
      throw new Error("The setup guide should not replace executable setup.");
    });
    const onOpenFullSetup = vi.fn();

    render(
      <GitHubChatConnectorCard
        connected
        configSchema={schemaWith("integrations.github")}
        cachedWorkflow={cachedWorkflow}
        onStartAgentGitHubSetup={onStartAgentGitHubSetup}
        onGenerateConnectorWorkflow={onGenerateConnectorWorkflow}
        onOpenFullSetup={onOpenFullSetup}
      />,
    );

    expect(screen.queryByText("Setup guide")).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /start connection/i }));
    });

    expect(onStartAgentGitHubSetup).toHaveBeenCalledTimes(1);
    expect(onGenerateConnectorWorkflow).not.toHaveBeenCalled();
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

  it("keeps cached guidance in the integrations directory setup", () => {
    render(
      <GitHubChatConnectorCard
        connected
        directSetup
        configSchema={null}
        cachedWorkflow={cachedWorkflow}
      />,
    );

    expect(screen.getByText("Setup guide")).toBeInTheDocument();
    expect(screen.getByText("Cached GitHub setup guidance.")).toBeInTheDocument();
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
    const onGenerateConnectorWorkflow = vi.fn(async () => {
      throw new Error("The setup guide should not replace executable setup.");
    });

    render(
      <GitHubChatConnectorCard
        connected
        configSchema={null}
        {...handlers}
        onAuthStart={onAuthStart}
        onStartAgentGitHubSetup={onStartAgentGitHubSetup}
        onGenerateConnectorWorkflow={onGenerateConnectorWorkflow}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /start connection/i }));
    });

    expect(onAuthStart).toHaveBeenCalledTimes(1);
    expect(onStartAgentGitHubSetup).toHaveBeenCalledTimes(1);
    expect(onGenerateConnectorWorkflow).not.toHaveBeenCalled();
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
    expect(screen.getByText("Checking GitHub now. You do not need to enter this code again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Checking" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: /open github/i })).not.toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(onVerifyAgentGitHubSetup).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(screen.getByRole("button", { name: "Check connection" })).toBeEnabled();
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
    expect(screen.getByText("Connected")).toHaveClass("text-success");
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

    expect(await screen.findByText(/GitHub authorization did not start/i)).toBeInTheDocument();
    expect(screen.queryByText("GitHub authorization service is temporarily unavailable.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Technical details" }));
    expect(screen.getByText("GitHub authorization service is temporarily unavailable.")).toBeInTheDocument();
    expect(onStartAgentGitHubSetup).not.toHaveBeenCalled();
  });

  describe("managed disconnect lifecycle (gap 1)", () => {
    const connectedHandlers = () => ({
      onAuthStart: vi.fn(async () => ({ authId: "auth-1" })),
      onAuthStatus: vi.fn(async () => ({ status: "pending" })),
      onIntegrationStatus: vi.fn(async () => ({
        integrations: { github: { configured: true, authenticated: true, usable: true, connectionId: "conn-9" } },
      })),
    });

    async function renderConnectedCard(onDisconnect: NonNullable<ComponentProps<typeof GitHubChatConnectorCard>["onDisconnect"]>) {
      render(
        <GitHubChatConnectorCard
          connected
          configSchema={schemaWith("integrations.github")}
          {...connectedHandlers()}
          onDisconnect={onDisconnect}
        />,
      );
      // Wait for the initial status probe to present the connected state.
      await screen.findByText(/GitHub is connected\./i);
      fireEvent.click(screen.getByRole("button", { name: /^disconnect$/i }));
      const confirm = await screen.findByRole("button", { name: /disconnect github/i });
      await act(async () => {
        fireEvent.click(confirm);
      });
    }

    it("regression: does not present disconnected state when the SDK resolves ok:false", async () => {
      // SECURITY CONTRACT: a managed disconnect that the gateway reports as not
      // completed (ok:false) must leave the card in the connected state with an
      // error, never silently reset to "Connect GitHub" while the credential is
      // still live.
      const onDisconnect = vi.fn(async () => ({ ok: false }));
      await renderConnectedCard(onDisconnect);

      expect(await screen.findByText(/GitHub is still connected/i)).toBeInTheDocument();
      expect(screen.getByText(/GitHub is connected\./i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /start connection/i })).not.toBeInTheDocument();
    });

    it("regression: treats a disconnect result without ok:true as a failure", async () => {
      // INVALID/NO-OP RESULT CONTRACT: a resolved payload that omits `ok` is not
      // proof of revocation. The card must keep showing the connected state.
      const onDisconnect = vi.fn(async () => ({ } as { ok: boolean }));
      await renderConnectedCard(onDisconnect);

      expect(await screen.findByText(/GitHub is still connected/i)).toBeInTheDocument();
      expect(screen.getByText(/GitHub is connected\./i)).toBeInTheDocument();
    });

    it("resets to disconnected only after a confirmed ok:true result", async () => {
      const onDisconnect = vi.fn(async () => ({ ok: true }));
      await renderConnectedCard(onDisconnect);

      expect(await screen.findByRole("button", { name: /start connection/i })).toBeInTheDocument();
      expect(screen.queryByText(/GitHub is connected\./i)).not.toBeInTheDocument();
      expect(screen.queryByText(/GitHub is still connected/i)).not.toBeInTheDocument();
      expect(onDisconnect).toHaveBeenCalledWith({ integrationId: "github", connectionId: "conn-9", revoke: true });
    });

    it("keeps the connected state and shows the error when disconnect rejects", async () => {
      const onDisconnect = vi.fn(async () => {
        throw new Error("gateway timeout");
      });
      await renderConnectedCard(onDisconnect);

      expect(await screen.findByText(/GitHub is still connected/i)).toBeInTheDocument();
      expect(screen.getByText(/GitHub is connected\./i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Technical details" }));
      expect(screen.getByText("gateway timeout")).toBeInTheDocument();
    });

    it("requires the destructive confirmation before calling disconnect", async () => {
      const onDisconnect = vi.fn(async () => ({ ok: true }));
      render(
        <GitHubChatConnectorCard
          connected
          configSchema={schemaWith("integrations.github")}
          {...connectedHandlers()}
          onDisconnect={onDisconnect}
        />,
      );
      await screen.findByText(/GitHub is connected\./i);

      fireEvent.click(screen.getByRole("button", { name: /^disconnect$/i }));
      expect(onDisconnect).not.toHaveBeenCalled();
      // The destructive confirmation explains the revocation before any call.
      expect(await screen.findByText(/revokes the saved GitHub connection/i)).toBeInTheDocument();

      // Cancel keeps the credential untouched and the card connected.
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
      });
      expect(onDisconnect).not.toHaveBeenCalled();
      expect(screen.getByText(/GitHub is connected\./i)).toBeInTheDocument();
    });
  });

  describe("managed device-flow polling bounds (gap 4)", () => {
    const pollRuntime = { provider: "openclaw", version: "2026.7.16", capabilities: ["integrations.auth"] };

    function pollingProvider(pollSetup: AgentConnectorsProvider["pollSetup"]): AgentConnectorsProvider {
      return {
        runtime: pollRuntime,
        list: vi.fn(async () => [{
          connectorId: "github",
          configured: false,
          authenticated: false,
          usable: false,
          setupModes: ["managed-auth" as const],
        }]),
        startSetup: vi.fn(async () => ({
          connectorId: "github",
          mode: "managed-auth" as const,
          setupId: "auth-poll",
          deviceUrl: "https://github.com/login/device",
          deviceCode: "ABCD-EFGH",
          expiresAt: Date.now() + 90_000,
          pollIntervalMs: 1500,
          provenance: pollRuntime,
        })),
        pollSetup,
        configure: vi.fn(),
      } satisfies AgentConnectorsProvider;
    }

    it("regression: polling stops after a bounded number of attempts when the flow never completes", async () => {
      // RELIABILITY CONTRACT: a managed device flow that never reaches a
      // terminal state must not poll forever — an abandoned tab would otherwise
      // poll the gateway indefinitely. The runtime-provided expiry must terminate
      // polling with a failure state.
      vi.useFakeTimers();
      const pollSetup = vi.fn(async () => ({
        connectorId: "github",
        setupId: "auth-poll",
        state: "pending" as const,
        provenance: pollRuntime,
      }));
      const connectorsProvider = pollingProvider(pollSetup);

      render(<GitHubChatConnectorCard connected connectorsProvider={connectorsProvider} configSchema={null} />);
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /start connection/i }));
      });
      expect(screen.getByText("ABCD-EFGH")).toBeInTheDocument();

      // Simulate ten minutes of pending responses (bounded, fake timers).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      });

      // A bounded flow must have stopped well before ~400 attempts and shown a
      // terminal failure instead of the still-pending device-code prompt.
      expect(pollSetup.mock.calls.length).toBeLessThanOrEqual(60);
      expect(screen.getByText(/did not finish|expired|taking too long/i)).toBeInTheDocument();
      const callsAfterFailure = pollSetup.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60 * 1000);
      });
      expect(pollSetup.mock.calls.length).toBe(callsAfterFailure);
    });

    it("stops polling when the runtime reports a terminal failed state", async () => {
      vi.useFakeTimers();
      const pollSetup = vi.fn(async () => ({
        connectorId: "github",
        setupId: "auth-poll",
        state: "failed" as const,
        error: "authorization expired",
        provenance: pollRuntime,
      }));
      const connectorsProvider = pollingProvider(pollSetup);

      render(<GitHubChatConnectorCard connected connectorsProvider={connectorsProvider} configSchema={null} />);
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /start connection/i }));
      });
      // Drive the poll interval so the terminal failed response is processed.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(screen.getByText(/GitHub authorization did not finish/i)).toBeInTheDocument();
      const callsAfterFailure = pollSetup.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30 * 1000);
      });
      expect(pollSetup.mock.calls.length).toBe(callsAfterFailure);
    });

    it("stops polling when the card unmounts mid-flow", async () => {
      vi.useFakeTimers();
      const pollSetup = vi.fn(async () => ({
        connectorId: "github",
        setupId: "auth-poll",
        state: "pending" as const,
        provenance: pollRuntime,
      }));
      const connectorsProvider = pollingProvider(pollSetup);

      const { unmount } = render(
        <GitHubChatConnectorCard connected connectorsProvider={connectorsProvider} configSchema={null} />,
      );
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /start connection/i }));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      const callsBeforeUnmount = pollSetup.mock.calls.length;
      expect(callsBeforeUnmount).toBeGreaterThan(0);

      unmount();
      const callsAtUnmount = pollSetup.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30 * 1000);
      });
      expect(pollSetup.mock.calls.length).toBe(callsAtUnmount);
    });
  });

  describe("double-start and agent-driven setup (gaps 2 and 6)", () => {
    it("issues exactly one managed auth start for a single connect gesture", async () => {
      // RELIABILITY CONTRACT: a connect click must mint exactly one gateway
      // authorization. NOTE (gap 6 residual): `start()` has no in-flight
      // guard and the card's own mount/status effect resets `step` to `idle`
      // when the status probe resolves, re-enabling the button mid-flight —
      // a second click after that point starts a second authorization. A
      // single-gesture regression is pinned here; the re-click race requires
      // a production in-flight guard and is recorded as a residual defect.
      let resolveStart: ((result: { authId: string }) => void) | undefined;
      const onAuthStart = vi.fn(() => new Promise<{ authId: string }>((resolve) => {
        resolveStart = resolve;
      }));
      render(
        <GitHubChatConnectorCard
          connected
          configSchema={schemaWith("integrations.github")}
          onAuthStart={onAuthStart}
          onAuthStatus={vi.fn(async () => ({ status: "pending" }))}
          onIntegrationStatus={vi.fn(async () => ({ integrations: { github: { configured: false, authenticated: false, usable: false } } }))}
        />,
      );
      // Let the initial status probe settle into the idle step.
      const startButton = await screen.findByRole("button", { name: /start connection/i });

      await act(async () => {
        fireEvent.click(startButton);
      });
      resolveStart?.({ authId: "auth-1" });
      await act(async () => {
        await Promise.resolve();
      });

      expect(onAuthStart).toHaveBeenCalledTimes(1);
    });

    it("surfaces a failed agent setup send and offers retry", async () => {
      const onStartAgentGitHubSetup = vi.fn(async () => {
        throw new Error("agent disconnected mid-send");
      });
      render(
        <GitHubChatConnectorCard
          connected
          configSchema={schemaWith("integrations.github")}
          onStartAgentGitHubSetup={onStartAgentGitHubSetup}
        />,
      );

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /start connection/i }));
      });

      expect(await screen.findByText(/GitHub setup did not start/i)).toBeInTheDocument();
      expect(onStartAgentGitHubSetup).toHaveBeenCalledTimes(1);

      // Retry affordance remains available after a failed send.
      const retry = screen.getByRole("button", { name: /start connection/i });
      await act(async () => {
        fireEvent.click(retry);
      });
      expect(onStartAgentGitHubSetup).toHaveBeenCalledTimes(2);
    });

    it("never renders a managed Disconnect affordance in the agent-driven gh flow", async () => {
      // CHARACTERIZATION (gap 2): the agent-driven `gh auth login` flow has no
      // disconnect/revoke route. The card must not present a managed Disconnect
      // button while the agent flow is active, even in the ready state, because
      // the CLI login lives in the workspace shell and is not a managed
      // connection the gateway can revoke. This pins the current UI
      // distinction; it does not define a new logout workflow.
      const onDisconnect = vi.fn(async () => ({ ok: true }));
      render(
        <GitHubChatConnectorCard
          connected
          configSchema={schemaWith("integrations.github")}
          onDisconnect={onDisconnect}
          agentSetupStatus={{
            phase: "ready",
            accountDisplayName: "octocat",
            recentCommands: [
              { label: "Checking GitHub auth", command: "gh auth status", result: "Logged in to github.com account octocat" },
            ],
          }}
        />,
      );

      expect(await screen.findByText("Signed in as octocat")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^disconnect$/i })).not.toBeInTheDocument();
      expect(onDisconnect).not.toHaveBeenCalled();
    });

    it("does not render a managed Disconnect affordance while the agent device-code step is active", async () => {
      const onDisconnect = vi.fn(async () => ({ ok: true }));
      render(
        <GitHubChatConnectorCard
          connected
          configSchema={schemaWith("integrations.github")}
          onDisconnect={onDisconnect}
          agentSetupStatus={{
            phase: "device-code",
            userCode: "8BCD-83A2",
            verificationUri: "https://github.com/login/device",
            recentCommands: [],
          }}
        />,
      );

      expect(await screen.findByText("8BCD-83A2")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^disconnect$/i })).not.toBeInTheDocument();
      expect(onDisconnect).not.toHaveBeenCalled();
    });
  });
});
