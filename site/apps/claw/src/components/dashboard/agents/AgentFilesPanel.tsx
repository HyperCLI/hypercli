"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpDown,
  Eye,
  EyeOff,
  FileText,
  FolderOpen,
  Loader2,
  Upload,
  WifiOff,
} from "lucide-react";

import { FileBreadcrumbs } from "@/components/dashboard/files/FileBreadcrumbs";
import { FilePreview } from "@/components/dashboard/files/FilePreview";
import { FilesDirectoryTree } from "@/components/dashboard/files/FilesDirectoryTree";
import { FilesEmptyState } from "@/components/dashboard/files/FilesEmptyState";
import { FilesSearchBar } from "@/components/dashboard/files/FilesSearchBar";
import { FilesUploadZone } from "@/components/dashboard/files/FilesUploadZone";
import type { FileEntry, FileSortDir, FileSortKey } from "@/components/dashboard/files/types";
import { isProtectedFile } from "@/lib/protected-files";

const SORT_OPTIONS: Array<{ key: FileSortKey; label: string }> = [
  { key: "name", label: "Name" },
  { key: "size", label: "Size" },
  { key: "date", label: "Date" },
];

function normalizePanelPath(path: string): string {
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
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

interface AgentFilesPanelProps {
  agentName?: string | null;
  agentState?: string | null;
  rootPath?: string;
  connected: boolean;
  connecting: boolean;
  hydrating: boolean;
  error?: string | null;
  onListFiles: (path?: string) => Promise<FileEntry[]>;
  onOpenFile: (path: string) => Promise<string>;
  onSaveFile: (path: string, content: string) => Promise<void>;
  onDeleteFile: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  onUploadFile: (path: string, content: string) => Promise<void>;
}

export function AgentFilesPanel({
  agentName,
  agentState,
  rootPath = "",
  connected,
  connecting,
  hydrating,
  error,
  onListFiles,
  onOpenFile,
  onSaveFile,
  onDeleteFile,
  onUploadFile,
}: AgentFilesPanelProps) {
  const normalizedRootPath = useMemo(() => normalizePanelPath(rootPath), [rootPath]);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPath, setCurrentPath] = useState(() => normalizedRootPath);
  const [showHidden, setShowHidden] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [sortKey, setSortKey] = useState<FileSortKey>("name");
  const [sortDir, setSortDir] = useState<FileSortDir>("asc");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const listRequestIdRef = useRef(0);

  const [previewEntry, setPreviewEntry] = useState<FileEntry | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const loadFiles = useCallback(async () => {
    if (!connected) return;
    const requestId = ++listRequestIdRef.current;
    setListLoading(true);
    setListError(null);
    try {
      const nextFiles = await onListFiles(currentPath || undefined);
      if (requestId === listRequestIdRef.current) {
        setFiles(nextFiles);
      }
    } catch (err) {
      if (requestId === listRequestIdRef.current) {
        setListError(err instanceof Error ? err.message : "Failed to load files");
        setFiles([]);
      }
    } finally {
      if (requestId === listRequestIdRef.current) {
        setListLoading(false);
      }
    }
  }, [connected, currentPath, onListFiles]);

  useEffect(() => {
    if (!connected) {
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

  const filesLoading = listLoading || (agentState === "RUNNING" && (connecting || hydrating));
  const filesDisconnected = agentState === "RUNNING" && !connecting && !hydrating && !listLoading && !connected;
  const effectiveError = listError ?? error ?? null;
  const emptyKind: "offline" | "loading" | "error" | "no-files" | "no-results" | null =
    filesLoading
      ? "loading"
      : effectiveError
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
      setPreviewContent(await onOpenFile(entry.path));
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Failed to load file");
    } finally {
      setPreviewLoading(false);
    }
  }, [onOpenFile]);

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

  const handleUploadFile = useCallback(async (path: string, content: string) => {
    await onUploadFile(path, content);
    await loadFiles();
  }, [loadFiles, onUploadFile]);

  const handleCopyPath = useCallback((entry: FileEntry) => {
    navigator.clipboard.writeText(entry.path).catch(() => {});
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 flex-shrink-0 items-center gap-3 border-b border-border px-4">
        <FolderOpen className="h-4 w-4 text-primary" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{agentName || "Agent files"}</p>
          <p className="text-[10px] text-text-muted">
            {fileCount} files{dirCount > 0 ? `, ${dirCount} folders` : ""}
          </p>
        </div>

        <div className="flex-1" />

        {(filesLoading || !connected || effectiveError) && (
          <div className="flex items-center gap-1 text-[10px] text-[#f0c56c]">
            {filesLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <WifiOff className="h-3 w-3" />}
            <span>
              {filesLoading ? "Loading workspace" : effectiveError ? "Files error" : agentState === "RUNNING" ? "Unavailable" : agentState}
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowUpload((open) => !open)}
          disabled={!connected}
          className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            showUpload ? "bg-primary/10 text-primary" : "text-text-muted hover:bg-surface-low hover:text-foreground"
          }`}
          title="Upload files"
        >
          <Upload className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={() => setShowHidden((value) => !value)}
          className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
            showHidden ? "bg-primary/10 text-primary" : "text-text-muted hover:bg-surface-low hover:text-foreground"
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
                className="absolute right-0 top-full z-50 mt-1 w-28 overflow-hidden rounded-lg border border-border bg-[#1a1a1c] py-1 shadow-xl"
              >
                {SORT_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => toggleSort(option.key)}
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-[11px] hover:bg-surface-low ${
                      sortKey === option.key ? "text-primary" : "text-foreground"
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

      <div className="flex min-h-0 flex-1">
        <aside className="flex min-h-0 w-72 flex-shrink-0 flex-col border-r border-border">
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
                    ? "Loading workspace"
                    : emptyKind === "offline" && filesDisconnected
                      ? "Files unavailable"
                      : undefined
                }
                description={
                  emptyKind === "loading"
                    ? "Loading folders and files."
                    : emptyKind === "offline" && filesDisconnected
                      ? "Start the agent to browse workspace files."
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
                onCopyPath={handleCopyPath}
              />
            )}
          </div>
        </aside>

        <main className="min-h-0 min-w-0 flex-1">
          <AnimatePresence mode="wait">
            {previewEntry ? (
              <FilePreview
                key={previewEntry.path}
                entry={previewEntry}
                content={previewContent}
                loading={previewLoading}
                error={previewError}
                readOnly={isProtectedFile(previewEntry.path)}
                onClose={() => setPreviewEntry(null)}
                onSave={handleSaveFile}
              />
            ) : (
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
      </div>
    </div>
  );
}
