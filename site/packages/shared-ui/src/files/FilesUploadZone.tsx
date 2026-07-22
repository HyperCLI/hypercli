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
  compact?: boolean;
}

// ── Component ──

export function FilesUploadZone({ currentPath, onUpload, compact = false }: FilesUploadZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFiles = useCallback(async (fileList: FileList) => {
    const items: UploadItem[] = Array.from(fileList).map((file) => ({
      id: `${file.name}-${Date.now()}-${Math.random()}`,
      file,
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

        const targetPath = currentPath
          ? `${currentPath}/${item.file.name}`
          : item.file.name;

        await onUpload(targetPath, content);

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
  }, [currentPath, onUpload]);

  const retryUpload = useCallback(async (itemId: string) => {
    const item = uploads.find((u) => u.id === itemId);
    if (!item) return;

    setUploads((prev) =>
      prev.map((u) => (u.id === itemId ? { ...u, status: "uploading", progress: 10, error: undefined } : u)),
    );

    try {
      const content = await readFileAsBytes(item.file);
      const targetPath = currentPath ? `${currentPath}/${item.file.name}` : item.file.name;
      await onUpload(targetPath, content);
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
  }, [uploads, currentPath, onUpload]);

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
    if (e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  }, [processFiles]);

  const handleClickUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
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
          {dragOver ? "Drop to upload" : "Drop files or click to browse"}
        </span>
      </motion.div>

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
                  <p className="text-[10px] text-foreground truncate">{item.file.name}</p>
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
    } catch {
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
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}
