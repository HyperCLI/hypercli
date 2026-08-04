export type ThemeMode = "dark" | "light";
export type ThemeFamily = "classic" | "aurora";
export type Theme = ThemeMode | `aurora-${ThemeMode}`;

export interface ThemeDefinition {
  value: Theme;
  family: ThemeFamily;
  mode: ThemeMode;
  label: string;
}

export const THEME_DEFINITIONS = [
  { value: "light", family: "classic", mode: "light", label: "Classic Light" },
  { value: "dark", family: "classic", mode: "dark", label: "Classic Dark" },
  { value: "aurora-light", family: "aurora", mode: "light", label: "Aurora Light" },
  { value: "aurora-dark", family: "aurora", mode: "dark", label: "Aurora Dark" },
] as const satisfies readonly ThemeDefinition[];

export const DEFAULT_THEME: Theme = "aurora-dark";
export const THEME_COOKIE_NAME = "hypercli_color_theme";
export const THEME_STORAGE_KEY = THEME_COOKIE_NAME;
export const THEME_FAMILY_COOKIE_NAME = "hypercli_theme_family";
export const THEME_FAMILY_STORAGE_KEY = THEME_FAMILY_COOKIE_NAME;
export const LEGACY_THEME_KEY = "hypercli_theme";

const THEME_CHANGE_EVENT = "hypercli-theme-changed";
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
const CONFIGURED_COOKIE_DOMAIN = (process.env.NEXT_PUBLIC_COOKIE_DOMAIN || "").trim();

export function normalizeTheme(value: unknown): Theme | null {
  return THEME_DEFINITIONS.some((theme) => theme.value === value) ? value as Theme : null;
}

export function normalizeThemeMode(value: unknown): ThemeMode | null {
  return value === "dark" || value === "light" ? value : null;
}

export function normalizeThemeFamily(value: unknown): ThemeFamily | null {
  return value === "classic" || value === "aurora" ? value : null;
}

function normalizeLegacyTheme(value: unknown): Theme | null {
  if (value === "default" || value === "green") return "dark";
  return normalizeTheme(value);
}

export function getThemeMode(theme: Theme): ThemeMode {
  return theme === "light" || theme === "aurora-light" ? "light" : "dark";
}

export function getThemeFamily(theme: Theme): ThemeFamily {
  return theme.startsWith("aurora-") ? "aurora" : "classic";
}

export function composeTheme(family: ThemeFamily, mode: ThemeMode): Theme {
  return family === "aurora" ? `aurora-${mode}` : mode;
}

export function withThemeMode(theme: Theme, mode: ThemeMode): Theme {
  return composeTheme(getThemeFamily(theme), mode);
}

export function withThemeFamily(theme: Theme, family: ThemeFamily): Theme {
  return composeTheme(family, getThemeMode(theme));
}

export function getPairedTheme(theme: Theme): Theme {
  return withThemeMode(theme, getThemeMode(theme) === "light" ? "dark" : "light");
}

function readCookie<T>(name: string, normalize: (value: unknown) => T | null): T | null {
  if (typeof document === "undefined") return null;

  let cookies: string;
  try {
    cookies = document.cookie;
  } catch {
    return null;
  }

  let resolved: T | null = null;
  for (const cookie of cookies.split(";")) {
    const separatorIndex = cookie.indexOf("=");
    if (separatorIndex === -1 || cookie.slice(0, separatorIndex).trim() !== name) continue;

    try {
      const value = normalize(decodeURIComponent(cookie.slice(separatorIndex + 1).trim()));
      if (value !== null) resolved = value;
    } catch {
      // Ignore one malformed cookie and continue checking other cookie scopes.
    }
  }

  return resolved;
}

function readStorage<T>(name: string, normalize: (value: unknown) => T | null): T | null {
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
    window.localStorage.setItem(THEME_STORAGE_KEY, getThemeMode(theme));
    window.localStorage.setItem(THEME_FAMILY_STORAGE_KEY, getThemeFamily(theme));
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

function writeCookie(name: string, value: string): void {
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
    if (domain) {
      document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
    }
    document.cookie = `${name}=${value}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${domain}${secure}`;
  } catch {
    // The DOM theme and same-tab event still update when cookies are blocked.
  }
}

function readAppliedTheme(): Theme | null {
  if (typeof document === "undefined") return null;
  return normalizeTheme(document.documentElement.getAttribute("data-theme"));
}

function persistTheme(theme: Theme): void {
  writeCookie(THEME_COOKIE_NAME, getThemeMode(theme));
  writeCookie(THEME_FAMILY_COOKIE_NAME, getThemeFamily(theme));
  writeStorage(theme);
}

function notifyThemeChange(theme: Theme): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme } }));
}

/**
 * Read the current preference, with shared domain cookies as the source of truth.
 * Mode and visual family are persisted separately so older apps can still honor mode.
 */
export function getTheme(): Theme {
  const canonicalCookieTheme = readCookie(THEME_COOKIE_NAME, normalizeTheme);
  const canonicalCookieMode = canonicalCookieTheme
    ? getThemeMode(canonicalCookieTheme)
    : readCookie(THEME_COOKIE_NAME, normalizeThemeMode);
  const legacyCookieTheme = readCookie(LEGACY_THEME_KEY, normalizeLegacyTheme);
  const canonicalStoredTheme = readStorage(THEME_STORAGE_KEY, normalizeTheme);
  const canonicalStoredMode = canonicalStoredTheme
    ? getThemeMode(canonicalStoredTheme)
    : readStorage(THEME_STORAGE_KEY, normalizeThemeMode);
  const legacyStoredTheme = readStorage(LEGACY_THEME_KEY, normalizeLegacyTheme);
  const appliedTheme = readAppliedTheme();

  const mode =
    canonicalCookieMode ??
    (legacyCookieTheme ? getThemeMode(legacyCookieTheme) : null) ??
    canonicalStoredMode ??
    (legacyStoredTheme ? getThemeMode(legacyStoredTheme) : null) ??
    (appliedTheme ? getThemeMode(appliedTheme) : null) ??
    getThemeMode(DEFAULT_THEME);
  const theme = composeTheme("aurora", mode);

  persistTheme(theme);
  return theme;
}

/** Apply a theme immediately, independently of cookie or storage availability. */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const requestedTheme = normalizeTheme(theme) ?? DEFAULT_THEME;
  const normalizedTheme = composeTheme("aurora", getThemeMode(requestedTheme));
  const mode = getThemeMode(normalizedTheme);

  document.documentElement.setAttribute("data-theme", normalizedTheme);
  document.documentElement.setAttribute("data-color-mode", mode);
  document.documentElement.style.colorScheme = mode;
  document.body?.setAttribute("data-theme", normalizedTheme);
  document.body?.setAttribute("data-color-mode", mode);
}

/** Apply and persist a preference, then notify subscribers in the current tab. */
export function setTheme(theme: Theme): void {
  const requestedTheme = normalizeTheme(theme) ?? DEFAULT_THEME;
  const normalizedTheme = composeTheme("aurora", getThemeMode(requestedTheme));
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
  const nextTheme = getPairedTheme(getTheme());
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
    if (
      event.key === THEME_STORAGE_KEY ||
      event.key === THEME_FAMILY_STORAGE_KEY ||
      event.key === LEGACY_THEME_KEY
    ) {
      synchronize();
    }
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
