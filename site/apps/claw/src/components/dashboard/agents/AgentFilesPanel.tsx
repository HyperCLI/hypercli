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
} from "@/lib/agent-file-path";
import { OPENCLAW_WORKSPACE_PREFIX } from "@/lib/openclaw-config";
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

function absoluteSyncPath(path: string, syncRoot: string): string {
  const normalized = normalizeAgentBrowserFilePath(path);
  if (!normalized) return syncRoot;
  if (normalized.startsWith("/")) return normalized;
  return normalizeAgentBrowserFilePath(`${syncRoot}/${normalized}`);
}

function syncRelativePath(path: string, syncRoot: string): string {
  const normalized = normalizeAgentBrowserFilePath(path);
  if (!normalized.startsWith("/")) {
    if (normalized === ".." || normalized.startsWith("../")) {
      throw new Error("This location is browse-only.");
    }
    return normalized;
  }
  if (!syncRoot) throw new Error("The synchronized filesystem root is unavailable.");
  if (normalized === syncRoot) return "";
  if (normalized.startsWith(`${syncRoot}/`)) {
    return normalized.slice(syncRoot.length + 1);
  }
  throw new Error("This location is browse-only.");
}

function normalizeInitialPreviewPath(path: string, syncRoot: string): string {
  const trimmed = path.trim();
  const browserPath = normalizeAgentBrowserFilePath(trimmed.replace(/^MEDIA:\s*/i, ""));
  const isLegacyMediaPath = /^MEDIA:/i.test(trimmed)
    || (browserPath.startsWith("/home/")
      && browserPath !== syncRoot
      && !browserPath.startsWith(`${syncRoot}/`));
  return browserPath.startsWith("/") && !isLegacyMediaPath
    ? browserPath
    : normalizeOpenClawMediaFilePath(trimmed);
}

function sourceReadPath(path: string, source: AgentFilesPanelSource, syncRoot: string): string {
  if (source === "gateway") return normalizeAgentBrowserFilePath(path);
  return syncRelativePath(path, syncRoot);
}

function sourceWritePath(path: string, source: AgentFilesPanelSource, syncRoot: string): string {
  if (source === "gateway") return normalizeAgentBrowserFilePath(path);
  return syncRelativePath(path, syncRoot);
}

function displayPath(path: string, source: AgentFilesPanelSource, syncRoot: string): string {
  return source === "gateway"
    ? normalizeAgentBrowserFilePath(path)
    : absoluteSyncPath(path, syncRoot);
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
  syncRoot: string,
  parentPath?: string,
): FileEntry {
  return { ...entry, path: displayPath(entryBackendPath(entry, parentPath, source), source, syncRoot) };
}

function displayOpenResult<T extends string | Uint8Array>(
  result: AgentFileOpenResponse<T>,
  source: AgentFilesPanelSource,
  syncRoot: string,
): AgentFileOpenResponse<T> {
  if (!result || typeof result !== "object" || result instanceof Uint8Array || !("content" in result)) {
    return result;
  }
  return result.path ? { ...result, path: displayPath(result.path, source, syncRoot) } : result;
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
  const normalizedRootPath = rootPath ? normalizeAgentBrowserFilePath(rootPath) : "";
  const sourcePaths = useMemo<AgentFilesPanelSourcePaths | undefined>(() => {
    if (!normalizedRootPath) return sourcePathsOverride;
    return {
      agent: {
        homePath: normalizedRootPath,
        rootPath: normalizedRootPath,
        writableRootPath: normalizedRootPath,
      },
      backup: {
        homePath: normalizedRootPath,
        rootPath: normalizedRootPath,
        writableRootPath: normalizedRootPath,
      },
      gateway: {
        homePath: OPENCLAW_WORKSPACE_PREFIX,
        rootPath: OPENCLAW_WORKSPACE_PREFIX,
        writableRootPath: null,
      },
      ...sourcePathsOverride,
    };
  }, [normalizedRootPath, sourcePathsOverride]);

  const listFiles = useCallback(async (path?: string, source: AgentFilesPanelSource = "agent") => {
    const backendPath = path === undefined ? undefined : sourceReadPath(path, source, normalizedRootPath);
    const entries = await onListFiles(backendPath, source);
    return entries.map((entry) => displayEntry(entry, source, normalizedRootPath, backendPath));
  }, [normalizedRootPath, onListFiles]);

  const openFile = useCallback(async (path: string, source: AgentFilesPanelSource = "agent") => (
    displayOpenResult(
      await onOpenFile(sourceReadPath(path, source, normalizedRootPath), source),
      source,
      normalizedRootPath,
    )
  ), [normalizedRootPath, onOpenFile]);

  const openFileBytes = useCallback(async (
    path: string,
    source: AgentFilesPanelSource = "agent",
    options?: Parameters<NonNullable<AgentFilesPanelProps["onOpenFileBytes"]>>[2],
  ) => {
    if (!onOpenFileBytes) return new Uint8Array();
    return displayOpenResult(
      await onOpenFileBytes(sourceReadPath(path, source, normalizedRootPath), source, options),
      source,
      normalizedRootPath,
    );
  }, [normalizedRootPath, onOpenFileBytes]);

  const downloadFileBytes = useCallback(async (path: string, source: AgentFilesPanelSource = "agent") => {
    if (!onDownloadFileBytes) return new Uint8Array();
    return displayOpenResult(
      await onDownloadFileBytes(sourceReadPath(path, source, normalizedRootPath), source),
      source,
      normalizedRootPath,
    );
  }, [normalizedRootPath, onDownloadFileBytes]);

  const saveFile = useCallback(async (path: string, content: string, source: AgentFilesPanelSource = "agent") => {
    if (!onSaveFile) return;
    await onSaveFile(sourceWritePath(path, source, normalizedRootPath), content, source);
  }, [normalizedRootPath, onSaveFile]);

  const deleteFile = useCallback(async (
    path: string,
    options?: { recursive?: boolean },
    source: AgentFilesPanelSource = "agent",
  ) => {
    if (!onDeleteFile) return;
    await onDeleteFile(sourceWritePath(path, source, normalizedRootPath), options, source);
  }, [normalizedRootPath, onDeleteFile]);

  const uploadFile = useCallback(async (
    path: string,
    content: Uint8Array,
    source: Exclude<AgentFilesPanelSource, "gateway">,
  ) => {
    if (!onUploadFile) return;
    await onUploadFile(sourceWritePath(path, source, normalizedRootPath), content, source);
  }, [normalizedRootPath, onUploadFile]);

  const createDirectory = useCallback(async (
    path: string,
    source: Exclude<AgentFilesPanelSource, "gateway">,
  ) => {
    if (!onCreateDirectory) return;
    await onCreateDirectory(sourceWritePath(path, source, normalizedRootPath), source);
  }, [normalizedRootPath, onCreateDirectory]);

  const normalizedInitialPreviewPath = initialPreviewPath
    ? normalizeInitialPreviewPath(initialPreviewPath, normalizedRootPath)
    : undefined;

  return (
    <SharedAgentFilesPanel
      {...props}
      rootPath={normalizedRootPath}
      sourcePaths={sourcePaths}
      defaultSource={defaultSource}
      initialPreviewPath={normalizedInitialPreviewPath
        ? displayPath(normalizedInitialPreviewPath, defaultSource, normalizedRootPath)
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
