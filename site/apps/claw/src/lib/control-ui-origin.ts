import {
  normalizeControlUiOrigin,
  parseControlUiAllowedOrigins,
} from "@hypercli.com/sdk/openclaw/control-ui-origin";

// Parsing and normalization live in the SDK (with the tauri: scheme in the
// allowlist, so a desktop-started agent's allow-list reads correctly here too).
// This module keeps only the read side of that contract.
export {
  normalizeControlUiOrigin,
  parseControlUiAllowedOrigins,
} from "@hypercli.com/sdk/openclaw/control-ui-origin";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function controlUiAllowedOriginsFromLaunchConfig(launchConfig: unknown): string[] {
  if (!isRecord(launchConfig)) return [];
  const env = isRecord(launchConfig.env) ? launchConfig.env : null;

  return Array.from(new Set([
    ...parseControlUiAllowedOrigins(env?.OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN),
  ]));
}

export function currentControlUiOrigin(): string | null {
  if (typeof window === "undefined") return null;
  return normalizeControlUiOrigin(window.location?.origin);
}
