"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";

import {
  AgentFilesPanel,
  type AgentFilePreviewReadOptions,
} from "@/components/dashboard/agents/AgentFilesPanel";
import { AgentLoadingState } from "@/components/dashboard/agents/page-helpers";
import type { FileEntry } from "@hypercli/shared-ui/files";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { useAgentDashboardDesktopViewport } from "@/hooks/useAgentDashboardViewport";
import { agentDisplayLabel, toAgentViewModel } from "@/components/dashboard/agents/agentViewModel";
import { createAgentClient } from "@/lib/agent-client";
import {
  launchConfigSyncRoot,
  normalizeAgentBrowserFilePath,
} from "@/lib/agent-file-path";
import type { AgentFileEntry } from "@/types";
import { OpenClawAgent } from "@hypercli.com/sdk/agents";

const AGENT_DIRECTORY_MARKER_NAME = ".hypercli-folder";

function normalizeAgentFilePath(path: string): string {
  return normalizeAgentBrowserFilePath(path);
}

function stringFileMetadata(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function toDashboardFileEntry(entry: AgentFileEntry): FileEntry {
  const path = normalizeAgentFilePath(entry.path);
  return {
    name: entry.name || path.split("/").filter(Boolean).pop() || entry.path,
    path,
    type: entry.type,
    size: entry.size,
    mimeType: stringFileMetadata(entry.mime_type)
      ?? stringFileMetadata(entry.mimeType)
      ?? stringFileMetadata(entry.content_type)
      ?? stringFileMetadata(entry.contentType),
    lastModified: stringFileMetadata(entry.last_modified ?? entry.lastModified),
    checksum: stringFileMetadata(entry.checksum),
    checksumAlgorithm: stringFileMetadata(entry.checksum_algorithm ?? entry.checksumAlgorithm ?? entry.checksum_algo),
    hash: stringFileMetadata(entry.hash),
    hashAlgorithm: stringFileMetadata(entry.hash_algorithm ?? entry.hashAlgorithm),
    sha256: stringFileMetadata(entry.sha256 ?? entry.sha_256),
    md5: stringFileMetadata(entry.md5),
    etag: stringFileMetadata(entry.etag ?? entry.eTag),
    versionId: stringFileMetadata(entry.version_id ?? entry.versionId),
  };
}

function isAgentDirectoryMarkerEntry(entry: AgentFileEntry): boolean {
  const name = entry.name || entry.path.split("/").filter(Boolean).pop() || "";
  return name === AGENT_DIRECTORY_MARKER_NAME;
}

export default function AgentFilesPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const agentId = params?.id ?? "";
  const initialFilePath = searchParams?.get("file") ?? null;
  const { getToken, user } = useAgentAuth();
  const agentRequestKey = user?.id && agentId ? `${user.id}:${agentId}` : null;
  const [agentLoad, setAgentLoad] = useState<{
    key: string;
    agent: OpenClawAgent | null;
    error: string | null;
  } | null>(null);
  const activeAgentLoad = agentLoad?.key === agentRequestKey ? agentLoad : null;
  const agent = activeAgentLoad?.agent ?? null;
  const agentError = activeAgentLoad?.error ?? null;
  const agentLoading = Boolean(agentRequestKey && !activeAgentLoad);
  const isDesktopViewport = useAgentDashboardDesktopViewport();

  useEffect(() => {
    if (!agentRequestKey) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await getToken();
        const deployment = await createAgentClient(token).get(agentId);
        if (!cancelled) setAgentLoad({ key: agentRequestKey, agent: deployment as OpenClawAgent, error: null });
      } catch (e) {
        if (!cancelled) setAgentLoad({
          key: agentRequestKey,
          agent: null,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, agentRequestKey, getToken]);

  const listFiles = useCallback(async (path?: string) => {
    if (!agentId) return [];
    const token = await getToken();
    const client = createAgentClient(token);
    const normalizedPath = normalizeAgentFilePath(path ?? "");
    const entries = await client.filesList(agentId, normalizedPath);
    return (entries as AgentFileEntry[])
      .filter((entry) => !isAgentDirectoryMarkerEntry(entry))
      .map(toDashboardFileEntry);
  }, [agentId, getToken]);

  const openFile = useCallback(async (path: string) => {
    const token = await getToken();
    return createAgentClient(token).fileRead(agentId, normalizeAgentFilePath(path));
  }, [agentId, getToken]);

  const openFileBytes = useCallback(async (
    path: string,
    options?: AgentFilePreviewReadOptions,
  ) => {
    const token = await getToken();
    return createAgentClient(token).fileReadBytesWithMetadata(
      agentId,
      normalizeAgentFilePath(path),
      options,
    );
  }, [agentId, getToken]);

  const saveFile = useCallback(async (path: string, content: string) => {
    const token = await getToken();
    await createAgentClient(token).fileWrite(
      agentId,
      normalizeAgentFilePath(path),
      content,
    );
  }, [agentId, getToken]);

  const deleteFile = useCallback(async (
    path: string,
    options?: { recursive?: boolean },
  ) => {
    const token = await getToken();
    await createAgentClient(token).fileDelete(agentId, normalizeAgentFilePath(path), options);
  }, [agentId, getToken]);

  const uploadFile = useCallback(async (path: string, content: Uint8Array) => {
    const token = await getToken();
    await createAgentClient(token).fileWriteBytes(
      agentId,
      normalizeAgentFilePath(path),
      content,
    );
  }, [agentId, getToken]);

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
    );
  }, [agentId, getToken]);

  const agentView = useMemo(() => agent ? toAgentViewModel(agent) : null, [agent]);
  const filesSyncRoot = useMemo(
    () => launchConfigSyncRoot(agent?.launchConfig),
    [agent],
  );

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
      rootPath={filesSyncRoot}
      connected={Boolean(agentId)}
      initialPreviewPath={initialFilePath}
      isDesktopViewport={isDesktopViewport}
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
