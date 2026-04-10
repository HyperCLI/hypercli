"use client";

import { useState, useCallback, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { FileEntry, TreeNode, FileSortKey, FileSortDir } from "./types";
import { FileRow } from "./FileRow";

// ── Types ──

interface FilesDirectoryTreeProps {
  entries: FileEntry[];
  searchQuery?: string;
  sortKey?: FileSortKey;
  sortDir?: FileSortDir;
  showHidden?: boolean;
  onOpenFile: (entry: FileEntry) => void;
  onDeleteFile?: (entry: FileEntry) => void;
  onRenameFile?: (entry: FileEntry, newName: string) => void;
  onDownloadFile?: (entry: FileEntry) => void;
  onCopyPath?: (entry: FileEntry) => void;
}

// ── Helpers ──

function buildTree(entries: FileEntry[]): TreeNode[] {
  const root: TreeNode[] = [];
  const dirMap = new Map<string, TreeNode>();

  // Sort entries so directories come before files and ensure parents exist
  const sorted = [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });

  for (const entry of sorted) {
    const segments = entry.path.split("/").filter(Boolean);
    const node: TreeNode = {
      name: entry.name,
      path: entry.path,
      type: entry.type,
      size: entry.size,
      lastModified: entry.lastModified,
      children: entry.type === "directory" ? [] : undefined,
    };

    if (segments.length <= 1) {
      root.push(node);
    } else {
      const parentPath = segments.slice(0, -1).join("/");
      const parent = dirMap.get(parentPath);
      if (parent?.children) {
        parent.children.push(node);
      } else {
        // Orphan — add to root
        root.push(node);
      }
    }

    if (entry.type === "directory") {
      dirMap.set(entry.path, node);
    }
  }

  return root;
}

function flattenForSearch(entries: FileEntry[], query: string): FileEntry[] {
  const q = query.toLowerCase();
  return entries.filter((e) => e.name.toLowerCase().includes(q));
}

function sortEntries(entries: TreeNode[], key: FileSortKey, dir: FileSortDir): TreeNode[] {
  const cmp = (a: TreeNode, b: TreeNode): number => {
    // Directories always first
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;

    let result = 0;
    if (key === "name") result = a.name.localeCompare(b.name);
    else if (key === "size") result = (a.size ?? 0) - (b.size ?? 0);
    else if (key === "date") result = (a.lastModified ?? "").localeCompare(b.lastModified ?? "");

    return dir === "desc" ? -result : result;
  };

  return [...entries].sort(cmp).map((node) => ({
    ...node,
    children: node.children ? sortEntries(node.children, key, dir) : undefined,
  }));
}

function filterHidden(nodes: TreeNode[], show: boolean): TreeNode[] {
  if (show) return nodes;
  return nodes
    .filter((n) => !n.name.startsWith("."))
    .map((n) => ({
      ...n,
      children: n.children ? filterHidden(n.children, show) : undefined,
    }));
}

// ── Recursive tree renderer ──

function TreeLevel({
  nodes,
  depth,
  expandedPaths,
  onToggle,
  searchQuery,
  onOpenFile,
  onDeleteFile,
  onRenameFile,
  onDownloadFile,
  onCopyPath,
}: {
  nodes: TreeNode[];
  depth: number;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  searchQuery?: string;
  onOpenFile: (entry: FileEntry) => void;
  onDeleteFile?: (entry: FileEntry) => void;
  onRenameFile?: (entry: FileEntry, newName: string) => void;
  onDownloadFile?: (entry: FileEntry) => void;
  onCopyPath?: (entry: FileEntry) => void;
}) {
  return (
    <div>
      {nodes.map((node) => {
        const isDir = node.type === "directory";
        const isExpanded = expandedPaths.has(node.path);
        const entry: FileEntry = {
          name: node.name,
          path: node.path,
          type: node.type,
          size: node.size,
          lastModified: node.lastModified,
        };

        return (
          <div key={node.path}>
            <FileRow
              entry={entry}
              depth={depth}
              expanded={isDir ? isExpanded : undefined}
              searchQuery={searchQuery}
              onOpen={onOpenFile}
              onToggle={() => isDir && onToggle(node.path)}
              onDelete={onDeleteFile ? () => onDeleteFile(entry) : undefined}
              onRename={onRenameFile ? (_, name) => onRenameFile(entry, name) : undefined}
              onDownload={onDownloadFile ? () => onDownloadFile(entry) : undefined}
              onCopyPath={onCopyPath ? () => onCopyPath(entry) : undefined}
            />
            <AnimatePresence initial={false}>
              {isDir && isExpanded && node.children && node.children.length > 0 && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden"
                >
                  <TreeLevel
                    nodes={node.children}
                    depth={depth + 1}
                    expandedPaths={expandedPaths}
                    onToggle={onToggle}
                    searchQuery={searchQuery}
                    onOpenFile={onOpenFile}
                    onDeleteFile={onDeleteFile}
                    onRenameFile={onRenameFile}
                    onDownloadFile={onDownloadFile}
                    onCopyPath={onCopyPath}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ──

export function FilesDirectoryTree({
  entries,
  searchQuery,
  sortKey = "name",
  sortDir = "asc",
  showHidden = false,
  onOpenFile,
  onDeleteFile,
  onRenameFile,
  onDownloadFile,
  onCopyPath,
}: FilesDirectoryTreeProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // If searching, show flat filtered list
  const isSearching = !!(searchQuery?.trim());

  const displayNodes = useMemo(() => {
    if (isSearching) {
      const flat = flattenForSearch(entries, searchQuery!);
      return flat.map((e): TreeNode => ({
        name: e.name,
        path: e.path,
        type: e.type,
        size: e.size,
        lastModified: e.lastModified,
      }));
    }

    const tree = buildTree(entries);
    const filtered = filterHidden(tree, showHidden);
    return sortEntries(filtered, sortKey, sortDir);
  }, [entries, searchQuery, isSearching, showHidden, sortKey, sortDir]);

  return (
    <TreeLevel
      nodes={displayNodes}
      depth={0}
      expandedPaths={expandedPaths}
      onToggle={toggleExpand}
      searchQuery={isSearching ? searchQuery : undefined}
      onOpenFile={onOpenFile}
      onDeleteFile={onDeleteFile}
      onRenameFile={onRenameFile}
      onDownloadFile={onDownloadFile}
      onCopyPath={onCopyPath}
    />
  );
}
