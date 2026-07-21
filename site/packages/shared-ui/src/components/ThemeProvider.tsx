"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import {
  DEFAULT_THEME,
  getTheme,
  initializeTheme,
  setTheme,
  subscribeToThemeChanges,
  toggleTheme,
  type Theme,
} from "../utils/theme";

export interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => Theme;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function subscribeToThemeStore(onStoreChange: () => void): () => void {
  initializeTheme();
  return subscribeToThemeChanges(onStoreChange);
}

function getServerTheme(): Theme {
  return DEFAULT_THEME;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribeToThemeStore, getTheme, getServerTheme);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within a ThemeProvider");
  return context;
}
