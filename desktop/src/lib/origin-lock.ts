/**
 * OpenClaw control-UI origin lock — read side.
 *
 * An OpenClaw agent records the origins allowed to control it in the
 * `OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN` launch env. Parsing and normalization
 * are owned by ts-sdk (openclaw-control-ui-origin.ts, with the tauri: scheme
 * in the allowlist); this module keeps only the desktop-specific read
 * helpers: what the current origin is, and whether the agent's stored lock
 * authorizes it.
 *
 * Because we can read the launch config from the deployment payload we already
 * fetch, a mismatch is detected *before* anything fails, rather than surfacing
 * later as an unexplained refused connection.
 */

import {
  normalizeControlUiOrigin,
  OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN_ENV,
  parseControlUiAllowedOrigins,
} from "../../../ts-sdk/src/openclaw-control-ui-origin.ts";

const CONTROL_UI_ALLOWED_ORIGIN_ENV = OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN_ENV;

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

function currentOrigin(): string {
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
   * Whether this app's origin can be expressed at all. All three origins this
   * app can run at are allowed-scheme origins, so a restart genuinely fixes
   * it; this stays false only for origins outside the recorded allowlist.
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
