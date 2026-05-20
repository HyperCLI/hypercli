export type ClawTheme = "default" | "green" | "purple";

export const DEFAULT_CLAW_THEME: ClawTheme = "default";
export const CLAW_THEME_STORAGE_KEY = "claw_theme";
export const CLAW_THEME_COOKIE_NAME = "claw_theme";
export const CLAW_THEME_CHANGE_EVENT = "claw-theme-change";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const CLAW_THEMES: readonly ClawTheme[] = ["default", "green", "purple"];

export function isClawTheme(value: unknown): value is ClawTheme {
  return typeof value === "string" && CLAW_THEMES.includes(value as ClawTheme);
}

function getThemeFromCookie(): ClawTheme | null {
  if (typeof document === "undefined") return null;

  const value = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${CLAW_THEME_COOKIE_NAME}=`))
    ?.split("=")[1];

  if (!value) return null;

  try {
    const decodedValue = decodeURIComponent(value);
    return isClawTheme(decodedValue) ? decodedValue : null;
  } catch {
    return isClawTheme(value) ? value : null;
  }
}

function setThemeCookie(theme: ClawTheme): void {
  if (typeof document === "undefined") return;

  document.cookie = `${CLAW_THEME_COOKIE_NAME}=${encodeURIComponent(theme)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

function getThemeFromStorage(): ClawTheme | null {
  if (typeof window === "undefined") return null;

  try {
    const storedTheme = window.localStorage.getItem(CLAW_THEME_STORAGE_KEY);
    return isClawTheme(storedTheme) ? storedTheme : null;
  } catch {
    return null;
  }
}

export function getClawTheme(): ClawTheme {
  return getThemeFromStorage() ?? getThemeFromCookie() ?? DEFAULT_CLAW_THEME;
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

  document.documentElement.setAttribute("data-theme", theme);
  document.body?.setAttribute("data-theme", theme);
}

export function setClawTheme(theme: ClawTheme): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(CLAW_THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage failures; the DOM theme still applies for the session.
    }
  }

  setThemeCookie(theme);
  applyClawTheme(theme);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CLAW_THEME_CHANGE_EVENT, { detail: { theme } }));
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
  const themes = JSON.stringify(CLAW_THEMES);

  return `(function(){try{var key=${JSON.stringify(CLAW_THEME_STORAGE_KEY)};var cookie=${JSON.stringify(CLAW_THEME_COOKIE_NAME)};var fallback=${JSON.stringify(DEFAULT_CLAW_THEME)};var themes=${themes};var allowed=function(value){return themes.indexOf(value)!==-1;};var readCookie=function(){var prefix=cookie+"=";var rows=document.cookie?document.cookie.split("; "):[];for(var i=0;i<rows.length;i++){if(rows[i].indexOf(prefix)===0){try{return decodeURIComponent(rows[i].slice(prefix.length));}catch(e){return rows[i].slice(prefix.length);}}}return null;};var theme=null;try{theme=window.localStorage.getItem(key);}catch(e){}if(!allowed(theme)){theme=readCookie();}if(!allowed(theme)){theme=fallback;}var applyBody=function(){if(document.body){document.body.setAttribute("data-theme",theme);}};document.documentElement.setAttribute("data-theme",theme);applyBody();if(!document.body){document.addEventListener("DOMContentLoaded",applyBody,{once:true});}}catch(e){}})();`;
}
