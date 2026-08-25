import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BuzzActivityEvent, ObserverEvent } from "@/lib/buzz-activity";
import { AgentActivityPanel } from "./AgentActivityPanel";

function rawFrame(partial: Partial<ObserverEvent>): ObserverEvent {
  return {
    seq: 1,
    timestamp: "2026-08-25T00:00:00.000Z",
    kind: "acp_read",
    agentIndex: 0,
    channelId: null,
    sessionId: "session-1",
    turnId: "turn-1",
    payload: {},
    ...partial,
  };
}

function activityEvent(partial: Partial<BuzzActivityEvent>): BuzzActivityEvent {
  return {
    id: `event-${partial.seq ?? 1}`,
    renderClass: "generic",
    label: "Ran tool",
    timestamp: new Date().toISOString(),
    seq: 1,
    raw: rawFrame({}),
    ...partial,
  };
}

function renderPanel(props: Partial<Parameters<typeof AgentActivityPanel>[0]>) {
  return render(
    <AgentActivityPanel
      status="connected"
      events={[]}
      activityBoxRef={createRef<HTMLDivElement>()}
      {...props}
    />,
  );
}

describe("AgentActivityPanel", () => {
  it("shows a loading state while connecting", () => {
    renderPanel({ status: "connecting" });

    expect(screen.getByText("Connecting activity")).toBeInTheDocument();
  });

  it("shows a disconnected state with a reconnect affordance", () => {
    const onReconnect = vi.fn();
    renderPanel({ status: "disconnected", onReconnect });

    expect(screen.getByText("Activity disconnected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(onReconnect).toHaveBeenCalledOnce();
  });

  it("shows the stream error with a reconnect affordance", () => {
    const onReconnect = vi.fn();
    renderPanel({ status: "error", error: "activity unavailable", onReconnect });

    expect(screen.getByText("Activity stream error")).toBeInTheDocument();
    expect(screen.getByText("activity unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(onReconnect).toHaveBeenCalledOnce();
  });

  it("shows an empty state once connected without events", () => {
    renderPanel({ status: "connected", events: [] });

    expect(screen.getByTestId("agents-activity-empty")).toHaveTextContent("No activity yet");
  });

  it("renders a shell tool, a message, and a failed tool", () => {
    renderPanel({
      status: "connected",
      events: [
        activityEvent({
          id: "tool-1",
          renderClass: "shell",
          label: "Ran command",
          preview: "ls -la",
          status: "executing",
        }),
        activityEvent({
          id: "msg-1",
          renderClass: "message",
          label: "Assistant",
          detail: "Here is the summary you asked for.",
          seq: 2,
        }),
        activityEvent({
          id: "tool-2",
          renderClass: "error",
          label: "Ran command failed",
          preview: "rm -rf /",
          status: "failed",
          isError: true,
          seq: 3,
        }),
      ],
    });

    const rows = screen.getAllByTestId("agents-activity-event");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Ran command");
    expect(rows[0]).toHaveTextContent("ls -la");
    expect(rows[0].querySelector("[data-testid='agents-activity-status-running']")).not.toBeNull();
    expect(rows[1]).toHaveTextContent("Assistant");
    expect(rows[1]).toHaveTextContent("Here is the summary you asked for.");
    expect(rows[2]).toHaveTextContent("Ran command failed");
    expect(rows[2].querySelector("[data-testid='agents-activity-status-failed']")).not.toBeNull();
  });

  it("marks a completed tool with a check", () => {
    renderPanel({
      status: "connected",
      events: [
        activityEvent({ id: "tool-1", renderClass: "shell", label: "Ran command", status: "completed" }),
      ],
    });

    expect(screen.getByTestId("agents-activity-status-completed")).toBeInTheDocument();
  });

  it("hides the raw observer frame behind a per-row expander", () => {
    const raw = rawFrame({ kind: "turn_started", payload: { triggeringEventIds: ["e-1"] } });
    renderPanel({
      status: "connected",
      events: [activityEvent({ id: "turn-1", renderClass: "status", label: "Turn started", raw })],
    });

    expect(screen.queryByText(/triggeringEventIds/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Toggle raw event for Turn started" }));
    expect(screen.getByText(/triggeringEventIds/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Toggle raw event for Turn started" }));
    expect(screen.queryByText(/triggeringEventIds/)).not.toBeInTheDocument();
  });

  it("does not render suppressed rows", () => {
    renderPanel({
      status: "connected",
      events: [
        activityEvent({ id: "hidden-1", renderClass: "suppressed", label: "Checked todos" }),
        activityEvent({ id: "shown-1", renderClass: "status", label: "Session ready", seq: 2 }),
      ],
    });

    expect(screen.getAllByTestId("agents-activity-event")).toHaveLength(1);
    expect(screen.queryByText("Checked todos")).not.toBeInTheDocument();
  });

  it("offers a pop-out affordance when provided", () => {
    const onPopOut = vi.fn();
    renderPanel({ status: "connected", onPopOut });

    fireEvent.click(screen.getByRole("button", { name: "Pop out activity" }));
    expect(onPopOut).toHaveBeenCalledOnce();
  });
});
