"use client";

import { useCallback, useMemo } from "react";
import {
  AgentFilesPanel as SharedAgentFilesPanel,
  type AgentFileOpenResponse,
  type AgentFilesPanelProps,
  type AgentFilesPanelSource,
  type AgentFilesPanelSourcePaths,
  type FileEntry,
} from "@hypercli/shared-ui/files";

import { MarkdownContent } from "@/components/dashboard/chat/MarkdownContent";
import {
  normalizeAgentBrowserFilePath,
  normalizeOpenClawMediaFilePath,
  normalizeOpenClawWorkspaceFilePath,
} from "@/lib/agent-file-path";
import { OPENCLAW_SYNC_ROOT } from "@/lib/openclaw-config";
import { isProtectedFile } from "@/lib/protected-files";

export type {
  AgentFileOpenResponse,
  AgentFileOpenResult,
  AgentFilePreviewReadOptions,
  AgentFilesPanelProps,
  AgentFilesPanelSource,
  AgentFilesPanelSourceDisabledReasons,
  AgentFilesPanelSourcePathScope,
  AgentFilesPanelSourcePaths,
} from "@hypercli/shared-ui/files";

function renderMarkdown(content: string, className?: string) {
  return <MarkdownContent content={content} className={className} />;
}

function absoluteSyncPath(path: string): string {
  const normalized = normalizeAgentBrowserFilePath(path);
  if (!normalized) return OPENCLAW_SYNC_ROOT;
  if (normalized.startsWith("/")) return normalized;
  return normalizeAgentBrowserFilePath(`${OPENCLAW_SYNC_ROOT}/${normalized}`);
}

function syncRelativePath(path: string): string {
  const normalized = normalizeAgentBrowserFilePath(path);
  if (!normalized.startsWith("/")) {
    if (normalized === ".." || normalized.startsWith("../")) {
      throw new Error("This location is browse-only.");
    }
    return normalized;
  }
  if (normalized === OPENCLAW_SYNC_ROOT) return "";
  if (normalized.startsWith(`${OPENCLAW_SYNC_ROOT}/`)) {
    return normalized.slice(OPENCLAW_SYNC_ROOT.length + 1);
  }
  throw new Error("This location is browse-only.");
}

function normalizeInitialPreviewPath(path: string): string {
  const trimmed = path.trim();
  const browserPath = normalizeAgentBrowserFilePath(trimmed.replace(/^MEDIA:\s*/i, ""));
  const isLegacyMediaPath = /^MEDIA:/i.test(trimmed)
    || (browserPath.startsWith("/home/")
      && browserPath !== OPENCLAW_SYNC_ROOT
      && !browserPath.startsWith(`${OPENCLAW_SYNC_ROOT}/`));
  return browserPath.startsWith("/") && !isLegacyMediaPath
    ? browserPath
    : normalizeOpenClawMediaFilePath(trimmed);
}

function sourceReadPath(path: string, source: AgentFilesPanelSource): string {
  if (source === "gateway") return normalizeAgentBrowserFilePath(path);
  return syncRelativePath(path);
}

function sourceWritePath(path: string, source: AgentFilesPanelSource): string {
  if (source === "gateway") return normalizeAgentBrowserFilePath(path);
  return syncRelativePath(path);
}

function displayPath(path: string, source: AgentFilesPanelSource): string {
  return source === "gateway"
    ? normalizeAgentBrowserFilePath(path)
    : absoluteSyncPath(path);
}

function entryBackendPath(entry: FileEntry, parentPath: string | undefined, source: AgentFilesPanelSource): string {
  const rawPath = typeof (entry as { path?: unknown }).path === "string" ? entry.path : entry.name;
  const normalizedPath = normalizeAgentBrowserFilePath(rawPath);
  if (source === "gateway" || normalizedPath.startsWith("/")) return normalizedPath;

  const normalizedParent = normalizeAgentBrowserFilePath(parentPath ?? "");
  if (
    !normalizedParent ||
    normalizedPath === normalizedParent ||
    normalizedPath.startsWith(`${normalizedParent}/`)
  ) {
    return normalizedPath;
  }
  return normalizeAgentBrowserFilePath(`${normalizedParent}/${normalizedPath}`);
}

function displayEntry(
  entry: FileEntry,
  source: AgentFilesPanelSource,
  parentPath?: string,
): FileEntry {
  return { ...entry, path: displayPath(entryBackendPath(entry, parentPath, source), source) };
}

function displayOpenResult<T extends string | Uint8Array>(
  result: AgentFileOpenResponse<T>,
  source: AgentFilesPanelSource,
): AgentFileOpenResponse<T> {
  if (!result || typeof result !== "object" || result instanceof Uint8Array || !("content" in result)) {
    return result;
  }
  return result.path ? { ...result, path: displayPath(result.path, source) } : result;
}

export function AgentFilesPanel({
  rootPath,
  sourcePaths: sourcePathsOverride,
  defaultSource = "agent",
  initialPreviewPath,
  isReadOnlyFile,
  renderMarkdown: renderMarkdownOverride,
  onListFiles,
  onOpenFile,
  onOpenFileBytes,
  onDownloadFileBytes,
  onSaveFile,
  onDeleteFile,
  onUploadFile,
  onCreateDirectory,
  ...props
}: AgentFilesPanelProps) {
  const normalizedRootPath = rootPath ? normalizeOpenClawWorkspaceFilePath(rootPath) : "";
  const sourcePaths = useMemo<AgentFilesPanelSourcePaths | undefined>(() => {
    if (!normalizedRootPath) return sourcePathsOverride;
    const homeRelativePath = normalizedRootPath.split("/").filter(Boolean)[0] ?? normalizedRootPath;
    const homePath = absoluteSyncPath(homeRelativePath);
    return {
      agent: {
        homePath,
        rootPath: OPENCLAW_SYNC_ROOT,
        writableRootPath: OPENCLAW_SYNC_ROOT,
      },
      backup: {
        homePath,
        rootPath: OPENCLAW_SYNC_ROOT,
        writableRootPath: OPENCLAW_SYNC_ROOT,
      },
      gateway: {
        homePath: normalizedRootPath,
        rootPath: normalizedRootPath,
        writableRootPath: null,
      },
      ...sourcePathsOverride,
    };
  }, [normalizedRootPath, sourcePathsOverride]);

  const listFiles = useCallback(async (path?: string, source: AgentFilesPanelSource = "agent") => {
    const backendPath = path === undefined ? undefined : sourceReadPath(path, source);
    const entries = await onListFiles(backendPath, source);
    return entries.map((entry) => displayEntry(entry, source, backendPath));
  }, [onListFiles]);

  const openFile = useCallback(async (path: string, source: AgentFilesPanelSource = "agent") => (
    displayOpenResult(await onOpenFile(sourceReadPath(path, source), source), source)
  ), [onOpenFile]);

  const openFileBytes = useCallback(async (
    path: string,
    source: AgentFilesPanelSource = "agent",
    options?: Parameters<NonNullable<AgentFilesPanelProps["onOpenFileBytes"]>>[2],
  ) => {
    if (!onOpenFileBytes) return new Uint8Array();
    return displayOpenResult(await onOpenFileBytes(sourceReadPath(path, source), source, options), source);
  }, [onOpenFileBytes]);

  const downloadFileBytes = useCallback(async (path: string, source: AgentFilesPanelSource = "agent") => {
    if (!onDownloadFileBytes) return new Uint8Array();
    return displayOpenResult(await onDownloadFileBytes(sourceReadPath(path, source), source), source);
  }, [onDownloadFileBytes]);

  const saveFile = useCallback(async (path: string, content: string, source: AgentFilesPanelSource = "agent") => {
    if (!onSaveFile) return;
    await onSaveFile(sourceWritePath(path, source), content, source);
  }, [onSaveFile]);

  const deleteFile = useCallback(async (
    path: string,
    options?: { recursive?: boolean },
    source: AgentFilesPanelSource = "agent",
  ) => {
    if (!onDeleteFile) return;
    await onDeleteFile(sourceWritePath(path, source), options, source);
  }, [onDeleteFile]);

  const uploadFile = useCallback(async (
    path: string,
    content: Uint8Array,
    source: Exclude<AgentFilesPanelSource, "gateway">,
  ) => {
    if (!onUploadFile) return;
    await onUploadFile(sourceWritePath(path, source), content, source);
  }, [onUploadFile]);

  const createDirectory = useCallback(async (
    path: string,
    source: Exclude<AgentFilesPanelSource, "gateway">,
  ) => {
    if (!onCreateDirectory) return;
    await onCreateDirectory(sourceWritePath(path, source), source);
  }, [onCreateDirectory]);

  const normalizedInitialPreviewPath = initialPreviewPath
    ? normalizeInitialPreviewPath(initialPreviewPath)
    : undefined;

  return (
    <SharedAgentFilesPanel
      {...props}
      rootPath={normalizedRootPath}
      sourcePaths={sourcePaths}
      defaultSource={defaultSource}
      initialPreviewPath={normalizedInitialPreviewPath
        ? displayPath(normalizedInitialPreviewPath, defaultSource)
        : initialPreviewPath}
      onListFiles={listFiles}
      onOpenFile={openFile}
      onOpenFileBytes={onOpenFileBytes ? openFileBytes : undefined}
      onDownloadFileBytes={onDownloadFileBytes ? downloadFileBytes : undefined}
      onSaveFile={onSaveFile ? saveFile : undefined}
      onDeleteFile={onDeleteFile ? deleteFile : undefined}
      onUploadFile={onUploadFile ? uploadFile : undefined}
      onCreateDirectory={onCreateDirectory ? createDirectory : undefined}
      isReadOnlyFile={isReadOnlyFile ?? isProtectedFile}
      renderMarkdown={renderMarkdownOverride ?? renderMarkdown}
    />
  );
}
