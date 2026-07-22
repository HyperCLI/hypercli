"use client";

import { useAgentAuth } from "@/hooks/useAgentAuth";
import { useWorkspace } from "@/components/dashboard/WorkspaceContext";
import {
  SharedKnowledgePanel,
  type SharedKnowledgeAgent,
} from "./SharedKnowledgePanel";

type SharedKnowledgeSectionProps = {
  agents: SharedKnowledgeAgent[];
  agentsLoading?: boolean;
  agentsError?: string | null;
  preferredAgentId?: string | null;
};

export function SharedKnowledgeSection({
  agents,
  agentsLoading = false,
  agentsError = null,
  preferredAgentId = null,
}: SharedKnowledgeSectionProps) {
  const { user } = useAgentAuth();
  const principalId = user?.id ?? null;
  const {
    workspacesClient,
    workspaces,
    selectedWorkspaceId,
    isLoading,
    error,
    selectWorkspace,
    refreshWorkspaces,
  } = useWorkspace();

  return (
    <SharedKnowledgePanel
      key={`${workspacesClient ? "ready" : "pending"}:${principalId ?? "anonymous"}`}
      agents={agents}
      agentsLoading={agentsLoading}
      agentsError={agentsError}
      connectionError={error}
      preferredAgentId={preferredAgentId}
      workspaces={workspacesClient}
      availableWorkspaces={workspaces}
      selectedWorkspaceId={selectedWorkspaceId}
      onSelectWorkspace={selectWorkspace}
      onWorkspacesChanged={refreshWorkspaces}
      ready={Boolean(workspacesClient) && !isLoading}
    />
  );
}
