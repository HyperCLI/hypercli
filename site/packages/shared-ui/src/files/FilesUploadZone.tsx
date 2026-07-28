"use client";

import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  X,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  FileIcon,
} from "lucide-react";
import type { UploadItem } from "./types";
import { TooltipHint } from "../components/ui/tooltip";

// ── Constants ──

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

// ── Types ──

interface FilesUploadZoneProps {
  currentPath: string;
  onUpload: (path: string, content: Uint8Array) => Promise<void>;
  onCreateDirectory?: (path: string) => Promise<void>;
  compact?: boolean;
}

export interface DroppedUploadFile {
  file: File;
  relativePath: string;
}

interface DroppedFileSystemEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
}

interface DroppedFileEntry extends DroppedFileSystemEntry {
  file: (success: (file: File) => void, error?: (cause: DOMException) => void) => void;
}

interface DroppedDirectoryEntry extends DroppedFileSystemEntry {
  createReader: () => {
    readEntries: (
      success: (entries: DroppedFileSystemEntry[]) => void,
      error?: (cause: DOMException) => void,
    ) => void;
  };
}

export interface DroppedFileSelection {
  files: DroppedUploadFile[];
  directories: string[];
}

interface DroppedFileSystemHandle {
  kind: "file" | "directory";
  name: string;
}

interface DroppedFileHandle extends DroppedFileSystemHandle {
  kind: "file";
  getFile: () => Promise<File>;
}

interface DroppedDirectoryHandle extends DroppedFileSystemHandle {
  kind: "directory";
  values: () => AsyncIterable<DroppedFileSystemHandle>;
}

interface DroppedItemSnapshot {
  entry: DroppedFileSystemEntry | null;
  handlePromise: Promise<DroppedFileSystemHandle | null> | null;
  handleError: unknown | null;
  file: File | null;
}

// ── Component ──

export function FilesUploadZone({ currentPath, onUpload, onCreateDirectory, compact = false }: FilesUploadZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dropError, setDropError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFiles = useCallback(async ({ files, directories }: DroppedFileSelection) => {
    if (onCreateDirectory) {
      for (const relativePath of directories) {
        await onCreateDirectory(joinUploadPath(currentPath, relativePath));
      }
    }

    const items: UploadItem[] = files.map(({ file, relativePath }) => ({
      id: `${relativePath}-${Date.now()}-${Math.random()}`,
      file,
      relativePath,
      targetPath: joinUploadPath(currentPath, relativePath),
      progress: 0,
      status: file.size > MAX_FILE_SIZE ? "error" as const : "pending" as const,
      error: file.size > MAX_FILE_SIZE ? `File exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` : undefined,
    }));

    setUploads((prev) => [...prev, ...items]);

    for (const item of items) {
      if (item.status === "error") continue;

      setUploads((prev) =>
        prev.map((u) => (u.id === item.id ? { ...u, status: "uploading", progress: 10 } : u)),
      );

      try {
        const content = await readFileAsBytes(item.file);

        setUploads((prev) =>
          prev.map((u) => (u.id === item.id ? { ...u, progress: 60 } : u)),
        );

        await onUpload(item.targetPath, content);

        setUploads((prev) =>
          prev.map((u) => (u.id === item.id ? { ...u, status: "done", progress: 100 } : u)),
        );
      } catch (err) {
        setUploads((prev) =>
          prev.map((u) =>
            u.id === item.id
              ? { ...u, status: "error", error: err instanceof Error ? err.message : "Upload failed" }
              : u,
          ),
        );
      }
    }
  }, [currentPath, onCreateDirectory, onUpload]);

  const retryUpload = useCallback(async (itemId: string) => {
    const item = uploads.find((u) => u.id === itemId);
    if (!item) return;

    setUploads((prev) =>
      prev.map((u) => (u.id === itemId ? { ...u, status: "uploading", progress: 10, error: undefined } : u)),
    );

    try {
      const content = await readFileAsBytes(item.file);
      await onUpload(item.targetPath, content);
      setUploads((prev) =>
        prev.map((u) => (u.id === itemId ? { ...u, status: "done", progress: 100 } : u)),
      );
    } catch (err) {
      setUploads((prev) =>
        prev.map((u) =>
          u.id === itemId
            ? { ...u, status: "error", error: err instanceof Error ? err.message : "Upload failed" }
            : u,
        ),
      );
    }
  }, [onUpload, uploads]);

  const removeUpload = useCallback((itemId: string) => {
    setUploads((prev) => prev.filter((u) => u.id !== itemId));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    setDropError(null);
    void readDroppedFileSelection(e.dataTransfer)
      .then((selection) => processFiles(selection))
      .catch((cause: unknown) => {
        setDropError(formatDropError(cause));
      });
  }, [processFiles]);

  const handleClickUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setDropError(null);
      void processFiles({
        files: Array.from(e.target.files).map((file) => ({
          file,
          relativePath: normalizeDroppedRelativePath(file.webkitRelativePath || file.name),
        })),
        directories: [],
      }).catch((cause: unknown) => {
        setDropError(formatDropError(cause));
      });
      e.target.value = "";
    }
  }, [processFiles]);

  const activeUploads = uploads.filter((u) => u.status !== "done");
  const hasActive = activeUploads.length > 0;

  return (
    <div className="space-y-2">
      {/* Drop zone */}
      <motion.div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClickUpload}
        animate={{
          borderColor: dragOver ? "color-mix(in srgb, var(--selection-accent) 50%, transparent)" : "var(--border)",
          backgroundColor: dragOver ? "color-mix(in srgb, var(--selection-accent) 8%, transparent)" : "rgba(0, 0, 0, 0)",
        }}
        transition={{ duration: 0.15 }}
        className={`border border-dashed rounded-lg flex items-center justify-center gap-2 cursor-pointer transition-colors hover:border-text-muted/30 hover:bg-surface-low/30 ${
          compact ? "px-3 py-2" : "px-4 py-4"
        }`}
      >
        <Upload className={`text-text-muted ${compact ? "w-3.5 h-3.5" : "w-4 h-4"}`} />
        <span className={`text-text-muted ${compact ? "text-[10px]" : "text-[11px]"}`}>
          {dragOver ? "Drop to upload" : "Drop files or folders, or click for files"}
        </span>
      </motion.div>

      {dropError ? <p role="alert" className="text-[10px] text-destructive">{dropError}</p> : null}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileInput}
        className="hidden"
      />

      {/* Upload progress list */}
      <AnimatePresence>
        {hasActive && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden space-y-1"
          >
            {activeUploads.map((item) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-surface-low/50 border border-border"
              >
                {/* Status icon */}
                {item.status === "uploading" && (
                  <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
                    <RefreshCw className="w-3 h-3 text-[var(--selection-accent)]" />
                  </motion.div>
                )}
                {item.status === "done" && <CheckCircle2 className="w-3 h-3 text-[var(--selection-accent)]" />}
                {item.status === "error" && <AlertCircle className="w-3 h-3 text-destructive" />}
                {item.status === "pending" && <FileIcon className="w-3 h-3 text-text-muted" />}

                {/* Name + progress */}
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-foreground truncate">{item.relativePath ?? item.file.name}</p>
                  {item.status === "uploading" && (
                    <div className="h-1 mt-0.5 rounded-full bg-surface-high overflow-hidden">
                      <motion.div
                        className="h-full bg-[var(--selection-accent)] rounded-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${item.progress}%` }}
                        transition={{ duration: 0.3 }}
                      />
                    </div>
                  )}
                  {item.error && (
                    <p className="truncate text-[9px] text-destructive">{item.error}</p>
                  )}
                </div>

                {/* Actions */}
                {item.status === "error" && (
                  <TooltipHint label="Retry">
                    <button aria-label="Retry" onClick={(e) => { e.stopPropagation(); retryUpload(item.id); }} className="w-4 h-4 rounded flex items-center justify-center text-text-muted hover:text-foreground transition-colors">
                      <RefreshCw className="w-2.5 h-2.5" />
                    </button>
                  </TooltipHint>
                )}
                <TooltipHint label="Dismiss">
                  <button aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); removeUpload(item.id); }} className="w-4 h-4 rounded flex items-center justify-center text-text-muted hover:text-foreground transition-colors">
                    <X className="w-2.5 h-2.5" />
                  </button>
                </TooltipHint>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Helpers ──

async function readFileAsBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function") {
    try {
      return new Uint8Array(await file.arrayBuffer());
    } catch (cause) {
      if (isNotFoundError(cause)) throw fileNotFoundError(file.name);
      // Fall through to FileReader for browser/test runtimes with incomplete Blob support.
    }
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new Uint8Array(reader.result));
      } else {
        reject(new Error("Failed to read file"));
      }
    };
    reader.onerror = () => reject(
      isNotFoundError(reader.error) ? fileNotFoundError(file.name) : new Error(`Could not read "${file.name}".`),
    );
    try {
      reader.readAsArrayBuffer(file);
    } catch (cause) {
      reject(isNotFoundError(cause) ? fileNotFoundError(file.name) : cause);
    }
  });
}

function joinUploadPath(currentPath: string, relativePath: string): string {
  const normalizedRelativePath = normalizeDroppedRelativePath(relativePath);
  if (!currentPath) return normalizedRelativePath;
  return currentPath === "/"
    ? `/${normalizedRelativePath}`
    : `${currentPath.replace(/\/+$/, "")}/${normalizedRelativePath}`;
}

export function normalizeDroppedRelativePath(path: string): string {
  const normalizedPath = path.replace(/\\/g, "/");
  const segments = normalizedPath.split("/").filter(Boolean);
  if (
    normalizedPath.startsWith("/") ||
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === ".." || segment.includes("\0"))
  ) {
    throw new Error("The selected folder contains an invalid path.");
  }
  return segments.join("/");
}

function isNotFoundError(cause: unknown): boolean {
  return Boolean(cause && typeof cause === "object" && "name" in cause && cause.name === "NotFoundError");
}

function fileNotFoundError(name: string): Error {
  return new Error(`Could not read "${name}". It may have been moved or removed while the folder was being added.`);
}

function directoryNotFoundError(name: string): Error {
  return new Error(`Could not read folder "${name}". It may have been moved or removed while it was being added.`);
}

function directoryReadError(name: string, cause: unknown): unknown {
  if (isNotFoundError(cause)) return directoryNotFoundError(name);
  if (cause instanceof Error && cause.message) return cause;
  return new Error(`Could not read folder "${name}".`);
}

function formatDropError(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message;
  return "The folder could not be read. It may have been moved or removed while it was being added.";
}

function readDroppedFile(entry: DroppedFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, (cause) => reject(
      isNotFoundError(cause) ? fileNotFoundError(entry.name) : cause,
    ));
  });
}

async function readDroppedDirectoryEntries(entry: DroppedDirectoryEntry): Promise<DroppedFileSystemEntry[]> {
  let reader: ReturnType<DroppedDirectoryEntry["createReader"]>;
  try {
    reader = entry.createReader();
  } catch (cause) {
    throw directoryReadError(entry.name, cause);
  }
  const entries: DroppedFileSystemEntry[] = [];
  while (true) {
    const batch = await new Promise<DroppedFileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, (cause) => reject(directoryReadError(entry.name, cause)));
    });
    if (batch.length === 0) return entries;
    entries.push(...batch);
  }
}

async function collectDroppedEntry(
  entry: DroppedFileSystemEntry,
  parentPath: string,
  selection: DroppedFileSelection,
): Promise<void> {
  const relativePath = normalizeDroppedRelativePath(parentPath ? `${parentPath}/${entry.name}` : entry.name);
  if (entry.isFile) {
    selection.files.push({ file: await readDroppedFile(entry as DroppedFileEntry), relativePath });
    return;
  }
  if (!entry.isDirectory) return;
  selection.directories.push(relativePath);
  const children = await readDroppedDirectoryEntries(entry as DroppedDirectoryEntry);
  for (const child of children) await collectDroppedEntry(child, relativePath, selection);
}

async function collectDroppedHandle(
  handle: DroppedFileSystemHandle,
  parentPath: string,
  selection: DroppedFileSelection,
): Promise<void> {
  const relativePath = normalizeDroppedRelativePath(parentPath ? `${parentPath}/${handle.name}` : handle.name);
  if (handle.kind === "file") {
    try {
      selection.files.push({ file: await (handle as DroppedFileHandle).getFile(), relativePath });
    } catch (cause) {
      throw isNotFoundError(cause) ? fileNotFoundError(handle.name) : cause;
    }
    return;
  }

  selection.directories.push(relativePath);
  try {
    const values = (handle as DroppedDirectoryHandle).values;
    if (typeof values !== "function") throw new Error("Folder traversal is not supported by this browser.");
    for await (const child of values.call(handle)) {
      await collectDroppedHandle(child, relativePath, selection);
    }
  } catch (cause) {
    throw directoryReadError(handle.name, cause);
  }
}

export async function readDroppedFileSelection(dataTransfer: DataTransfer): Promise<DroppedFileSelection> {
  const selection: DroppedFileSelection = { files: [], directories: [] };
  const items = Array.from(dataTransfer.items ?? []);
  const fallbackFiles = Array.from(dataTransfer.files);
  let fallbackFileIndex = 0;
  const snapshots = items.flatMap((item): DroppedItemSnapshot[] => {
    if (item.kind && item.kind !== "file") return [];
    const itemWithFileSystemAccess = item as DataTransferItem & {
      webkitGetAsEntry?: () => DroppedFileSystemEntry | null;
      getAsFileSystemHandle?: () => Promise<DroppedFileSystemHandle | null>;
    };
    const fallbackFile = fallbackFiles[fallbackFileIndex] ?? null;
    fallbackFileIndex += 1;
    const entry = itemWithFileSystemAccess.webkitGetAsEntry?.call(item);
    let handlePromise: Promise<DroppedFileSystemHandle | null> | null = null;
    let handleError: unknown | null = null;
    if (!entry) {
      try {
        const requestedHandle = itemWithFileSystemAccess.getAsFileSystemHandle?.call(item);
        if (requestedHandle) handlePromise = requestedHandle;
      } catch (cause) {
        handleError = cause;
      }
    }
    return [{
      entry: entry ?? null,
      handlePromise,
      handleError,
      file: item.getAsFile?.() ?? fallbackFile,
    }];
  });

  for (const snapshot of snapshots) {
    if (snapshot.entry) {
      await collectDroppedEntry(snapshot.entry, "", selection);
      continue;
    }
    let handle: DroppedFileSystemHandle | null = null;
    try {
      if (snapshot.handleError) throw snapshot.handleError;
      handle = snapshot.handlePromise ? await snapshot.handlePromise : null;
    } catch (cause) {
      if (isNotFoundError(cause)) throw directoryNotFoundError("dropped folder");
      throw cause;
    }
    if (handle) {
      await collectDroppedHandle(handle, "", selection);
      continue;
    }
    const file = snapshot.file;
    if (file) {
      assertDroppedFileIsReadable(file);
      selection.files.push({
        file,
        relativePath: normalizeDroppedRelativePath(file.webkitRelativePath || file.name),
      });
    }
  }

  if (selection.files.length === 0 && selection.directories.length === 0) {
    selection.files.push(...fallbackFiles.map((file) => {
      assertDroppedFileIsReadable(file);
      return {
        file,
        relativePath: normalizeDroppedRelativePath(file.webkitRelativePath || file.name),
      };
    }));
  }
  selection.directories = Array.from(new Set(selection.directories))
    .sort((left, right) => left.split("/").length - right.split("/").length);
  return selection;
}

function assertDroppedFileIsReadable(file: File): void {
  if (file.size > 0 || file.type || file.webkitRelativePath) return;
  throw new Error(
    `Could not open folder "${file.name}". This browser did not provide access to its contents. Try dropping it from your local filesystem in Chrome or Edge.`,
  );
}
