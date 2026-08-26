import { act, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithClient, expectNoA11yViolations } from "@/test/utils";
import {
  AgentLaunchPrompt,
  AgentLoadingState,
  AgentStatusChip,
  RETAINED_AGENT_READY_GRACE_MS,
  getAgentWorkspaceStatus,
  useRetainedAgentReadyExpiry,
} from "./page-helpers";

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-color-mode");
});

describe("getAgentWorkspaceStatus", () => {
  it("distinguishes cold gateway acquisition from a retained conversation", () => {
    expect(getAgentWorkspaceStatus({
      connected: false,
      connecting: true,
      gatewayConnected: false,
      hydrating: false,
      conversation: true,
      retainedReadyExpired: false,
    })).toMatchObject({
      label: "Preparing",
      detail: "Preparing the selected conversation.",
      loading: true,
    });

    expect(getAgentWorkspaceStatus({
      connected: false,
      connecting: true,
      gatewayConnected: true,
      hydrating: true,
      conversation: true,
      retainedReadyExpired: false,
    })).toMatchObject({
      label: "Ready",
      detail: "Agent is online.",
      tone: "ready",
    });
  });

  it("keeps the agent ready while a retained non-chat workspace hydrates", () => {
    expect(getAgentWorkspaceStatus({
      connected: false,
      connecting: true,
      gatewayConnected: true,
      hydrating: true,
      conversation: false,
      retainedReadyExpired: false,
    })).toMatchObject({
      label: "Ready",
      detail: "Agent is online.",
      tone: "ready",
    });

    expect(getAgentWorkspaceStatus({
      connected: true,
      connecting: false,
      gatewayConnected: true,
      hydrating: false,
      conversation: false,
      retainedReadyExpired: false,
    })).toMatchObject({
      label: "Ready",
      detail: "Agent is online.",
    });
  });

  it("keeps Hermes ready while its retained session is hydrating", () => {
    expect(getAgentWorkspaceStatus({
      connected: true,
      connecting: false,
      gatewayConnected: true,
      hydrating: true,
      conversation: true,
      retainedReadyExpired: false,
    })).toMatchObject({
      label: "Ready",
      detail: "Agent is online.",
      tone: "ready",
    });
  });

  it("reports a stopped transport as disconnected", () => {
    expect(getAgentWorkspaceStatus({
      connected: false,
      connecting: false,
      gatewayConnected: false,
      hydrating: false,
      conversation: true,
      retainedReadyExpired: false,
    })).toEqual({
      label: "Disconnected",
      detail: "Gateway disconnected.",
      tone: "disconnected",
    });
  });

  it("bounds retained Ready and resets the grace period after recovery", () => {
    vi.useFakeTimers();
    const view = renderHook(({
      connected,
      connecting,
      gatewayConnected,
      hydrating,
    }: {
      connected: boolean;
      connecting: boolean;
      gatewayConnected: boolean;
      hydrating: boolean;
    }) => {
      const retainedReadyExpired = useRetainedAgentReadyExpiry({
        scopeKey: "agent-1",
        connected,
        gatewayConnected,
      });
      return getAgentWorkspaceStatus({
        connected,
        connecting,
        gatewayConnected,
        hydrating,
        conversation: true,
        retainedReadyExpired,
      });
    }, {
      initialProps: {
        connected: false,
        connecting: true,
        gatewayConnected: true,
        hydrating: true,
      },
    });

    try {
      expect(view.result.current.label).toBe("Ready");

      act(() => vi.advanceTimersByTime(RETAINED_AGENT_READY_GRACE_MS - 1));
      expect(view.result.current.label).toBe("Ready");

      act(() => vi.advanceTimersByTime(1));
      expect(view.result.current).toMatchObject({
        label: "Reconnecting",
        tone: "connecting",
        loading: true,
      });

      view.rerender({
        connected: true,
        connecting: false,
        gatewayConnected: true,
        hydrating: false,
      });
      act(() => vi.advanceTimersByTime(0));
      expect(view.result.current.label).toBe("Ready");

      view.rerender({
        connected: false,
        connecting: false,
        gatewayConnected: true,
        hydrating: false,
      });
      expect(view.result.current.label).toBe("Ready");

      act(() => vi.advanceTimersByTime(RETAINED_AGENT_READY_GRACE_MS));
      expect(view.result.current).toMatchObject({
        label: "Disconnected",
        tone: "disconnected",
      });
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });
});

describe("AgentStatusChip", () => {
  it.each([
    ["aurora-light", "light"],
    ["aurora-dark", "dark"],
  ] as const)("uses accessible Ready text in the %s theme", async (theme, mode) => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.setAttribute("data-color-mode", mode);
    const { container } = renderWithClient(
      <AgentStatusChip status={{ label: "Ready", detail: "Agent is online.", tone: "ready" }} />,
    );

    expect(screen.getByLabelText("Ready: Agent is online.")).toHaveClass("text-text-secondary");
    await expectNoA11yViolations(container);
  });

  it("keeps static status text out of the keyboard tab order", async () => {
    const user = userEvent.setup();
    renderWithClient(
      <>
        <AgentStatusChip status={{ label: "Ready", detail: "Agent is online.", tone: "ready" }} />
        <button type="button">Next action</button>
      </>,
    );

    expect(screen.getByLabelText("Ready: Agent is online.")).not.toHaveAttribute("tabindex");
    await user.tab();
    expect(screen.getByRole("button", { name: "Next action" })).toHaveFocus();
  });
});

describe("AgentLaunchPrompt", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("launches from the keyboard and has no obvious accessibility violations", async () => {
    const user = userEvent.setup();
    const onLaunch = vi.fn();
    const { container } = renderWithClient(
      <AgentLaunchPrompt label="Chat" launching={false} onLaunch={onLaunch} />,
    );

    await expectNoA11yViolations(container);

    await user.tab();
    expect(screen.getByRole("button", { name: /start agent to use chat/i })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(onLaunch).toHaveBeenCalledTimes(1);
  });

  it("disables launch actions when blocked", async () => {
    const onLaunch = vi.fn();
    const onSelectSmall = vi.fn();
    renderWithClient(
      <AgentLaunchPrompt
        label="Shell"
        launching={false}
        onLaunch={onLaunch}
        blockedMessage="Stop another agent before launching this one."
        suggestedTierActions={[{ label: "Use Small", onSelect: onSelectSmall }]}
      />,
    );

    expect(screen.getByRole("button", { name: /start agent to use shell/i })).toBeDisabled();
    expect(screen.getByText("Launch blocked")).toBeInTheDocument();
    expect(screen.getByText("Stop another agent before launching this one.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /use small/i }));
    expect(onSelectSmall).toHaveBeenCalledTimes(1);
  });

  it("shows launching state without firing while disabled", async () => {
    const onLaunch = vi.fn();
    renderWithClient(
      <AgentLaunchPrompt label="Logs" launching={true} onLaunch={onLaunch} blockedTitle="Starting" />,
    );

    expect(screen.getByText("Starting agent")).toBeInTheDocument();
    expect(screen.getByText("Starting the runtime and gateway.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start agent to use logs/i })).not.toBeInTheDocument();
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it("supports contextual stopped-state footnotes", () => {
    renderWithClient(
      <AgentLaunchPrompt
        label="Shell"
        launching={false}
        onLaunch={vi.fn()}
        footnote="Start the agent to open a terminal session."
      />,
    );

    expect(screen.getByText("Start the agent to open a terminal session.")).toBeInTheDocument();
    expect(screen.queryByText("Files remain available while stopped.")).not.toBeInTheDocument();
  });
});

describe("AgentLoadingState", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("uses the new startup loading state by default", () => {
    const { container } = renderWithClient(<AgentLoadingState />);

    expect(screen.getByRole("heading", { name: "Your teammate is warming up" })).toBeInTheDocument();
    expect(screen.getByText("Connecting gateway")).toBeInTheDocument();
    expect(screen.getByText("Opening the agent session")).toBeInTheDocument();
    expect(container.querySelector('[data-slot="agent-startup-tips"]')).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /agent workspace loading/i })).not.toBeInTheDocument();
  });

  it("keeps the startup experience mounted while status text changes", async () => {
    const { container, rerender } = renderWithClient(
      <AgentLoadingState
        title="Provisioning runtime"
        detail="Reserving compute and preparing the workspace."
      />,
    );
    const startupExperience = container.querySelector('[data-slot="agent-startup-tips"]');

    rerender(
      <AgentLoadingState
        title="Booting agent"
        detail="Starting the container and OpenClaw services."
      />,
    );

    expect(container.querySelector('[data-slot="agent-startup-tips"]')).toBe(startupExperience);
    await waitFor(() => {
      expect(screen.getByText("Booting agent")).toBeInTheDocument();
      expect(screen.getByText("Starting the container and OpenClaw services.")).toBeInTheDocument();
    });
    expect(screen.queryByRole("img", { name: /agent workspace loading/i })).not.toBeInTheDocument();
  });

  it("uses the startup tips experience for lifecycle boot phases", () => {
    renderWithClient(
      <AgentLoadingState
        bootStatus={{
          status: "loading",
          phase: "creating",
          title: "Creating agent",
          detail: "Preparing persistent storage and admitting the runtime.",
          tone: "starting",
          stage: "runtime",
        }}
      />,
    );

    expect(document.querySelector('[data-slot="agent-startup-tips"]')).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /agent workspace loading/i })).not.toBeInTheDocument();
  });

  it("renders an error status with a retry action", async () => {
    const onRetry = vi.fn();
    renderWithClient(
      <AgentLoadingState
        bootStatus={{
          status: "error",
          phase: "error",
          title: "Could not connect",
          detail: "Gateway handshake failed",
          stage: "gateway",
        }}
        actionLabel="Retry"
        onAction={onRetry}
      />,
    );

    expect(screen.getByRole("alert", { name: /could not connect gateway handshake failed/i })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /agent workspace loading/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
