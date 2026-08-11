import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_STARTUP_TIP_INTERVAL_MS,
  AgentStartupLoadingVisual,
  AgentStartupTipsVisual,
} from "./AgentStartupLoadingVisual";
import { expectNoA11yViolations, renderWithClient } from "@/test/utils";

const LEGACY_AGENT_STARTUP_EXPERIENCE_STORAGE_KEY = "claw.agentStartupExperience.v1";

describe("AgentStartupTipsVisual", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows truthful startup status with rotating guidance", async () => {
    const { container } = renderWithClient(
      <AgentStartupTipsVisual
        title="Provisioning runtime"
        detail="Reserving compute and preparing the workspace."
      />,
    );

    expect(screen.getByRole("heading", { name: "Your teammate is warming up" })).toBeInTheDocument();
    expect(screen.getByRole("status", {
      name: /provisioning runtime reserving compute and preparing the workspace/i,
    })).toBeInTheDocument();
    expect(container.querySelector('[data-slot="loading-dots"]')?.children).toHaveLength(3);
    expect(screen.getByText("Start with the finish line")).toBeInTheDocument();
    expect(screen.queryByText("While you wait")).not.toBeInTheDocument();
    expect(screen.queryByText(/1\s*\/\s*10/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /startup tips/i })).not.toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("supports a returning-teammate heading for initial page hydration", () => {
    renderWithClient(
      <AgentStartupTipsVisual
        heading="Rejoining your teammate"
        note="Restoring your connection and recent conversation."
        title="Connecting gateway"
        detail="Opening the agent session."
      />,
    );

    expect(screen.getByRole("heading", { name: "Rejoining your teammate" })).toBeInTheDocument();
    expect(screen.getByText("Restoring your connection and recent conversation.")).toBeInTheDocument();
  });

  it("exposes an available startup action", () => {
    const onStop = vi.fn();
    renderWithClient(
      <AgentStartupTipsVisual actionLabel="Stop agent" onAction={onStop} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Stop agent" }));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("rotates tips every five seconds without a playback control", () => {
    vi.useFakeTimers();
    renderWithClient(<AgentStartupTipsVisual />);

    act(() => vi.advanceTimersByTime(AGENT_STARTUP_TIP_INTERVAL_MS));

    expect(screen.getByText("Bring the source with you")).toBeInTheDocument();
    expect(screen.queryByText(/2\s*\/\s*10/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /startup tips/i })).not.toBeInTheDocument();
  });

});

describe("AgentStartupLoadingVisual", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("uses the new tips experience by default", () => {
    renderWithClient(<AgentStartupLoadingVisual title="Booting agent" detail="Starting the runtime." />);

    expect(document.querySelector('[data-slot="agent-startup-tips"]')).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /agent workspace loading/i })).not.toBeInTheDocument();
  });

  it("ignores the retired Classic preference", () => {
    window.localStorage.setItem(LEGACY_AGENT_STARTUP_EXPERIENCE_STORAGE_KEY, "classic");

    renderWithClient(<AgentStartupLoadingVisual title="Booting agent" detail="Starting the runtime." />);

    expect(document.querySelector('[data-slot="agent-startup-tips"]')).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /agent workspace loading/i })).not.toBeInTheDocument();
  });

  it("keeps the existing retryable error presentation in either experience", () => {
    const onRetry = vi.fn();
    renderWithClient(
      <AgentStartupLoadingVisual
        title="Could not connect"
        detail="Gateway handshake failed"
        status="error"
        onAction={onRetry}
      />,
    );

    expect(screen.getByRole("alert", { name: /could not connect gateway handshake failed/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
