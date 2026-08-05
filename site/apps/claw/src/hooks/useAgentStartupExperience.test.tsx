import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  AGENT_STARTUP_EXPERIENCE_STORAGE_KEY,
  useAgentStartupExperience,
} from "./useAgentStartupExperience";

describe("useAgentStartupExperience", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("uses the tips experience by default", () => {
    const hook = renderHook(() => useAgentStartupExperience());

    expect(hook.result.current[0]).toBe("tips");
  });

  it("persists the selected experience across hook instances", () => {
    const first = renderHook(() => useAgentStartupExperience());

    act(() => first.result.current[1]("classic"));
    expect(first.result.current[0]).toBe("classic");
    expect(window.localStorage.getItem(AGENT_STARTUP_EXPERIENCE_STORAGE_KEY)).toBe("classic");

    first.unmount();
    const second = renderHook(() => useAgentStartupExperience());
    expect(second.result.current[0]).toBe("classic");

    act(() => second.result.current[1]("tips"));
    expect(window.localStorage.getItem(AGENT_STARTUP_EXPERIENCE_STORAGE_KEY)).toBe("tips");
  });

  it("falls back to tips for unknown stored values", () => {
    window.localStorage.setItem(AGENT_STARTUP_EXPERIENCE_STORAGE_KEY, "unknown");

    const hook = renderHook(() => useAgentStartupExperience());

    expect(hook.result.current[0]).toBe("tips");
  });

  it("responds to preference changes from another tab", () => {
    const hook = renderHook(() => useAgentStartupExperience());
    window.localStorage.setItem(AGENT_STARTUP_EXPERIENCE_STORAGE_KEY, "classic");

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: AGENT_STARTUP_EXPERIENCE_STORAGE_KEY,
      }));
    });

    expect(hook.result.current[0]).toBe("classic");
  });
});
