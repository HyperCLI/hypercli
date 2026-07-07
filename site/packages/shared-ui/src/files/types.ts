import type { LucideIcon } from "lucide-react";

// ── Core file types ──

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  lastModified?: string;
  checksum?: string;
  checksumAlgorithm?: string;
  hash?: string;
  hashAlgorithm?: string;
  sha256?: string;
  md5?: string;
  etag?: string;
  versionId?: string;
  source?: "agent" | "backup" | "gateway" | "pod" | "s3" | "auto";
  backupComparison?: FileBackupComparison;
  missing?: boolean;
}

export type FileBackupStatus = "synced" | "modified" | "live-only" | "backup-only" | "backup-copy" | "unverified" | "stale" | "unknown";
export type FileBackupFreshness = "live-newer" | "backup-newer" | "same-time" | "unknown";

export interface FileBackupSnapshot {
  path: string;
  type: "file" | "directory";
  size?: number;
  lastModified?: string;
  checksum?: string;
  checksumAlgorithm?: string;
  hash?: string;
  hashAlgorithm?: string;
  sha256?: string;
  md5?: string;
  etag?: string;
  versionId?: string;
}

export interface FileBackupComparison {
  status: FileBackupStatus;
  freshness: FileBackupFreshness;
  live?: FileBackupSnapshot;
  backup?: FileBackupSnapshot;
  hashField?: string;
  hashAlgorithm?: string;
  reason?: string;
}

export interface FileBackupSummary {
  total: number;
  synced: number;
  modified: number;
  liveOnly: number;
  backupOnly: number;
  unknown: number;
}

export interface DirectoryListing {
  prefix: string;
  directories: FileEntry[];
  files: FileEntry[];
  truncated?: boolean;
}

export interface UploadItem {
  id: string;
  file: File;
  progress: number;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

// ── Tree node (recursive) ──

export interface TreeNode extends FileEntry {
  children?: TreeNode[];
}

// ── File icon mapping ──

export interface FileIconMapping {
  icon: LucideIcon;
  color: string;
}

// ── Drawer state ──

export type FilesDrawerView = "tree" | "preview";

export type FileSortKey = "name" | "size" | "date";
export type FileSortDir = "asc" | "desc";

// ── Callbacks ──

export interface FilesCallbacks {
  onListFiles: (prefix?: string) => Promise<DirectoryListing>;
  onGetFile: (path: string) => Promise<string>;
  onSetFile: (path: string, content: string) => Promise<void>;
  onDeleteFile: (path: string) => Promise<void>;
  onUploadFile: (path: string, content: Uint8Array) => Promise<void>;
}
