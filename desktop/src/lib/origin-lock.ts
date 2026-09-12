/**
 * OpenClaw control-UI origin lock — read side.
 *
 * An OpenClaw agent records the origins allowed to control it in the
 * `OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN` launch env: a full replace for the
 * gateway's allow-list, comma-separated, with `'*'` covering every origin.
 * Parsing is owned by ts-sdk (openclaw-control-ui-origin.ts); this module
 * keeps only the desktop-specific read helpers: what the current origin is,
 * and whether the agent's stored lock authorizes it.
 *
 * Because we can read the launch config from the deployment payload we already
 * fetch, a mismatch is detected *before* anything fails, rather than surfacing
 * later as an unexplained refused connection.
 */

import {
  CONTROL_UI_ALLOWED_ORIGIN_WILDCARD,
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
   * Whether a restart can record this app's origin at all. The env is a
   * free-form replace, so any origin is expressible; this stays true unless
   * there is no current origin to write.
   */
  expressible: boolean;
}

export function originLockStatus(launchConfig: unknown, origin?: string): OriginLockStatus {
  const allowed = controlUiAllowedOrigins(launchConfig);
  const current = (origin ?? currentOrigin()).trim();
  return {
    locked: allowed.length > 0 && !allowed.includes(CONTROL_UI_ALLOWED_ORIGIN_WILDCARD),
    allowed,
    current,
    expressible: current !== "",
    authorized:
      allowed.length === 0 ||
      allowed.includes(CONTROL_UI_ALLOWED_ORIGIN_WILDCARD) ||
      (current !== "" && allowed.includes(current)),
  };
}
