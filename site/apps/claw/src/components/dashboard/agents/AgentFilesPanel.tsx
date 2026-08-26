"use client";

import { useCallback, useMemo } from "react";
import {
  AgentFilesPanel as SharedAgentFilesPanel,
  type AgentFileOpenResponse,
  type AgentFilePreviewReadOptions,
  type AgentFilesPanelProps as SharedAgentFilesPanelProps,
  type AgentFilesPanelSourcePaths,
  type FileEntry,
} from "@hypercli/shared-ui/files";

import { MarkdownContent } from "@/components/dashboard/chat/MarkdownContent";
import {
  normalizeAgentBrowserFilePath,
  normalizeOpenClawMediaFilePath,
  resolveAgentFileSourcePath,
} from "@/lib/agent-file-path";
import { isProtectedFile } from "@/lib/protected-files";

export type {
  AgentFileOpenResponse,
  AgentFileOpenResult,
  AgentFilePreviewReadOptions,
} from "@hypercli/shared-ui/files";

export type AgentFilesPanelProps = Omit<
  SharedAgentFilesPanelProps,
  | "sourcePaths"
  | "defaultSource"
  | "sourceDisabledReasons"
  | "showSourceTabs"
  | "onListFiles"
  | "onOpenFile"
  | "onOpenFileBytes"
  | "onDownloadFileBytes"
  | "onSaveFile"
  | "onDeleteFile"
  | "onUploadFile"
  | "onCreateDirectory"
> & {
  onRequestProductUse?: () => boolean;
  onListFiles: (path?: string) => Promise<FileEntry[]>;
  onOpenFile: (path: string) => Promise<AgentFileOpenResponse<string>>;
  onOpenFileBytes?: (
    path: string,
    options?: AgentFilePreviewReadOptions,
  ) => Promise<AgentFileOpenResponse<Uint8Array>>;
  onDownloadFileBytes?: (path: string) => Promise<AgentFileOpenResponse<Uint8Array>>;
  onSaveFile?: (path: string, content: string) => Promise<void>;
  onDeleteFile?: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  onUploadFile?: (path: string, content: Uint8Array) => Promise<void>;
  onCreateDirectory?: (path: string) => Promise<void>;
};

function renderMarkdown(content: string, className?: string) {
  return <MarkdownContent content={content} className={className} />;
}

function absoluteSyncPath(path: string, syncRoot: string): string {
  const normalized = normalizeAgentBrowserFilePath(path);
  if (!normalized) return syncRoot;
  if (normalized.startsWith("/")) return normalized;
  if (normalized === syncRoot || normalized.startsWith(`${syncRoot}/`)) return normalized;
  return normalizeAgentBrowserFilePath(`${syncRoot}/${normalized}`);
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

function sourceReadPath(path: string, syncRoot: string): string {
  return resolveAgentFileSourcePath(path, syncRoot);
}

function sourceWritePath(path: string, syncRoot: string): string {
  return resolveAgentFileSourcePath(path, syncRoot);
}

function displayPath(path: string, syncRoot: string): string {
  return absoluteSyncPath(path, syncRoot);
}

function entryBackendPath(entry: FileEntry, parentPath: string | undefined): string {
  const rawPath = typeof (entry as { path?: unknown }).path === "string" ? entry.path : entry.name;
  const normalizedPath = normalizeAgentBrowserFilePath(rawPath);
  if (normalizedPath.startsWith("/")) return normalizedPath;

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
  syncRoot: string,
  parentPath?: string,
): FileEntry {
  return { ...entry, path: displayPath(entryBackendPath(entry, parentPath), syncRoot) };
}

function displayOpenResult<T extends string | Uint8Array>(
  result: AgentFileOpenResponse<T>,
  syncRoot: string,
): AgentFileOpenResponse<T> {
  if (!result || typeof result !== "object" || result instanceof Uint8Array || !("content" in result)) {
    return result;
  }
  return result.path ? { ...result, path: displayPath(result.path, syncRoot) } : result;
}

export function AgentFilesPanel({
  rootPath,
  initialPreviewPath,
  isReadOnlyFile,
  renderMarkdown: renderMarkdownOverride,
  onRequestProductUse,
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
    if (!normalizedRootPath) return undefined;
    return {
      agent: {
        homePath: normalizedRootPath,
        rootPath: normalizedRootPath,
        writableRootPath: normalizedRootPath,
      },
    };
  }, [normalizedRootPath]);

  const listFiles = useCallback(async (path?: string) => {
    const backendPath = path === undefined ? undefined : sourceReadPath(path, normalizedRootPath);
    const entries = await onListFiles(backendPath);
    return entries.map((entry) => displayEntry(entry, normalizedRootPath, backendPath));
  }, [normalizedRootPath, onListFiles]);

  const openFile = useCallback(async (path: string) => (
    displayOpenResult(
      await onOpenFile(sourceReadPath(path, normalizedRootPath)),
      normalizedRootPath,
    )
  ), [normalizedRootPath, onOpenFile]);

  const openFileBytes = useCallback(async (
    path: string,
    _source?: Parameters<NonNullable<SharedAgentFilesPanelProps["onOpenFileBytes"]>>[1],
    options?: AgentFilePreviewReadOptions,
  ) => {
    if (!onOpenFileBytes) return new Uint8Array();
    return displayOpenResult(
      await onOpenFileBytes(sourceReadPath(path, normalizedRootPath), options),
      normalizedRootPath,
    );
  }, [normalizedRootPath, onOpenFileBytes]);

  const downloadFileBytes = useCallback(async (path: string) => {
    if (!onDownloadFileBytes) return new Uint8Array();
    return displayOpenResult(
      await onDownloadFileBytes(sourceReadPath(path, normalizedRootPath)),
      normalizedRootPath,
    );
  }, [normalizedRootPath, onDownloadFileBytes]);

  const saveFile = useCallback(async (path: string, content: string) => {
    if (!onSaveFile) return;
    if (onRequestProductUse && !onRequestProductUse()) return;
    await onSaveFile(sourceWritePath(path, normalizedRootPath), content);
  }, [normalizedRootPath, onRequestProductUse, onSaveFile]);

  const deleteFile = useCallback(async (
    path: string,
    options?: { recursive?: boolean },
  ) => {
    if (!onDeleteFile) return;
    await onDeleteFile(sourceWritePath(path, normalizedRootPath), options);
  }, [normalizedRootPath, onDeleteFile]);

  const uploadFile = useCallback(async (
    path: string,
    content: Uint8Array,
  ) => {
    if (!onUploadFile) return;
    if (onRequestProductUse && !onRequestProductUse()) return;
    await onUploadFile(sourceWritePath(path, normalizedRootPath), content);
  }, [normalizedRootPath, onRequestProductUse, onUploadFile]);

  const createDirectory = useCallback(async (path: string) => {
    if (!onCreateDirectory) return;
    if (onRequestProductUse && !onRequestProductUse()) return;
    await onCreateDirectory(sourceWritePath(path, normalizedRootPath));
  }, [normalizedRootPath, onCreateDirectory, onRequestProductUse]);

  const normalizedInitialPreviewPath = initialPreviewPath
    ? normalizeInitialPreviewPath(initialPreviewPath, normalizedRootPath)
    : undefined;

  return (
    <SharedAgentFilesPanel
      {...props}
      rootPath={normalizedRootPath}
      sourcePaths={sourcePaths}
      defaultSource="agent"
      showSourceTabs={false}
      initialPreviewPath={normalizedInitialPreviewPath
        ? displayPath(normalizedInitialPreviewPath, normalizedRootPath)
        : initialPreviewPath}
      onListFiles={listFiles}
      onOpenFile={openFile}
      onOpenFileBytes={onOpenFileBytes ? openFileBytes : undefined}
      onDownloadFileBytes={onDownloadFileBytes ? downloadFileBytes : undefined}
      onSaveFile={onSaveFile ? saveFile : undefined}
      onDeleteFile={onDeleteFile ? deleteFile : undefined}
      onUploadFile={onUploadFile ? uploadFile : undefined}
      onCreateDirectory={onCreateDirectory ? createDirectory : undefined}
      onBeforeWrite={onRequestProductUse}
      isReadOnlyFile={isReadOnlyFile ?? isProtectedFile}
      renderMarkdown={renderMarkdownOverride ?? renderMarkdown}
    />
  );
}
