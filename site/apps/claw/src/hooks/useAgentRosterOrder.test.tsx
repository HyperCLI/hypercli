import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_ROSTER_ORDER_STORAGE_KEY,
  agentRosterOrderStorageKey,
  clearAgentRosterOrder,
  mergeVisibleAgentRosterOrder,
  moveAgentInRosterOrder,
  reconcileAgentRosterOrder,
  useAgentRosterOrder,
} from "./useAgentRosterOrder";

describe("useAgentRosterOrder", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearAgentRosterOrder();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists and restores agent order", () => {
    const first = renderHook(() => useAgentRosterOrder(["agent-a", "agent-b", "agent-c"]));

    act(() => first.result.current.setVisibleAgentOrder(["agent-c", "agent-a", "agent-b"]));

    expect(first.result.current.orderedAgentIds).toEqual(["agent-c", "agent-a", "agent-b"]);
    expect(JSON.parse(window.localStorage.getItem(AGENT_ROSTER_ORDER_STORAGE_KEY) ?? "null")).toEqual({
      version: 1,
      agentIds: ["agent-c", "agent-a", "agent-b"],
    });

    first.unmount();
    const restored = renderHook(() => useAgentRosterOrder(["agent-a", "agent-b", "agent-c"]));
    expect(restored.result.current.orderedAgentIds).toEqual(["agent-c", "agent-a", "agent-b"]);
  });

  it("keeps persisted order independent for each Workspace", () => {
    const workspaceA = renderHook(() => useAgentRosterOrder(["agent-a", "agent-b"], "workspace-a"));
    const workspaceB = renderHook(() => useAgentRosterOrder(["agent-a", "agent-b"], "workspace-b"));

    act(() => workspaceA.result.current.setVisibleAgentOrder(["agent-b", "agent-a"]));

    expect(workspaceA.result.current.orderedAgentIds).toEqual(["agent-b", "agent-a"]);
    expect(workspaceB.result.current.orderedAgentIds).toEqual(["agent-a", "agent-b"]);
    expect(JSON.parse(window.localStorage.getItem(agentRosterOrderStorageKey("workspace-a")) ?? "null")).toEqual({
      version: 1,
      agentIds: ["agent-b", "agent-a"],
    });
    expect(window.localStorage.getItem(agentRosterOrderStorageKey("workspace-b"))).toBeNull();
  });

  it("drops deleted agents and appends new agents in API order", () => {
    expect(reconcileAgentRosterOrder(
      ["agent-deleted", "agent-b", "agent-a"],
      ["agent-a", "agent-b", "agent-c"],
    )).toEqual(["agent-b", "agent-a", "agent-c"]);
  });

  it("keeps hidden agents in place when a filtered subset is reordered", () => {
    expect(mergeVisibleAgentRosterOrder(
      ["agent-a", "agent-offline", "agent-b", "agent-c"],
      ["agent-c", "agent-a", "agent-b"],
    )).toEqual(["agent-c", "agent-offline", "agent-a", "agent-b"]);
  });

  it("moves one agent within a visible order", () => {
    expect(moveAgentInRosterOrder(["agent-a", "agent-b", "agent-c"], "agent-c", -1)).toEqual([
      "agent-a",
      "agent-c",
      "agent-b",
    ]);
    expect(moveAgentInRosterOrder(["agent-a", "agent-b"], "agent-a", -1)).toEqual(["agent-a", "agent-b"]);
  });

  it("normalizes malformed and duplicate stored IDs", () => {
    window.localStorage.setItem(AGENT_ROSTER_ORDER_STORAGE_KEY, JSON.stringify({
      version: 1,
      agentIds: ["agent-b", "", 42, "agent-b", "agent-a"],
    }));
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: AGENT_ROSTER_ORDER_STORAGE_KEY })));

    const { result } = renderHook(() => useAgentRosterOrder(["agent-a", "agent-b", "agent-c"]));
    expect(result.current.orderedAgentIds).toEqual(["agent-b", "agent-a", "agent-c"]);
  });

  it("updates from another browser context", () => {
    const { result } = renderHook(() => useAgentRosterOrder(["agent-a", "agent-b"]));
    window.localStorage.setItem(AGENT_ROSTER_ORDER_STORAGE_KEY, JSON.stringify({
      version: 1,
      agentIds: ["agent-b", "agent-a"],
    }));

    act(() => window.dispatchEvent(new StorageEvent("storage", { key: AGENT_ROSTER_ORDER_STORAGE_KEY })));

    expect(result.current.orderedAgentIds).toEqual(["agent-b", "agent-a"]);
  });

  it("keeps ordering in memory when local storage is unavailable", () => {
    const { result } = renderHook(() => useAgentRosterOrder(["agent-a", "agent-b"]));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    act(() => result.current.setVisibleAgentOrder(["agent-b", "agent-a"]));

    expect(result.current.orderedAgentIds).toEqual(["agent-b", "agent-a"]);
  });
});
