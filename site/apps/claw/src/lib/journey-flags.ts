export type ClawJourneyMode = "off" | "preview" | "public";

export interface JourneySearchParams {
  get(name: string): string | null;
}

export const JOURNEY_PREVIEW_STORAGE_KEY = "claw.journey.previewEnabled";

const VALID_JOURNEY_MODES = new Set<ClawJourneyMode>(["off", "preview", "public"]);
const ENABLE_PARAM_VALUES = new Set(["1", "true", "yes", "on"]);
const DISABLE_PARAM_VALUES = new Set(["0", "false", "no", "off"]);

export function getClawJourneyMode(): ClawJourneyMode {
  const rawMode = process.env.NEXT_PUBLIC_CLAW_JOURNEY_MODE?.trim().toLowerCase();
  return rawMode && VALID_JOURNEY_MODES.has(rawMode as ClawJourneyMode)
    ? rawMode as ClawJourneyMode
    : "off";
}

export function getJourneyParamIntent(value: string | null): "enable" | "disable" | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (ENABLE_PARAM_VALUES.has(normalized)) return "enable";
  if (DISABLE_PARAM_VALUES.has(normalized)) return "disable";
  return null;
}

export function getJourneyResetRequested(searchParams: JourneySearchParams | null | undefined): boolean {
  return getJourneyParamIntent(searchParams?.get("journeyReset") ?? null) === "enable";
}

export function readJourneyPreviewEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(JOURNEY_PREVIEW_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeJourneyPreviewEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) {
      window.localStorage.setItem(JOURNEY_PREVIEW_STORAGE_KEY, "1");
    } else {
      window.localStorage.removeItem(JOURNEY_PREVIEW_STORAGE_KEY);
    }
  } catch {
    // Preview access is optional; Journey should still render from explicit env mode.
  }
}
