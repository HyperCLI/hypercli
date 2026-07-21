import { redirect } from "next/navigation";

type SharedKnowledgeRedirectPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstSearchParam(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate?.trim() || null;
}

export default async function SharedKnowledgeRedirectPage({ searchParams }: SharedKnowledgeRedirectPageProps) {
  const query = await searchParams;
  const focusedAgentId = firstSearchParam(query.focusAgent) ?? firstSearchParam(query.agentId);
  const sessionKey = firstSearchParam(query.session);
  const target = new URLSearchParams({ section: "knowledge" });
  if (focusedAgentId) target.set("agentId", focusedAgentId);
  if (sessionKey) target.set("session", sessionKey);
  redirect(`/dashboard/agents?${target.toString()}`);
}
