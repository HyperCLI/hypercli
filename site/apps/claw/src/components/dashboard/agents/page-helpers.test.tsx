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

    const launchButton = screen.getByRole("button", { name: /start agent to use logs/i });
    expect(launchButton).toHaveAttribute("title", "Starting");
    await userEvent.click(launchButton);
    expect(onLaunch).not.toHaveBeenCalled();
  });
});

describe("AgentLoadingState", () => {
  it("shows gateway as the active lifecycle step while waiting", () => {
    renderWithClient(
      <AgentLoadingState
        title="Waiting for gateway"
        detail="The runtime is up. Reconnecting to the agent session."
        tone="connecting"
        stage="gateway"
      />,
    );

    expect(screen.getByText("Waiting for gateway")).toBeInTheDocument();
    expect(screen.getByLabelText(/runtime complete, agent complete, gateway active/i)).toBeInTheDocument();
  });
});
