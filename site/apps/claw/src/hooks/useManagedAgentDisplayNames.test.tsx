import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearManagedAgentDisplayNames,
  managedAgentDisplayNameScope,
  managedAgentDisplayNamesStorageKey,
  useManagedAgentDisplayNames,
} from "./useManagedAgentDisplayNames";

describe("useManagedAgentDisplayNames", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearManagedAgentDisplayNames("user-a");
    clearManagedAgentDisplayNames("user-b");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists trimmed display names and removes blank values", () => {
    const storageKey = managedAgentDisplayNamesStorageKey("user-a");
    const first = renderHook(() => useManagedAgentDisplayNames("user-a"));

    act(() => first.result.current.setDisplayName("agent-1", "  Research Pilot  "));

    expect(first.result.current.displayNamesByAgentId).toEqual({ "agent-1": "Research Pilot" });
    expect(JSON.parse(window.localStorage.getItem(storageKey!) ?? "null")).toEqual({
      version: 1,
      displayNames: { "agent-1": "Research Pilot" },
    });

    first.unmount();
    const restored = renderHook(() => useManagedAgentDisplayNames("user-a"));
    expect(restored.result.current.displayNamesByAgentId).toEqual({ "agent-1": "Research Pilot" });

    act(() => restored.result.current.setDisplayName("agent-1", "   "));
    expect(restored.result.current.displayNamesByAgentId).toEqual({});
    expect(window.localStorage.getItem(storageKey!)).toBeNull();
  });

  it("keeps aliases isolated by account scope", () => {
    const userA = renderHook(() => useManagedAgentDisplayNames("user-a"));
    const userB = renderHook(() => useManagedAgentDisplayNames("user-b"));

    act(() => userA.result.current.setDisplayName("agent-1", "Research Pilot"));

    expect(userA.result.current.displayNamesByAgentId).toEqual({ "agent-1": "Research Pilot" });
    expect(userB.result.current.displayNamesByAgentId).toEqual({});
  });

  it("filters malformed and version-mismatched storage", () => {
    const storageKey = managedAgentDisplayNamesStorageKey("user-a")!;
    window.localStorage.setItem(storageKey, JSON.stringify({
      version: 1,
      displayNames: { " agent-1 ": "  Research Pilot  ", blank: "", invalid: 42 },
    }));
    const { result } = renderHook(() => useManagedAgentDisplayNames("user-a"));

    expect(result.current.displayNamesByAgentId).toEqual({ "agent-1": "Research Pilot" });

    window.localStorage.setItem(storageKey, JSON.stringify({ version: 2, displayNames: { "agent-1": "Ignored" } }));
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: storageKey })));
    expect(result.current.displayNamesByAgentId).toEqual({});
  });

  it("synchronizes same-tab and cross-tab updates", () => {
    const storageKey = managedAgentDisplayNamesStorageKey("user-a")!;
    const first = renderHook(() => useManagedAgentDisplayNames("user-a"));
    const second = renderHook(() => useManagedAgentDisplayNames("user-a"));

    act(() => first.result.current.setDisplayName("agent-1", "Research Pilot"));
    expect(second.result.current.displayNamesByAgentId).toEqual({ "agent-1": "Research Pilot" });

    window.localStorage.setItem(storageKey, JSON.stringify({
      version: 1,
      displayNames: { "agent-1": "Marketing" },
    }));
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: storageKey })));
    expect(first.result.current.displayNamesByAgentId).toEqual({ "agent-1": "Marketing" });
  });

  it("keeps aliases in memory when local storage writes fail", () => {
    const { result } = renderHook(() => useManagedAgentDisplayNames("user-a"));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    act(() => result.current.setDisplayName("agent-1", "Research Pilot"));

    expect(result.current.displayNamesByAgentId).toEqual({ "agent-1": "Research Pilot" });
  });

  it("does not create an unscoped alias store", () => {
    const { result } = renderHook(() => useManagedAgentDisplayNames(null));

    act(() => result.current.setDisplayName("agent-1", "Research Pilot"));

    expect(result.current.displayNamesByAgentId).toEqual({});
    expect(window.localStorage.length).toBe(0);
  });

  it("uses a stable account ID and avoids the shared stored-session placeholder", () => {
    expect(managedAgentDisplayNameScope({ id: "user-123", email: "person@example.com" })).toBe("id:user-123");
    expect(managedAgentDisplayNameScope({ id: "stored-session", email: "Person@Example.com" })).toBe("email:person@example.com");
    expect(managedAgentDisplayNameScope(null)).toBeNull();
  });
});
