import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Agent } from "@/app/dashboard/agents/types";
import { SettingsAgentSelector } from "./SettingsAgentSelector";

const agents: Agent[] = [
  {
    id: "agent-1",
    name: "research-agent",
    displayName: "Research",
    managed: false,
    user_id: "user-1",
    state: "RUNNING",
    isLaunchable: true,
    cpu_millicores: 1000,
    memory_mib: 2048,
    hostname: "research.example.com",
    started_at: "2026-08-01T00:00:00Z",
    stopped_at: null,
    archived_at: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    launchEpoch: 0,
    clusterId: null,
    meta: null,
  },
  {
    id: "agent-2",
    name: "writer",
    user_id: "user-1",
    state: "STOPPED",
    isLaunchable: true,
    cpu_millicores: 1000,
    memory_mib: 2048,
    hostname: null,
    started_at: null,
    stopped_at: "2026-08-02T00:00:00Z",
    archived_at: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-02T00:00:00Z",
    launchEpoch: 0,
    clusterId: null,
    meta: null,
  },
];

function renderSelector(overrides: Partial<React.ComponentProps<typeof SettingsAgentSelector>> = {}) {
  const props: React.ComponentProps<typeof SettingsAgentSelector> = {
    agents,
    loading: false,
    error: null,
    onSelect: vi.fn(),
    onArchive: vi.fn(),
    onDelete: vi.fn(),
    onRetry: vi.fn(),
    onCreateAgent: vi.fn(),
    ...overrides,
  };
  render(<SettingsAgentSelector {...props} />);
  return props;
}

describe("SettingsAgentSelector", () => {
  it("lists every account agent and reports the selected id", () => {
    const { onSelect } = renderSelector();

    expect(screen.getByRole("heading", { name: "Agents" })).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Stopped")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open settings for writer" }));
    expect(onSelect).toHaveBeenCalledWith("agent-2");
  });

  it("offers archive and delete actions for a stopped agent", () => {
    const { onArchive, onDelete, onSelect } = renderSelector();

    fireEvent.click(screen.getByRole("button", { name: "Archive writer" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete writer" }));

    expect(onArchive).toHaveBeenCalledWith("agent-2");
    expect(onDelete).toHaveBeenCalledWith("agent-2");
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Archive Research" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Research" })).not.toBeInTheDocument();
  });

  it("offers deletion without archive for an archived agent", () => {
    const archivedAgent: Agent = {
      ...agents[1],
      state: "ARCHIVED",
      archived_at: "2026-08-03T00:00:00Z",
    };
    const onArchive = vi.fn();
    const onDelete = vi.fn();
    renderSelector({ agents: [archivedAgent], onArchive, onDelete });

    expect(screen.queryByRole("button", { name: "Archive writer" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete writer" }));
    expect(onArchive).not.toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalledWith("agent-2");
  });

  it("announces and disables an archive action in progress", () => {
    renderSelector({ archivingAgentId: "agent-2" });

    const archiveButton = screen.getByRole("button", { name: "Archiving writer" });
    expect(archiveButton).toBeDisabled();
    expect(archiveButton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Delete writer" })).toBeDisabled();
  });

  it("announces and disables a delete action in progress", () => {
    renderSelector({ deletingAgentId: "agent-2" });

    const deleteButton = screen.getByRole("button", { name: "Deleting writer" });
    expect(deleteButton).toBeDisabled();
    expect(deleteButton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Archive writer" })).toBeDisabled();
  });

  it("scopes the busy state to the targeted agent", async () => {
    const user = userEvent.setup();
    const stoppedPair: Agent[] = [
      agents[1],
      { ...agents[1], id: "agent-3", name: "builder" },
    ];
    const { onArchive, onDelete } = renderSelector({ agents: stoppedPair, archivingAgentId: "agent-2" });

    expect(screen.getByRole("button", { name: "Archiving writer" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete writer" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Archive builder" }));
    await user.click(screen.getByRole("button", { name: "Delete builder" }));
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onArchive).toHaveBeenCalledWith("agent-3");
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith("agent-3");
  });

  it("does not dispatch a busy archive action", async () => {
    const user = userEvent.setup();
    const { onArchive } = renderSelector({ archivingAgentId: "agent-2" });

    await user.click(screen.getByRole("button", { name: "Archiving writer" }));
    await user.click(screen.getByRole("button", { name: "Delete writer" }));

    expect(onArchive).not.toHaveBeenCalled();
  });

  it.each([
    "CREATING",
    "STARTING",
    "RUNNING",
    "STOPPING",
    "ARCHIVING",
    "RESTORING",
    "FAILED",
    "DELETED",
    "UNKNOWN",
  ])("hides lifecycle actions while the agent is %s", (state) => {
    renderSelector({ agents: [{ ...agents[1], state }] });

    expect(screen.queryByRole("button", { name: /Archive writer/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete writer/ })).not.toBeInTheDocument();
  });

  it("gates lowercase states the same as normalized states", () => {
    renderSelector({ agents: [{ ...agents[1], state: "stopped" as Agent["state"] }] });

    expect(screen.getByRole("button", { name: "Archive writer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete writer" })).toBeInTheDocument();
  });

  it("renders lifecycle actions as siblings of the card select control", () => {
    renderSelector();

    const selectControl = screen.getByRole("button", { name: "Open settings for writer" });
    expect(within(selectControl).queryByRole("button")).not.toBeInTheDocument();
  });

  it("filters the agent card grid by display name", () => {
    renderSelector();

    fireEvent.change(screen.getByRole("searchbox", { name: "Filter agents by name" }), {
      target: { value: "research" },
    });

    expect(screen.getByRole("button", { name: "Open settings for Research" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open settings for writer" })).not.toBeInTheDocument();
  });

  it("switches between grid and row layouts", () => {
    renderSelector();

    const agentList = screen.getByRole("list", { name: "Agents" });
    expect(agentList).toHaveAttribute("data-layout", "grid");
    expect(screen.getByRole("radio", { name: "Grid view" })).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: "Rows view" }));

    expect(agentList).toHaveAttribute("data-layout", "rows");
    expect(screen.getByRole("radio", { name: "Rows view" })).toBeChecked();
  });

  it("shows a loading state before the initial roster arrives", () => {
    renderSelector({ agents: [], loading: true });

    expect(screen.getByRole("status")).toHaveTextContent("Loading agents");
    expect(screen.queryByRole("list", { name: "Agents" })).not.toBeInTheDocument();
  });

  it("offers recovery when the roster cannot be loaded", async () => {
    const onRetry = vi.fn();
    renderSelector({ agents: [], error: "Service unavailable.", onRetry });

    expect(screen.getByRole("alert")).toHaveTextContent("Service unavailable.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(onRetry).toHaveBeenCalledOnce());
  });

  it("offers agent creation for an empty account", () => {
    const onCreateAgent = vi.fn();
    renderSelector({ agents: [], onCreateAgent });

    fireEvent.click(screen.getByRole("button", { name: "New agent" }));
    expect(onCreateAgent).toHaveBeenCalledOnce();
  });
});
