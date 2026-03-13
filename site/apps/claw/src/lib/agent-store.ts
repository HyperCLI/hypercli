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
