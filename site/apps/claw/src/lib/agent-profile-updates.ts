import type {
  Agent as SdkAgent,
  UpdateAgentOptions,
  UpdateExternalAgentOptions,
} from "@hypercli.com/sdk/agents";

type AgentProfileIdentity = Pick<SdkAgent, "id" | "managed" | "name">;

interface AgentProfileUpdateClient<TAgent = SdkAgent> {
  update: (agentId: string, options: UpdateAgentOptions) => Promise<TAgent>;
  updateExternalAgent: (agentId: string, options: UpdateExternalAgentOptions) => Promise<TAgent>;
}

export function mergeAgentListAfterMutations<TAgent extends { id: string }>(
  currentAgents: TAgent[],
  listedAgents: TAgent[],
  versionsAtRequest: ReadonlyMap<string, number>,
  currentVersions: ReadonlyMap<string, number>,
): TAgent[] {
  const currentById = new Map(currentAgents.map((agent) => [agent.id, agent]));
  const listedIds = new Set(listedAgents.map((agent) => agent.id));
  const changedDuringRequest = (agentId: string) => (
    (versionsAtRequest.get(agentId) ?? 0) !== (currentVersions.get(agentId) ?? 0)
  );
  const merged = listedAgents.map((agent) => (
    changedDuringRequest(agent.id) ? currentById.get(agent.id) ?? agent : agent
  ));

  for (const agent of currentAgents) {
    if (!listedIds.has(agent.id) && changedDuringRequest(agent.id)) merged.push(agent);
  }
  return merged;
}

export function createAgentMutationQueue() {
  const tails = new Map<string, Promise<void>>();

  return function runAgentMutation<T>(agentId: string, mutation: () => Promise<T>): Promise<T> {
    const previous = tails.get(agentId) ?? Promise.resolve();
    const result = previous.then(mutation);
    const tail = result.then(() => undefined, () => undefined);
    tails.set(agentId, tail);
    void tail.then(() => {
      if (tails.get(agentId) === tail) tails.delete(agentId);
    });
    return result;
  };
}

export async function persistAgentCanonicalName<TAgent>(
  client: AgentProfileUpdateClient<TAgent>,
  agent: AgentProfileIdentity,
  name: string,
): Promise<TAgent> {
  const nextName = name.trim();
  if (!nextName) throw new Error("Agent name is required.");
  return agent.managed === false
    ? client.updateExternalAgent(agent.id, { name: nextName })
    : client.update(agent.id, { name: nextName });
}

export async function persistAgentDisplayName<TAgent>(
  client: AgentProfileUpdateClient<TAgent>,
  agent: AgentProfileIdentity,
  displayName: string,
): Promise<TAgent> {
  const nextDisplayName = displayName.trim();
  if (!nextDisplayName) throw new Error("Display name is required.");

  if (agent.managed === false) {
    return client.updateExternalAgent(agent.id, { displayName: nextDisplayName.slice(0, 255) });
  }
  const handle = nextDisplayName.replace(/^@+/, "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(handle)) {
    throw new Error("Display names must start with a lowercase letter or number and contain 2-64 lowercase letters, numbers, underscores, or dashes.");
  }
  return client.update(agent.id, { handle });
}
