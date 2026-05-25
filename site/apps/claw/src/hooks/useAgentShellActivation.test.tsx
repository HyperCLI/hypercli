import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderHookWithClient } from "@/test/utils";
import { useAgentShellActivation } from "./useAgentShellActivation";

describe("useAgentShellActivation", () => {
  it("keeps the shell connection enabled after visiting shell and moving to other panels", async () => {
    const { result, rerender } = renderHookWithClient(
      ({ activeTab, agentId, agentState }) => useAgentShellActivation({ activeTab, agentId, agentState }),
      {
        initialProps: {
          activeTab: "chat",
          agentId: "agent-1" as string | null,
          agentState: "RUNNING" as string | null,
        },
      },
    );

    expect(result.current).toBe(false);

    rerender({ activeTab: "shell", agentId: "agent-1", agentState: "RUNNING" });
    await waitFor(() => expect(result.current).toBe(true));

    rerender({ activeTab: "files", agentId: "agent-1", agentState: "RUNNING" });
    expect(result.current).toBe(true);

    rerender({ activeTab: "integrations", agentId: "agent-1", agentState: "RUNNING" });
    expect(result.current).toBe(true);

    rerender({ activeTab: "settings", agentId: "agent-1", agentState: "RUNNING" });
    expect(result.current).toBe(true);
  });

  it("resets activation when the agent changes or stops", async () => {
    const { result, rerender } = renderHookWithClient(
      ({ activeTab, agentId, agentState }) => useAgentShellActivation({ activeTab, agentId, agentState }),
      {
        initialProps: {
          activeTab: "shell",
          agentId: "agent-1" as string | null,
          agentState: "RUNNING" as string | null,
        },
      },
    );

    await waitFor(() => expect(result.current).toBe(true));

    rerender({ activeTab: "files", agentId: "agent-1", agentState: "STOPPING" });
    await waitFor(() => expect(result.current).toBe(false));

    rerender({ activeTab: "files", agentId: "agent-2", agentState: "RUNNING" });
    expect(result.current).toBe(false);

    rerender({ activeTab: "shell", agentId: "agent-2", agentState: "RUNNING" });
    await waitFor(() => expect(result.current).toBe(true));

    rerender({ activeTab: "chat", agentId: null, agentState: null });
    await waitFor(() => expect(result.current).toBe(false));
  });
});
