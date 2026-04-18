import type { Agent, AgentBudget } from "@/app/dashboard/agents/types";

const FALLBACK_AGENT_SIZE_PRESETS: Record<string, { cpu: number; memory: number }> = {
  small: { cpu: 1, memory: 1 },
  medium: { cpu: 2, memory: 2 },
  large: { cpu: 4, memory: 4 },
};

export interface AgentTierStartGuidance {
  tier: string;
  title: string;
  message: string;
  suggestedTier: string | null;
  availableTiers: Array<{ tier: string; available: number }>;
}

export interface AgentTierSelectionState {
  agentId: string;
  guidance: AgentTierStartGuidance;
}

export function titleizeTier(value: string): string {
  return value.replace(/-/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

export function getAgentSizePresets(
  budget: AgentBudget | null,
): Record<string, { cpu_millicores: number; memory_mib: number }> {
  const source = budget?.size_presets ?? FALLBACK_AGENT_SIZE_PRESETS;
  return Object.fromEntries(
    Object.entries(source).map(([tier, preset]) => [
      tier,
      {
        cpu_millicores: Math.round((preset.cpu || 0) * 1000),
        memory_mib: Math.round((preset.memory || 0) * 1024),
      },
    ]),
  );
}

export function inferAgentTier(
  agent: Pick<Agent, "cpu_millicores" | "memory_mib">,
  budget: AgentBudget | null,
): string | null {
  const presets = getAgentSizePresets(budget);
  for (const [tier, preset] of Object.entries(presets)) {
    if (preset.cpu_millicores === agent.cpu_millicores && preset.memory_mib === agent.memory_mib) {
      return tier;
    }
  }
  return null;
}

export function describeAgentTierStartGuidance(
  agent: Pick<Agent, "cpu_millicores" | "memory_mib"> | null,
  budget: AgentBudget | null,
): AgentTierStartGuidance | null {
  if (!agent || !budget) return null;
  const tier = inferAgentTier(agent, budget);
  if (!tier) return null;
  const requested = budget.slots?.[tier] ?? { granted: 0, used: 0, available: 0 };
  if (requested.available > 0) return null;

  const requestedLabel = titleizeTier(tier);
  const otherAvailable = Object.entries(budget.slots ?? {})
    .filter(([entryTier, entry]) => entryTier !== tier && (entry?.available ?? 0) > 0)
    .sort(([, left], [, right]) => (right?.available ?? 0) - (left?.available ?? 0));

  if (otherAvailable.length > 0) {
    const [suggestedTier, suggestedEntry] = otherAvailable[0];
    const suggestedLabel = titleizeTier(suggestedTier);
    return {
      tier,
      title: `${requestedLabel} slot required`,
      suggestedTier,
      availableTiers: otherAvailable.map(([entryTier, entry]) => ({
        tier: entryTier,
        available: entry?.available ?? 0,
      })),
      message:
        `This agent was created as a ${requestedLabel} agent. ` +
        `Your account has no free ${requestedLabel} slots, but ${suggestedEntry.available} free ${suggestedLabel} ` +
        `slot${suggestedEntry.available === 1 ? "" : "s"} available. Resize this agent to ${suggestedLabel} to use the capacity you already bought.`,
    };
  }

  if (requested.granted > 0) {
    return {
      tier,
      title: `${requestedLabel} slots are fully used`,
      suggestedTier: null,
      availableTiers: [],
      message:
        `This agent was created as a ${requestedLabel} agent. ` +
        `All ${requestedLabel} slots on this account are currently in use. Stop another ${requestedLabel} agent or buy another ${requestedLabel} bundle to launch it.`,
    };
  }

  return {
    tier,
    title: `${requestedLabel} slot required`,
    suggestedTier: null,
    availableTiers: [],
    message:
      `This agent was created as a ${requestedLabel} agent. ` +
      `Your account does not currently include any ${requestedLabel} slots. Buy a ${requestedLabel} bundle to launch it.`,
  };
}

export function parseEntitlementSlotTier(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const quotedMatch = message.match(/No available '([^']+)' entitlement slots/i);
  if (quotedMatch?.[1]) return quotedMatch[1].toLowerCase();
  const plainMatch = message.match(/No available ([a-z-]+) entitlement slots/i);
  if (plainMatch?.[1]) return plainMatch[1].toLowerCase();
  return null;
}

export function describeAgentsPageError(error: unknown): { message: string; clusterUnavailable: boolean } {
  const fallback = "Failed to load agents";
  const raw = error instanceof Error ? error.message : String(error ?? fallback);
  const normalized = raw.trim();
  if (normalized.includes("Agent cluster is not assigned")) {
    return {
      clusterUnavailable: true,
      message: "Agent cluster assignment is still pending for this account. Try again in a minute.",
    };
  }
  return {
    clusterUnavailable: false,
    message: normalized || fallback,
  };
}
