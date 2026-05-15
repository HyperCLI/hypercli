import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithClient, expectNoA11yViolations } from "@/test/utils";
import { AgentLaunchPrompt, AgentLoadingState } from "./page-helpers";

describe("AgentLaunchPrompt", () => {
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
});

describe("AgentLoadingState", () => {
  it("shows the shared gateway loading state", () => {
    renderWithClient(<AgentLoadingState />);

    expect(screen.getByText("Connecting gateway .")).toBeInTheDocument();
    expect(screen.getByText("Opening the agent session")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /agent workspace loading/i })).toBeInTheDocument();
  });

  it("keeps the loading animation mounted while status text changes", () => {
    const { rerender } = renderWithClient(
      <AgentLoadingState
        title="Provisioning runtime"
        detail="Reserving compute and preparing the workspace."
      />,
    );
    const animation = screen.getByRole("img", { name: /agent workspace loading/i });

    rerender(
      <AgentLoadingState
        title="Booting agent"
        detail="Starting the container and OpenClaw services."
      />,
    );

    expect(screen.getByRole("img", { name: /agent workspace loading/i })).toBe(animation);
    expect(screen.getByText("Booting agent")).toBeInTheDocument();
    expect(screen.getByText("Starting the container and OpenClaw services.")).toBeInTheDocument();
  });
});
