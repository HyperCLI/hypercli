export type ClawTheme = "default" | "green" | "purple";

export const DEFAULT_CLAW_THEME: ClawTheme = "green";
export const CLAW_THEME_STORAGE_KEY = "claw_theme";
export const CLAW_THEME_COOKIE_NAME = "claw_theme";
export const CLAW_THEME_CHANGE_EVENT = "claw-theme-change";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const CLAW_THEMES: readonly ClawTheme[] = ["default", "green", "purple"];

export function isClawTheme(value: unknown): value is ClawTheme {
  return typeof value === "string" && CLAW_THEMES.includes(value as ClawTheme);
}

function setThemeCookie(theme: ClawTheme): void {
  if (typeof document === "undefined") return;

  document.cookie = `${CLAW_THEME_COOKIE_NAME}=${encodeURIComponent(theme)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

export function getClawTheme(): ClawTheme {
  return DEFAULT_CLAW_THEME;
}

export function getAppliedClawTheme(): ClawTheme {
  if (typeof document !== "undefined") {
    const appliedTheme = document.documentElement.getAttribute("data-theme");
    if (isClawTheme(appliedTheme)) return appliedTheme;
  }

  return getClawTheme();
}

export function applyClawTheme(theme: ClawTheme): void {
  if (typeof document === "undefined") return;

  void theme;
  document.documentElement.setAttribute("data-theme", DEFAULT_CLAW_THEME);
  document.body?.setAttribute("data-theme", DEFAULT_CLAW_THEME);
}

export function setClawTheme(theme: ClawTheme): void {
  void theme;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(CLAW_THEME_STORAGE_KEY, DEFAULT_CLAW_THEME);
    } catch {
      // Ignore storage failures; the DOM theme still applies for the session.
    }
  }

  setThemeCookie(DEFAULT_CLAW_THEME);
  applyClawTheme(DEFAULT_CLAW_THEME);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CLAW_THEME_CHANGE_EVENT, { detail: { theme: DEFAULT_CLAW_THEME } }));
  }
}

export function initializeClawTheme(): ClawTheme {
  const theme = getClawTheme();
  applyClawTheme(theme);
  return theme;
}

export function subscribeToClawThemeChanges(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const handleThemeChange = () => {
    callback();
  };

  const handleStorageChange = (event: StorageEvent) => {
    if (event.key !== CLAW_THEME_STORAGE_KEY) return;
    applyClawTheme(getClawTheme());
    callback();
  };

  window.addEventListener(CLAW_THEME_CHANGE_EVENT, handleThemeChange);
  window.addEventListener("storage", handleStorageChange);

  return () => {
    window.removeEventListener(CLAW_THEME_CHANGE_EVENT, handleThemeChange);
    window.removeEventListener("storage", handleStorageChange);
  };
}

export function getClawThemeBootstrapScript(): string {
  return `(function(){try{var theme=${JSON.stringify(DEFAULT_CLAW_THEME)};var applyBody=function(){if(document.body){document.body.setAttribute("data-theme",theme);}};document.documentElement.setAttribute("data-theme",theme);applyBody();if(!document.body){document.addEventListener("DOMContentLoaded",applyBody,{once:true});}}catch(e){}})();`;
}
