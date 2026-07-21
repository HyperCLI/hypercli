export type Theme = "dark" | "light";

export const DEFAULT_THEME: Theme = "dark";
export const THEME_COOKIE_NAME = "hypercli_color_theme";
export const THEME_STORAGE_KEY = THEME_COOKIE_NAME;
export const LEGACY_THEME_KEY = "hypercli_theme";

const THEME_CHANGE_EVENT = "hypercli-theme-changed";
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
const CONFIGURED_COOKIE_DOMAIN = (process.env.NEXT_PUBLIC_COOKIE_DOMAIN || "").trim();

function normalizeTheme(value: unknown): Theme | null {
  return value === "dark" || value === "light" ? value : null;
}

function normalizeLegacyTheme(value: unknown): Theme | null {
  if (value === "default" || value === "green") return "dark";
  return normalizeTheme(value);
}

function readCookie(name: string, normalize: (value: unknown) => Theme | null): Theme | null {
  if (typeof document === "undefined") return null;

  let cookies: string;
  try {
    cookies = document.cookie;
  } catch {
    return null;
  }

  for (const cookie of cookies.split(";")) {
    const separatorIndex = cookie.indexOf("=");
    if (separatorIndex === -1 || cookie.slice(0, separatorIndex).trim() !== name) continue;

    try {
      const theme = normalize(decodeURIComponent(cookie.slice(separatorIndex + 1).trim()));
      if (theme) return theme;
    } catch {
      // Ignore one malformed cookie and continue checking other cookie scopes.
    }
  }

  return null;
}

function readStorage(name: string, normalize: (value: unknown) => Theme | null): Theme | null {
  if (typeof window === "undefined") return null;

  try {
    return normalize(window.localStorage.getItem(name));
  } catch {
    return null;
  }
}

function writeStorage(theme: Theme): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Cookies remain authoritative when storage is unavailable.
  }
}

function isLocalHostname(hostname: string): boolean {
  const normalizedHostname = hostname.trim().toLowerCase();
  return (
    !normalizedHostname ||
    normalizedHostname === "localhost" ||
    normalizedHostname.endsWith(".localhost") ||
    normalizedHostname === "127.0.0.1" ||
    normalizedHostname === "0.0.0.0" ||
    normalizedHostname === "[::1]" ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalizedHostname) ||
    normalizedHostname.includes(":")
  );
}

function getCookieDomain(): string {
  if (typeof window === "undefined") return "";

  try {
    const hostname = window.location.hostname.trim().toLowerCase();
    if (isLocalHostname(hostname)) return "";

    const configuredDomain = CONFIGURED_COOKIE_DOMAIN.toLowerCase().replace(/^\.+/, "");
    if (!configuredDomain || configuredDomain === "localhost") return "";
    if (hostname !== configuredDomain && !hostname.endsWith(`.${configuredDomain}`)) return "";

    return `.${configuredDomain}`;
  } catch {
    return "";
  }
}

function writeCookie(theme: Theme): void {
  if (typeof document === "undefined") return;

  let domain = "";
  let secure = "";
  if (typeof window !== "undefined") {
    const cookieDomain = getCookieDomain();
    domain = cookieDomain ? `; Domain=${cookieDomain}` : "";
    try {
      secure = window.location.protocol === "https:" ? "; Secure" : "";
    } catch {
      secure = "";
    }
  }

  try {
    document.cookie = `${THEME_COOKIE_NAME}=${theme}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${domain}${secure}`;
  } catch {
    // The DOM theme and same-tab event still update when cookies are blocked.
  }
}

function readAppliedTheme(): Theme | null {
  if (typeof document === "undefined") return null;
  return normalizeTheme(document.documentElement.getAttribute("data-theme"));
}

function persistTheme(theme: Theme): void {
  writeCookie(theme);
  writeStorage(theme);
}

function notifyThemeChange(theme: Theme): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme } }));
}

/**
 * Read the current preference, with the shared domain cookie as the source of truth.
 * Legacy cookie and storage values are migrated to the canonical key on first read.
 */
export function getTheme(): Theme {
  const cookieTheme = readCookie(THEME_COOKIE_NAME, normalizeTheme);
  if (cookieTheme) {
    writeStorage(cookieTheme);
    return cookieTheme;
  }

  const legacyCookieTheme = readCookie(LEGACY_THEME_KEY, normalizeLegacyTheme);
  if (legacyCookieTheme) {
    persistTheme(legacyCookieTheme);
    return legacyCookieTheme;
  }

  const storedTheme = readStorage(THEME_STORAGE_KEY, normalizeTheme);
  if (storedTheme) {
    persistTheme(storedTheme);
    return storedTheme;
  }

  const legacyStoredTheme = readStorage(LEGACY_THEME_KEY, normalizeLegacyTheme);
  if (legacyStoredTheme) {
    persistTheme(legacyStoredTheme);
    return legacyStoredTheme;
  }

  const theme = readAppliedTheme() ?? DEFAULT_THEME;
  persistTheme(theme);
  return theme;
}

/** Apply a theme immediately, independently of cookie or storage availability. */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const normalizedTheme = normalizeTheme(theme) ?? DEFAULT_THEME;

  document.documentElement.setAttribute("data-theme", normalizedTheme);
  document.documentElement.style.colorScheme = normalizedTheme;
  document.body?.setAttribute("data-theme", normalizedTheme);
}

/** Apply and persist a preference, then notify subscribers in the current tab. */
export function setTheme(theme: Theme): void {
  const normalizedTheme = normalizeTheme(theme) ?? DEFAULT_THEME;
  applyTheme(normalizedTheme);
  persistTheme(normalizedTheme);
  notifyThemeChange(normalizedTheme);
}

export function initializeTheme(): Theme {
  const theme = getTheme();
  applyTheme(theme);
  return theme;
}

export function toggleTheme(): Theme {
  const nextTheme: Theme = getTheme() === "light" ? "dark" : "light";
  setTheme(nextTheme);
  return nextTheme;
}

/**
 * Subscribe to same-tab changes and resynchronize when browser lifecycle events
 * can reveal a cookie update made by another app or tab.
 */
export function subscribeToThemeChanges(callback: (theme: Theme) => void): () => void {
  if (typeof window === "undefined") return () => {};

  let lastKnownTheme = getTheme();

  const synchronize = (candidate?: Theme) => {
    const theme = candidate ?? getTheme();
    if (theme === lastKnownTheme) return;

    lastKnownTheme = theme;
    applyTheme(theme);
    callback(theme);
  };

  const handleThemeChange = (event: Event) => {
    const theme = normalizeTheme((event as CustomEvent<{ theme?: unknown }>).detail?.theme);
    synchronize(theme ?? undefined);
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY || event.key === LEGACY_THEME_KEY) synchronize();
  };
  const handleFocus = () => synchronize();
  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") synchronize();
  };
  const handlePageShow = () => synchronize();

  window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);
  window.addEventListener("storage", handleStorage);
  window.addEventListener("focus", handleFocus);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("pageshow", handlePageShow);

  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener("focus", handleFocus);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("pageshow", handlePageShow);
  };
}
