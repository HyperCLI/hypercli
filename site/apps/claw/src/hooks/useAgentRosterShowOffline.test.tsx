import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  AGENT_ROSTER_SHOW_OFFLINE_STORAGE_KEY,
  useAgentRosterShowOffline,
} from "./useAgentRosterShowOffline";

describe("useAgentRosterShowOffline", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("shows offline agents by default", () => {
    const hook = renderHook(() => useAgentRosterShowOffline());

    expect(hook.result.current[0]).toBe(true);
  });

  it("persists the offline agent visibility across hook instances", () => {
    const first = renderHook(() => useAgentRosterShowOffline());
    expect(first.result.current[0]).toBe(true);

    act(() => first.result.current[1](false));
    expect(first.result.current[0]).toBe(false);
    expect(window.localStorage.getItem(AGENT_ROSTER_SHOW_OFFLINE_STORAGE_KEY)).toBe("false");

    first.unmount();
    const second = renderHook(() => useAgentRosterShowOffline());
    expect(second.result.current[0]).toBe(false);

    act(() => second.result.current[1](true));
    expect(window.localStorage.getItem(AGENT_ROSTER_SHOW_OFFLINE_STORAGE_KEY)).toBe("true");
  });
});
