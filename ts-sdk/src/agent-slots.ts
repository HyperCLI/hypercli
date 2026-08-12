export type AgentSlotSize = 'small' | 'medium' | 'large';

export function parseAgentSlotSize(value: unknown, fieldName = 'Agent slot size'): AgentSlotSize {
  if (value !== 'small' && value !== 'medium' && value !== 'large') {
    throw new Error(`${fieldName} must be one of: small, medium, large`);
  }
  return value;
}

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
    size: parseAgentSlotSize(data.size),
    agentId,
    occupied: data.occupied === undefined ? agentId !== null : Boolean(data.occupied),
    expiresAt: parseAgentSlotDate(data.expires_at),
  };
}
