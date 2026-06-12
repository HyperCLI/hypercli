"use client";

import { useEffect, type ReactNode } from "react";
import { initializeTheme, subscribeToThemeChanges } from "../utils/theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    initializeTheme();
    return subscribeToThemeChanges(() => {});
  }, []);

  return <>{children}</>;
}
