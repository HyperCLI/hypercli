"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FolderOpen, ArrowLeft, Eye, EyeOff, ArrowUpDown,
  WifiOff, Loader2, Upload,
} from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import type { FileEntry, FileSortKey, FileSortDir } from "@/components/dashboard/files/types";
import { FilesSearchBar } from "@/components/dashboard/files/FilesSearchBar";
import { FilesUploadZone } from "@/components/dashboard/files/FilesUploadZone";
import { FileBreadcrumbs } from "@/components/dashboard/files/FileBreadcrumbs";
import { FilesDirectoryTree } from "@/components/dashboard/files/FilesDirectoryTree";
import { FilePreview } from "@/components/dashboard/files/FilePreview";
import { FilesEmptyState } from "@/components/dashboard/files/FilesEmptyState";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { useOpenClawSession } from "@/hooks/useOpenClawSession";
import { createAgentClient } from "@/lib/agent-client";
import { isProtectedFile } from "@/lib/protected-files";

type AgentState = "PENDING" | "STARTING" | "RUNNING" | "STOPPING" | "STOPPED" | "FAILED";

interface AgentDetail {
  id: string;
  name: string;
  state: AgentState;
  hostname: string | null;
}

const SORT_OPTIONS: { key: FileSortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "size", label: "Size" },
  { key: "date", label: "Date" },
];

export default function AgentFilesPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const agentId = params?.id ?? "";
  const initialFilePath = searchParams?.get("file") ?? null;
  const { getToken } = useAgentAuth();

  // Agent metadata
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [agentLoading, setAgentLoading] = useState(true);

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const deployment = await createAgentClient(token).get(agentId);
        if (cancelled) return;
        setAgent({
          id: deployment.id,
          name: deployment.name ?? deployment.id,
          state: ((deployment.state ?? "STOPPED").toUpperCase()) as AgentState,
          hostname: deployment.hostname ?? null,
        });
      } catch (e) {
        if (!cancelled) setAgentError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setAgentLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [agentId, getToken]);

  // Connect to gateway when agent is RUNNING (matches main page pattern)
  const chat = useOpenClawSession(agent && agent.state === "RUNNING" ? agent : null);

  // Map gateway WorkspaceFile[] → FileEntry[] (gateway only returns files, not directories)
  const files: FileEntry[] = useMemo(
    () => chat.files.map((f) => ({ name: f.name, path: f.name, type: "file" as const, size: f.size })),
    [chat.files],
  );

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
    try {
      const content = await chat.openFile(entry.path);
      setPreviewContent(content);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewLoading(false);
    }
  }, [chat]);

  const handleSaveFile = useCallback(async (path: string, content: string) => {
    await chat.saveFile(path, content);
  }, [chat]);

  const handleDeleteFile = useCallback(async (entry: FileEntry) => {
    if (!agent) return;
    const token = await getToken();
    await createAgentClient(token).fileDelete(agent.id, entry.path);
    if (previewEntry?.path === entry.path) setPreviewEntry(null);
  }, [agent, getToken, previewEntry]);

  const handleUploadFile = useCallback(async (path: string, content: string) => {
    if (!agent) return;
    const token = await getToken();
    await createAgentClient(token).fileWriteBytes(agent.id, path, new TextEncoder().encode(content));
  }, [agent, getToken]);

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

  const connected = chat.connected;
  const emptyKind: "offline" | "no-files" | "no-results" | null =
    !connected ? "offline" :
    files.length === 0 ? "no-files" :
    searchQuery.trim() && searchResultCount === 0 ? "no-results" : null;

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

  // Auto-open the file passed via ?file=... (one-shot, once the gateway has the file list)
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (!initialFilePath) return;
    if (!connected) return;
    const match = files.find((f) => f.path === initialFilePath);
    if (!match) return;
    autoOpenedRef.current = true;
    void handleOpenFile(match);
  }, [connected, files, initialFilePath, handleOpenFile]);

  // Loading / error states for agent fetch
  if (agentLoading) {
    return (
      <div className="flex h-full items-center justify-center text-text-muted">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading agent…
      </div>
    );
  }
  if (agentError || !agent) {
    return (
      <div className="flex h-full items-center justify-center flex-col gap-3 text-text-muted">
        <p className="text-sm text-[#d05f5f]">{agentError ?? "Agent not found"}</p>
        <Link
          href="/dashboard/agents"
          className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-surface-low"
        >
          Back to agents
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-4 h-12 border-b border-border flex-shrink-0">
        <Link
          href="/dashboard/agents"
          className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors"
          title="Back to agent"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>

        <FolderOpen className="w-4 h-4 text-[#38D39F]" />
        <span className="text-sm font-semibold text-foreground truncate max-w-[200px]">
          {agent.name}
        </span>
        <span className="text-xs text-text-muted">/</span>
        <span className="text-sm text-text-secondary">Files</span>

        <span className="text-[10px] text-text-muted tabular-nums">
          {fileCount} files{dirCount > 0 && `, ${dirCount} dirs`}
        </span>

        <div className="flex-1" />

        {!connected && (
          <div className="flex items-center gap-1 text-[9px] text-[#f0c56c]">
            <WifiOff className="w-3 h-3" />
            <span>{agent.state === "RUNNING" ? "Connecting…" : agent.state}</span>
          </div>
        )}

        <button
          onClick={() => setShowUpload((v) => !v)}
          disabled={!connected}
          className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
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
                kind={emptyKind}
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

        <div className="flex-1 min-w-0 min-h-0">
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
                className="flex flex-col items-center justify-center h-full text-text-muted gap-3"
              >
                <FolderOpen className="w-10 h-10 opacity-20" />
                <div className="text-center">
                  <p className="text-sm font-medium text-foreground mb-1">Select a file to preview</p>
                  <p className="text-[11px] text-text-muted">Click any file to view or edit its contents</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
