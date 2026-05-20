import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CLAW_THEME_CHANGE_EVENT,
  CLAW_THEME_STORAGE_KEY,
  applyClawTheme,
  getClawTheme,
  initializeClawTheme,
  isClawTheme,
  setClawTheme,
} from "./claw-theme";

function clearThemeCookie() {
  document.cookie = "claw_theme=; path=/; max-age=0";
}

describe("claw theme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearThemeCookie();
    document.documentElement.removeAttribute("data-theme");
    document.body.removeAttribute("data-theme");
  });

  it("validates supported Claw themes", () => {
    expect(isClawTheme("default")).toBe(true);
    expect(isClawTheme("green")).toBe(true);
    expect(isClawTheme("purple")).toBe(true);
    expect(isClawTheme("light")).toBe(false);
    expect(isClawTheme("blue")).toBe(false);
  });

  it("falls back to default without a stored theme", () => {
    expect(getClawTheme()).toBe("default");
  });

  it("reads a valid stored theme and ignores invalid values", () => {
    window.localStorage.setItem(CLAW_THEME_STORAGE_KEY, "green");
    expect(getClawTheme()).toBe("green");

    window.localStorage.setItem(CLAW_THEME_STORAGE_KEY, "blue");
    expect(getClawTheme()).toBe("default");
  });

  it("applies the theme to html and body", () => {
    applyClawTheme("purple");

    expect(document.documentElement).toHaveAttribute("data-theme", "purple");
    expect(document.body).toHaveAttribute("data-theme", "purple");
  });

  it("persists, applies, and announces theme changes", () => {
    const listener = vi.fn();
    window.addEventListener(CLAW_THEME_CHANGE_EVENT, listener);

    setClawTheme("green");

    expect(window.localStorage.getItem(CLAW_THEME_STORAGE_KEY)).toBe("green");
    expect(document.cookie).toContain("claw_theme=green");
    expect(document.documentElement).toHaveAttribute("data-theme", "green");
    expect(document.body).toHaveAttribute("data-theme", "green");
    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener(CLAW_THEME_CHANGE_EVENT, listener);
  });

  it("initializes from the persisted theme", () => {
    window.localStorage.setItem(CLAW_THEME_STORAGE_KEY, "purple");

    expect(initializeClawTheme()).toBe("purple");
    expect(document.documentElement).toHaveAttribute("data-theme", "purple");
    expect(document.body).toHaveAttribute("data-theme", "purple");
  });
});
