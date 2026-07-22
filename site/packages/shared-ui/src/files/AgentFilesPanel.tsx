"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpDown,
  Eye,
  EyeOff,
  FileText,
  FolderPlus,
  FolderOpen,
  Loader2,
  Upload,
  WifiOff,
} from "lucide-react";

import { FileBreadcrumbs } from "./FileBreadcrumbs";
import {
  attachFileBackupComparisons,
  compareFileBackupEntries,
  markFileBackupComparisonUnavailable,
} from "./backup-comparison";
import { FilePreview, type FilePreviewMarkdownRenderer } from "./FilePreview";
import { FilesDirectoryTree } from "./FilesDirectoryTree";
import { FilesEmptyState } from "./FilesEmptyState";
import { FilesSearchBar } from "./FilesSearchBar";
import { FilesUploadZone } from "./FilesUploadZone";
import type { FileEntry, FileSortDir, FileSortKey } from "./types";
import { shouldReadFileAsBytes } from "./file-types";
import { downloadFileBytes } from "../utils/download-file";
import { writeClipboardText } from "../utils/browser-clipboard";
import { TooltipHint } from "../components/ui/tooltip";

const SORT_OPTIONS: Array<{ key: FileSortKey; label: string }> = [
  { key: "name", label: "Name" },
  { key: "size", label: "Size" },
  { key: "date", label: "Date" },
];

/**
 * Which file-access path panel operations are routed through:
 * - `agent`   → the deployment HTTP files API against the live agent pod filesystem.
 * - `backup`  → the deployment HTTP files API against the S3 backup of the workspace.
 * - `gateway` → the gateway `agents.files.*` RPC (name-addressed workspace files).
 */
export type AgentFilesPanelSource = "agent" | "backup" | "gateway";
export type AgentFilesPanelSourceDisabledReasons = Partial<Record<AgentFilesPanelSource, string>>;

const SOURCE_MODE_OPTIONS: Array<{ key: AgentFilesPanelSource; label: string; title: string }> = [
  { key: "agent", label: "Agent", title: "Live agent pod filesystem" },
  { key: "backup", label: "Backup", title: "S3 backup of the workspace (served while the agent is stopped)" },
  { key: "gateway", label: "Gateway", title: "Name-addressed workspace files over the agent gateway" },
];
const EMPTY_SOURCE_DISABLED_REASONS: AgentFilesPanelSourceDisabledReasons = {};

const FILES_LISTING_CACHE_LIMIT = 80;
const filesListingCache = new Map<string, FileEntry[]>();

function normalizePanelPath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/^\.\//, "");
}

function filesListingCacheKey(
  agentId: string | null | undefined,
  rootPath: string,
  path: string,
  sourceMode: AgentFilesPanelSource = "agent",
): string | null {
  const normalizedAgentId = agentId?.trim();
  if (!normalizedAgentId) return null;
  return [normalizedAgentId, sourceMode, normalizePanelPath(rootPath), normalizePanelPath(path)].join("\n");
}

function sourceInitialPath(source: AgentFilesPanelSource, workspaceRootPath: string): string {
  if (source === "gateway") return workspaceRootPath;
  return workspaceRootPath.split("/").filter(Boolean)[0] ?? "";
}

function sourceEffectiveRootPath(source: AgentFilesPanelSource, workspaceRootPath: string): string {
  return source === "gateway" ? workspaceRootPath : "";
}

function resolveAvailableSource(
  requestedSource: AgentFilesPanelSource,
  disabledReasons: AgentFilesPanelSourceDisabledReasons,
): AgentFilesPanelSource {
  if (!disabledReasons[requestedSource]) return requestedSource;
  return SOURCE_MODE_OPTIONS.find((option) => !disabledReasons[option.key])?.key ?? requestedSource;
}

function getCachedFiles(cacheKey: string | null): FileEntry[] | null {
  if (!cacheKey) return null;
  const cached = filesListingCache.get(cacheKey);
  return cached ? [...cached] : null;
}

function setCachedFiles(cacheKey: string | null, files: FileEntry[]): void {
  if (!cacheKey) return;
  filesListingCache.delete(cacheKey);
  filesListingCache.set(cacheKey, [...files]);
  while (filesListingCache.size > FILES_LISTING_CACHE_LIMIT) {
    const oldestKey = filesListingCache.keys().next().value;
    if (!oldestKey) break;
    filesListingCache.delete(oldestKey);
  }
}

function pathRelativeToRoot(path: string, rootPath: string): string {
  const normalizedPath = normalizePanelPath(path);
  const normalizedRoot = normalizePanelPath(rootPath);
  if (!normalizedRoot) return normalizedPath;
  if (normalizedPath === normalizedRoot) return "";
  return normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath;
}

function pathFromRoot(path: string, rootPath: string): string {
  const normalizedPath = normalizePanelPath(path);
  const normalizedRoot = normalizePanelPath(rootPath);
  if (!normalizedRoot) return normalizedPath;
  return normalizedPath ? `${normalizedRoot}/${normalizedPath}` : normalizedRoot;
}

export interface AgentFileOpenResult<T extends string | Uint8Array> {
  content: T;
  path?: string;
  name?: string;
  renamed?: boolean;
}

export type AgentFileOpenResponse<T extends string | Uint8Array> = T | AgentFileOpenResult<T>;

function isAgentFileOpenResult<T extends string | Uint8Array>(
  value: AgentFileOpenResponse<T>,
): value is AgentFileOpenResult<T> {
  return Boolean(value) && typeof value === "object" && !(value instanceof Uint8Array) && "content" in value;
}

function resolveAgentFileOpenResult<T extends string | Uint8Array>(
  value: AgentFileOpenResponse<T>,
): AgentFileOpenResult<T> {
  return isAgentFileOpenResult(value) ? value : { content: value };
}

function fileNameFromPath(path: string): string {
  return path.split("/").filter(Boolean).pop() || path || "file";
}

export interface AgentFilesPanelProps {
  agentId?: string | null;
  agentName?: string | null;
  rootPath?: string;
  defaultSource?: AgentFilesPanelSource;
  sourceDisabledReasons?: AgentFilesPanelSourceDisabledReasons;
  showSourceTabs?: boolean;
  connected: boolean;
  initialPreviewPath?: string | null;
  isDesktopViewport?: boolean;
  error?: string | null;
  onListFiles: (path?: string, source?: AgentFilesPanelSource) => Promise<FileEntry[]>;
  onOpenFile: (path: string, source?: AgentFilesPanelSource) => Promise<AgentFileOpenResponse<string>>;
  onOpenFileBytes?: (path: string, source?: AgentFilesPanelSource) => Promise<AgentFileOpenResponse<Uint8Array>>;
  onDownloadFileBytes?: (path: string, source?: AgentFilesPanelSource) => Promise<AgentFileOpenResponse<Uint8Array>>;
  onSaveFile?: (path: string, content: string, source?: AgentFilesPanelSource) => Promise<void>;
  onDeleteFile?: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  onUploadFile?: (path: string, content: Uint8Array) => Promise<void>;
  onCreateDirectory?: (path: string) => Promise<void>;
  isReadOnlyFile?: (path: string) => boolean;
  readOnlyLabel?: string;
  readOnlyDescription?: ReactNode;
  renderMarkdown?: FilePreviewMarkdownRenderer;
  downloadBytes?: (fileName: string, bytes: Uint8Array, mimeType?: string) => void;
  copyText?: (text: string) => boolean | Promise<boolean>;
}

export function AgentFilesPanel({
  agentId,
  agentName,
  rootPath = "",
  defaultSource = "agent",
  sourceDisabledReasons = EMPTY_SOURCE_DISABLED_REASONS,
  showSourceTabs = false,
  connected,
  initialPreviewPath,
  isDesktopViewport = false,
  error,
  onListFiles,
  onOpenFile,
  onOpenFileBytes,
  onDownloadFileBytes,
  onSaveFile,
  onDeleteFile,
  onUploadFile,
  onCreateDirectory,
  isReadOnlyFile = () => false,
  readOnlyLabel,
  readOnlyDescription,
  renderMarkdown,
  downloadBytes = downloadFileBytes,
  copyText = writeClipboardText,
}: AgentFilesPanelProps) {
  const normalizedRootPath = useMemo(() => normalizePanelPath(rootPath), [rootPath]);
  const initialSourceMode = resolveAvailableSource(defaultSource, sourceDisabledReasons);
  const [sourceMode, setSourceMode] = useState<AgentFilesPanelSource>(() => initialSourceMode);
  const isGatewaySource = sourceMode === "gateway";
  // The highest directory each source can navigate up to (the breadcrumb "Home" target):
  // - gateway: name-addressed workspace files — flat, no directory nav; pin to the workspace root.
  // - agent (live pod) + backup (S3): the deployment files API is sync-root-relative, so the real
  //   root is the sync root (`""` === /home/node). Un-clamp so the user can climb above the
  //   `.openclaw/workspace` subdir. NOTE: the pod filesystem above the sync root (up to `/`) is
  //   NOT reachable through the current backend files API, so `agent` also stops at the sync root.
  const effectiveRootPath = sourceEffectiveRootPath(sourceMode, normalizedRootPath);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPath, setCurrentPath] = useState(() => sourceInitialPath(initialSourceMode, normalizedRootPath));
  const [showHidden, setShowHidden] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderError, setNewFolderError] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [sortKey, setSortKey] = useState<FileSortKey>("name");
  const [sortDir, setSortDir] = useState<FileSortDir>("asc");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [files, setFiles] = useState<FileEntry[]>(() => (
    getCachedFiles(filesListingCacheKey(
      agentId,
      sourceEffectiveRootPath(initialSourceMode, normalizedRootPath),
      sourceInitialPath(initialSourceMode, normalizedRootPath),
      initialSourceMode,
    )) ?? []
  ));
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const listRequestIdRef = useRef(0);

  const [previewEntry, setPreviewEntry] = useState<FileEntry | null>(null);
  const [previewContent, setPreviewContent] = useState<string | Uint8Array | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const currentListingCacheKey = useMemo(
    () => filesListingCacheKey(agentId, effectiveRootPath, currentPath, sourceMode),
    [agentId, currentPath, effectiveRootPath, sourceMode],
  );
  const currentSourceDisabledReason = sourceDisabledReasons[sourceMode] ?? null;
  const backupComparisonDisabledReason = isGatewaySource
    ? null
    : sourceDisabledReasons.agent ?? sourceDisabledReasons.backup ?? null;
  const backupComparisonAvailable = connected && showSourceTabs && !isGatewaySource && !backupComparisonDisabledReason;
  const resetSourceSelection = useCallback((nextSource: AgentFilesPanelSource) => {
    setSourceMode(nextSource);
    setCurrentPath(sourceInitialPath(nextSource, normalizedRootPath));
    setSearchQuery("");
    setPreviewEntry(null);
    setPreviewContent(null);
    setPreviewError(null);
    setShowUpload(false);
    setShowCreateFolder(false);
  }, [normalizedRootPath]);

  const loadFiles = useCallback(async () => {
    if (!connected || currentSourceDisabledReason) return;
    const cachedFiles = getCachedFiles(currentListingCacheKey);
    if (cachedFiles) setFiles(cachedFiles);
    else setFiles([]);

    const requestId = ++listRequestIdRef.current;
    setListLoading(true);
    setListError(null);
    try {
      // Gateway files are name-addressed (flat list, no directory scoping) — always list the whole set.
      const nextFiles = isGatewaySource
        ? await onListFiles(undefined, "gateway")
        : await onListFiles(currentPath || undefined, sourceMode);
      if (requestId === listRequestIdRef.current) {
        setFiles(nextFiles);
        setCachedFiles(currentListingCacheKey, nextFiles);
      }

      if (!showSourceTabs) return;

      if (!backupComparisonAvailable) {
        if (requestId === listRequestIdRef.current) {
          setFiles(sourceMode === "backup" && backupComparisonDisabledReason
            ? markFileBackupComparisonUnavailable(nextFiles, "backup", backupComparisonDisabledReason)
            : nextFiles);
        }
        return;
      }

      try {
        const peerSource: AgentFilesPanelSource = sourceMode === "agent" ? "backup" : "agent";
        const peerFiles = await onListFiles(currentPath || undefined, peerSource);
        const liveFiles = sourceMode === "agent" ? nextFiles : peerFiles;
        const backupFiles = sourceMode === "backup" ? nextFiles : peerFiles;
        const comparisons = compareFileBackupEntries(liveFiles, backupFiles);
        if (requestId === listRequestIdRef.current) {
          setFiles(attachFileBackupComparisons(nextFiles, comparisons));
        }
      } catch (err) {
        if (requestId === listRequestIdRef.current) {
          setFiles(markFileBackupComparisonUnavailable(
            nextFiles,
            sourceMode === "backup" ? "backup" : "live",
            err instanceof Error ? err.message : "Could not compare latest backup.",
          ));
        }
      }
    } catch (err) {
      if (requestId === listRequestIdRef.current) {
        setListError(err instanceof Error ? err.message : "Failed to load files");
        if (!cachedFiles) setFiles([]);
      }
    } finally {
      if (requestId === listRequestIdRef.current) {
        setListLoading(false);
      }
    }
  }, [backupComparisonAvailable, backupComparisonDisabledReason, connected, currentListingCacheKey, currentPath, currentSourceDisabledReason, isGatewaySource, onListFiles, showSourceTabs, sourceMode]);

  useEffect(() => {
    if (!sourceDisabledReasons[sourceMode]) return;
    const fallbackSource = resolveAvailableSource(defaultSource, sourceDisabledReasons);
    if (fallbackSource === sourceMode) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      resetSourceSelection(fallbackSource);
    });
    return () => {
      cancelled = true;
    };
  }, [defaultSource, resetSourceSelection, sourceDisabledReasons, sourceMode]);

  useEffect(() => {
    if (showSourceTabs) return;
    const fallbackSource = resolveAvailableSource(defaultSource, sourceDisabledReasons);
    if (fallbackSource === sourceMode) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      resetSourceSelection(fallbackSource);
    });
    return () => {
      cancelled = true;
    };
  }, [defaultSource, resetSourceSelection, showSourceTabs, sourceDisabledReasons, sourceMode]);

  useEffect(() => {
    let cancelled = false;
    if (!connected) {
      listRequestIdRef.current += 1;
      queueMicrotask(() => {
        if (cancelled) return;
        setFiles([]);
        setListLoading(false);
        setListError(null);
      });
      return () => {
        cancelled = true;
      };
    }
    startTransition(() => {
      if (!cancelled) void loadFiles();
    });
    return () => {
      cancelled = true;
    };
  }, [connected, loadFiles]);

  const fileCount = files.filter((file) => file.type === "file").length;
  const dirCount = files.filter((file) => file.type === "directory").length;
  const searchResultCount = useMemo(() => {
    if (!searchQuery.trim()) return undefined;
    const query = searchQuery.toLowerCase();
    return files.filter((file) => file.name.toLowerCase().includes(query)).length;
  }, [files, searchQuery]);

  const filesLoading = listLoading;
  const blockingLoading = filesLoading && files.length === 0;
  const filesDisconnected = !listLoading && !connected;
  const effectiveError = currentSourceDisabledReason ?? listError ?? error ?? null;
  const currentSourceAvailable = connected && !currentSourceDisabledReason;
  const filesBootStatus = useMemo(() => {
    if (effectiveError) {
      return { status: "error" as const, title: "Files error", detail: effectiveError };
    }
    if (filesLoading) {
      return {
        status: "loading" as const,
        title: files.length > 0 ? "Refreshing files" : "Loading files",
        detail: files.length > 0 ? "Updating folders and files." : "Fetching folders and files.",
      };
    }
    if (!connected) {
      return {
        status: "loading" as const,
        title: "Waiting for gateway",
        detail: filesDisconnected
          ? "Reconnect the workspace to browse live files."
          : "Start the agent to browse workspace files.",
      };
    }
    return null;
  }, [connected, effectiveError, files.length, filesDisconnected, filesLoading]);
  const emptyKind: "offline" | "loading" | "error" | "no-files" | "no-results" | null =
    blockingLoading
      ? "loading"
      : effectiveError && files.length === 0
        ? "error"
        : !connected
          ? "offline"
          : files.length === 0
            ? "no-files"
            : searchQuery.trim() && searchResultCount === 0
              ? "no-results"
              : null;

  const handleOpenFile = useCallback(async (entry: FileEntry) => {
    if (entry.type === "directory") {
      setCurrentPath(normalizePanelPath(entry.path));
      setPreviewEntry(null);
      return;
    }

    setPreviewEntry(entry);
    setPreviewContent(null);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const openAsBytes = shouldReadFileAsBytes(entry.name) && onOpenFileBytes;
      const result = resolveAgentFileOpenResult(
        await (openAsBytes
          ? onOpenFileBytes(entry.path, sourceMode)
          : onOpenFile(entry.path, sourceMode)),
      );
      const nextPath = result.path ? normalizePanelPath(result.path) : entry.path;
      const nextName = result.name || (nextPath !== entry.path ? fileNameFromPath(nextPath) : entry.name);
      if (nextPath !== entry.path || nextName !== entry.name) {
        setPreviewEntry({ ...entry, path: nextPath, name: nextName });
        void loadFiles();
      }
      setPreviewContent(result.content);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Failed to load file");
    } finally {
      setPreviewLoading(false);
    }
  }, [loadFiles, onOpenFile, onOpenFileBytes, sourceMode]);

  const normalizedInitialPreviewPath = useMemo(
    () => initialPreviewPath ? normalizePanelPath(initialPreviewPath) : "",
    [initialPreviewPath],
  );

  useEffect(() => {
    if (!connected || !normalizedInitialPreviewPath) return;
    const relativePath = pathRelativeToRoot(normalizedInitialPreviewPath, normalizedRootPath);
    const fullPath = pathFromRoot(relativePath, normalizedRootPath);
    const nameParts = fullPath.split("/").filter(Boolean);
    const name = nameParts[nameParts.length - 1] ?? fullPath;
    const parentPath = fullPath.includes("/")
      ? fullPath.slice(0, fullPath.lastIndexOf("/"))
      : normalizedRootPath;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setCurrentPath(parentPath || normalizedRootPath);
      void handleOpenFile({ name, path: fullPath, type: "file" });
    });
    return () => {
      cancelled = true;
    };
  }, [connected, handleOpenFile, normalizedInitialPreviewPath, normalizedRootPath]);

  const handleSaveFile = useCallback(async (path: string, content: string) => {
    if (!onSaveFile) return;
    await onSaveFile(path, content, sourceMode);
    setPreviewContent(content);
    void loadFiles();
  }, [loadFiles, onSaveFile, sourceMode]);

  const handleDeleteFile = useCallback(async (entry: FileEntry) => {
    if (!onDeleteFile) return;
    await onDeleteFile(entry.path, entry.type === "directory" ? { recursive: true } : undefined);
    if (previewEntry?.path === entry.path) {
      setPreviewEntry(null);
      setPreviewContent(null);
    }
    await loadFiles();
  }, [loadFiles, onDeleteFile, previewEntry]);

  const handleUploadFile = useCallback(async (path: string, content: Uint8Array) => {
    if (!onUploadFile) return;
    await onUploadFile(path, content);
    await loadFiles();
  }, [loadFiles, onUploadFile]);

  const validateNewFolderName = useCallback((name: string): string | null => {
    if (!name.trim()) return "Folder name is required.";
    if (name === "." || name === "..") return "Use a real folder name.";
    if (/[\\/]/.test(name)) return "Create one folder at a time.";
    return null;
  }, []);

  const handleCreateDirectory = useCallback(async () => {
    if (!onCreateDirectory) return;
    const trimmedName = newFolderName.trim();
    const validationError = validateNewFolderName(trimmedName);
    if (validationError) {
      setNewFolderError(validationError);
      return;
    }

    const targetPath = currentPath ? `${currentPath}/${trimmedName}` : trimmedName;
    setCreatingFolder(true);
    setNewFolderError(null);
    try {
      await onCreateDirectory(targetPath);
      setNewFolderName("");
      setShowCreateFolder(false);
      await loadFiles();
    } catch (err) {
      setNewFolderError(err instanceof Error ? err.message : "Failed to create folder.");
    } finally {
      setCreatingFolder(false);
    }
  }, [currentPath, loadFiles, newFolderName, onCreateDirectory, validateNewFolderName]);

  const handleDownloadFile = useCallback(async (entry: FileEntry) => {
    if (!onDownloadFileBytes || entry.type === "directory") return;
    const result = resolveAgentFileOpenResult(
      await onDownloadFileBytes(entry.path, sourceMode),
    );
    const nextPath = result.path ? normalizePanelPath(result.path) : entry.path;
    downloadBytes(result.name || (nextPath !== entry.path ? fileNameFromPath(nextPath) : entry.name), result.content);
    if (nextPath !== entry.path) void loadFiles();
  }, [downloadBytes, loadFiles, onDownloadFileBytes, sourceMode]);

  const handleCopyPath = useCallback((entry: FileEntry) => {
    void copyText(entry.path);
  }, [copyText]);

  const handleNavigate = useCallback((path: string) => {
    setCurrentPath(pathFromRoot(path, effectiveRootPath));
    setPreviewEntry(null);
  }, [effectiveRootPath]);

  const handleSourceModeChange = useCallback((mode: AgentFilesPanelSource) => {
    if (mode === sourceMode) return;
    if (sourceDisabledReasons[mode]) return;
    resetSourceSelection(mode);
  }, [resetSourceSelection, sourceDisabledReasons, sourceMode]);

  const toggleSort = useCallback((key: FileSortKey) => {
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setSortMenuOpen(false);
  }, [sortKey]);

  const breadcrumbPath = pathRelativeToRoot(currentPath, effectiveRootPath);
  const filePreview = previewEntry ? (
    <FilePreview
      key={previewEntry.path}
      entry={previewEntry}
      content={previewContent}
      loading={previewLoading}
      error={previewError}
      readOnly={!isGatewaySource && isReadOnlyFile(previewEntry.path)}
      readOnlyLabel={readOnlyLabel}
      readOnlyDescription={readOnlyDescription}
      onClose={() => setPreviewEntry(null)}
      onSave={onSaveFile ? handleSaveFile : undefined}
      onDownload={onDownloadFileBytes ? handleDownloadFile : undefined}
      renderMarkdown={renderMarkdown}
      copyText={copyText}
    />
  ) : null;

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="flex h-12 flex-shrink-0 items-center gap-3 border-b border-border px-4">
        <FolderOpen className="h-4 w-4 text-[var(--selection-accent)]" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{agentName || "Agent files"}</p>
          <p className="text-[10px] text-text-muted">
            {fileCount} files{dirCount > 0 ? `, ${dirCount} folders` : ""}
          </p>
        </div>

        <div className="flex-1" />

        {showSourceTabs && (
          <div
            className="flex flex-shrink-0 items-center rounded-lg border border-border bg-surface-low p-0.5"
            role="tablist"
            aria-label="File source"
          >
            {SOURCE_MODE_OPTIONS.map((option) => {
              const disabledReason = sourceDisabledReasons[option.key];
              return (
                <TooltipHint key={option.key} label={disabledReason ?? option.title} disabled={Boolean(disabledReason)}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={sourceMode === option.key}
                    disabled={Boolean(disabledReason)}
                    onClick={() => handleSourceModeChange(option.key)}
                    className={`h-6 rounded-md px-2 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      sourceMode === option.key
                        ? "bg-selection-accent/10 text-selection-accent"
                        : "text-text-muted hover:text-foreground"
                    }`}
                  >
                    {option.label}
                  </button>
                </TooltipHint>
              );
            })}
          </div>
        )}

        {(filesLoading || !connected || effectiveError) && (
          <div className="flex items-center gap-1 text-[10px] text-warning">
            {filesBootStatus?.status === "loading" ? <Loader2 className="h-3 w-3 animate-spin" /> : <WifiOff className="h-3 w-3" />}
            <span>
              {filesBootStatus?.title ?? (effectiveError ? "Files error" : "Unavailable")}
            </span>
          </div>
        )}

        {onCreateDirectory && (
          <TooltipHint label={isGatewaySource ? "Folders are not available for gateway files" : "New folder"} disabled={!currentSourceAvailable || isGatewaySource}>
            <button
              type="button"
              onClick={() => {
                setShowCreateFolder((open) => !open);
                setShowUpload(false);
                setNewFolderError(null);
              }}
              disabled={!currentSourceAvailable || isGatewaySource}
              className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                showCreateFolder ? "bg-selection-accent/10 text-selection-accent" : "text-text-muted hover:bg-surface-low hover:text-foreground"
              }`}
              aria-label="New folder"
            >
              <FolderPlus className="h-3.5 w-3.5" />
            </button>
          </TooltipHint>
        )}

        {onUploadFile && (
          <TooltipHint label={isGatewaySource ? "Uploads are not available for gateway files" : "Upload files"} disabled={!currentSourceAvailable || isGatewaySource}>
            <button
              type="button"
              aria-label="Upload files"
              onClick={() => {
                setShowUpload((open) => !open);
                setShowCreateFolder(false);
              }}
              disabled={!currentSourceAvailable || isGatewaySource}
              className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                showUpload ? "bg-selection-accent/10 text-selection-accent" : "text-text-muted hover:bg-surface-low hover:text-foreground"
              }`}
            >
              <Upload className="h-3.5 w-3.5" />
            </button>
          </TooltipHint>
        )}

        <TooltipHint label={showHidden ? "Hide dotfiles" : "Show dotfiles"}>
          <button
            type="button"
            aria-label={showHidden ? "Hide dotfiles" : "Show dotfiles"}
            onClick={() => setShowHidden((value) => !value)}
            className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
              showHidden ? "bg-selection-accent/10 text-selection-accent" : "text-text-muted hover:bg-surface-low hover:text-foreground"
            }`}
          >
            {showHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
        </TooltipHint>

        <div className="relative">
          <TooltipHint label="Sort">
            <button
              type="button"
              aria-label="Sort"
              onClick={() => setSortMenuOpen((open) => !open)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-low hover:text-foreground"
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
            </button>
          </TooltipHint>
          <AnimatePresence>
            {sortMenuOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -4 }}
                transition={{ duration: 0.12 }}
                className="absolute right-0 top-full z-50 mt-1 w-28 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-xl"
              >
                {SORT_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => toggleSort(option.key)}
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-[11px] hover:bg-surface-low ${
                      sortKey === option.key ? "text-selection-accent" : "text-foreground"
                    }`}
                  >
                    <span>{option.label}</span>
                    {sortKey === option.key && (
                      <span className="text-[9px] text-text-muted">{sortDir === "asc" ? "A-Z" : "Z-A"}</span>
                    )}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {showCreateFolder && currentSourceAvailable && !isGatewaySource && onCreateDirectory && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="flex-shrink-0 overflow-hidden border-b border-border"
          >
            <form
              className="flex flex-wrap items-start gap-2 px-4 py-3"
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreateDirectory();
              }}
            >
              <div className="min-w-0 flex-1">
                <label htmlFor="agent-files-new-folder" className="sr-only">Folder name</label>
                <input
                  id="agent-files-new-folder"
                  type="text"
                  value={newFolderName}
                  onChange={(event) => {
                    setNewFolderName(event.target.value);
                    if (newFolderError) setNewFolderError(null);
                  }}
                  placeholder="Folder name"
                  className="h-8 w-full rounded-lg border border-border bg-surface-low px-3 text-xs text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-[var(--selection-accent)]"
                  autoComplete="off"
                  disabled={creatingFolder}
                />
                {newFolderError && <p className="mt-1 text-[10px] text-destructive">{newFolderError}</p>}
              </div>
              <button
                type="submit"
                disabled={creatingFolder}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-selection-accent px-3 text-[11px] font-medium text-selection-accent-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creatingFolder && <Loader2 className="h-3 w-3 animate-spin" />}
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCreateFolder(false);
                  setNewFolderName("");
                  setNewFolderError(null);
                }}
                disabled={creatingFolder}
                className="h-8 rounded-lg px-3 text-[11px] text-text-muted transition-colors hover:bg-surface-low hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {onUploadFile && showUpload && currentSourceAvailable && !isGatewaySource && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="flex-shrink-0 overflow-hidden border-b border-border"
          >
            <div className="px-4 py-3">
              <FilesUploadZone currentPath={currentPath} onUpload={handleUploadFile} compact />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className={`flex min-h-0 flex-1 ${isDesktopViewport ? "flex-row" : "flex-col"}`}>
        <aside
          className={`flex flex-shrink-0 flex-col ${
            isDesktopViewport
              ? "h-auto min-h-0 w-72 border-r border-border"
              : "h-full min-h-0 w-full"
          }`}
        >
          <div className="flex-shrink-0 space-y-2 px-3 pb-2 pt-3">
            <FilesSearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              resultCount={searchResultCount}
              totalCount={files.length}
            />
            {!isGatewaySource && breadcrumbPath && !searchQuery.trim() && (
              <FileBreadcrumbs path={breadcrumbPath} onNavigate={handleNavigate} />
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {emptyKind ? (
              <FilesEmptyState
                kind={emptyKind}
                searchQuery={searchQuery}
                errorMessage={effectiveError ?? undefined}
                onRetry={emptyKind === "error" ? loadFiles : undefined}
                title={
                  emptyKind === "loading"
                    ? filesBootStatus?.title ?? "Loading files"
                    : emptyKind === "error"
                      ? filesBootStatus?.title
                    : emptyKind === "offline" && filesDisconnected
                      ? filesBootStatus?.title ?? "Files unavailable"
                      : undefined
                }
                description={
                  emptyKind === "loading"
                    ? filesBootStatus?.detail ?? "Fetching folders and files."
                    : emptyKind === "error"
                      ? filesBootStatus?.detail
                    : emptyKind === "offline" && filesDisconnected
                      ? filesBootStatus?.detail ?? "Start the agent to browse workspace files."
                      : undefined
                }
              />
            ) : (
              <FilesDirectoryTree
                entries={files}
                searchQuery={searchQuery}
                sortKey={sortKey}
                sortDir={sortDir}
                showHidden={showHidden}
                onOpenFile={handleOpenFile}
                onOpenDirectory={handleOpenFile}
                onDeleteFile={isGatewaySource || !currentSourceAvailable || !onDeleteFile ? undefined : handleDeleteFile}
                onDownloadFile={onDownloadFileBytes ? handleDownloadFile : undefined}
                onCopyPath={handleCopyPath}
              />
            )}
          </div>
        </aside>

        {isDesktopViewport && (
          <main className="min-h-0 min-w-0 flex-1">
            <AnimatePresence mode="wait">
              {filePreview ?? (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex h-full flex-col items-center justify-center gap-3 text-text-muted"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-surface-low/50">
                    <FileText className="h-5 w-5 opacity-50" />
                  </div>
                  <div className="text-center">
                    <p className="mb-1 text-sm font-medium text-foreground">Select a file to preview</p>
                    <p className="text-[11px] text-text-muted">Browse workspace files without leaving the agent.</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </main>
        )}
      </div>

      <AnimatePresence>
        {!isDesktopViewport && previewEntry && (
          <motion.section
            key="file-editor-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="File editor"
            initial={{ y: "100%", opacity: 0.98 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0.98 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0 z-50 flex min-h-0 flex-col overflow-hidden bg-background shadow-[0_-18px_50px_color-mix(in_srgb,var(--foreground)_18%,transparent)]"
          >
            <div className="flex flex-shrink-0 justify-center py-2">
              <div className="h-1 w-10 rounded-full bg-border" />
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {filePreview}
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
