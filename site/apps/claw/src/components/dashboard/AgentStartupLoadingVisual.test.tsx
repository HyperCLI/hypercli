import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_STARTUP_TIP_INTERVAL_MS,
  AgentStartupLoadingVisual,
  AgentStartupTipsVisual,
} from "./AgentStartupLoadingVisual";
import { AGENT_STARTUP_EXPERIENCE_STORAGE_KEY } from "@/hooks/useAgentStartupExperience";
import { expectNoA11yViolations, renderWithClient } from "@/test/utils";

describe("AgentStartupTipsVisual", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows truthful startup status with a practical first tip", async () => {
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
    expect(screen.getByLabelText("Tip 1 of 10")).toBeInTheDocument();
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

  it("rotates tips every five seconds without resetting when startup status changes", () => {
    vi.useFakeTimers();
    const { rerender } = renderWithClient(
      <AgentStartupTipsVisual
        title="Provisioning runtime"
        detail="Reserving compute and preparing the workspace."
      />,
    );

    act(() => vi.advanceTimersByTime(3_000));
    rerender(
      <AgentStartupTipsVisual
        title="Booting agent"
        detail="Starting the container and OpenClaw services."
      />,
    );
    act(() => vi.advanceTimersByTime(AGENT_STARTUP_TIP_INTERVAL_MS - 3_000));

    expect(screen.getByText("Bring the source with you")).toBeInTheDocument();
    expect(screen.getByLabelText("Tip 2 of 10")).toBeInTheDocument();
  });

  it("pauses and resumes automatic tip rotation", () => {
    vi.useFakeTimers();
    renderWithClient(<AgentStartupTipsVisual />);

    fireEvent.click(screen.getByRole("button", { name: "Pause startup tips" }));
    act(() => vi.advanceTimersByTime(AGENT_STARTUP_TIP_INTERVAL_MS * 2));
    expect(screen.getByText("Start with the finish line")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Resume startup tips" }));
    act(() => vi.advanceTimersByTime(AGENT_STARTUP_TIP_INTERVAL_MS));
    expect(screen.getByText("Bring the source with you")).toBeInTheDocument();
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

  it("renders the unchanged Classic loader when selected", () => {
    window.localStorage.setItem(AGENT_STARTUP_EXPERIENCE_STORAGE_KEY, "classic");

    renderWithClient(<AgentStartupLoadingVisual title="Booting agent" detail="Starting the runtime." />);

    expect(screen.getByRole("img", { name: /agent workspace loading/i })).toBeInTheDocument();
    expect(document.querySelector('[data-slot="agent-startup-tips"]')).not.toBeInTheDocument();
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
