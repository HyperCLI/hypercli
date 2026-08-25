"use client";

import * as React from "react";
import type {
  AgentSkillProposalInspection,
  AgentSkillProposalsProvider,
  AgentSkillProposalSummary,
} from "@hypercli.com/sdk/skills";

interface UseSkillProposalsOptions {
  enabled: boolean;
  connected: boolean;
  provider: AgentSkillProposalsProvider | null;
}

export function useSkillProposals({ enabled, connected, provider }: UseSkillProposalsOptions) {
  const [proposals, setProposals] = React.useState<AgentSkillProposalSummary[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const requestIdRef = React.useRef(0);

  const refresh = React.useCallback(async () => {
    if (!enabled || !connected || !provider?.capabilities.list) {
      setProposals([]);
      setError(null);
      return [];
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await provider.list();
      if (requestId === requestIdRef.current) setProposals(next);
      return next;
    } catch (cause) {
      if (requestId === requestIdRef.current) {
        setError(cause instanceof Error && cause.message.trim()
          ? cause.message.trim()
          : "Pending skill reviews are unavailable.");
      }
      throw cause;
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [connected, enabled, provider]);

  const inspect = React.useCallback((proposalId: string): Promise<AgentSkillProposalInspection> => {
    if (!provider) return Promise.reject(new Error("Pending skill review is unavailable."));
    return provider.inspect(proposalId);
  }, [provider]);

  const apply = React.useCallback(async (proposalId: string, expectedRevision?: string) => {
    if (!provider) throw new Error("Pending skill approval is unavailable.");
    const result = await provider.apply({ proposalId, expectedRevision });
    setProposals((current) => current.filter((proposal) => proposal.id !== proposalId));
    await refresh().catch(() => undefined);
    return result;
  }, [provider, refresh]);

  const reject = React.useCallback(async (proposalId: string, expectedRevision?: string) => {
    if (!provider) throw new Error("Pending skill rejection is unavailable.");
    const result = await provider.reject({ proposalId, expectedRevision });
    setProposals((current) => current.filter((proposal) => proposal.id !== proposalId));
    await refresh().catch(() => undefined);
    return result;
  }, [provider, refresh]);

  React.useEffect(() => {
    if (!enabled || !connected) {
      const requestId = ++requestIdRef.current;
      queueMicrotask(() => {
        if (requestId !== requestIdRef.current) return;
        setProposals([]);
        setError(null);
        setLoading(false);
      });
      return;
    }
    void Promise.resolve().then(refresh).catch(() => undefined);
    return () => {
      requestIdRef.current += 1;
    };
  }, [connected, enabled, refresh]);

  return {
    proposals,
    loading,
    error,
    capabilities: provider?.capabilities ?? null,
    refresh,
    inspect,
    apply,
    reject,
  };
}
