import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_DASHBOARD_DESKTOP_MEDIA_QUERY,
  AGENT_DASHBOARD_PHONE_INPUT_MEDIA_QUERY,
  resolveAgentDashboardDesktopViewport,
  useAgentDashboardDesktopViewport,
} from "./useAgentDashboardViewport";

const originalMatchMedia = window.matchMedia;
const originalScreenWidth = window.screen.width;
const originalScreenHeight = window.screen.height;

function setScreenSize(width: number, height: number) {
  Object.defineProperties(window.screen, {
    width: { configurable: true, value: width },
    height: { configurable: true, value: height },
  });
}

afterEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
  setScreenSize(originalScreenWidth, originalScreenHeight);
});

describe("useAgentDashboardDesktopViewport", () => {
  it("server-renders the mobile layout before viewport hydration", () => {
    function ViewportProbe() {
      return <span>{useAgentDashboardDesktopViewport() ? "desktop" : "mobile"}</span>;
    }

    expect(renderToString(<ViewportProbe />)).toContain("mobile");
  });

  it("keeps short landscape phones and 640px tablets on the mobile layout", () => {
    expect(AGENT_DASHBOARD_DESKTOP_MEDIA_QUERY).toBe(
      "(min-width: 1024px), (min-width: 768px) and (min-height: 500px)",
    );
    expect(resolveAgentDashboardDesktopViewport({
      desktopMediaMatches: false,
      phoneInputMatches: true,
      screenWidth: 412,
      screenHeight: 915,
    })).toBe(false);
    expect(resolveAgentDashboardDesktopViewport({
      desktopMediaMatches: false,
      phoneInputMatches: true,
      screenWidth: 640,
      screenHeight: 1024,
    })).toBe(false);
  });

  it("overrides a forced desktop canvas on a coarse-touch phone", () => {
    expect(resolveAgentDashboardDesktopViewport({
      desktopMediaMatches: true,
      phoneInputMatches: true,
      screenWidth: 412,
      screenHeight: 915,
    })).toBe(false);
  });

  it("upgrades to desktop after hydration and reacts to viewport changes", () => {
    let desktopMatches = false;
    const listeners = new Map<string, Set<() => void>>([
      [AGENT_DASHBOARD_DESKTOP_MEDIA_QUERY, new Set()],
      [AGENT_DASHBOARD_PHONE_INPUT_MEDIA_QUERY, new Set()],
    ]);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn((query: string) => ({
        get matches() {
          return query === AGENT_DASHBOARD_DESKTOP_MEDIA_QUERY ? desktopMatches : false;
        },
        media: query,
        onchange: null,
        addEventListener: (_type: string, listener: () => void) => listeners.get(query)?.add(listener),
        removeEventListener: (_type: string, listener: () => void) => listeners.get(query)?.delete(listener),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      } satisfies MediaQueryList)),
    });
    setScreenSize(1440, 1024);
    const onDesktop = vi.fn();

    const { result } = renderHook(() => useAgentDashboardDesktopViewport(onDesktop));
    expect(result.current).toBe(false);

    act(() => {
      desktopMatches = true;
      listeners.get(AGENT_DASHBOARD_DESKTOP_MEDIA_QUERY)?.forEach((listener) => listener());
    });

    expect(result.current).toBe(true);
    expect(onDesktop).toHaveBeenCalledTimes(1);
  });
});
