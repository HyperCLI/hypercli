import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  AGENT_ROSTER_COLLAPSED_STORAGE_KEY,
  useAgentRosterCollapsed,
} from "./useAgentRosterCollapsed";

describe("useAgentRosterCollapsed", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists the collapsed state across hook instances", () => {
    const first = renderHook(() => useAgentRosterCollapsed());
    expect(first.result.current[0]).toBe(false);

    act(() => first.result.current[1](true));
    expect(first.result.current[0]).toBe(true);
    expect(window.localStorage.getItem(AGENT_ROSTER_COLLAPSED_STORAGE_KEY)).toBe("true");

    first.unmount();
    const second = renderHook(() => useAgentRosterCollapsed());
    expect(second.result.current[0]).toBe(true);
  });
});
