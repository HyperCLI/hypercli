import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { toAgentViewModel } from "@/components/dashboard/agents/agentViewModel";
import { buildSdkAgent } from "@/test/factories";
import { renderWithClient } from "@/test/utils";
import { AccountOperationsHome } from "./AccountOperationsHome";

describe("AccountOperationsHome gateway isolation", () => {
  it("opens the selected Agent without acquiring operations for it or any roster peer", async () => {
    const operationsSnapshots = Array.from({ length: 5 }, () => vi.fn(async () => ({
      sessions: { sessions: [] },
      cronJobs: [],
      failures: {},
      capturedAt: Date.now(),
    })));
    const sdkAgents = operationsSnapshots.map((operationsSnapshot, index) => Object.assign(
      buildSdkAgent({ id: `agent-${index + 1}`, name: `Agent ${index + 1}`, state: "RUNNING" }),
      { operationsSnapshot },
    ));
    const onOpenAgent = vi.fn();

    renderWithClient(
      <AccountOperationsHome
        sdkAgents={sdkAgents}
        agents={sdkAgents.map(toAgentViewModel)}
        workspaces={[]}
        spaceAccessClient={null}
        onOpenAgent={onOpenAgent}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Talk to Agent 1" }));

    expect(onOpenAgent).toHaveBeenCalledWith("agent-1");
    for (const operationsSnapshot of operationsSnapshots) {
      expect(operationsSnapshot).not.toHaveBeenCalled();
    }
    expect(screen.getByRole("heading", { name: "Open an agent to see its sessions" })).toBeInTheDocument();
  });
});
