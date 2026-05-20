import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { ClawThemePicker } from "./ClawThemePicker";
import { CLAW_THEME_STORAGE_KEY, applyClawTheme } from "@/lib/claw-theme";

function clearThemeCookie() {
  document.cookie = "claw_theme=; path=/; max-age=0";
}

describe("ClawThemePicker", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearThemeCookie();
    applyClawTheme("default");
  });

  it("opens the theme menu and shows all theme choices", () => {
    render(<ClawThemePicker />);

    fireEvent.click(screen.getByRole("button", { name: "Theme: Default" }));

    expect(screen.getByRole("menu", { name: "Theme" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /default/i })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: /green/i })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("menuitemradio", { name: /purple/i })).toHaveAttribute("aria-checked", "false");
  });

  it("can align the theme menu from the start edge", () => {
    render(<ClawThemePicker menuAlign="start" />);

    fireEvent.click(screen.getByRole("button", { name: "Theme: Default" }));

    expect(screen.getByRole("menu", { name: "Theme" })).toHaveClass("left-0");
    expect(screen.getByRole("menu", { name: "Theme" })).not.toHaveClass("right-0");
  });

  it("selects and persists a theme", () => {
    render(<ClawThemePicker />);

    fireEvent.click(screen.getByRole("button", { name: "Theme: Default" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /purple/i }));

    expect(document.documentElement).toHaveAttribute("data-theme", "purple");
    expect(document.body).toHaveAttribute("data-theme", "purple");
    expect(window.localStorage.getItem(CLAW_THEME_STORAGE_KEY)).toBe("purple");
    expect(screen.getByRole("button", { name: "Theme: Purple" })).toBeInTheDocument();
    expect(screen.queryByRole("menu", { name: "Theme" })).not.toBeInTheDocument();
  });

  it("reflects an externally applied theme", async () => {
    render(<ClawThemePicker />);

    await act(async () => {
      window.localStorage.setItem(CLAW_THEME_STORAGE_KEY, "green");
      window.dispatchEvent(new StorageEvent("storage", { key: CLAW_THEME_STORAGE_KEY, newValue: "green" }));
    });

    expect(screen.getByRole("button", { name: "Theme: Green" })).toBeInTheDocument();
  });
});
