import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("filters the agent card grid by display name", () => {
    renderSelector();

    fireEvent.change(screen.getByRole("searchbox", { name: "Filter agents by name" }), {
      target: { value: "research" },
    });

    expect(screen.getByRole("button", { name: "Open settings for Research" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open settings for writer" })).not.toBeInTheDocument();
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
