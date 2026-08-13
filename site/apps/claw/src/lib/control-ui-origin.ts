const CONTROL_UI_ALLOWED_ORIGIN_ENV = "OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

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

export function controlUiAllowedOriginsFromLaunchConfig(launchConfig: unknown): string[] {
  if (!isRecord(launchConfig)) return [];
  const env = isRecord(launchConfig.env) ? launchConfig.env : null;
  const config = isRecord(launchConfig.config) ? launchConfig.config : null;
  const gateway = isRecord(config?.gateway) ? config.gateway : null;
  const controlUi = isRecord(gateway?.controlUi) ? gateway.controlUi : null;

  return Array.from(new Set([
    ...parseControlUiAllowedOrigins(env?.[CONTROL_UI_ALLOWED_ORIGIN_ENV]),
    ...parseControlUiAllowedOrigins(controlUi?.allowedOrigins),
  ]));
}

export function currentControlUiOrigin(): string | null {
  if (typeof window === "undefined") return null;
  return normalizeControlUiOrigin(window.location?.origin);
}
