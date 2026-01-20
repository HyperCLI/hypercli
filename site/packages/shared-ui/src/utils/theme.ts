/**
 * Shared theme utilities for cross-app theme synchronization
 * Uses cookies to share theme preference across apps on different ports
 */

export type Theme = "light" | "dark";

const THEME_KEY = "hypercli_theme";
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // 1 year in seconds

/**
 * Get theme from cookie (works across ports/subdomains)
 */
function getThemeFromCookie(): Theme | null {
  if (typeof document === "undefined") return null;
  
  const match = document.cookie.match(new RegExp(`(^| )${THEME_KEY}=([^;]+)`));
  if (match) {
    const value = match[2];
    if (value === "light" || value === "dark") {
      return value;
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
  document.cookie = `${THEME_KEY}=${theme}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

/**
 * Get current theme preference
 * Priority: cookie > localStorage > system preference > dark
 */
export function getTheme(): Theme {
  // Try cookie first (for cross-app sync)
  const cookieTheme = getThemeFromCookie();
  if (cookieTheme) return cookieTheme;
  
  // Fall back to localStorage
  if (typeof localStorage !== "undefined") {
    const localTheme = localStorage.getItem(THEME_KEY) as Theme | null;
    if (localTheme === "light" || localTheme === "dark") {
      // Sync to cookie for cross-app consistency
      setThemeCookie(localTheme);
      return localTheme;
    }
  }
  
  // Default to dark
  return "dark";
}

/**
 * Set theme preference (updates both cookie and localStorage)
 */
export function setTheme(theme: Theme): void {
  // Update cookie for cross-app sync
  setThemeCookie(theme);
  
  // Also update localStorage for same-origin storage events
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(THEME_KEY, theme);
  }
}

/**
 * Apply theme to document
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  
  document.documentElement.setAttribute("data-theme", theme);
  document.body.setAttribute("data-theme", theme);
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
  const newTheme: Theme = currentTheme === "light" ? "dark" : "light";
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
      const newTheme = e.newValue as Theme;
      if (newTheme === "light" || newTheme === "dark") {
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
