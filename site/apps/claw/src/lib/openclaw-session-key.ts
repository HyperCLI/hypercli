import {
  OPENCLAW_DASHBOARD_SESSION_PREFIX,
  OPENCLAW_INTERNAL_MAIN_SESSION_KEY,
  createOpenClawSessionKey,
} from "@hypercli.com/sdk/openclaw/gateway";

export const OPENCLAW_INTERNAL_SESSION_KEY = OPENCLAW_INTERNAL_MAIN_SESSION_KEY;

export function createOpenClawDashboardSessionKey(existingSessionKeys: Array<string | null | undefined> = []): string {
  return createOpenClawSessionKey(existingSessionKeys, OPENCLAW_DASHBOARD_SESSION_PREFIX);
}
