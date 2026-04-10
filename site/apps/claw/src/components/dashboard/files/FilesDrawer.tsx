"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  FolderOpen,
  EyeOff,
  Eye,
  ArrowUpDown,
  WifiOff,
} from "lucide-react";
import type { FileEntry, FileSortKey, FileSortDir, FilesCallbacks } from "./types";
import { FilesSearchBar } from "./FilesSearchBar";
import { FilesUploadZone } from "./FilesUploadZone";
import { FileBreadcrumbs } from "./FileBreadcrumbs";
import { FilesDirectoryTree } from "./FilesDirectoryTree";
import { FilePreview } from "./FilePreview";
import { FilesEmptyState } from "./FilesEmptyState";

// ── Types ──

interface FilesDrawerProps {
  open: boolean;
  onClose: () => void;
  connected: boolean;
  callbacks?: FilesCallbacks | null;
  /** External file entries (e.g. from useGatewayChat). If provided, skips internal fetch. */
  files?: FileEntry[] | null;
}

// ── Sort options ──

const SORT_OPTIONS: { key: FileSortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "size", label: "Size" },
  { key: "date", label: "Date" },
];

// ── Component ──

export function FilesDrawer({ open, onClose, connected, callbacks, files: externalFiles }: FilesDrawerProps) {
  // ── State ──
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPath, setCurrentPath] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [sortKey, setSortKey] = useState<FileSortKey>("name");
  const [sortDir, setSortDir] = useState<FileSortDir>("asc");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);

  // Preview state
  const [previewEntry, setPreviewEntry] = useState<FileEntry | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // ── Sync external files ──
  useEffect(() => {
    if (externalFiles) {
      setFiles(externalFiles);
      setLoading(false);
      setError(null);
    }
  }, [externalFiles]);

  // ── Load files ──
  const loadFiles = useCallback(async () => {
    if (!callbacks || externalFiles) return;
    setLoading(true);
    setError(null);
    try {
      const listing = await callbacks.onListFiles(currentPath || undefined);
      const entries: FileEntry[] = [
        ...listing.directories.map((d) => ({ ...d, type: "directory" as const })),
        ...listing.files.map((f) => ({ ...f, type: "file" as const })),
      ];
      setFiles(entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files");
    } finally {
      setLoading(false);
    }
  }, [callbacks, currentPath, externalFiles]);

  // Load on open or path change
  useEffect(() => {
    if (open && connected && !externalFiles) {
      loadFiles();
    }
  }, [open, connected, currentPath, loadFiles, externalFiles]);

  // ── File actions ──
  const handleOpenFile = useCallback(async (entry: FileEntry) => {
    if (entry.type === "directory") {
      setCurrentPath(entry.path);
      return;
    }
    setPreviewEntry(entry);
    setPreviewContent(null);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      if (callbacks) {
        const content = await callbacks.onGetFile(entry.path);
        setPreviewContent(content);
      }
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Failed to load file");
    } finally {
      setPreviewLoading(false);
    }
  }, [callbacks]);

  const handleSaveFile = useCallback(async (path: string, content: string) => {
    if (!callbacks) return;
    await callbacks.onSetFile(path, content);
  }, [callbacks]);

  const handleDeleteFile = useCallback(async (entry: FileEntry) => {
    if (!callbacks) return;
    try {
      await callbacks.onDeleteFile(entry.path);
      setFiles((prev) => prev.filter((f) => f.path !== entry.path));
      if (previewEntry?.path === entry.path) {
        setPreviewEntry(null);
      }
    } catch (err) {
      // TODO: show toast
      console.error("Delete failed:", err);
    }
  }, [callbacks, previewEntry]);

  const handleUploadFile = useCallback(async (path: string, content: string) => {
    if (!callbacks) return;
    await callbacks.onUploadFile(path, content);
    // Refresh file list after upload
    loadFiles();
  }, [callbacks, loadFiles]);

  const handleCopyPath = useCallback((entry: FileEntry) => {
    navigator.clipboard.writeText(entry.path).catch(() => {});
  }, []);

  const handleNavigate = useCallback((path: string) => {
    setCurrentPath(path);
    setPreviewEntry(null);
  }, []);

  const toggleSort = useCallback((key: FileSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setSortMenuOpen(false);
  }, [sortKey]);

  // ── Search result count ──
  const searchResultCount = useMemo(() => {
    if (!searchQuery.trim()) return undefined;
    const q = searchQuery.toLowerCase();
    return files.filter((f) => f.name.toLowerCase().includes(q)).length;
  }, [files, searchQuery]);

  // ── Determine empty state ──
  const emptyKind = !connected
    ? "offline"
    : loading
    ? "loading"
    : error
    ? "error"
    : files.length === 0
    ? "no-files"
    : searchQuery.trim() && searchResultCount === 0
    ? "no-results"
    : null;

  // ── Close on Escape ──
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (previewEntry) setPreviewEntry(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, previewEntry]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 bg-black/40"
            onClick={onClose}
          />

          {/* Drawer panel */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 400, damping: 35 }}
            className="fixed right-0 top-0 bottom-0 z-50 w-[380px] max-w-[90vw] bg-background border-l border-border flex flex-col shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center gap-2 px-4 h-12 border-b border-border flex-shrink-0">
              <FolderOpen className="w-4 h-4 text-[#38D39F]" />
              <span className="text-sm font-semibold text-foreground flex-1">Files</span>

              {!connected && (
                <div className="flex items-center gap-1 text-[9px] text-[#f0c56c]">
                  <WifiOff className="w-3 h-3" />
                  <span>Offline</span>
                </div>
              )}

              {/* Show/hide hidden files */}
              <button
                onClick={() => setShowHidden((v) => !v)}
                className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${
                  showHidden ? "text-[#38D39F] bg-[#38D39F]/10" : "text-text-muted hover:text-foreground hover:bg-surface-low"
                }`}
                title={showHidden ? "Hide dotfiles" : "Show dotfiles"}
              >
                {showHidden ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              </button>

              {/* Sort menu */}
              <div className="relative">
                <button
                  onClick={() => setSortMenuOpen((v) => !v)}
                  className="w-6 h-6 rounded flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors"
                  title="Sort"
                >
                  <ArrowUpDown className="w-3 h-3" />
                </button>
                <AnimatePresence>
                  {sortMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95, y: -4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: -4 }}
                      transition={{ duration: 0.1 }}
                      className="absolute right-0 top-full mt-1 z-50 w-28 rounded-lg border border-border bg-[#1a1a1c] shadow-xl overflow-hidden"
                    >
                      <div className="py-1">
                        {SORT_OPTIONS.map((opt) => (
                          <button
                            key={opt.key}
                            onClick={() => toggleSort(opt.key)}
                            className={`flex items-center justify-between w-full px-3 py-1.5 text-[11px] transition-colors hover:bg-surface-low ${
                              sortKey === opt.key ? "text-[#38D39F]" : "text-foreground"
                            }`}
                          >
                            <span>{opt.label}</span>
                            {sortKey === opt.key && (
                              <span className="text-[9px] text-text-muted">{sortDir === "asc" ? "A-Z" : "Z-A"}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <button
                onClick={onClose}
                className="w-6 h-6 rounded flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Toolbar: search + breadcrumbs */}
            <div className="px-3 pt-3 pb-2 space-y-2 flex-shrink-0">
              <FilesSearchBar
                value={searchQuery}
                onChange={setSearchQuery}
                resultCount={searchResultCount}
                totalCount={files.length}
              />
              {currentPath && !searchQuery.trim() && (
                <FileBreadcrumbs path={currentPath} onNavigate={handleNavigate} />
              )}
            </div>

            {/* Content area — either preview or tree */}
            <div className="flex-1 min-h-0 flex flex-col">
              <AnimatePresence mode="wait">
                {previewEntry ? (
                  <FilePreview
                    key="preview"
                    entry={previewEntry}
                    content={previewContent}
                    loading={previewLoading}
                    error={previewError}
                    onClose={() => setPreviewEntry(null)}
                    onSave={callbacks ? handleSaveFile : undefined}
                  />
                ) : emptyKind ? (
                  <FilesEmptyState
                    key="empty"
                    kind={emptyKind as any}
                    searchQuery={searchQuery}
                    errorMessage={error ?? undefined}
                    onRetry={loadFiles}
                  />
                ) : (
                  <motion.div
                    key="tree"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex-1 overflow-y-auto px-2 pb-2"
                  >
                    <FilesDirectoryTree
                      entries={files}
                      searchQuery={searchQuery}
                      sortKey={sortKey}
                      sortDir={sortDir}
                      showHidden={showHidden}
                      onOpenFile={handleOpenFile}
                      onDeleteFile={callbacks ? handleDeleteFile : undefined}
                      onCopyPath={handleCopyPath}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Upload zone — always visible at bottom */}
            {connected && callbacks && !previewEntry && (
              <div className="flex-shrink-0 px-3 pb-3 pt-1 border-t border-border">
                <FilesUploadZone
                  currentPath={currentPath}
                  onUpload={handleUploadFile}
                  compact
                />
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
