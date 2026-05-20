"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  DEFAULT_CLAW_THEME,
  getAppliedClawTheme,
  setClawTheme,
  subscribeToClawThemeChanges,
  type ClawTheme,
} from "@/lib/claw-theme";

export function useClawTheme() {
  const theme = useSyncExternalStore(
    subscribeToClawThemeChanges,
    getAppliedClawTheme,
    () => DEFAULT_CLAW_THEME,
  );

  const setTheme = useCallback((nextTheme: ClawTheme) => {
    setClawTheme(nextTheme);
  }, []);

  return { theme, setTheme };
}
