/**
 * Persist agent state (gateway tokens, etc.) in localStorage.
 *
 * Key: `hyperagent:deployments:{agentId}`
 * Value: JSON { gatewayToken, updatedAt }
 */

const PREFIX = "hyperagent:deployments:";

interface StoredAgentState {
  gatewayToken?: string;
  updatedAt: number;
}

export function getAgentState(agentId: string): StoredAgentState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`${PREFIX}${agentId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setAgentState(agentId: string, state: Partial<StoredAgentState>): void {
  if (typeof window === "undefined") return;
  try {
    const existing = getAgentState(agentId) ?? { updatedAt: 0 };
    const merged = { ...existing, ...state, updatedAt: Date.now() };
    localStorage.setItem(`${PREFIX}${agentId}`, JSON.stringify(merged));
  } catch {
    // localStorage full or unavailable
  }
}

export function getGatewayToken(agentId: string): string | null {
  return getAgentState(agentId)?.gatewayToken ?? null;
}

export function setGatewayToken(agentId: string, token: string): void {
  setAgentState(agentId, { gatewayToken: token });
}

export function removeAgentState(agentId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(`${PREFIX}${agentId}`);
  } catch {
    // ignore
  }
}

/**
 * Clear the SDK's device auth token for a specific agent.
 *
 * The GatewayClient stores device tokens in `openclaw.device.auth.v1`
 * keyed by `{deploymentId}|operator`. When an agent is stopped and
 * restarted, it gets a new gateway token but the old device token
 * lingers, causing AUTH_DEVICE_TOKEN_MISMATCH on reconnect.
 */
export function clearDeviceAuthToken(agentId: string): void {
  if (typeof window === "undefined") return;
  const STORAGE_KEY = "openclaw.device.auth.v1";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const store = JSON.parse(raw);
    if (!store?.tokens) return;
    const key = `${agentId}|operator`;
    if (!store.tokens[key]) return;
    const nextTokens = { ...store.tokens };
    delete nextTokens[key];
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...store, tokens: nextTokens }));
  } catch {
    // ignore
  }
}
