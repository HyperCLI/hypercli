export function resolveWorkspaceAgentSelection(
  availableAgentIds: readonly string[],
  requestedAgentId: string | null,
  currentAgentId: string | null,
): string | null {
  const availableAgentIdSet = new Set(availableAgentIds);
  if (requestedAgentId && availableAgentIdSet.has(requestedAgentId)) return requestedAgentId;
  if (currentAgentId && availableAgentIdSet.has(currentAgentId)) return currentAgentId;
  return availableAgentIds[0] ?? null;
}
