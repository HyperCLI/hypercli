import type { LucideIcon } from "lucide-react";

// ── Core file types ──

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  lastModified?: string;
  missing?: boolean;
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

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  lastModified?: string;
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
  onUploadFile: (path: string, content: string) => Promise<void>;
}
