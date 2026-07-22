"use client";

import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import {
  File as FileIcon,
  Folder,
  FolderOpen,
  FileText,
  FileImage,
  FileJson,
  FileCode,
  FileArchive,
  FileAudio,
  FileVideo,
  CalendarDays,
  Settings,
  MoreVertical,
  Download,
  Trash2,
  PenLine,
  Copy,
  Eye,
  type LucideIcon,
} from "lucide-react";
import type { FileBackupComparison, FileEntry } from "./types";
import { resolveFileType, type FileIconKind } from "./file-types";
import { HighlightMatch } from "./FilesSearchBar";

// ── File icon resolver ──

const FILE_TYPE_ICONS: Record<FileIconKind, { icon: LucideIcon; color: string }> = {
  file: { icon: FileIcon, color: "var(--text-muted)" },
  image: { icon: FileImage, color: "var(--selection-accent)" },
  audio: { icon: FileAudio, color: "var(--chart-2)" },
  video: { icon: FileVideo, color: "var(--chart-4)" },
  archive: { icon: FileArchive, color: "var(--warning)" },
  code: { icon: FileCode, color: "var(--primary)" },
  json: { icon: FileJson, color: "var(--primary)" },
  settings: { icon: Settings, color: "var(--warning)" },
  text: { icon: FileText, color: "var(--text-muted)" },
  calendar: { icon: CalendarDays, color: "var(--chart-2)" },
  document: { icon: FileText, color: "var(--foreground)" },
  spreadsheet: { icon: FileText, color: "var(--chart-2)" },
  presentation: { icon: FileText, color: "var(--chart-4)" },
};

function getFileIcon(entry: FileEntry): { icon: LucideIcon; color: string } {
  if (entry.type === "directory") {
    return { icon: Folder, color: "var(--primary)" };
  }
  const fileType = resolveFileType(entry.name);
  return FILE_TYPE_ICONS[fileType.iconKind] ?? FILE_TYPE_ICONS.file;
}

export function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function backupTime(value: string | undefined): string {
  return value?.trim() || "unknown";
}

function backupTooltipLines(comparison: FileBackupComparison, title: string, hashLine: string): string {
  const lines = [
    title,
    `Backup copy modified: ${backupTime(comparison.backup?.lastModified)}`,
  ];
  if (comparison.live) lines.push(`Live file modified: ${backupTime(comparison.live.lastModified)}`);
  if (hashLine) lines.push(hashLine);
  if (comparison.reason) lines.push(comparison.reason);
  if (comparison.freshness === "live-newer") lines.push("Live file is newer than the backup copy.");
  if (comparison.freshness === "backup-newer") lines.push("Backup copy is newer than the live file.");
  return lines.join("\n");
}

export function getFileBackupBadge(comparison: FileBackupComparison | undefined, isDirectory: boolean): { label: string; title: string; className: string } | null {
  if (!comparison) return null;
  if (isDirectory) return null;

  if (comparison.status === "synced") {
    return {
      label: "Backed up",
      title: backupTooltipLines(comparison, "Backed up", `Hashes match${comparison.hashAlgorithm ? ` (${comparison.hashAlgorithm})` : ""}.`),
      className: "border-success/35 bg-success text-success",
    };
  }
  if (comparison.status === "modified") {
    return {
      label: "Changed since backup",
      title: backupTooltipLines(comparison, "Changed since backup", "Hashes differ."),
      className: "border-warning/35 bg-warning text-warning",
    };
  }
  if (comparison.status === "live-only") {
    return {
      label: "Not backed up",
      title: backupTooltipLines(comparison, "Not backed up", "No matching backup copy found."),
      className: "border-destructive/35 bg-destructive text-destructive",
    };
  }
  if (comparison.status === "backup-only") {
    return {
      label: "Only in backup",
      title: backupTooltipLines(comparison, "Only in backup", "No matching live file found."),
      className: "border-primary/35 bg-primary text-primary",
    };
  }
  if (comparison.status === "backup-copy") {
    return {
      label: "Backed up",
      title: backupTooltipLines(comparison, "Backed up", "Start the agent to compare this backup copy with the live file."),
      className: "border-success/35 bg-success text-success",
    };
  }
  if (comparison.status === "unverified") {
    return {
      label: "Backed up",
      title: backupTooltipLines(comparison, "Backed up", "Hash verification unavailable."),
      className: "border-success/35 bg-success text-success",
    };
  }
  if (comparison.status === "stale") {
    return {
      label: "Backup may be stale",
      title: backupTooltipLines(comparison, "Backup may be stale", "Hash verification unavailable."),
      className: "border-warning/35 bg-warning text-warning",
    };
  }
  return {
    label: "Backup status unknown",
    title: backupTooltipLines(comparison, "Backup status unknown", "No comparable hash is available yet."),
    className: "border-border bg-text-muted text-text-muted",
  };
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
  const backupStatus = getFileBackupBadge(entry.backupComparison, isDir);

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
        {backupStatus && (
          <span
            role="img"
            aria-label={backupStatus.label}
            className={`hidden h-2.5 w-2.5 shrink-0 rounded-full border sm:inline-flex ${backupStatus.className}`}
            title={backupStatus.title}
          />
        )}
      </button>

      {/* Context menu trigger */}
      <div className="relative flex-shrink-0" ref={menuRef}>
        <button
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
          aria-label={`File actions for ${entry.path}`}
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
