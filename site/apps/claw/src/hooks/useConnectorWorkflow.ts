"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentConnectorDescriptor, AgentConnectorsProvider } from "@hypercli.com/sdk/connectors";
import type { GatewayEphemeralChatOptions } from "@hypercli.com/sdk/openclaw/gateway";

import {
  buildPreloadedConnectorWorkflow,
  buildConnectorRuntimeSnapshot,
  buildConnectorWorkflowPrompt,
  CONNECTOR_IDS,
  CONNECTOR_WORKFLOW_PROMPT_REVISION,
  connectorWorkflowsEqual,
  parseConnectorWorkflow,
  validateConnectorWorkflowQuality,
  type ConnectorId,
  type ConnectorWorkflow,
} from "@/lib/connector-workflow";
import {
  CONNECTOR_WORKFLOW_REFRESH_INTERVAL_MS,
  connectorWorkflowEntryIsFresh,
  readStoredConnectorWorkflows,
  writeStoredConnectorWorkflows,
  type StoredConnectorWorkflowEntry,
  type StoredConnectorWorkflows,
} from "@/lib/connector-workflow-cache";

const PRELOAD_CONCURRENCY = 4;

interface UseConnectorWorkflowOptions {
  provider: AgentConnectorsProvider | null;
  scopeKey: string;
  backgroundBlocked?: boolean;
  runEphemeralPrompt: (message: string, options?: GatewayEphemeralChatOptions) => Promise<string>;
  runShellProposal: (command: string) => Promise<void>;
}

interface WorkflowState {
  scopeKey: string;
  entries: StoredConnectorWorkflows;
}

interface PreloadJob {
  cancelled?: boolean;
  connectorId: ConnectorId;
  descriptor: AgentConnectorDescriptor;
  provider: AgentConnectorsProvider;
  scopeKey: string;
}

interface ActivePreload {
  job: PreloadJob;
  controller: AbortController;
  completion: Promise<ConnectorWorkflow>;
  demanded?: boolean;
}

function fallbackDescriptor(connectorId: ConnectorId): AgentConnectorDescriptor {
  return {
    connectorId,
    configured: false,
    authenticated: false,
    usable: false,
    setupModes: connectorId === "github" ? ["managed-auth"] : ["config"],
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function staleGenerationError(): Error {
  const error = new Error("Connector workflow generation was superseded.");
  error.name = "AbortError";
  return error;
}

function workflowsFromEntries(entries: StoredConnectorWorkflows): Partial<Record<ConnectorId, ConnectorWorkflow>> {
  return Object.fromEntries(
    Object.entries(entries).map(([connectorId, entry]) => [connectorId, entry?.workflow]),
  );
}

function entriesWithPreloadedWorkflows(
  currentScopeKey: string,
  currentProvider: AgentConnectorsProvider | null,
  storedEntries: StoredConnectorWorkflows,
): StoredConnectorWorkflows {
  if (!currentProvider || !currentScopeKey || currentScopeKey === "disconnected") return storedEntries;
  let entries = storedEntries;
  for (const connectorId of CONNECTOR_IDS) {
    const runtimeFingerprint = buildConnectorRuntimeSnapshot(
      currentProvider.runtime,
      fallbackDescriptor(connectorId),
    ).runtimeFingerprint;
    const preloadedWorkflow = buildPreloadedConnectorWorkflow(connectorId, runtimeFingerprint);
    const existingEntry = entries[connectorId];
    if (existingEntry?.revision === CONNECTOR_WORKFLOW_PROMPT_REVISION) {
      if (existingEntry.source === "generated") continue;
      if (connectorWorkflowsEqual(existingEntry.workflow, preloadedWorkflow)) continue;
    }
    if (entries === storedEntries) entries = { ...storedEntries };
    entries[connectorId] = {
      workflow: preloadedWorkflow,
      lastCheckedAt: 0,
      source: "preloaded",
      revision: CONNECTOR_WORKFLOW_PROMPT_REVISION,
    };
  }
  return entries;
}

export function useConnectorWorkflow({
  provider,
  scopeKey,
  backgroundBlocked = false,
  runEphemeralPrompt,
  runShellProposal,
}: UseConnectorWorkflowOptions) {
  const [workflowState, setWorkflowState] = useState<WorkflowState>(() => {
    const storedEntries = readStoredConnectorWorkflows(scopeKey);
    return {
      scopeKey,
      entries: entriesWithPreloadedWorkflows(scopeKey, provider, storedEntries),
    };
  });
  const entriesRef = useRef(workflowState);
  const inFlightRef = useRef(new Map<string, Promise<ConnectorWorkflow>>());
  const preloadQueueRef = useRef<PreloadJob[]>([]);
  const activePreloadsRef = useRef(new Map<ConnectorId, ActivePreload>());
  const generationEpochRef = useRef(0);
  const demandCountRef = useRef(0);
  const backgroundBlockedRef = useRef(backgroundBlocked);
  const providerRef = useRef(provider);
  const scopeKeyRef = useRef(scopeKey);
  const mountedRef = useRef(true);

  useEffect(() => {
    providerRef.current = provider;
    scopeKeyRef.current = scopeKey;
  }, [provider, scopeKey]);

  useEffect(() => {
    const sameScope = entriesRef.current.scopeKey === scopeKey;
    const currentEntries = sameScope
      ? entriesRef.current.entries
      : readStoredConnectorWorkflows(scopeKey);
    const entries = entriesWithPreloadedWorkflows(scopeKey, provider, currentEntries);
    writeStoredConnectorWorkflows(scopeKey, entries);
    if (sameScope && entries === currentEntries) return;
    const next = { scopeKey, entries };
    entriesRef.current = next;
    setWorkflowState(next);
  }, [provider, scopeKey]);

  const updateStoredEntry = useCallback((
    targetScope: string,
    connectorId: ConnectorId,
    entry: StoredConnectorWorkflowEntry,
  ) => {
    const currentEntries = entriesRef.current.scopeKey === targetScope
      ? entriesRef.current.entries
      : readStoredConnectorWorkflows(targetScope);
    const entries = { ...currentEntries, [connectorId]: entry };
    writeStoredConnectorWorkflows(targetScope, entries);
    if (scopeKeyRef.current !== targetScope || !mountedRef.current) return;
    const next = { scopeKey: targetScope, entries };
    entriesRef.current = next;
    setWorkflowState(next);
  }, []);

  const generateWithDescriptor = useCallback((
    connectorId: ConnectorId,
    descriptor: AgentConnectorDescriptor,
    generationProvider: AgentConnectorsProvider,
    generationScope: string,
    signal?: AbortSignal,
  ): Promise<ConnectorWorkflow> => {
    const cacheKey = `${generationScope}:${connectorId}`;
    const cachedEntry = entriesRef.current.scopeKey === generationScope
      ? entriesRef.current.entries[connectorId]
      : readStoredConnectorWorkflows(generationScope)[connectorId];
    if (connectorWorkflowEntryIsFresh(cachedEntry)) return Promise.resolve(cachedEntry!.workflow);
    const inFlight = inFlightRef.current.get(cacheKey);
    if (inFlight) return inFlight;

    const snapshot = buildConnectorRuntimeSnapshot(generationProvider.runtime, descriptor);
    const prompt = buildConnectorWorkflowPrompt(connectorId, snapshot);
    const generationOptions: GatewayEphemeralChatOptions = {
      signal,
      timeoutMs: 120_000,
      maxResponseChars: 32_768,
      fastMode: true,
      onEvent: (event) => {
        if (event.type === "tool_call" || event.type === "tool_result") {
          throw new Error("Connector planning attempted to use a tool and was stopped.");
        }
      },
    };
    const expected = { connectorId, runtimeFingerprint: snapshot.runtimeFingerprint };
    const generationEpoch = generationEpochRef.current;
    const generationIsCurrent = () => (
      generationEpochRef.current === generationEpoch &&
      providerRef.current === generationProvider &&
      scopeKeyRef.current === generationScope
    );
    const promise = (async () => {
      try {
        const response = await runEphemeralPrompt(prompt, generationOptions);
        if (!generationIsCurrent()) throw staleGenerationError();
        const parsed = parseConnectorWorkflow(response, expected);
        const workflow = validateConnectorWorkflowQuality(parsed, { configured: descriptor.configured });
        const unchanged = cachedEntry && connectorWorkflowsEqual(cachedEntry.workflow, workflow);
        const checkedWorkflow = unchanged ? cachedEntry.workflow : workflow;
        updateStoredEntry(generationScope, connectorId, {
          workflow: checkedWorkflow,
          lastCheckedAt: Date.now(),
          source: unchanged ? cachedEntry.source : "generated",
          revision: CONNECTOR_WORKFLOW_PROMPT_REVISION,
        });
        return checkedWorkflow;
      } catch (error) {
        if (
          cachedEntry &&
          !isAbortError(error) &&
          generationIsCurrent() &&
          (cachedEntry.source !== "preloaded" || signal !== undefined)
        ) {
          updateStoredEntry(generationScope, connectorId, {
            workflow: cachedEntry.workflow,
            lastCheckedAt: Date.now(),
            source: cachedEntry.source,
            revision: CONNECTOR_WORKFLOW_PROMPT_REVISION,
          });
        }
        throw error;
      }
    })();
    inFlightRef.current.set(cacheKey, promise);
    void promise.finally(() => {
      if (inFlightRef.current.get(cacheKey) === promise) inFlightRef.current.delete(cacheKey);
    }).catch(() => undefined);
    return promise;
  }, [runEphemeralPrompt, updateStoredEntry]);

  const drainPreloadQueue = useCallback(function drain() {
    if (backgroundBlockedRef.current || demandCountRef.current > 0 || !providerRef.current) return;

    while (
      activePreloadsRef.current.size < PRELOAD_CONCURRENCY &&
      preloadQueueRef.current.length > 0 &&
      !backgroundBlockedRef.current &&
      demandCountRef.current === 0 &&
      providerRef.current
    ) {
      const job = preloadQueueRef.current.shift();
      if (!job || job.scopeKey !== scopeKeyRef.current || job.provider !== providerRef.current) continue;
      const controller = new AbortController();
      const completion = generateWithDescriptor(
        job.connectorId,
        job.descriptor,
        job.provider,
        job.scopeKey,
        controller.signal,
      );
      const active: ActivePreload = { job, controller, completion };
      activePreloadsRef.current.set(job.connectorId, active);
      void completion.catch((error) => {
        if (
          isAbortError(error) &&
          mountedRef.current &&
          !job.cancelled &&
          !active.demanded &&
          job.scopeKey === scopeKeyRef.current &&
          job.provider === providerRef.current &&
          !preloadQueueRef.current.some((candidate) => candidate.connectorId === job.connectorId)
        ) {
          preloadQueueRef.current.unshift(job);
        }
      }).finally(() => {
        if (activePreloadsRef.current.get(job.connectorId)?.completion === completion) {
          activePreloadsRef.current.delete(job.connectorId);
        }
        drain();
      });
    }
  }, [generateWithDescriptor]);

  const preloadConnectorWorkflows = useCallback(async (connectorIds: readonly ConnectorId[]) => {
    const currentProvider = providerRef.current;
    const requestedScope = scopeKeyRef.current;
    if (!currentProvider || backgroundBlockedRef.current) return;

    const dueConnectorIds = connectorIds.filter((connectorId) => {
      const entry = entriesRef.current.scopeKey === requestedScope
        ? entriesRef.current.entries[connectorId]
        : readStoredConnectorWorkflows(requestedScope)[connectorId];
      return !connectorWorkflowEntryIsFresh(entry);
    });
    if (dueConnectorIds.length === 0) return;

    const descriptors = await Promise.all(dueConnectorIds.map(async (connectorId) => {
      try {
        const connectors = await currentProvider.list({ connectorId });
        return connectors.find((candidate) => candidate.connectorId === connectorId) ?? fallbackDescriptor(connectorId);
      } catch {
        return null;
      }
    }));
    if (providerRef.current !== currentProvider || scopeKeyRef.current !== requestedScope) return;

    descriptors.forEach((descriptor, index) => {
      const connectorId = dueConnectorIds[index];
      if (!connectorId) return;
      const existingEntry = entriesRef.current.scopeKey === requestedScope
        ? entriesRef.current.entries[connectorId]
        : readStoredConnectorWorkflows(requestedScope)[connectorId];
      if (!descriptor) {
        if (existingEntry) {
          updateStoredEntry(requestedScope, connectorId, {
            workflow: existingEntry.workflow,
            lastCheckedAt: Date.now(),
            source: existingEntry.source,
            revision: CONNECTOR_WORKFLOW_PROMPT_REVISION,
          });
        }
        return;
      }
      if (activePreloadsRef.current.has(connectorId)) return;
      if (inFlightRef.current.has(`${requestedScope}:${connectorId}`)) return;
      if (preloadQueueRef.current.some((job) => job.connectorId === connectorId)) return;
      preloadQueueRef.current.push({ connectorId, descriptor, provider: currentProvider, scopeKey: requestedScope });
    });
    drainPreloadQueue();
  }, [drainPreloadQueue, updateStoredEntry]);

  const generateConnectorWorkflow = useCallback(async (connectorId: ConnectorId) => {
    const currentProvider = providerRef.current;
    const requestedScope = scopeKeyRef.current;
    const cachedEntry = entriesRef.current.scopeKey === requestedScope
      ? entriesRef.current.entries[connectorId]
      : readStoredConnectorWorkflows(requestedScope)[connectorId];
    if (connectorWorkflowEntryIsFresh(cachedEntry)) return cachedEntry!.workflow;
    if (!currentProvider) {
      if (cachedEntry) return cachedEntry.workflow;
      throw new Error("Connector setup is unavailable while the workspace is disconnected.");
    }

    demandCountRef.current += 1;
    preloadQueueRef.current = preloadQueueRef.current.filter((job) => job.connectorId !== connectorId);
    const activePreload = activePreloadsRef.current.get(connectorId);
    if (activePreload) activePreload.demanded = true;

    try {
      if (activePreload) return await activePreload.completion;
      const existingGeneration = inFlightRef.current.get(`${requestedScope}:${connectorId}`);
      if (existingGeneration) return await existingGeneration;
      const connectors = await currentProvider.list({ connectorId }).catch(() => []);
      const descriptor = connectors.find((candidate) => candidate.connectorId === connectorId)
        ?? fallbackDescriptor(connectorId);
      return await generateWithDescriptor(connectorId, descriptor, currentProvider, requestedScope);
    } finally {
      demandCountRef.current = Math.max(0, demandCountRef.current - 1);
      drainPreloadQueue();
    }
  }, [drainPreloadQueue, generateWithDescriptor]);

  useEffect(() => {
    backgroundBlockedRef.current = backgroundBlocked;
    if (backgroundBlocked) {
      for (const activePreload of activePreloadsRef.current.values()) {
        if (!activePreload.demanded) activePreload.controller.abort();
      }
    } else {
      drainPreloadQueue();
    }
  }, [backgroundBlocked, drainPreloadQueue]);

  useEffect(() => {
    generationEpochRef.current += 1;
    inFlightRef.current.clear();
    preloadQueueRef.current = [];
    for (const activePreload of activePreloadsRef.current.values()) {
      activePreload.job.cancelled = true;
      activePreload.controller.abort();
    }
    activePreloadsRef.current.clear();
  }, [provider, scopeKey]);

  useEffect(() => {
    if (workflowState.scopeKey !== scopeKey || !provider) return;
    const connectorIds = (Object.keys(workflowState.entries) as ConnectorId[]).filter((connectorId) => (
      workflowState.entries[connectorId]!.lastCheckedAt > 0
    ));
    if (connectorIds.length === 0) return;
    const now = Date.now();
    const nextRefreshAt = Math.min(...connectorIds.map((connectorId) => (
      workflowState.entries[connectorId]!.lastCheckedAt + CONNECTOR_WORKFLOW_REFRESH_INTERVAL_MS
    )));
    const refresh = () => void preloadConnectorWorkflows(connectorIds);
    if (nextRefreshAt <= now) {
      if (!backgroundBlocked) refresh();
      return;
    }
    const timer = window.setTimeout(refresh, nextRefreshAt - now);
    return () => window.clearTimeout(timer);
  }, [backgroundBlocked, preloadConnectorWorkflows, provider, scopeKey, workflowState]);

  useEffect(() => {
    mountedRef.current = true;
    const activePreloads = activePreloadsRef.current;
    return () => {
      mountedRef.current = false;
      preloadQueueRef.current = [];
      for (const activePreload of activePreloads.values()) {
        activePreload.job.cancelled = true;
        activePreload.controller.abort();
      }
      activePreloads.clear();
    };
  }, []);

  const connectorWorkflows = useMemo(
    () => workflowsFromEntries(workflowState.scopeKey === scopeKey ? workflowState.entries : {}),
    [scopeKey, workflowState],
  );

  return {
    connectorWorkflows,
    generateConnectorWorkflow,
    preloadConnectorWorkflows,
    runConnectorShellProposal: runShellProposal,
  };
}
