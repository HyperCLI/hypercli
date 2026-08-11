import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithClient, expectNoA11yViolations } from "@/test/utils";
import { AgentLaunchPrompt, AgentLoadingState } from "./page-helpers";

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

    expect(screen.getByText("Booting agent")).toBeInTheDocument();
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
