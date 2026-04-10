"use client";

import { useState, useCallback, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { FileEntry, TreeNode, FileSortKey, FileSortDir } from "./types";
import { PanelFileRow } from "./PanelFileRow";

// ── Helpers ──

function buildTree(entries: FileEntry[]): TreeNode[] {
  const root: TreeNode[] = [];
  const dirMap = new Map<string, TreeNode>();
  const sorted = [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
  for (const entry of sorted) {
    const node: TreeNode = { name: entry.name, path: entry.path, type: entry.type, size: entry.size, lastModified: entry.lastModified, children: entry.type === "directory" ? [] : undefined };
    const segments = entry.path.split("/").filter(Boolean);
    if (segments.length <= 1) { root.push(node); }
    else { const parentPath = segments.slice(0, -1).join("/"); const parent = dirMap.get(parentPath); parent?.children ? parent.children.push(node) : root.push(node); }
    if (entry.type === "directory") dirMap.set(entry.path, node);
  }
  return root;
}

function sortNodes(nodes: TreeNode[], key: FileSortKey, dir: FileSortDir): TreeNode[] {
  const cmp = (a: TreeNode, b: TreeNode) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    let r = 0;
    if (key === "name") r = a.name.localeCompare(b.name);
    else if (key === "size") r = (a.size ?? 0) - (b.size ?? 0);
    else if (key === "date") r = (a.lastModified ?? "").localeCompare(b.lastModified ?? "");
    return dir === "desc" ? -r : r;
  };
  return [...nodes].sort(cmp).map((n) => ({ ...n, children: n.children ? sortNodes(n.children, key, dir) : undefined }));
}

function filterHidden(nodes: TreeNode[], show: boolean): TreeNode[] {
  if (show) return nodes;
  return nodes.filter((n) => !n.name.startsWith(".")).map((n) => ({ ...n, children: n.children ? filterHidden(n.children, show) : undefined }));
}

function flatSearch(entries: FileEntry[], q: string): FileEntry[] {
  const lq = q.toLowerCase();
  return entries.filter((e) => e.name.toLowerCase().includes(lq));
}

// ── Recursive renderer ──

function TreeLevel({
  nodes, depth, expandedPaths, selectedPath, onToggle, searchQuery,
  onOpenFile, onDeleteFile, onRenameFile, onDownloadFile, onCopyPath,
}: {
  nodes: TreeNode[]; depth: number; expandedPaths: Set<string>; selectedPath: string | null;
  onToggle: (path: string) => void; searchQuery?: string;
  onOpenFile: (e: FileEntry) => void; onDeleteFile?: (e: FileEntry) => void;
  onRenameFile?: (e: FileEntry, n: string) => void; onDownloadFile?: (e: FileEntry) => void;
  onCopyPath?: (e: FileEntry) => void;
}) {
  return (
    <div>
      {nodes.map((node) => {
        const isDir = node.type === "directory";
        const isExpanded = expandedPaths.has(node.path);
        const entry: FileEntry = { name: node.name, path: node.path, type: node.type, size: node.size, lastModified: node.lastModified };
        return (
          <div key={node.path}>
            <PanelFileRow
              entry={entry} depth={depth} expanded={isDir ? isExpanded : undefined}
              selected={selectedPath === node.path} searchQuery={searchQuery}
              onOpen={onOpenFile} onToggle={() => isDir && onToggle(node.path)}
              onDelete={onDeleteFile ? () => onDeleteFile(entry) : undefined}
              onRename={onRenameFile ? (_, name) => onRenameFile(entry, name) : undefined}
              onDownload={onDownloadFile ? () => onDownloadFile(entry) : undefined}
              onCopyPath={onCopyPath ? () => onCopyPath(entry) : undefined}
            />
            <AnimatePresence initial={false}>
              {isDir && isExpanded && node.children && node.children.length > 0 && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
                  <TreeLevel nodes={node.children} depth={depth + 1} expandedPaths={expandedPaths} selectedPath={selectedPath} onToggle={onToggle} searchQuery={searchQuery} onOpenFile={onOpenFile} onDeleteFile={onDeleteFile} onRenameFile={onRenameFile} onDownloadFile={onDownloadFile} onCopyPath={onCopyPath} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

// ── Main ──

interface PanelFilesTreeProps {
  entries: FileEntry[];
  searchQuery?: string;
  sortKey?: FileSortKey;
  sortDir?: FileSortDir;
  showHidden?: boolean;
  selectedPath?: string | null;
  onOpenFile: (entry: FileEntry) => void;
  onDeleteFile?: (entry: FileEntry) => void;
  onRenameFile?: (entry: FileEntry, newName: string) => void;
  onDownloadFile?: (entry: FileEntry) => void;
  onCopyPath?: (entry: FileEntry) => void;
}

export function PanelFilesTree({
  entries, searchQuery, sortKey = "name", sortDir = "asc", showHidden = false, selectedPath,
  onOpenFile, onDeleteFile, onRenameFile, onDownloadFile, onCopyPath,
}: PanelFilesTreeProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const toggleExpand = useCallback((path: string) => { setExpandedPaths((prev) => { const n = new Set(prev); n.has(path) ? n.delete(path) : n.add(path); return n; }); }, []);

  const isSearching = !!(searchQuery?.trim());

  const displayNodes = useMemo(() => {
    if (isSearching) return flatSearch(entries, searchQuery!).map((e): TreeNode => ({ name: e.name, path: e.path, type: e.type, size: e.size, lastModified: e.lastModified }));
    return sortNodes(filterHidden(buildTree(entries), showHidden), sortKey, sortDir);
  }, [entries, searchQuery, isSearching, showHidden, sortKey, sortDir]);

  return (
    <TreeLevel
      nodes={displayNodes} depth={0} expandedPaths={expandedPaths} selectedPath={selectedPath ?? null}
      onToggle={toggleExpand} searchQuery={isSearching ? searchQuery : undefined}
      onOpenFile={onOpenFile} onDeleteFile={onDeleteFile} onRenameFile={onRenameFile}
      onDownloadFile={onDownloadFile} onCopyPath={onCopyPath}
    />
  );
}
