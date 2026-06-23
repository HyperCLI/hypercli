"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

import { FileBreadcrumbs } from "@/components/dashboard/files/FileBreadcrumbs";
import { FilePreview, isArchiveFileName, isImageFileName } from "@/components/dashboard/files/FilePreview";
import { FilesDirectoryTree } from "@/components/dashboard/files/FilesDirectoryTree";
import { FilesEmptyState } from "@/components/dashboard/files/FilesEmptyState";
import { FilesSearchBar } from "@/components/dashboard/files/FilesSearchBar";
import { FilesUploadZone } from "@/components/dashboard/files/FilesUploadZone";
import type { FileEntry, FileSortDir, FileSortKey } from "@/components/dashboard/files/types";
import { getAgentGatewayPanelBootStatus } from "@/components/dashboard/agents/chat-boot-stage";
import { isProtectedFile } from "@/lib/protected-files";
import { downloadFileBytes } from "@/lib/download-file";
import { writeClipboardText } from "@/lib/browser-clipboard";
import { normalizeOpenClawMediaFilePath, normalizeOpenClawWorkspaceFilePath } from "@/lib/agent-file-path";

const SORT_OPTIONS: Array<{ key: FileSortKey; label: string }> = [
  { key: "name", label: "Name" },
  { key: "size", label: "Size" },
  { key: "date", label: "Date" },
];
const FILES_LISTING_CACHE_LIMIT = 80;
const filesListingCache = new Map<string, FileEntry[]>();

function normalizePanelPath(path: string): string {
  return normalizeOpenClawWorkspaceFilePath(path);
}

function filesListingCacheKey(agentId: string | null | undefined, rootPath: string, path: string): string | null {
  const normalizedAgentId = agentId?.trim();
  if (!normalizedAgentId) return null;
  return [normalizedAgentId, normalizePanelPath(rootPath), normalizePanelPath(path)].join("\n");
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

interface AgentFileOpenResult<T extends string | Uint8Array> {
  content: T;
  path?: string;
  name?: string;
  renamed?: boolean;
}

type AgentFileOpenResponse<T extends string | Uint8Array> = T | AgentFileOpenResult<T>;

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

interface AgentFilesPanelProps {
  agentId?: string | null;
  agentName?: string | null;
  rootPath?: string;
  connected: boolean;
  initialPreviewPath?: string | null;
  isDesktopViewport?: boolean;
  error?: string | null;
  onListFiles: (path?: string) => Promise<FileEntry[]>;
  onOpenFile: (path: string) => Promise<AgentFileOpenResponse<string>>;
  onOpenFileBytes?: (path: string) => Promise<AgentFileOpenResponse<Uint8Array>>;
  onDownloadFileBytes?: (path: string) => Promise<AgentFileOpenResponse<Uint8Array>>;
  onSaveFile: (path: string, content: string) => Promise<void>;
  onDeleteFile: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  onUploadFile: (path: string, content: Uint8Array) => Promise<void>;
  onCreateDirectory?: (path: string) => Promise<void>;
}

export function AgentFilesPanel({
  agentId,
  agentName,
  rootPath = "",
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
}: AgentFilesPanelProps) {
  const normalizedRootPath = useMemo(() => normalizePanelPath(rootPath), [rootPath]);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPath, setCurrentPath] = useState(() => normalizedRootPath);
  const [showHidden, setShowHidden] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderError, setNewFolderError] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [sortKey, setSortKey] = useState<FileSortKey>("name");
  const [sortDir, setSortDir] = useState<FileSortDir>("asc");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [files, setFiles] = useState<FileEntry[]>(() => (
    getCachedFiles(filesListingCacheKey(agentId, normalizedRootPath, normalizedRootPath)) ?? []
  ));
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const listRequestIdRef = useRef(0);

  const [previewEntry, setPreviewEntry] = useState<FileEntry | null>(null);
  const [previewContent, setPreviewContent] = useState<string | Uint8Array | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const currentListingCacheKey = useMemo(
    () => filesListingCacheKey(agentId, normalizedRootPath, currentPath),
    [agentId, currentPath, normalizedRootPath],
  );

  const loadFiles = useCallback(async () => {
    if (!connected) return;
    const cachedFiles = getCachedFiles(currentListingCacheKey);
    if (cachedFiles) setFiles(cachedFiles);
    else setFiles([]);

    const requestId = ++listRequestIdRef.current;
    setListLoading(true);
    setListError(null);
    try {
      const nextFiles = await onListFiles(currentPath || undefined);
      if (requestId === listRequestIdRef.current) {
        setFiles(nextFiles);
        setCachedFiles(currentListingCacheKey, nextFiles);
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
  }, [connected, currentListingCacheKey, currentPath, onListFiles]);

  useEffect(() => {
    if (!connected) {
      listRequestIdRef.current += 1;
      setFiles([]);
      setListLoading(false);
      setListError(null);
      return;
    }
    void loadFiles();
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
  const effectiveError = listError ?? error ?? null;
  const filesBootStatus = getAgentGatewayPanelBootStatus({
    connected,
    connecting: false,
    loading: filesLoading,
    error: effectiveError,
    loadingTitle: files.length > 0 ? "Refreshing files" : "Loading files",
    loadingDetail: files.length > 0 ? "Updating folders and files." : "Fetching folders and files.",
    connectingDetail: "Opening the files workspace.",
    waitingDetail: filesDisconnected
      ? "Reconnect the workspace to browse live files."
      : "Start the agent to browse workspace files.",
    errorTitle: "Files error",
  });
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
      const result = resolveAgentFileOpenResult(
        await ((isImageFileName(entry.name) || isArchiveFileName(entry.name)) && onOpenFileBytes
          ? onOpenFileBytes(entry.path)
          : onOpenFile(entry.path)),
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
  }, [loadFiles, onOpenFile, onOpenFileBytes]);

  const normalizedInitialPreviewPath = useMemo(
    () => initialPreviewPath ? normalizeOpenClawMediaFilePath(initialPreviewPath) : "",
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
    setCurrentPath(parentPath || normalizedRootPath);
    void handleOpenFile({ name, path: fullPath, type: "file" });
  }, [connected, handleOpenFile, normalizedInitialPreviewPath, normalizedRootPath]);

  const handleSaveFile = useCallback(async (path: string, content: string) => {
    await onSaveFile(path, content);
    setPreviewContent(content);
    void loadFiles();
  }, [loadFiles, onSaveFile]);

  const handleDeleteFile = useCallback(async (entry: FileEntry) => {
    await onDeleteFile(entry.path, entry.type === "directory" ? { recursive: true } : undefined);
    if (previewEntry?.path === entry.path) {
      setPreviewEntry(null);
      setPreviewContent(null);
    }
    await loadFiles();
  }, [loadFiles, onDeleteFile, previewEntry]);

  const handleUploadFile = useCallback(async (path: string, content: Uint8Array) => {
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
    const result = resolveAgentFileOpenResult(await onDownloadFileBytes(entry.path));
    const nextPath = result.path ? normalizePanelPath(result.path) : entry.path;
    downloadFileBytes(result.name || (nextPath !== entry.path ? fileNameFromPath(nextPath) : entry.name), result.content);
    if (nextPath !== entry.path) void loadFiles();
  }, [loadFiles, onDownloadFileBytes]);

  const handleCopyPath = useCallback((entry: FileEntry) => {
    void writeClipboardText(entry.path);
  }, []);

  const handleNavigate = useCallback((path: string) => {
    setCurrentPath(pathFromRoot(path, normalizedRootPath));
    setPreviewEntry(null);
  }, [normalizedRootPath]);

  const toggleSort = useCallback((key: FileSortKey) => {
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setSortMenuOpen(false);
  }, [sortKey]);

  const breadcrumbPath = pathRelativeToRoot(currentPath, normalizedRootPath);
  const filePreview = previewEntry ? (
    <FilePreview
      key={previewEntry.path}
      entry={previewEntry}
      content={previewContent}
      loading={previewLoading}
      error={previewError}
      readOnly={isProtectedFile(previewEntry.path)}
      onClose={() => setPreviewEntry(null)}
      onSave={handleSaveFile}
      onDownload={onDownloadFileBytes ? handleDownloadFile : undefined}
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

        {(filesLoading || !connected || effectiveError) && (
          <div className="flex items-center gap-1 text-[10px] text-warning">
            {filesBootStatus?.status === "loading" ? <Loader2 className="h-3 w-3 animate-spin" /> : <WifiOff className="h-3 w-3" />}
            <span>
              {filesBootStatus?.title ?? (agentState === "RUNNING" ? "Unavailable" : agentState)}
            </span>
          </div>
        )}

        {onCreateDirectory && (
          <button
            type="button"
            onClick={() => {
              setShowCreateFolder((open) => !open);
              setShowUpload(false);
              setNewFolderError(null);
            }}
            disabled={!connected}
            className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              showCreateFolder ? "bg-selection-accent/10 text-selection-accent" : "text-text-muted hover:bg-surface-low hover:text-foreground"
            }`}
            title="New folder"
            aria-label="New folder"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            setShowUpload((open) => !open);
            setShowCreateFolder(false);
          }}
          disabled={!connected}
          className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            showUpload ? "bg-selection-accent/10 text-selection-accent" : "text-text-muted hover:bg-surface-low hover:text-foreground"
          }`}
          title="Upload files"
        >
          <Upload className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={() => setShowHidden((value) => !value)}
          className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
            showHidden ? "bg-selection-accent/10 text-selection-accent" : "text-text-muted hover:bg-surface-low hover:text-foreground"
          }`}
          title={showHidden ? "Hide dotfiles" : "Show dotfiles"}
        >
          {showHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setSortMenuOpen((open) => !open)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-low hover:text-foreground"
            title="Sort"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>
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
        {showCreateFolder && connected && onCreateDirectory && (
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
        {showUpload && connected && (
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
            {breadcrumbPath && !searchQuery.trim() && (
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
                onDeleteFile={handleDeleteFile}
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
