"use client";

import { useEffect, useState } from "react";
import type { WorkspacesAPI } from "@hypercli.com/sdk/workspaces";

import { useAgentAuth } from "@/hooks/useAgentAuth";
import { createWorkspacesClient } from "@/lib/agent-client";
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
  const { getToken, user } = useAgentAuth();
  const principalId = user?.id ?? null;
  const [connection, setConnection] = useState<{
    principalId: string | null;
    tokenGetter: typeof getToken;
    workspaces: WorkspacesAPI | null;
    error: string | null;
  }>(() => ({ principalId, tokenGetter: getToken, workspaces: null, error: null }));
  const connectionIsCurrent = connection.principalId === principalId && connection.tokenGetter === getToken;
  const workspaces = connectionIsCurrent ? connection.workspaces : null;
  const connectionError = connectionIsCurrent ? connection.error : null;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const token = await getToken();
        if (cancelled) return;
        setConnection({
          principalId,
          tokenGetter: getToken,
          workspaces: createWorkspacesClient(token),
          error: null,
        });
      } catch (error) {
        if (cancelled) return;
        setConnection({
          principalId,
          tokenGetter: getToken,
          workspaces: null,
          error: error instanceof Error ? error.message : "Shared knowledge is unavailable right now.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getToken, principalId]);

  return (
    <SharedKnowledgePanel
      key={`${connectionIsCurrent && workspaces ? "ready" : "pending"}:${principalId ?? "anonymous"}`}
      agents={agents}
      agentsLoading={agentsLoading}
      agentsError={agentsError}
      connectionError={connectionError}
      preferredAgentId={preferredAgentId}
      workspaces={workspaces}
      ready={Boolean(workspaces)}
    />
  );
}
