import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearOpenClawSessionPins,
  openClawSessionPinsStorageKey,
  useOpenClawSessionPins,
} from "./useOpenClawSessionPins";

describe("useOpenClawSessionPins", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists pinned sessions for the selected agent", () => {
    const first = renderHook(() => useOpenClawSessionPins("agent-1"));

    act(() => first.result.current.setSessionPinned("session-alpha", true));

    expect(first.result.current.pinnedSessionKeys).toEqual(["session-alpha"]);
    expect(JSON.parse(window.localStorage.getItem(openClawSessionPinsStorageKey("agent-1")) ?? "null")).toEqual({
      version: 1,
      sessionKeys: ["session-alpha"],
    });

    first.unmount();
    const restored = renderHook(() => useOpenClawSessionPins("agent-1"));
    expect(restored.result.current.pinnedSessionKeys).toEqual(["session-alpha"]);
  });

  it("isolates pins by agent and unpins scoped aliases", () => {
    const { result, rerender } = renderHook(
      ({ agentId }) => useOpenClawSessionPins(agentId),
      { initialProps: { agentId: "agent-1" } },
    );

    act(() => result.current.setSessionPinned("session-alpha", true));
    rerender({ agentId: "agent-2" });
    expect(result.current.pinnedSessionKeys).toEqual([]);

    act(() => result.current.setSessionPinned("main", true));
    expect(result.current.pinnedSessionKeys).toEqual(["main"]);

    rerender({ agentId: "agent-1" });
    expect(result.current.pinnedSessionKeys).toEqual(["session-alpha"]);
    act(() => result.current.setSessionPinned("agent:default:session-alpha", false));
    expect(result.current.pinnedSessionKeys).toEqual([]);
  });

  it("normalizes malformed and duplicate stored keys", () => {
    window.localStorage.setItem(openClawSessionPinsStorageKey("agent-malformed"), JSON.stringify({
      version: 1,
      sessionKeys: ["session-alpha", "agent:default:session-alpha", "", 42, "main", "agent:default:main"],
    }));

    const { result } = renderHook(() => useOpenClawSessionPins("agent-malformed"));

    expect(result.current.pinnedSessionKeys).toEqual(["session-alpha", "main", "agent:default:main"]);
  });

  it("updates from storage events in another browser context", () => {
    const storageKey = openClawSessionPinsStorageKey("agent-storage-event");
    const { result } = renderHook(() => useOpenClawSessionPins("agent-storage-event"));

    window.localStorage.setItem(storageKey, JSON.stringify({ version: 1, sessionKeys: ["session-beta"] }));
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: storageKey })));

    expect(result.current.pinnedSessionKeys).toEqual(["session-beta"]);
  });

  it("keeps pin changes in memory when local storage is unavailable", () => {
    const { result } = renderHook(() => useOpenClawSessionPins("agent-memory-only"));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    act(() => result.current.setSessionPinned("session-memory", true));

    expect(result.current.pinnedSessionKeys).toEqual(["session-memory"]);
  });

  it("clears all pins for a deleted agent", () => {
    const { result } = renderHook(() => useOpenClawSessionPins("agent-deleted"));
    act(() => result.current.setSessionPinned("session-alpha", true));

    act(() => clearOpenClawSessionPins("agent-deleted"));

    expect(result.current.pinnedSessionKeys).toEqual([]);
    expect(window.localStorage.getItem(openClawSessionPinsStorageKey("agent-deleted"))).toBeNull();
  });
});
