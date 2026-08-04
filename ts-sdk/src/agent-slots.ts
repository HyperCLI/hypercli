export type AgentSlotSize = 'small' | 'medium' | 'large' | (string & {});

export interface AgentSlotInventory {
  granted: number;
  used: number;
  available: number;
}

export interface AgentSlot {
  id: string;
  entitlementId: string | null;
  planId: string;
  size: AgentSlotSize;
  agentId: string | null;
  occupied: boolean;
  expiresAt: Date | null;
}

function parseAgentSlotDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  return new Date(value.replace('Z', '+00:00'));
}

export function agentSlotFromDict(data: Record<string, any>): AgentSlot {
  const agentId = data.agent_id ? String(data.agent_id) : null;
  return {
    id: String(data.id || ''),
    entitlementId: data.entitlement_id ? String(data.entitlement_id) : null,
    planId: String(data.plan_id || ''),
    size: String(data.size || '') as AgentSlotSize,
    agentId,
    occupied: data.occupied === undefined ? agentId !== null : Boolean(data.occupied),
    expiresAt: parseAgentSlotDate(data.expires_at),
  };
}
