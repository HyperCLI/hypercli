/**
 * OpenClaw control-UI origin lock.
 *
 * An OpenClaw agent records the origin allowed to control it in the
 * `OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN` launch env, and that value is written
 * *at start time* from whichever client started it. Start an agent from
 * `npm run tauri dev` and it is pinned to `http://localhost:1420`; the packaged
 * app is then locked out until the agent is restarted.
 *
 * The parsing and validation rules below deliberately mirror
 * `site/apps/claw/src/lib/control-ui-origin.ts` so the desktop and the web
 * console agree on what a given env value means. The env format is a list
 * (comma- or whitespace-separated, or a JSON array) even though every writer
 * today collapses it to a single value.
 *
 * Because we can read the launch config from the deployment payload we already
 * fetch, a mismatch is detected *before* anything fails, rather than surfacing
 * later as an unexplained refused connection.
 */

export const CONTROL_UI_ALLOWED_ORIGIN_ENV = "OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN";

/** Only http/https origins are representable; anything else normalises to null. */
export function normalizeControlUiOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function parseControlUiAllowedOrigins(value: unknown): string[] {
  let values: unknown[];
  if (Array.isArray(value)) {
    values = value;
  } else if (typeof value === "string") {
    const candidate = value.trim();
    if (!candidate) return [];
    if (candidate.startsWith("[")) {
      try {
        return parseControlUiAllowedOrigins(JSON.parse(candidate));
      } catch {
        return [];
      }
    }
    values = candidate.split(/[,\s]+/);
  } else {
    return [];
  }
  const origins = values
    .map(normalizeControlUiOrigin)
    .filter((origin): origin is string => Boolean(origin));
  return Array.from(new Set(origins));
}

function launchEnv(launchConfig: unknown): Record<string, unknown> | null {
  if (!launchConfig || typeof launchConfig !== "object" || Array.isArray(launchConfig)) return null;
  const env = (launchConfig as { env?: unknown }).env;
  if (!env || typeof env !== "object" || Array.isArray(env)) return null;
  return env as Record<string, unknown>;
}

export function controlUiAllowedOrigins(launchConfig: unknown): string[] {
  const env = launchEnv(launchConfig);
  return parseControlUiAllowedOrigins(env?.[CONTROL_UI_ALLOWED_ORIGIN_ENV]);
}

export function currentOrigin(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}

export interface OriginLockStatus {
  /** The agent restricts control to a specific set of origins. */
  locked: boolean;
  allowed: string[];
  current: string;
  /** This app's origin is accepted. */
  authorized: boolean;
  /**
   * Whether this app's origin can be expressed at all. Tauri serves macOS and
   * Linux from `tauri://localhost`, whose scheme is not http(s) and therefore
   * cannot be written into the allow-list — restarting will not fix it there.
   */
  expressible: boolean;
}

export function originLockStatus(launchConfig: unknown, origin?: string): OriginLockStatus {
  const allowed = controlUiAllowedOrigins(launchConfig);
  const current = origin ?? currentOrigin();
  const normalized = normalizeControlUiOrigin(current);
  return {
    locked: allowed.length > 0,
    allowed,
    current,
    expressible: normalized !== null,
    authorized: allowed.length === 0 || (normalized !== null && allowed.includes(normalized)),
  };
}

/**
 * The value this app should write when it starts an agent: every origin the
 * desktop can legitimately have, plus anything already recorded, so starting
 * from one place stops evicting the others. Written space-separated, which the
 * shared parser accepts.
 */
export function controlUiOriginsToWrite(existingLaunchConfig?: unknown): string {
  const desktopOrigins = [
    currentOrigin(),
    // Tauri's packaged origins. Windows is http-based and therefore
    // representable; the macOS/Linux `tauri://localhost` is not, and is
    // filtered out by normalisation rather than written as an invalid value.
    "http://tauri.localhost",
    "tauri://localhost",
    // The Vite dev server.
    "http://localhost:1420",
  ];
  const merged = [
    ...controlUiAllowedOrigins(existingLaunchConfig),
    ...desktopOrigins.map(normalizeControlUiOrigin).filter((o): o is string => Boolean(o)),
  ];
  return Array.from(new Set(merged)).join(" ");
}
