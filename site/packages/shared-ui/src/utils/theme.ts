/**
 * Shared theme utilities for cross-app theme synchronization
 * Uses cookies to share theme preference across apps on different ports
 */

export type Theme = "default" | "dark" | "light";

const DEFAULT_THEME: Theme = "default";
const LEGACY_THEME_ALIASES: Record<string, Theme> = {
  green: DEFAULT_THEME,
};

const THEME_KEY = "hypercli_theme";
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // 1 year in seconds

function normalizeTheme(value: string | null | undefined): Theme | null {
  if (!value) return null;
  if (value === "default" || value === "dark" || value === "light") return value;
  return LEGACY_THEME_ALIASES[value] ?? null;
}

/**
 * Get theme from cookie (works across ports/subdomains)
 */
function getThemeFromCookie(): Theme | null {
  if (typeof document === "undefined") return null;

  const match = document.cookie.match(new RegExp(`(^| )${THEME_KEY}=([^;]+)`));
  if (match) {
    try {
      return normalizeTheme(decodeURIComponent(match[2]));
    } catch {
      return normalizeTheme(match[2]);
    }
  }
  return null;
}

/**
 * Set theme in cookie (accessible across ports in dev, subdomains in prod)
 */
function setThemeCookie(theme: Theme): void {
  if (typeof document === "undefined") return;

  // Set cookie with path=/ so it's accessible across all paths
  // In production, you might want to add domain=.hypercli.com for subdomain sharing
  document.cookie = `${THEME_KEY}=${encodeURIComponent(theme)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

/**
 * Get current theme preference
 * Priority: cookie > localStorage > default product theme
 */
export function getTheme(): Theme {
  // Try cookie first (for cross-app sync)
  const cookieTheme = getThemeFromCookie();
  if (cookieTheme) return cookieTheme;

  // Fall back to localStorage
  if (typeof localStorage !== "undefined") {
    const localTheme = normalizeTheme(localStorage.getItem(THEME_KEY));
    if (localTheme) {
      // Sync to cookie for cross-app consistency
      setThemeCookie(localTheme);
      return localTheme;
    }
  }

  return DEFAULT_THEME;
}

/**
 * Set theme preference (updates both cookie and localStorage)
 */
export function setTheme(theme: Theme): void {
  const normalizedTheme = normalizeTheme(theme) ?? DEFAULT_THEME;

  // Update cookie for cross-app sync
  setThemeCookie(normalizedTheme);

  // Also update localStorage for same-origin storage events
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(THEME_KEY, normalizedTheme);
  }
}

/**
 * Apply theme to document
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const normalizedTheme = normalizeTheme(theme) ?? DEFAULT_THEME;

  document.documentElement.setAttribute("data-theme", normalizedTheme);
  document.body?.setAttribute("data-theme", normalizedTheme);
}

/**
 * Initialize theme on page load
 * Returns the current theme
 */
export function initializeTheme(): Theme {
  const theme = getTheme();
  applyTheme(theme);
  return theme;
}

/**
 * Toggle theme and return new theme
 */
export function toggleTheme(): Theme {
  const currentTheme = getTheme();
  const newTheme: Theme = currentTheme === "light" ? DEFAULT_THEME : "light";
  setTheme(newTheme);
  applyTheme(newTheme);
  return newTheme;
}

/**
 * Listen for theme changes from other tabs/windows (same origin)
 * Also periodically checks cookie for cross-origin changes
 */
export function subscribeToThemeChanges(callback: (theme: Theme) => void): () => void {
  // Listen for localStorage changes (same origin, different tab)
  const handleStorageChange = (e: StorageEvent) => {
    if (e.key === THEME_KEY && e.newValue) {
      const newTheme = normalizeTheme(e.newValue);
      if (newTheme) {
        lastKnownTheme = newTheme;
        applyTheme(newTheme);
        callback(newTheme);
      }
    }
  };

  // Periodically check cookie for cross-origin changes (when tab gains focus)
  let lastKnownTheme = getTheme();

  const handleFocus = () => {
    const currentTheme = getTheme();
    if (currentTheme !== lastKnownTheme) {
      lastKnownTheme = currentTheme;
      applyTheme(currentTheme);
      callback(currentTheme);
    }
  };

  // Also check on visibility change (tab becomes visible)
  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      handleFocus();
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  // Return cleanup function
  return () => {
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    }
  };
}
