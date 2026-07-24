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

type ManagedDisplayNameSetter = (agentId: string, displayName: string | null) => void | Promise<void>;

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
  getClient: () => AgentProfileUpdateClient<TAgent> | Promise<AgentProfileUpdateClient<TAgent>>,
  agent: AgentProfileIdentity,
  displayName: string,
  setManagedDisplayName?: ManagedDisplayNameSetter,
): Promise<TAgent | null> {
  const nextDisplayName = displayName.trim().slice(0, 255);
  if (!nextDisplayName) throw new Error("Display name is required.");
  const customDisplayName = nextDisplayName === (agent.name ?? "").trim() ? null : nextDisplayName;

  if (agent.managed === false) {
    const client = await getClient();
    return client.updateExternalAgent(agent.id, { displayName: customDisplayName });
  }

  if (!setManagedDisplayName) {
    throw new Error("Local display name updates are unavailable without an authenticated account session.");
  }
  await setManagedDisplayName(agent.id, customDisplayName);
  return null;
}
