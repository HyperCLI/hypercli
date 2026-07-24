"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";

import { AgentFilesPanel, type AgentFilesPanelSource } from "@/components/dashboard/agents/AgentFilesPanel";
import { AgentLoadingState } from "@/components/dashboard/agents/page-helpers";
import type { FileEntry } from "@hypercli/shared-ui/files";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { managedAgentDisplayNameScope, useManagedAgentDisplayNames } from "@/hooks/useManagedAgentDisplayNames";
import { agentDisplayLabel, toAgentViewModel } from "@/components/dashboard/agents/agentViewModel";
import { createAgentClient } from "@/lib/agent-client";
import { normalizeOpenClawWorkspaceFilePath } from "@/lib/agent-file-path";
import { readFileSourceTabsPreference } from "@/lib/file-source-tabs-preference";
import { OPENCLAW_WORKSPACE_PREFIX } from "@/lib/openclaw-config";
import type { AgentFileEntry } from "@/types";
import { OpenClawAgent } from "@hypercli.com/sdk/agents";

type AgentFileSource = "auto" | "pod" | "s3";
/** The 3-way selector in AgentFilesPanel: live pod, S3 backup, or the gateway RPC. */
type AgentFilePanelSource = AgentFilesPanelSource;

/** Map the panel's backend sources onto the deployment HTTP files API wire sources. */
function backendWireSource(source: "agent" | "backup"): "pod" | "s3" {
  return source === "agent" ? "pod" : "s3";
}

const AGENT_DIRECTORY_MARKER_NAME = ".hypercli-folder";

function normalizeAgentFilePath(path: string): string {
  return normalizeOpenClawWorkspaceFilePath(path);
}

function stringFileMetadata(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function fileEntrySource(value: unknown): FileEntry["source"] | undefined {
  if (value === "agent" || value === "backup" || value === "gateway" || value === "pod" || value === "s3" || value === "auto") {
    return value;
  }
  return undefined;
}

function toDashboardFileEntry(entry: AgentFileEntry): FileEntry {
  const path = normalizeAgentFilePath(entry.path);
  return {
    name: entry.name || path.split("/").filter(Boolean).pop() || entry.path,
    path,
    type: entry.type,
    size: entry.size,
    lastModified: stringFileMetadata(entry.last_modified ?? entry.lastModified),
    checksum: stringFileMetadata(entry.checksum),
    checksumAlgorithm: stringFileMetadata(entry.checksum_algorithm ?? entry.checksumAlgorithm ?? entry.checksum_algo),
    hash: stringFileMetadata(entry.hash),
    hashAlgorithm: stringFileMetadata(entry.hash_algorithm ?? entry.hashAlgorithm),
    sha256: stringFileMetadata(entry.sha256 ?? entry.sha_256),
    md5: stringFileMetadata(entry.md5),
    etag: stringFileMetadata(entry.etag ?? entry.eTag),
    versionId: stringFileMetadata(entry.version_id ?? entry.versionId),
    source: fileEntrySource(entry.source),
  };
}

function isAgentDirectoryMarkerEntry(entry: AgentFileEntry): boolean {
  const name = entry.name || entry.path.split("/").filter(Boolean).pop() || "";
  return name === AGENT_DIRECTORY_MARKER_NAME;
}

function agentFileDestinationForState(agentState: string | null | undefined): AgentFileSource {
  return agentState === "RUNNING" ? "auto" : "s3";
}

export default function AgentFilesPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const agentId = params?.id ?? "";
  const initialFilePath = searchParams?.get("file") ?? null;
  const { getToken, user } = useAgentAuth();
  const displayNameStorageScope = managedAgentDisplayNameScope(user);
  const { displayNamesByAgentId } = useManagedAgentDisplayNames(displayNameStorageScope);
  const [agent, setAgent] = useState<OpenClawAgent | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [agentLoading, setAgentLoading] = useState(true);
  const [showFileSourceTabs] = useState(() => readFileSourceTabsPreference());

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

  const listFiles = useCallback(async (path?: string, source: AgentFilePanelSource = "agent") => {
    if (!agentId) return [];
    if (source === "gateway") {
      const entries = await gatewayFilesAgent().filesList(path ?? "", "gateway");
      return (entries as AgentFileEntry[]).map(toDashboardFileEntry);
    }
    const token = await getToken();
    const client = createAgentClient(token);
    const normalizedPath = normalizeAgentFilePath(path ?? "");
    const entries = await client.filesList(agentId, normalizedPath, backendWireSource(source));
    return (entries as AgentFileEntry[])
      .filter((entry) => !isAgentDirectoryMarkerEntry(entry))
      .map(toDashboardFileEntry);
  }, [agentId, gatewayFilesAgent, getToken]);

  const openFile = useCallback(async (path: string, requestedSource: AgentFilePanelSource = "agent") => {
    if (requestedSource === "gateway") {
      return gatewayFilesAgent().fileRead(path, "gateway");
    }
    const token = await getToken();
    return createAgentClient(token).fileRead(agentId, normalizeAgentFilePath(path), backendWireSource(requestedSource));
  }, [agentId, gatewayFilesAgent, getToken]);

  const openFileBytes = useCallback(async (path: string, requestedSource: AgentFilePanelSource = "agent") => {
    if (requestedSource === "gateway") {
      return gatewayFilesAgent().fileReadBytes(path, "gateway");
    }
    const token = await getToken();
    return createAgentClient(token).fileReadBytes(agentId, normalizeAgentFilePath(path), backendWireSource(requestedSource));
  }, [agentId, gatewayFilesAgent, getToken]);

  const saveFile = useCallback(async (path: string, content: string, destination: AgentFilePanelSource = "agent") => {
    if (destination === "gateway") {
      await gatewayFilesAgent().fileWrite(path, content, "gateway");
      return;
    }
    const token = await getToken();
    await createAgentClient(token).fileWrite(
      agentId,
      normalizeAgentFilePath(path),
      content,
      backendWireSource(destination),
    );
  }, [agentId, gatewayFilesAgent, getToken]);

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
    if (!normalizedPath) {
      throw new Error("Folder path is required.");
    }
    const token = await getToken();
    await createAgentClient(token).fileWriteBytes(
      agentId,
      `${normalizedPath}/${AGENT_DIRECTORY_MARKER_NAME}`,
      new Uint8Array(),
      "s3",
    );
  }, [agentId, getToken]);

  const filesDefaultSource: AgentFilesPanelSource = agent?.state === "RUNNING" ? "agent" : "backup";
  const agentView = useMemo(() => agent ? toAgentViewModel(agent, {
    managedDisplayName: displayNamesByAgentId[agent.id],
  }) : null, [agent, displayNamesByAgentId]);
  const filesSourceDisabledReasons = useMemo<Partial<Record<AgentFilesPanelSource, string>>>(() => {
    const reasons: Partial<Record<AgentFilesPanelSource, string>> = {};
    if (!agent) return reasons;
    if (agent.state !== "RUNNING") {
      reasons.agent = "Start the agent to browse live files.";
      reasons.gateway = "Start the agent to browse gateway files.";
      return reasons;
    }
    if (!(agent instanceof OpenClawAgent)) {
      reasons.gateway = "Gateway files are only available for OpenClaw agents.";
    }
    return reasons;
  }, [agent]);

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
        <p className="text-sm text-destructive">{agentError ?? "Agent not found"}</p>
        <Link href="/dashboard/agents" className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-surface-low">
          Back to agents
        </Link>
      </div>
    );
  }

  return (
    <AgentFilesPanel
      agentId={agentId}
      agentName={agentView ? agentDisplayLabel(agentView) : "Agent"}
      rootPath={OPENCLAW_WORKSPACE_PREFIX}
      defaultSource={filesDefaultSource}
      sourceDisabledReasons={filesSourceDisabledReasons}
      showSourceTabs={showFileSourceTabs}
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
