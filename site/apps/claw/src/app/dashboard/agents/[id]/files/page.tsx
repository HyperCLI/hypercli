"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";

import { AgentFilesPanel } from "@/components/dashboard/agents/AgentFilesPanel";
import { AgentLoadingState } from "@/components/dashboard/agents/page-helpers";
import type { FileEntry } from "@/components/dashboard/files/types";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { createAgentClient } from "@/lib/agent-client";
import { normalizeOpenClawWorkspaceFilePath } from "@/lib/agent-file-path";
import { OPENCLAW_WORKSPACE_PREFIX } from "@/lib/openclaw-config";
import type { AgentFileEntry } from "@/types";
import { OpenClawAgent } from "@hypercli.com/sdk/agents";

type AgentFileSource = "auto" | "pod" | "s3";
type AgentFilePanelSource = AgentFileSource | "gateway";

const AGENT_DIRECTORY_MARKER_NAME = ".hypercli-folder";

function normalizeAgentFilePath(path: string): string {
  return normalizeOpenClawWorkspaceFilePath(path);
}

function toDashboardFileEntry(entry: AgentFileEntry): FileEntry {
  const path = normalizeAgentFilePath(entry.path);
  return {
    name: entry.name || path.split("/").filter(Boolean).pop() || entry.path,
    path,
    type: entry.type,
    size: entry.size,
    lastModified: entry.last_modified,
  };
}

function isAgentDirectoryMarkerEntry(entry: AgentFileEntry): boolean {
  const name = entry.name || entry.path.split("/").filter(Boolean).pop() || "";
  return name === AGENT_DIRECTORY_MARKER_NAME;
}

function agentFileSourceForState(agentState: string | null | undefined, requested: AgentFileSource): AgentFileSource {
  if (requested !== "auto") return requested;
  return agentState === "RUNNING" ? "auto" : "s3";
}

function agentFileDestinationForState(agentState: string | null | undefined): AgentFileSource {
  return agentState === "RUNNING" ? "auto" : "s3";
}

export default function AgentFilesPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const agentId = params?.id ?? "";
  const initialFilePath = searchParams?.get("file") ?? null;
  const { getToken } = useAgentAuth();
  const [agent, setAgent] = useState<OpenClawAgent | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [agentLoading, setAgentLoading] = useState(true);

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await getToken();
        const deployment = await createAgentClient(token).get(agentId);
        if (!cancelled) setAgent(deployment as OpenClawAgent);
      } catch (e) {
        if (!cancelled) setAgentError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setAgentLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, getToken]);

  // Gateway file ops go through the SDK's OpenClawAgent instance (operator-WS agents.files.*),
  // so they need the hydrated agent record rather than the Deployments client.
  const gatewayFilesAgent = useCallback((): OpenClawAgent => {
    if (!agent) throw new Error("Agent record is still loading.");
    if (!(agent instanceof OpenClawAgent)) {
      throw new Error("Gateway files are only available for OpenClaw agents.");
    }
    return agent;
  }, [agent]);

  const listFiles = useCallback(async (path?: string, source: AgentFilePanelSource = "auto") => {
    if (!agentId) return [];
    if (source === "gateway") {
      const entries = await gatewayFilesAgent().filesList(path ?? "", "gateway");
      return (entries as AgentFileEntry[]).map(toDashboardFileEntry);
    }
    const token = await getToken();
    const client = createAgentClient(token);
    const normalizedPath = normalizeAgentFilePath(path ?? "");
    const preferredSource = agentFileSourceForState(agent?.state, source);
    const entries = await client.filesList(agentId, normalizedPath, preferredSource);
    if (preferredSource === "auto" && entries.length === 0) {
      for (const fallbackSource of ["s3", "pod"] as const) {
        try {
          const fallbackEntries = await client.filesList(agentId, normalizedPath, fallbackSource);
          if (fallbackEntries.length > 0) return (fallbackEntries as AgentFileEntry[])
            .filter((entry) => !isAgentDirectoryMarkerEntry(entry))
            .map(toDashboardFileEntry);
        } catch {}
      }
    }
    return (entries as AgentFileEntry[])
      .filter((entry) => !isAgentDirectoryMarkerEntry(entry))
      .map(toDashboardFileEntry);
  }, [agent?.state, agentId, gatewayFilesAgent, getToken]);

  const openFile = useCallback(async (path: string, requestedSource: AgentFilePanelSource = "auto") => {
    if (requestedSource === "gateway") {
      return gatewayFilesAgent().fileRead(path, "gateway");
    }
    const token = await getToken();
    const source = agentFileSourceForState(agent?.state, requestedSource);
    return createAgentClient(token).fileRead(agentId, normalizeAgentFilePath(path), source);
  }, [agent?.state, agentId, gatewayFilesAgent, getToken]);

  const openFileBytes = useCallback(async (path: string, requestedSource: AgentFilePanelSource = "auto") => {
    if (requestedSource === "gateway") {
      return gatewayFilesAgent().fileReadBytes(path, "gateway");
    }
    const token = await getToken();
    const source = agentFileSourceForState(agent?.state, requestedSource);
    return createAgentClient(token).fileReadBytes(agentId, normalizeAgentFilePath(path), source);
  }, [agent?.state, agentId, gatewayFilesAgent, getToken]);

  const saveFile = useCallback(async (path: string, content: string, destination: AgentFilePanelSource = "auto") => {
    if (destination === "gateway") {
      await gatewayFilesAgent().fileWrite(path, content, "gateway");
      return;
    }
    const token = await getToken();
    await createAgentClient(token).fileWrite(
      agentId,
      normalizeAgentFilePath(path),
      content,
      agentFileDestinationForState(agent?.state),
    );
  }, [agent?.state, agentId, gatewayFilesAgent, getToken]);

  const deleteFile = useCallback(async (path: string, options?: { recursive?: boolean }) => {
    const token = await getToken();
    await createAgentClient(token).fileDelete(agentId, normalizeAgentFilePath(path), options);
  }, [agentId, getToken]);

  const uploadFile = useCallback(async (path: string, content: Uint8Array) => {
    const token = await getToken();
    await createAgentClient(token).fileWriteBytes(
      agentId,
      normalizeAgentFilePath(path),
      content,
      agentFileDestinationForState(agent?.state),
    );
  }, [agent?.state, agentId, getToken]);

  const createDirectory = useCallback(async (path: string) => {
    const normalizedPath = normalizeAgentFilePath(path);
    if (normalizedPath === OPENCLAW_WORKSPACE_PREFIX || !normalizedPath.startsWith(`${OPENCLAW_WORKSPACE_PREFIX}/`)) {
      throw new Error("Folders can only be created inside the workspace.");
    }
    const token = await getToken();
    await createAgentClient(token).fileWriteBytes(
      agentId,
      `${normalizedPath}/${AGENT_DIRECTORY_MARKER_NAME}`,
      new Uint8Array(),
      "s3",
    );
  }, [agentId, getToken]);

  if (agentLoading) {
    return (
      <AgentLoadingState
        title="Loading agent record"
        detail="Opening the agent file browser."
        tone="loading"
        stage="complete"
      />
    );
  }

  if (agentError || !agent) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-text-muted">
        <p className="text-sm text-[#d05f5f]">{agentError ?? "Agent not found"}</p>
        <Link href="/dashboard/agents" className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-surface-low">
          Back to agents
        </Link>
      </div>
    );
  }

  return (
    <AgentFilesPanel
      agentId={agentId}
      agentName={agent.name || agent.podName || "Agent"}
      rootPath={OPENCLAW_WORKSPACE_PREFIX}
      connected={Boolean(agentId)}
      initialPreviewPath={initialFilePath}
      isDesktopViewport
      error={null}
      onListFiles={listFiles}
      onOpenFile={openFile}
      onOpenFileBytes={openFileBytes}
      onDownloadFileBytes={openFileBytes}
      onSaveFile={saveFile}
      onDeleteFile={deleteFile}
      onUploadFile={uploadFile}
      onCreateDirectory={createDirectory}
    />
  );
}
