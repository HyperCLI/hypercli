"use client";

import * as React from "react";
import type { AgentSkillCreateRequest, AgentSkillsProvider, AgentSkillUpdate } from "@hypercli.com/sdk/skills";

import type { SkillResourceOperations } from "./SkillFilesPanel";

import { applySkillDocument, loadProviderSkills, type AgentSkill } from "./provider-skills";

interface UseAgentSkillsOptions {
  enabled: boolean;
  connected: boolean;
  provider: AgentSkillsProvider | null;
}

export function useAgentSkills({ enabled, connected, provider }: UseAgentSkillsOptions) {
  const [skills, setSkills] = React.useState<AgentSkill[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const requestIdRef = React.useRef(0);
  const documentRequestIdsRef = React.useRef(new Map<string, number>());

  const refresh = React.useCallback(async () => {
    if (!enabled || !connected || !provider) return [];
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const nextSkills = await loadProviderSkills(provider);
      if (requestId === requestIdRef.current) setSkills(nextSkills);
      return nextSkills;
    } catch (cause) {
      if (requestId === requestIdRef.current) {
        setSkills([]);
        setError(cause instanceof Error ? cause.message : "Failed to load app skills.");
      }
      throw cause;
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [connected, enabled, provider]);

  const update = React.useCallback(async (skillId: string, value: AgentSkillUpdate) => {
    if (!provider?.update) throw new Error("Skill configuration is unavailable for this agent.");
    await provider.update(skillId, value);
    await refresh();
  }, [provider, refresh]);

  const create = React.useCallback(async (request: AgentSkillCreateRequest) => {
    if (!provider?.createSkill) throw new Error("Saving skills to this agent is unavailable.");
    return provider.createSkill(request);
  }, [provider]);

  const loadDocument = React.useCallback(async (skillId: string) => {
    if (!provider?.capabilities.readDocument) return null;
    const requestId = (documentRequestIdsRef.current.get(skillId) ?? 0) + 1;
    documentRequestIdsRef.current.set(skillId, requestId);
    setSkills((current) => current.map((skill) => skill.id === skillId
      ? { ...skill, documentState: "loading", documentError: undefined }
      : skill));
    try {
      const document = await provider.readDocument(skillId);
      if (documentRequestIdsRef.current.get(skillId) !== requestId) return document;
      setSkills((current) => current.map((skill) => {
        if (skill.id !== skillId) return skill;
        return document
          ? applySkillDocument(skill, document.content)
          : { ...skill, contentLoaded: false, documentState: "unavailable", documentError: undefined };
      }));
      return document;
    } catch (cause) {
      if (documentRequestIdsRef.current.get(skillId) === requestId) {
        const message = cause instanceof Error ? cause.message : "Failed to load skill instructions.";
        setSkills((current) => current.map((skill) => skill.id === skillId
          ? { ...skill, contentLoaded: false, documentState: "error", documentError: message }
          : skill));
      }
      throw cause;
    }
  }, [provider]);

  const resourceOperations: SkillResourceOperations | undefined = provider?.capabilities.resources
    && provider.listResources
    && provider.readResource
    ? {
        listResources: (skillId, path) => provider.listResources!(skillId, path),
        readResource: (skillId, path) => provider.readResource!(skillId, path),
        writeResource: provider.writeResource
          ? (skillId, path, content) => provider.writeResource!(skillId, path, content)
          : undefined,
        deleteResource: provider.deleteResource
          ? (skillId, path, options) => provider.deleteResource!(skillId, path, options)
          : undefined,
        createResourceDirectory: provider.createResourceDirectory
          ? (skillId, path) => provider.createResourceDirectory!(skillId, path)
          : undefined,
      }
    : undefined;

  React.useEffect(() => {
    if (!enabled || !connected) return;
    void Promise.resolve().then(refresh).catch(() => undefined);
    return () => {
      requestIdRef.current += 1;
    };
  }, [connected, enabled, refresh]);

  return { skills, loading, error, refresh, update, create, loadDocument, resourceOperations, capabilities: provider?.capabilities ?? null };
}
