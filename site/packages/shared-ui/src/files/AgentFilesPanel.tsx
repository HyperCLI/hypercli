"use client";

import { startTransition, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUp,
  ArrowUpDown,
  Eye,
  EyeOff,
  FileText,
  FolderPlus,
  FolderOpen,
  Home,
  Loader2,
  RotateCcw,
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
import { formatFileTechnicalDetails } from "./error-details";
import type { FileEntry, FileSortDir, FileSortKey } from "./types";
import { decodeUtf8FileContent, inferFileMimeType, isFileByteContent, resolveFileType, shouldReadFileAsBytes } from "./file-types";
import { RecoveryDetails, RecoveryState } from "../components/patterns/recovery";
import { downloadFileBytes } from "../utils/download-file";
import { writeClipboardText } from "../utils/browser-clipboard";
import { TooltipHint } from "../components/ui/tooltip";

const SORT_OPTIONS: Array<{ key: FileSortKey; label: string }> = [
  { key: "name", label: "Name" },
  { key: "size", label: "Size" },
  { key: "date", label: "Date" },
];
const MAX_TEXT_PREVIEW_BYTES = 4 * 1024 * 1024;
const MAX_INLINE_PREVIEW_BYTES = 64 * 1024 * 1024;

interface FileFeedbackIssue {
  message: string;
  description?: string;
  technicalDetails?: string;
}

/**
 * Which file-access path panel operations are routed through:
 * - `agent`   → the deployment HTTP files API against the live agent pod filesystem.
 * - `backup`  → the deployment HTTP files API against the S3 backup of the workspace.
 * - `gateway` → the gateway `agents.files.*` RPC (name-addressed workspace files).
 */
export type AgentFilesPanelSource = "agent" | "backup" | "gateway";
type AgentFilesWritableSource = Exclude<AgentFilesPanelSource, "gateway">;
export type AgentFilesPanelSourceDisabledReasons = Partial<Record<AgentFilesPanelSource, string>>;
export interface AgentFilesPanelSourcePathScope {
  homePath: string;
  rootPath: string;
  writableRootPath?: string | null;
}
export type AgentFilesPanelSourcePaths = Partial<Record<AgentFilesPanelSource, AgentFilesPanelSourcePathScope>>;

const SOURCE_MODE_OPTIONS: Array<{ key: AgentFilesPanelSource; label: string; title: string }> = [
  { key: "agent", label: "Agent", title: "Live agent pod filesystem" },
  { key: "backup", label: "Backup", title: "S3 backup of the workspace (served while the agent is stopped)" },
  { key: "gateway", label: "Gateway", title: "Name-addressed workspace files over the agent gateway" },
];
const EMPTY_SOURCE_DISABLED_REASONS: AgentFilesPanelSourceDisabledReasons = {};
const EMPTY_SOURCE_PATHS: AgentFilesPanelSourcePaths = {};

const FILES_LISTING_CACHE_LIMIT = 80;
const filesListingCache = new Map<string, FileEntry[]>();

function normalizePanelPath(path: string): string {
  const replaced = path.trim().replace(/\\/g, "/");
  const absolute = replaced.startsWith("/");
  const segments: string[] = [];
  for (const segment of replaced.replace(/^\.\//, "").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 0 && segments[segments.length - 1] !== "..") segments.pop();
      else if (!absolute) segments.push(segment);
      continue;
    }
    segments.push(segment);
  }
  const normalized = segments.join("/");
  return absolute ? (normalized ? `/${normalized}` : "/") : normalized;
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

function sourcePathScope(
  source: AgentFilesPanelSource,
  workspaceRootPath: string,
  sourcePaths: AgentFilesPanelSourcePaths,
): AgentFilesPanelSourcePathScope {
  const configured = sourcePaths[source];
  if (configured) {
    const rootPath = normalizePanelPath(configured.rootPath);
    return {
      homePath: normalizePanelPath(configured.homePath),
      rootPath,
      writableRootPath: configured.writableRootPath === null
        ? null
        : normalizePanelPath(configured.writableRootPath ?? rootPath),
    };
  }
  const rootPath = source === "gateway"
    ? workspaceRootPath
    : workspaceRootPath.split("/").filter(Boolean)[0] ?? "";
  return {
    homePath: rootPath,
    rootPath,
    writableRootPath: source === "gateway" ? null : rootPath,
  };
}

function sourceValue<T>(source: AgentFilesPanelSource, agent: T, backup: T, gateway: T): T {
  if (source === "agent") return agent;
  if (source === "backup") return backup;
  return gateway;
}

function joinPanelPath(basePath: string, childPath: string): string {
  const normalizedBase = normalizePanelPath(basePath);
  const normalizedChild = normalizePanelPath(childPath);
  if (!normalizedBase) return normalizedChild;
  if (!normalizedChild) return normalizedBase;
  return normalizePanelPath(`${normalizedBase}/${normalizedChild}`);
}

function parentPanelPath(path: string, rootPath: string): string {
  const normalizedPath = normalizePanelPath(path);
  const normalizedRoot = normalizePanelPath(rootPath);
  if (normalizedPath === normalizedRoot) return normalizedRoot;
  const separatorIndex = normalizedPath.lastIndexOf("/");
  const parentPath = separatorIndex < 0
    ? ""
    : separatorIndex === 0
      ? "/"
      : normalizedPath.slice(0, separatorIndex);
  if (!normalizedRoot || normalizedRoot === "/") return parentPath || normalizedRoot;
  return pathIsWithin(parentPath, normalizedRoot) ? parentPath : normalizedRoot;
}

function pathIsWithin(path: string, rootPath: string): boolean {
  const normalizedPath = normalizePanelPath(path);
  const normalizedRoot = normalizePanelPath(rootPath);
  if (normalizedRoot === "/") return normalizedPath.startsWith("/");
  if (!normalizedRoot) return !normalizedPath.startsWith("/");
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
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
  if (normalizedRoot === "/" && normalizedPath.startsWith("/")) return normalizedPath.slice(1);
  return normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath;
}

function pathFromRoot(path: string, rootPath: string): string {
  const normalizedPath = normalizePanelPath(path);
  const normalizedRoot = normalizePanelPath(rootPath);
  if (!normalizedRoot) return normalizedPath;
  return normalizedPath ? joinPanelPath(normalizedRoot, normalizedPath) : normalizedRoot;
}

export interface AgentFileOpenResult<T extends string | Uint8Array> {
  content: T;
  path?: string;
  name?: string;
  mimeType?: string;
  renamed?: boolean;
}

export type AgentFileOpenResponse<T extends string | Uint8Array> = T | AgentFileOpenResult<T>;

export interface AgentFilePreviewReadOptions {
  maxBytes: number;
  signal: AbortSignal;
}

function isAgentFileOpenResult<T extends string | Uint8Array>(
  value: AgentFileOpenResponse<T>,
): value is AgentFileOpenResult<T> {
  return Boolean(value) && typeof value === "object" && !isFileByteContent(value) && "content" in value;
}

function resolveAgentFileOpenResult<T extends string | Uint8Array>(
  value: AgentFileOpenResponse<T>,
): AgentFileOpenResult<T> {
  return isAgentFileOpenResult(value) ? value : { content: value };
}

function fileNameFromPath(path: string): string {
  return path.split("/").filter(Boolean).pop() || path || "file";
}

function fileContentByteLength(content: string | Uint8Array): number {
  return isFileByteContent(content)
    ? content.byteLength
    : new TextEncoder().encode(content).byteLength;
}

export interface AgentFilesPanelProps {
  agentId?: string | null;
  agentName?: string | null;
  rootPath?: string;
  sourcePaths?: AgentFilesPanelSourcePaths;
  defaultSource?: AgentFilesPanelSource;
  sourceDisabledReasons?: AgentFilesPanelSourceDisabledReasons;
  showSourceTabs?: boolean;
  connected: boolean;
  initialPreviewPath?: string | null;
  isDesktopViewport?: boolean;
  error?: string | null;
  onListFiles: (path?: string, source?: AgentFilesPanelSource) => Promise<FileEntry[]>;
  onOpenFile: (path: string, source?: AgentFilesPanelSource) => Promise<AgentFileOpenResponse<string>>;
  onOpenFileBytes?: (
    path: string,
    source?: AgentFilesPanelSource,
    options?: AgentFilePreviewReadOptions,
  ) => Promise<AgentFileOpenResponse<Uint8Array>>;
  onDownloadFileBytes?: (path: string, source?: AgentFilesPanelSource) => Promise<AgentFileOpenResponse<Uint8Array>>;
  onSaveFile?: (path: string, content: string, source?: AgentFilesPanelSource) => Promise<void>;
  onDeleteFile?: (path: string, options?: { recursive?: boolean }, source?: AgentFilesPanelSource) => Promise<void>;
  onUploadFile?: (path: string, content: Uint8Array, source: AgentFilesWritableSource) => Promise<void>;
  onCreateDirectory?: (path: string, source: AgentFilesWritableSource) => Promise<void>;
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
  sourcePaths = EMPTY_SOURCE_PATHS,
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
  const agentSourceScope = sourcePathScope("agent", normalizedRootPath, sourcePaths);
  const backupSourceScope = sourcePathScope("backup", normalizedRootPath, sourcePaths);
  const gatewaySourceScope = sourcePathScope("gateway", normalizedRootPath, sourcePaths);
  const agentHomePath = agentSourceScope.homePath;
  const backupHomePath = backupSourceScope.homePath;
  const gatewayHomePath = gatewaySourceScope.homePath;
  const agentRootPath = agentSourceScope.rootPath;
  const backupRootPath = backupSourceScope.rootPath;
  const gatewayRootPath = gatewaySourceScope.rootPath;
  const agentWritableRootPath = agentSourceScope.writableRootPath ?? null;
  const backupWritableRootPath = backupSourceScope.writableRootPath ?? null;
  const gatewayWritableRootPath = gatewaySourceScope.writableRootPath ?? null;
  const initialHomePath = sourceValue(
    initialSourceMode,
    agentHomePath,
    backupHomePath,
    gatewayHomePath,
  );
  const initialRootPath = sourceValue(
    initialSourceMode,
    agentRootPath,
    backupRootPath,
    gatewayRootPath,
  );
  const [sourceMode, setSourceMode] = useState<AgentFilesPanelSource>(() => initialSourceMode);
  const isGatewaySource = sourceMode === "gateway";
  const currentRootPath = sourceValue(
    sourceMode,
    agentRootPath,
    backupRootPath,
    gatewayRootPath,
  );
  const currentHomePath = sourceValue(
    sourceMode,
    agentHomePath,
    backupHomePath,
    gatewayHomePath,
  );
  const currentWritableRootPath = sourceValue(
    sourceMode,
    agentWritableRootPath,
    backupWritableRootPath,
    gatewayWritableRootPath,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPath, setCurrentPath] = useState(() => initialHomePath);
  const [showHidden, setShowHidden] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderError, setNewFolderError] = useState<FileFeedbackIssue | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [sortKey, setSortKey] = useState<FileSortKey>("name");
  const [sortDir, setSortDir] = useState<FileSortDir>("asc");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [files, setFiles] = useState<FileEntry[]>(() => (
    getCachedFiles(filesListingCacheKey(
      agentId,
      initialRootPath,
      initialHomePath,
      initialSourceMode,
    )) ?? []
  ));
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<FileFeedbackIssue | null>(null);
  const listRequestIdRef = useRef(0);
  const viewRevisionRef = useRef(0);

  const [previewEntry, setPreviewEntry] = useState<FileEntry | null>(null);
  const [previewContent, setPreviewContent] = useState<string | Uint8Array | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewUnavailableReason, setPreviewUnavailableReason] = useState<string | null>(null);
  const previewRequestIdRef = useRef(0);
  const previewAbortControllerRef = useRef<AbortController | null>(null);
  const openedInitialPreviewKeyRef = useRef<string | null>(null);
  useEffect(() => () => {
    listRequestIdRef.current += 1;
    previewRequestIdRef.current += 1;
    viewRevisionRef.current += 1;
    previewAbortControllerRef.current?.abort();
  }, []);
  const currentListingCacheKey = filesListingCacheKey(agentId, currentRootPath, currentPath, sourceMode);
  const currentSourceDisabledReason = sourceDisabledReasons[sourceMode] ?? null;
  const currentPathWritable = !isGatewaySource
    && currentWritableRootPath !== null
    && pathIsWithin(currentPath, currentWritableRootPath);
  const backupComparisonDisabledReason = isGatewaySource
    ? null
    : sourceDisabledReasons.agent ?? sourceDisabledReasons.backup ?? null;
  const backupComparisonAvailable = connected
    && showSourceTabs
    && !isGatewaySource
    && !backupComparisonDisabledReason
    && pathIsWithin(currentPath, backupRootPath);
  const clearPreview = useCallback(() => {
    previewRequestIdRef.current += 1;
    previewAbortControllerRef.current?.abort();
    previewAbortControllerRef.current = null;
    setPreviewEntry(null);
    setPreviewContent(null);
    setPreviewLoading(false);
    setPreviewError(null);
    setPreviewUnavailableReason(null);
  }, []);
  function resetSourceSelection(nextSource: AgentFilesPanelSource) {
    viewRevisionRef.current += 1;
    setSourceMode(nextSource);
    setCurrentPath(sourceValue(
      nextSource,
      agentHomePath,
      backupHomePath,
      gatewayHomePath,
    ));
    setSearchQuery("");
    setActionError(null);
    clearPreview();
    setShowUpload(false);
    setShowCreateFolder(false);
  }

  async function loadFiles() {
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
            "Backup comparison is temporarily unavailable.",
          ));
        }
      }
    } catch (err) {
      if (requestId === listRequestIdRef.current) {
        setListError(formatFileTechnicalDetails(err) ?? "The folder listing was unavailable.");
        if (!cachedFiles) setFiles([]);
      }
    } finally {
      if (requestId === listRequestIdRef.current) {
        setListLoading(false);
      }
    }
  }

  const resetSourceSelectionFromEffect = useEffectEvent(resetSourceSelection);
  const loadFilesFromEffect = useEffectEvent(loadFiles);

  useEffect(() => {
    if (!sourceDisabledReasons[sourceMode]) return;
    const fallbackSource = resolveAvailableSource(defaultSource, sourceDisabledReasons);
    if (fallbackSource === sourceMode) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      resetSourceSelectionFromEffect(fallbackSource);
    });
    return () => {
      cancelled = true;
    };
  }, [defaultSource, sourceDisabledReasons, sourceMode]);

  useEffect(() => {
    if (showSourceTabs) return;
    const fallbackSource = resolveAvailableSource(defaultSource, sourceDisabledReasons);
    if (fallbackSource === sourceMode) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      resetSourceSelectionFromEffect(fallbackSource);
    });
    return () => {
      cancelled = true;
    };
  }, [defaultSource, showSourceTabs, sourceDisabledReasons, sourceMode]);

  useEffect(() => {
    let cancelled = false;
    if (!connected) {
      listRequestIdRef.current += 1;
      viewRevisionRef.current += 1;
      queueMicrotask(() => {
        if (cancelled) return;
        clearPreview();
        setFiles([]);
        setListLoading(false);
        setListError(null);
      });
      return () => {
        cancelled = true;
      };
    }
    startTransition(() => {
      if (!cancelled) void loadFilesFromEffect();
    });
    return () => {
      cancelled = true;
    };
  }, [backupComparisonAvailable, clearPreview, connected, currentListingCacheKey, currentPath, currentSourceDisabledReason, onListFiles, showSourceTabs, sourceMode]);

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
      return {
        status: "error" as const,
        title: "Try again to load this folder",
        detail: "Your workspace is unchanged. Check the connection, then try once more.",
      };
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

  async function handleOpenFile(entry: FileEntry) {
    previewAbortControllerRef.current?.abort();
    previewAbortControllerRef.current = null;
    const requestId = ++previewRequestIdRef.current;
    if (entry.type === "directory") {
      viewRevisionRef.current += 1;
      setCurrentPath(normalizePanelPath(entry.path));
      clearPreview();
      return;
    }

    setPreviewEntry(entry);
    setPreviewContent(null);
    setPreviewError(null);
    setPreviewUnavailableReason(null);
    const fileType = resolveFileType(entry);
    if (isGatewaySource && fileType.readMode === "bytes") {
      setPreviewLoading(false);
      setPreviewUnavailableReason("This file type needs byte access, which is not available through Gateway files.");
      return;
    }
    const previewLimit = fileType.readMode === "text" || !fileType.known
      ? MAX_TEXT_PREVIEW_BYTES
      : MAX_INLINE_PREVIEW_BYTES;
    if (entry.size !== undefined && entry.size > previewLimit) {
      setPreviewLoading(false);
      setPreviewUnavailableReason(`Preview is limited to ${previewLimit / 1024 / 1024} MiB for this file type.`);
      return;
    }
    if (fileType.known && fileType.previewKind === "binary") {
      setPreviewLoading(false);
      setPreviewUnavailableReason(`${fileType.label} preview is not available.`);
      return;
    }
    if (fileType.readMode === "bytes" && !onOpenFileBytes) {
      setPreviewLoading(false);
      setPreviewUnavailableReason("A byte reader is required to preview this file type.");
      return;
    }

    const abortController = new AbortController();
    previewAbortControllerRef.current = abortController;
    setPreviewLoading(true);
    try {
      const openAsBytes = !isGatewaySource && onOpenFileBytes;
      const result = resolveAgentFileOpenResult(
        await (openAsBytes
          ? onOpenFileBytes(entry.path, sourceMode, { maxBytes: previewLimit, signal: abortController.signal })
          : onOpenFile(entry.path, sourceMode)),
      );
      if (requestId !== previewRequestIdRef.current) return;
      const nextPath = result.path ? normalizePanelPath(result.path) : entry.path;
      const nextName = result.name || (nextPath !== entry.path ? fileNameFromPath(nextPath) : entry.name);
      const nextMimeType = result.mimeType ?? entry.mimeType;
      const nextEntry = { ...entry, path: nextPath, name: nextName, mimeType: nextMimeType };
      const nextFileType = resolveFileType(nextEntry);
      if (nextPath !== entry.path || nextName !== entry.name || nextMimeType !== entry.mimeType) {
        setPreviewEntry(nextEntry);
        void loadFiles();
      }

      if (nextFileType.readMode === "bytes" && !isFileByteContent(result.content)) {
        setPreviewUnavailableReason(isGatewaySource
          ? "This file type needs byte access, which is not available through Gateway files."
          : "A byte reader is required to preview this file type.");
        return;
      }

      const resultPreviewLimit = nextFileType.readMode === "text" || !nextFileType.known
        ? MAX_TEXT_PREVIEW_BYTES
        : MAX_INLINE_PREVIEW_BYTES;
      if (fileContentByteLength(result.content) > resultPreviewLimit) {
        setPreviewUnavailableReason(`Preview is limited to ${resultPreviewLimit / 1024 / 1024} MiB for this file type.`);
        return;
      }

      const decodedContent = isFileByteContent(result.content) && (nextFileType.readMode === "text" || !nextFileType.known)
        ? decodeUtf8FileContent(result.content)
        : null;
      setPreviewContent(decodedContent ?? result.content);
    } catch (err) {
      if (requestId === previewRequestIdRef.current) {
        setPreviewError(formatFileTechnicalDetails(err) ?? "The file preview was unavailable.");
      }
    } finally {
      if (requestId === previewRequestIdRef.current) {
        previewAbortControllerRef.current = null;
        setPreviewLoading(false);
      }
    }
  }

  const normalizedInitialPreviewPath = useMemo(
    () => initialPreviewPath ? normalizePanelPath(initialPreviewPath) : "",
    [initialPreviewPath],
  );

  const openInitialPreview = useEffectEvent((entry: FileEntry) => {
    void handleOpenFile(entry);
  });

  useEffect(() => {
    if (!connected || !normalizedInitialPreviewPath) {
      openedInitialPreviewKeyRef.current = null;
      return;
    }
    const previewKey = `${agentId ?? ""}\n${normalizedInitialPreviewPath}`;
    if (openedInitialPreviewKeyRef.current === previewKey) return;
    const fullPath = normalizedInitialPreviewPath.startsWith("/")
      ? normalizedInitialPreviewPath
      : pathFromRoot(pathRelativeToRoot(normalizedInitialPreviewPath, normalizedRootPath), normalizedRootPath);
    const nameParts = fullPath.split("/").filter(Boolean);
    const name = nameParts[nameParts.length - 1] ?? fullPath;
    const parentPath = parentPanelPath(fullPath, initialRootPath);
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || openedInitialPreviewKeyRef.current === previewKey) return;
      openedInitialPreviewKeyRef.current = previewKey;
      viewRevisionRef.current += 1;
      setCurrentPath(parentPath || initialHomePath);
      openInitialPreview({ name, path: fullPath, type: "file" });
    });
    return () => {
      cancelled = true;
    };
  }, [agentId, connected, initialHomePath, initialRootPath, normalizedInitialPreviewPath, normalizedRootPath]);

  async function handleSaveFile(path: string, content: string) {
    if (!onSaveFile) return;
    const previewRequestId = previewRequestIdRef.current;
    const viewRevision = viewRevisionRef.current;
    await onSaveFile(path, content, sourceMode);
    if (previewRequestId === previewRequestIdRef.current) setPreviewContent(content);
    if (viewRevision === viewRevisionRef.current) void loadFiles();
  }

  async function handleDeleteFile(entry: FileEntry) {
    if (!onDeleteFile) return;
    const previewRequestId = previewRequestIdRef.current;
    const viewRevision = viewRevisionRef.current;
    setActionError(null);
    try {
      await onDeleteFile(entry.path, entry.type === "directory" ? { recursive: true } : undefined, sourceMode);
      if (previewRequestId === previewRequestIdRef.current && previewEntry?.path === entry.path) {
        clearPreview();
      }
      if (viewRevision === viewRevisionRef.current) await loadFiles();
    } catch (err) {
      if (viewRevision === viewRevisionRef.current) {
        setActionError({
          message: `Try again to delete "${entry.name}"`,
          description: entry.type === "directory"
            ? "The folder and everything inside it are still in your workspace."
            : "The file is still in your workspace.",
          technicalDetails: formatFileTechnicalDetails(err),
        });
      }
    }
  }

  async function handleUploadFile(path: string, content: Uint8Array) {
    if (!onUploadFile || sourceMode === "gateway") return;
    const viewRevision = viewRevisionRef.current;
    await onUploadFile(path, content, sourceMode);
    if (viewRevision === viewRevisionRef.current) await loadFiles();
  }

  async function handleUploadDirectory(path: string) {
    if (!onCreateDirectory || sourceMode === "gateway") return;
    const viewRevision = viewRevisionRef.current;
    await onCreateDirectory(path, sourceMode);
    if (viewRevision === viewRevisionRef.current) await loadFiles();
  }

  function validateNewFolderName(name: string): string | null {
    if (!name.trim()) return "Folder name is required.";
    if (name === "." || name === "..") return "Use a real folder name.";
    if (/[\\/]/.test(name)) return "Create one folder at a time.";
    return null;
  }

  async function handleCreateDirectory() {
    if (!onCreateDirectory || sourceMode === "gateway") return;
    const trimmedName = newFolderName.trim();
    const validationError = validateNewFolderName(trimmedName);
    if (validationError) {
      setNewFolderError({ message: validationError });
      return;
    }

    const targetPath = joinPanelPath(currentPath, trimmedName);
    const viewRevision = viewRevisionRef.current;
    setCreatingFolder(true);
    setNewFolderError(null);
    try {
      await onCreateDirectory(targetPath, sourceMode);
      if (viewRevision === viewRevisionRef.current) {
        setNewFolderName("");
        setShowCreateFolder(false);
        await loadFiles();
      }
    } catch (err) {
      if (viewRevision === viewRevisionRef.current) {
        setNewFolderError({
          message: "Try again to create this folder.",
          technicalDetails: formatFileTechnicalDetails(err),
        });
      }
    } finally {
      setCreatingFolder(false);
    }
  }

  async function handleDownloadFile(entry: FileEntry) {
    if (!onDownloadFileBytes || entry.type === "directory") return;
    const fileType = resolveFileType(entry);
    if (isGatewaySource && fileType.readMode === "bytes") return;
    const viewRevision = viewRevisionRef.current;
    setActionError(null);
    try {
      const result = resolveAgentFileOpenResult(
        await onDownloadFileBytes(entry.path, sourceMode),
      );
      const nextPath = result.path ? normalizePanelPath(result.path) : entry.path;
      const nextName = result.name || (nextPath !== entry.path ? fileNameFromPath(nextPath) : entry.name);
      const nextEntry = { ...entry, name: nextName, path: nextPath, mimeType: result.mimeType ?? entry.mimeType };
      downloadBytes(nextName, result.content, inferFileMimeType(nextEntry));
      if (nextPath !== entry.path && viewRevision === viewRevisionRef.current) void loadFiles();
    } catch (err) {
      if (viewRevision === viewRevisionRef.current) {
        setActionError({
          message: `Try again to download "${entry.name}"`,
          description: "The file is unchanged and remains available in this folder.",
          technicalDetails: formatFileTechnicalDetails(err),
        });
      }
    }
  }

  function handleCopyPath(entry: FileEntry) {
    void copyText(entry.path);
  }

  function handleNavigate(path: string) {
    viewRevisionRef.current += 1;
    setCurrentPath(pathFromRoot(path, currentRootPath));
    clearPreview();
    setShowUpload(false);
    setShowCreateFolder(false);
  }

  function handleNavigateHome() {
    viewRevisionRef.current += 1;
    setCurrentPath(currentHomePath);
    clearPreview();
    setShowUpload(false);
    setShowCreateFolder(false);
  }

  function handleNavigateUp() {
    viewRevisionRef.current += 1;
    setCurrentPath((path) => parentPanelPath(path, currentRootPath));
    clearPreview();
    setShowUpload(false);
    setShowCreateFolder(false);
  }

  function handleSourceModeChange(mode: AgentFilesPanelSource) {
    if (mode === sourceMode) return;
    if (sourceDisabledReasons[mode]) return;
    resetSourceSelection(mode);
  }

  function toggleSort(key: FileSortKey) {
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setSortMenuOpen(false);
  }

  const breadcrumbPath = pathRelativeToRoot(currentPath, currentRootPath);
  const canNavigateUp = normalizePanelPath(currentPath) !== normalizePanelPath(currentRootPath);
  const previewWritable = previewEntry !== null
    && (isGatewaySource || (
      currentWritableRootPath !== null
      && pathIsWithin(previewEntry.path, currentWritableRootPath)
    ));
  const previewBrowseOnly = previewEntry !== null && !isGatewaySource && !previewWritable;
  const filePreview = previewEntry ? (
    <FilePreview
      key={previewEntry.path}
      entry={previewEntry}
      content={previewContent}
      loading={previewLoading}
      error={previewError}
      unavailableReason={previewUnavailableReason}
      readOnly={!previewWritable || (!isGatewaySource && isReadOnlyFile(previewEntry.path))}
      readOnlyLabel={previewBrowseOnly ? "Browse-only" : readOnlyLabel}
      readOnlyDescription={previewBrowseOnly
        ? "Files outside the writable workspace can be previewed and downloaded, but not changed here."
        : readOnlyDescription}
      onClose={clearPreview}
      onSave={onSaveFile && previewWritable ? handleSaveFile : undefined}
      onDownload={onDownloadFileBytes && !(isGatewaySource && shouldReadFileAsBytes(previewEntry)) ? handleDownloadFile : undefined}
      onRetry={() => { void handleOpenFile(previewEntry); }}
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
              {effectiveError ? "Needs attention" : filesBootStatus?.title ?? "Unavailable"}
            </span>
          </div>
        )}

        {onCreateDirectory && (
          <TooltipHint
            label={isGatewaySource
              ? "Folders are not available for gateway files"
              : currentPathWritable
                ? "New folder"
                : "This location is browse-only"}
            disabled={!currentSourceAvailable || !currentPathWritable}
          >
            <button
              type="button"
              onClick={() => {
                setShowCreateFolder((open) => !open);
                setShowUpload(false);
                setNewFolderError(null);
              }}
              disabled={!currentSourceAvailable || !currentPathWritable}
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
          <TooltipHint
            label={isGatewaySource
              ? "Uploads are not available for gateway files"
              : currentPathWritable
                ? "Upload files"
                : "This location is browse-only"}
            disabled={!currentSourceAvailable || !currentPathWritable}
          >
            <button
              type="button"
              aria-label="Upload files"
              onClick={() => {
                setShowUpload((open) => !open);
                setShowCreateFolder(false);
              }}
              disabled={!currentSourceAvailable || !currentPathWritable}
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

      {actionError && (
        <RecoveryState
          presentation="compact"
          icon={RotateCcw}
          title={actionError.message}
          description={actionError.description ?? "Check the connection, then try once more."}
          technicalDetails={actionError.technicalDetails}
          detailsLabel="Technical details"
          onDismiss={() => setActionError(null)}
          dismissLabel="Dismiss file action error"
          announcement="assertive"
          headingLevel={3}
          className="mx-3 mt-2 flex-shrink-0"
        />
      )}

      {effectiveError && files.length > 0 && !actionError && (
        <RecoveryState
          presentation="compact"
          icon={WifiOff}
          title="Try again to refresh this folder"
          description="The current file list is still available while you reconnect."
          technicalDetails={formatFileTechnicalDetails(effectiveError)}
          detailsLabel="Technical details"
          primaryAction={connected && !currentSourceDisabledReason
            ? { label: "Try again", onAction: () => { void loadFiles(); } }
            : undefined}
          headingLevel={3}
          className="mx-3 mt-2 flex-shrink-0"
        />
      )}

      <AnimatePresence>
        {showCreateFolder && currentSourceAvailable && currentPathWritable && onCreateDirectory && (
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
                  aria-invalid={newFolderError ? "true" : undefined}
                  aria-describedby={newFolderError ? "agent-files-new-folder-error" : undefined}
                  className={`h-8 w-full rounded-lg border bg-surface-low px-3 text-xs text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-[var(--selection-accent)] ${
                    newFolderError ? "border-warning/60" : "border-border"
                  }`}
                  autoComplete="off"
                  disabled={creatingFolder}
                />
                {newFolderError && (
                  <div id="agent-files-new-folder-error" className="mt-1 text-[10px] text-warning">
                    <p role="alert">{newFolderError.message}</p>
                    <RecoveryDetails
                      label="Technical details"
                      technicalDetails={newFolderError.technicalDetails}
                      className="mt-1 text-foreground"
                    />
                  </div>
                )}
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
        {onUploadFile && showUpload && currentSourceAvailable && currentPathWritable && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="flex-shrink-0 overflow-hidden border-b border-border"
          >
            <div className="px-4 py-3">
              <FilesUploadZone
                currentPath={currentPath}
                onUpload={handleUploadFile}
                onCreateDirectory={onCreateDirectory && !isGatewaySource ? handleUploadDirectory : undefined}
                compact
              />
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
            <div className="flex min-w-0 items-center gap-1">
              <TooltipHint label="Home">
                <button
                  type="button"
                  aria-label="Home"
                  onClick={handleNavigateHome}
                  className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-low hover:text-foreground"
                >
                  <Home className="h-3 w-3" />
                </button>
              </TooltipHint>
              <TooltipHint label={canNavigateUp ? "Up one folder" : "Already at the top folder"} disabled={!canNavigateUp}>
                <button
                  type="button"
                  aria-label="Up one folder"
                  onClick={handleNavigateUp}
                  disabled={!canNavigateUp}
                  className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-low hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <ArrowUp className="h-3 w-3" />
                </button>
              </TooltipHint>
              <div className="min-w-0 flex-1">
                <FileBreadcrumbs path={breadcrumbPath} onNavigate={handleNavigate} />
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {emptyKind ? (
              <FilesEmptyState
                kind={emptyKind}
                searchQuery={searchQuery}
                errorMessage={effectiveError ?? undefined}
                onRetry={emptyKind === "error" && connected && !currentSourceDisabledReason ? loadFiles : undefined}
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
                onDeleteFile={!currentPathWritable || !currentSourceAvailable || !onDeleteFile ? undefined : handleDeleteFile}
                onDownloadFile={onDownloadFileBytes ? handleDownloadFile : undefined}
                canDownloadFile={(entry) => !(isGatewaySource && shouldReadFileAsBytes(entry))}
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
            className="elevation-shadow-top absolute inset-0 z-50 flex min-h-0 flex-col overflow-hidden bg-background"
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
