"use client";

import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import {
  File as FileIcon,
  Folder,
  FolderOpen,
  Code2,
  FileText,
  FileImage,
  FileJson,
  FileCode,
  Settings,
  MoreVertical,
  Download,
  Trash2,
  PenLine,
  Copy,
  Eye,
  type LucideIcon,
} from "lucide-react";
import type { FileEntry } from "./types";
import { HighlightMatch } from "./FilesSearchBar";

// ── File icon resolver ──

const EXTENSION_ICONS: Record<string, { icon: LucideIcon; color: string }> = {
  ts: { icon: FileCode, color: "var(--primary)" },
  tsx: { icon: FileCode, color: "var(--primary)" },
  js: { icon: FileCode, color: "var(--warning)" },
  jsx: { icon: FileCode, color: "var(--warning)" },
  py: { icon: FileCode, color: "var(--chart-2)" },
  rs: { icon: FileCode, color: "var(--chart-4)" },
  go: { icon: FileCode, color: "var(--chart-2)" },
  json: { icon: FileJson, color: "var(--primary)" },
  yaml: { icon: Settings, color: "var(--destructive)" },
  yml: { icon: Settings, color: "var(--destructive)" },
  toml: { icon: Settings, color: "var(--chart-4)" },
  md: { icon: FileText, color: "var(--foreground)" },
  txt: { icon: FileText, color: "var(--text-muted)" },
  log: { icon: FileText, color: "var(--text-muted)" },
  png: { icon: FileImage, color: "var(--selection-accent)" },
  jpg: { icon: FileImage, color: "var(--selection-accent)" },
  jpeg: { icon: FileImage, color: "var(--selection-accent)" },
  gif: { icon: FileImage, color: "var(--selection-accent)" },
  svg: { icon: FileImage, color: "var(--warning)" },
  webp: { icon: FileImage, color: "var(--selection-accent)" },
  html: { icon: Code2, color: "var(--warning)" },
  css: { icon: Code2, color: "var(--primary)" },
  sh: { icon: FileCode, color: "var(--success)" },
  env: { icon: Settings, color: "var(--warning)" },
};

function getFileIcon(entry: FileEntry): { icon: LucideIcon; color: string } {
  if (entry.type === "directory") {
    return { icon: Folder, color: "var(--primary)" };
  }
  const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_ICONS[ext] ?? { icon: FileIcon, color: "var(--text-muted)" };
}

export function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Types ──

interface FileRowProps {
  entry: FileEntry;
  depth?: number;
  expanded?: boolean;
  searchQuery?: string;
  onOpen: (entry: FileEntry) => void;
  onToggle?: (entry: FileEntry) => void;
  onDelete?: (entry: FileEntry) => void;
  onRename?: (entry: FileEntry, newName: string) => void;
  onDownload?: (entry: FileEntry) => void;
  onCopyPath?: (entry: FileEntry) => void;
}

// ── Component ──

export function FileRow({
  entry,
  depth = 0,
  expanded,
  searchQuery,
  onOpen,
  onToggle,
  onDelete,
  onRename,
  onDownload,
  onCopyPath,
}: FileRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(entry.name);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  const { icon: EntryIcon, color: iconColor } = getFileIcon(entry);
  const isDir = entry.type === "directory";

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  // Focus rename input
  useEffect(() => {
    if (renaming) renameRef.current?.select();
  }, [renaming]);

  const commitRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== entry.name) {
      onRename?.(entry, trimmed);
    }
    setRenaming(false);
  };

  const handleClick = () => {
    if (isDir) {
      onToggle?.(entry);
    } else {
      onOpen(entry);
    }
  };

  const DirIcon = expanded ? FolderOpen : Folder;
  const DisplayIcon = isDir ? DirIcon : EntryIcon;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="group/file flex items-center gap-1.5 rounded-md hover:bg-surface-low/60 transition-colors relative"
      style={{ paddingLeft: 8 + depth * 16 }}
    >
      <button
        onClick={handleClick}
        className="flex-1 flex items-center gap-2 py-1.5 pr-1 min-w-0 text-left"
      >
        <DisplayIcon
          className="w-4 h-4 flex-shrink-0"
          style={{ color: iconColor }}
        />
        <div className="flex-1 min-w-0">
          {renaming ? (
            <input
              ref={renameRef}
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setRenaming(false);
              }}
              onBlur={commitRename}
              onClick={(e) => e.stopPropagation()}
              className="w-full bg-transparent border-b border-[var(--selection-accent)] text-xs text-foreground focus:outline-none"
            />
          ) : (
            <span className="text-xs text-foreground truncate block">
              {searchQuery ? (
                <HighlightMatch text={entry.name} query={searchQuery} />
              ) : (
                entry.name
              )}
            </span>
          )}
        </div>
        {!isDir && entry.size !== undefined && (
          <span className="text-[9px] text-text-muted/60 tabular-nums flex-shrink-0">
            {formatFileSize(entry.size)}
          </span>
        )}
      </button>

      {/* Context menu trigger */}
      <div className="relative flex-shrink-0" ref={menuRef}>
        <button
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
          className="w-5 h-5 rounded flex items-center justify-center text-text-muted/0 group-hover/file:text-text-muted hover:text-foreground transition-all"
        >
          <MoreVertical className="w-3 h-3" />
        </button>

        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.1 }}
            className="absolute right-0 top-full mt-0.5 z-50 w-36 overflow-hidden rounded-lg border border-border bg-popover shadow-xl"
          >
            <div className="py-1">
              {!isDir && (
                <MenuButton icon={Eye} label="Preview" onClick={() => { setMenuOpen(false); onOpen(entry); }} />
              )}
              {!isDir && onDownload && (
                <MenuButton icon={Download} label="Download" onClick={() => { setMenuOpen(false); onDownload(entry); }} />
              )}
              {onRename && (
                <MenuButton icon={PenLine} label="Rename" onClick={() => { setMenuOpen(false); setRenaming(true); }} />
              )}
              {onCopyPath && (
                <MenuButton icon={Copy} label="Copy path" onClick={() => { setMenuOpen(false); onCopyPath(entry); }} />
              )}
              {onDelete && (
                <MenuButton icon={Trash2} label="Delete" danger onClick={() => { setMenuOpen(false); onDelete(entry); }} />
              )}
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

// ── Menu button sub-component ──

function MenuButton({
  icon: Icon,
  label,
  danger,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 w-full px-3 py-1.5 text-left text-[11px] transition-colors ${
        danger
          ? "text-destructive hover:bg-destructive/10"
          : "text-foreground hover:bg-surface-low"
      }`}
    >
      <Icon className="w-3 h-3" />
      {label}
    </button>
  );
}
