"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, FolderOpen, ChevronDown, ChevronUp,
  EyeOff, Eye, ArrowUpDown, WifiOff,
} from "lucide-react";
import type { FileEntry, FileSortKey, FileSortDir, FilesCallbacks } from "./types";
import { PanelFilesSearchBar } from "./PanelFilesSearchBar";
import { PanelFilesUploadZone } from "./PanelFilesUploadZone";
import { PanelFileBreadcrumbs } from "./PanelFileBreadcrumbs";
import { PanelFilesTree } from "./PanelFilesTree";
import { PanelFilePreview } from "./PanelFilePreview";
import { PanelFilesEmptyState } from "./PanelFilesEmptyState";

// ── Types ──

interface FilesPanelProps {
  open: boolean;
  onClose: () => void;
  connected: boolean;
  callbacks?: FilesCallbacks | null;
  files?: FileEntry[] | null;
  /** Height of the panel relative to the chat area. Default: 320 */
  height?: number;
}

const SORT_OPTIONS: { key: FileSortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "size", label: "Size" },
  { key: "date", label: "Date" },
];

// ── Component ──

export function FilesPanel({ open, onClose, connected, callbacks, files: externalFiles, height = 320 }: FilesPanelProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPath, setCurrentPath] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [sortKey, setSortKey] = useState<FileSortKey>("name");
  const [sortDir, setSortDir] = useState<FileSortDir>("asc");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Preview
  const [previewEntry, setPreviewEntry] = useState<FileEntry | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Sync external files
  useEffect(() => {
    if (externalFiles) { setFiles(externalFiles); setLoading(false); setError(null); }
  }, [externalFiles]);

  // Load files
  const loadFiles = useCallback(async () => {
    if (!callbacks || externalFiles) return;
    setLoading(true); setError(null);
    try {
      const listing = await callbacks.onListFiles(currentPath || undefined);
      setFiles([
        ...listing.directories.map((d) => ({ ...d, type: "directory" as const })),
        ...listing.files.map((f) => ({ ...f, type: "file" as const })),
      ]);
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to load files"); }
    finally { setLoading(false); }
  }, [callbacks, currentPath, externalFiles]);

  useEffect(() => { if (open && connected && !externalFiles) loadFiles(); }, [open, connected, currentPath, loadFiles, externalFiles]);

  // File actions
  const handleOpenFile = useCallback(async (entry: FileEntry) => {
    if (entry.type === "directory") { setCurrentPath(entry.path); return; }
    setPreviewEntry(entry); setPreviewContent(null); setPreviewError(null); setPreviewLoading(true);
    try { if (callbacks) setPreviewContent(await callbacks.onGetFile(entry.path)); }
    catch (err) { setPreviewError(err instanceof Error ? err.message : "Failed to load file"); }
    finally { setPreviewLoading(false); }
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
      if (previewEntry?.path === entry.path) setPreviewEntry(null);
    } catch (err) { console.error("Delete failed:", err); }
  }, [callbacks, previewEntry]);

  const handleUploadFile = useCallback(async (path: string, content: string) => {
    if (!callbacks) return;
    await callbacks.onUploadFile(path, content);
    loadFiles();
  }, [callbacks, loadFiles]);

  const handleCopyPath = useCallback((entry: FileEntry) => {
    navigator.clipboard.writeText(entry.path).catch(() => {});
  }, []);

  const handleNavigate = useCallback((path: string) => {
    setCurrentPath(path); setPreviewEntry(null);
  }, []);

  const toggleSort = useCallback((key: FileSortKey) => {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
    setSortMenuOpen(false);
  }, [sortKey]);

  const searchResultCount = useMemo(() => {
    if (!searchQuery.trim()) return undefined;
    return files.filter((f) => f.name.toLowerCase().includes(searchQuery.toLowerCase())).length;
  }, [files, searchQuery]);

  const emptyKind = !connected ? "offline" : loading ? "loading" : error ? "error" : files.length === 0 ? "no-files" : searchQuery.trim() && searchResultCount === 0 ? "no-results" : null;

  // Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { if (previewEntry) setPreviewEntry(null); else onClose(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, previewEntry]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: collapsed ? 40 : height, opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 35 }}
          className="flex-shrink-0 border-t border-border bg-background overflow-hidden flex flex-col"
        >
          {/* Header bar */}
          <div className="flex items-center gap-2 px-3 h-10 border-b border-border flex-shrink-0">
            <FolderOpen className="w-3.5 h-3.5 text-[#38D39F]" />
            <span className="text-xs font-semibold text-foreground">Files</span>

            {files.length > 0 && (
              <span className="text-[9px] text-text-muted tabular-nums">
                {files.filter((f) => f.type === "file").length} files
              </span>
            )}

            <div className="flex-1" />

            {!connected && (
              <div className="flex items-center gap-1 text-[9px] text-[#f0c56c]">
                <WifiOff className="w-3 h-3" /><span>Offline</span>
              </div>
            )}

            <button
              onClick={() => setShowHidden((v) => !v)}
              className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${showHidden ? "text-[#38D39F] bg-[#38D39F]/10" : "text-text-muted hover:text-foreground hover:bg-surface-low"}`}
              title={showHidden ? "Hide dotfiles" : "Show dotfiles"}
            >
              {showHidden ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            </button>

            <div className="relative">
              <button onClick={() => setSortMenuOpen((v) => !v)} className="w-6 h-6 rounded flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors" title="Sort">
                <ArrowUpDown className="w-3 h-3" />
              </button>
              <AnimatePresence>
                {sortMenuOpen && (
                  <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="absolute right-0 bottom-full mb-1 z-50 w-28 rounded-lg border border-border bg-[#1a1a1c] shadow-xl overflow-hidden py-1">
                    {SORT_OPTIONS.map((opt) => (
                      <button key={opt.key} onClick={() => toggleSort(opt.key)} className={`flex items-center justify-between w-full px-3 py-1.5 text-[11px] hover:bg-surface-low ${sortKey === opt.key ? "text-[#38D39F]" : "text-foreground"}`}>
                        <span>{opt.label}</span>
                        {sortKey === opt.key && <span className="text-[9px] text-text-muted">{sortDir === "asc" ? "A-Z" : "Z-A"}</span>}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <button onClick={() => setCollapsed((v) => !v)} className="w-6 h-6 rounded flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors" title={collapsed ? "Expand" : "Collapse"}>
              {collapsed ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>

            <button onClick={onClose} className="w-6 h-6 rounded flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors">
              <X className="w-3 h-3" />
            </button>
          </div>

          {/* Body — horizontal split: sidebar tree | preview */}
          {!collapsed && (
            <div className="flex-1 flex min-h-0">
              {/* Left: tree sidebar */}
              <div className="w-56 flex-shrink-0 flex flex-col border-r border-border min-h-0">
                {/* Search + breadcrumbs */}
                <div className="px-2 pt-2 pb-1.5 space-y-1.5 flex-shrink-0">
                  <PanelFilesSearchBar value={searchQuery} onChange={setSearchQuery} resultCount={searchResultCount} totalCount={files.length} />
                  {currentPath && !searchQuery.trim() && (
                    <PanelFileBreadcrumbs path={currentPath} onNavigate={handleNavigate} />
                  )}
                </div>

                {/* Tree or empty state */}
                <div className="flex-1 overflow-y-auto px-1 pb-1">
                  {emptyKind ? (
                    <PanelFilesEmptyState kind={emptyKind as any} searchQuery={searchQuery} errorMessage={error ?? undefined} onRetry={loadFiles} />
                  ) : (
                    <PanelFilesTree
                      entries={files} searchQuery={searchQuery} sortKey={sortKey} sortDir={sortDir} showHidden={showHidden}
                      selectedPath={previewEntry?.path}
                      onOpenFile={handleOpenFile} onDeleteFile={callbacks ? handleDeleteFile : undefined} onCopyPath={handleCopyPath}
                    />
                  )}
                </div>

                {/* Upload */}
                {connected && callbacks && (
                  <div className="flex-shrink-0 px-2 pb-2 pt-1 border-t border-border">
                    <PanelFilesUploadZone currentPath={currentPath} onUpload={handleUploadFile} />
                  </div>
                )}
              </div>

              {/* Right: preview */}
              <div className="flex-1 min-w-0 min-h-0">
                {previewEntry ? (
                  <PanelFilePreview
                    entry={previewEntry}
                    content={previewContent}
                    loading={previewLoading}
                    error={previewError}
                    onClose={() => setPreviewEntry(null)}
                    onSave={callbacks ? handleSaveFile : undefined}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-text-muted gap-2">
                    <FolderOpen className="w-6 h-6 opacity-30" />
                    <p className="text-[11px]">Select a file to preview</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
