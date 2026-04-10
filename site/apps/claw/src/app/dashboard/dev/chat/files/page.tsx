"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FolderOpen, ArrowLeft, Eye, EyeOff, ArrowUpDown,
  WifiOff, X, Settings, Upload, Search,
} from "lucide-react";
import Link from "next/link";
import type { FileEntry, FileSortKey, FileSortDir, FilesCallbacks } from "@/components/dashboard/files/types";
import { FilesSearchBar } from "@/components/dashboard/files/FilesSearchBar";
import { FilesUploadZone } from "@/components/dashboard/files/FilesUploadZone";
import { FileBreadcrumbs } from "@/components/dashboard/files/FileBreadcrumbs";
import { FilesDirectoryTree } from "@/components/dashboard/files/FilesDirectoryTree";
import { FilePreview } from "@/components/dashboard/files/FilePreview";
import { FilesEmptyState } from "@/components/dashboard/files/FilesEmptyState";

// ── Mock data presets ──

const MOCK_FILE_PRESETS: { name: string; path: string; type: "file" | "directory"; size?: number }[] = [
  { name: "src", path: "src", type: "directory" },
  { name: "config", path: "config", type: "directory" },
  { name: "data", path: "data", type: "directory" },
  { name: "logs", path: "logs", type: "directory" },
  { name: "utils", path: "src/utils", type: "directory" },
  { name: "index.ts", path: "src/index.ts", type: "file", size: 1240 },
  { name: "app.ts", path: "src/app.ts", type: "file", size: 3420 },
  { name: "helpers.ts", path: "src/utils/helpers.ts", type: "file", size: 890 },
  { name: "package.json", path: "package.json", type: "file", size: 520 },
  { name: "README.md", path: "README.md", type: "file", size: 280 },
  { name: ".env", path: ".env", type: "file", size: 64 },
  { name: "settings.yaml", path: "config/settings.yaml", type: "file", size: 340 },
  { name: "output.json", path: "data/output.json", type: "file", size: 15200 },
  { name: "agent.log", path: "logs/agent.log", type: "file", size: 8900 },
];

const MOCK_CONTENTS: Record<string, string> = {
  "src/index.ts": 'import { main } from "./app";\n\nmain();',
  "src/app.ts": 'export function main() {\n  console.log("Hello from agent");\n}',
  "src/utils/helpers.ts": 'export function formatDate(d: Date) {\n  return d.toISOString();\n}\n\nexport function sleep(ms: number) {\n  return new Promise((resolve) => setTimeout(resolve, ms));\n}',
  "package.json": '{\n  "name": "agent-workspace",\n  "version": "1.0.0",\n  "main": "src/index.ts",\n  "dependencies": {\n    "typescript": "^5.3.0"\n  }\n}',
  "README.md": "# Agent Workspace\n\nThis is the agent's workspace directory.\n\n## Structure\n\n- `src/` — Source code\n- `config/` — Configuration files\n- `data/` — Output data\n- `logs/` — Agent logs",
  ".env": "API_KEY=sk-test-123\nDEBUG=true\nLOG_LEVEL=info",
  "config/settings.yaml": "model: claude-opus-4-6\nmax_tokens: 4096\ntemperature: 0.7\ntools:\n  - file_read\n  - file_write\n  - web_search\n  - code_exec",
  "data/output.json": '{\n  "results": [\n    { "id": 1, "status": "ok", "duration_ms": 142 },\n    { "id": 2, "status": "ok", "duration_ms": 89 },\n    { "id": 3, "status": "error", "error": "timeout" }\n  ],\n  "total": 3,\n  "success_rate": 0.67\n}',
  "logs/agent.log": "[2026-04-10 08:00:00] INFO  Agent started\n[2026-04-10 08:00:01] INFO  Connected to gateway\n[2026-04-10 08:00:02] INFO  Loading config from /config/settings.yaml\n[2026-04-10 08:00:03] INFO  Model: claude-opus-4-6\n[2026-04-10 08:00:05] INFO  Ready to accept messages\n[2026-04-10 08:01:12] INFO  Received message from user-1\n[2026-04-10 08:01:14] INFO  Tool call: file_read /src/index.ts\n[2026-04-10 08:01:15] INFO  Response sent (142ms)",
};

const SORT_OPTIONS: { key: FileSortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "size", label: "Size" },
  { key: "date", label: "Date" },
];

// ── Page component ──

export default function DevFilesPage() {
  // File state
  const [files, setFiles] = useState<FileEntry[]>(MOCK_FILE_PRESETS);
  const [fileContents, setFileContents] = useState<Record<string, string>>(MOCK_CONTENTS);
  const [connected] = useState(true);

  // UI state
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPath, setCurrentPath] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [sortKey, setSortKey] = useState<FileSortKey>("name");
  const [sortDir, setSortDir] = useState<FileSortDir>("asc");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  // Preview
  const [previewEntry, setPreviewEntry] = useState<FileEntry | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // ── Callbacks ──
  const handleOpenFile = useCallback(async (entry: FileEntry) => {
    if (entry.type === "directory") { setCurrentPath(entry.path); return; }
    setPreviewEntry(entry);
    setPreviewContent(null);
    setPreviewError(null);
    setPreviewLoading(true);
    // Simulate async load
    await new Promise((r) => setTimeout(r, 150));
    const content = fileContents[entry.path];
    if (content !== undefined) {
      setPreviewContent(content);
    } else {
      setPreviewError("File content not found");
    }
    setPreviewLoading(false);
  }, [fileContents]);

  const handleSaveFile = useCallback(async (path: string, content: string) => {
    await new Promise((r) => setTimeout(r, 200));
    setFileContents((prev) => ({ ...prev, [path]: content }));
  }, []);

  const handleDeleteFile = useCallback(async (entry: FileEntry) => {
    setFiles((prev) => prev.filter((f) => f.path !== entry.path));
    setFileContents((prev) => { const next = { ...prev }; delete next[entry.path]; return next; });
    if (previewEntry?.path === entry.path) setPreviewEntry(null);
  }, [previewEntry]);

  const handleUploadFile = useCallback(async (path: string, content: string) => {
    const name = path.split("/").pop() ?? path;
    setFiles((prev) => [...prev, { name, path, type: "file", size: content.length }]);
    setFileContents((prev) => ({ ...prev, [path]: content }));
  }, []);

  const handleCopyPath = useCallback((entry: FileEntry) => {
    navigator.clipboard.writeText(entry.path).catch(() => {});
  }, []);

  const handleNavigate = useCallback((path: string) => {
    setCurrentPath(path);
    setPreviewEntry(null);
  }, []);

  const toggleSort = useCallback((key: FileSortKey) => {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
    setSortMenuOpen(false);
  }, [sortKey]);

  // Search
  const searchResultCount = useMemo(() => {
    if (!searchQuery.trim()) return undefined;
    return files.filter((f) => f.name.toLowerCase().includes(searchQuery.toLowerCase())).length;
  }, [files, searchQuery]);

  const emptyKind = !connected ? "offline" : files.length === 0 ? "no-files" : searchQuery.trim() && searchResultCount === 0 ? "no-results" : null;

  const fileCount = files.filter((f) => f.type === "file").length;
  const dirCount = files.filter((f) => f.type === "directory").length;

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && previewEntry) setPreviewEntry(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [previewEntry]);

  return (
    <div className="flex flex-col h-[calc(100dvh-3.5rem)]">
      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-4 h-12 border-b border-border flex-shrink-0">
        <Link
          href="/dashboard/dev/chat"
          className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors"
          title="Back to chat"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>

        <FolderOpen className="w-4 h-4 text-[#38D39F]" />
        <span className="text-sm font-semibold text-foreground">Workspace Files</span>

        <span className="text-[10px] text-text-muted tabular-nums">
          {fileCount} files, {dirCount} dirs
        </span>

        <div className="flex-1" />

        {!connected && (
          <div className="flex items-center gap-1 text-[9px] text-[#f0c56c]">
            <WifiOff className="w-3 h-3" /><span>Offline</span>
          </div>
        )}

        <button
          onClick={() => setShowUpload((v) => !v)}
          className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
            showUpload ? "text-[#38D39F] bg-[#38D39F]/10" : "text-text-muted hover:text-foreground hover:bg-surface-low"
          }`}
          title="Upload"
        >
          <Upload className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => setShowHidden((v) => !v)}
          className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
            showHidden ? "text-[#38D39F] bg-[#38D39F]/10" : "text-text-muted hover:text-foreground hover:bg-surface-low"
          }`}
          title={showHidden ? "Hide dotfiles" : "Show dotfiles"}
        >
          {showHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
        </button>

        <div className="relative">
          <button
            onClick={() => setSortMenuOpen((v) => !v)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors"
            title="Sort"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
          </button>
          <AnimatePresence>
            {sortMenuOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="absolute right-0 top-full mt-1 z-50 w-28 rounded-lg border border-border bg-[#1a1a1c] shadow-xl overflow-hidden py-1"
              >
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => toggleSort(opt.key)}
                    className={`flex items-center justify-between w-full px-3 py-1.5 text-[11px] hover:bg-surface-low ${sortKey === opt.key ? "text-[#38D39F]" : "text-foreground"}`}
                  >
                    <span>{opt.label}</span>
                    {sortKey === opt.key && <span className="text-[9px] text-text-muted">{sortDir === "asc" ? "A-Z" : "Z-A"}</span>}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Upload zone (collapsible) ── */}
      <AnimatePresence>
        {showUpload && connected && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-b border-border"
          >
            <div className="px-4 py-3">
              <FilesUploadZone currentPath={currentPath} onUpload={handleUploadFile} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main content: sidebar + preview ── */}
      <div className="flex-1 flex min-h-0">
        {/* Left sidebar: search + tree */}
        <div className="w-72 flex-shrink-0 flex flex-col border-r border-border min-h-0">
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

          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {emptyKind ? (
              <FilesEmptyState
                kind={emptyKind as any}
                searchQuery={searchQuery}
              />
            ) : (
              <FilesDirectoryTree
                entries={files}
                searchQuery={searchQuery}
                sortKey={sortKey}
                sortDir={sortDir}
                showHidden={showHidden}
                onOpenFile={handleOpenFile}
                onDeleteFile={handleDeleteFile}
                onCopyPath={handleCopyPath}
              />
            )}
          </div>
        </div>

        {/* Right: preview */}
        <div className="flex-1 min-w-0 min-h-0">
          <AnimatePresence mode="wait">
            {previewEntry ? (
              <FilePreview
                key={previewEntry.path}
                entry={previewEntry}
                content={previewContent}
                loading={previewLoading}
                error={previewError}
                onClose={() => setPreviewEntry(null)}
                onSave={handleSaveFile}
              />
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center h-full text-text-muted gap-3"
              >
                <FolderOpen className="w-10 h-10 opacity-20" />
                <div className="text-center">
                  <p className="text-sm font-medium text-foreground mb-1">Select a file to preview</p>
                  <p className="text-[11px] text-text-muted">Click any file in the tree to view or edit its contents</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
