"use client";

import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  X,
  Save,
  Download,
  Copy,
  Check,
  Loader2,
  FileText,
  FileImage,
  FileCode,
  AlertCircle,
  Lock,
} from "lucide-react";
import type { FileEntry } from "./types";
import { formatFileSize } from "./FileRow";

// ── Types ──

interface FilePreviewProps {
  entry: FileEntry;
  content: string | null;
  loading: boolean;
  error: string | null;
  dirty?: boolean;
  /** When true, the editor becomes read-only and the Save button is hidden.
   *  Used for core agent files that should be edited via download/re-upload. */
  readOnly?: boolean;
  readOnlyLabel?: string;
  readOnlyDescription?: ReactNode;
  onClose: () => void;
  showClose?: boolean;
  onSave?: (path: string, content: string) => Promise<void>;
  onDownload?: (entry: FileEntry) => void;
}

// ── Helpers ──

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"]);
const CODE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "py", "rs", "go", "rb", "java", "c", "cpp", "h",
  "sh", "bash", "zsh", "css", "scss", "html", "xml", "sql", "graphql",
  "yaml", "yml", "toml", "ini", "conf", "env", "dockerfile",
]);
const MARKDOWN_EXTENSIONS = new Set(["md", "mdx"]);

function getFileExtension(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function getPreviewType(name: string): "image" | "code" | "markdown" | "text" | "binary" {
  const ext = getFileExtension(name);
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (CODE_EXTENSIONS.has(ext)) return "code";
  if (MARKDOWN_EXTENSIONS.has(ext)) return "markdown";
  if (ext === "json" || ext === "txt" || ext === "log" || ext === "csv") return "text";
  return "text";
}

function getPreviewIcon(type: string) {
  switch (type) {
    case "image": return FileImage;
    case "code": return FileCode;
    default: return FileText;
  }
}

// ── Component ──

export function FilePreview({
  entry,
  content,
  loading,
  error,
  dirty = false,
  readOnly = false,
  readOnlyLabel = "Read-only",
  readOnlyDescription,
  onClose,
  showClose = true,
  onSave,
  onDownload,
}: FilePreviewProps) {
  const [editContent, setEditContent] = useState(content ?? "");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const previewType = getPreviewType(entry.name);
  const PreviewIcon = getPreviewIcon(previewType);
  const isEditable = previewType === "code" || previewType === "text" || previewType === "markdown";

  // Sync content when loaded
  const [lastContent, setLastContent] = useState(content);
  if (content !== lastContent) {
    setLastContent(content);
    setEditContent(content ?? "");
  }

  const isDirty = dirty || editContent !== (content ?? "");

  const handleSave = async () => {
    if (!onSave || !isDirty) return;
    setSaving(true);
    try {
      await onSave(entry.path, editContent);
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(editContent || content || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may fail in insecure contexts
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col h-full"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border flex-shrink-0">
        <PreviewIcon className="w-4 h-4 text-text-muted flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground truncate">
            {entry.name}
            {isDirty && <span className="text-[#f0c56c] ml-1">*</span>}
          </p>
          {entry.size !== undefined && (
            <p className="text-[9px] text-text-muted">{formatFileSize(entry.size)}</p>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {readOnly && (
            <span
              title="This file is read-only. Download, edit locally, then re-upload."
              className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider text-[#f0c56c] bg-[#f0c56c]/10 px-1.5 py-0.5 rounded"
            >
              <Lock className="w-2.5 h-2.5" />
              {readOnlyLabel}
            </span>
          )}
          {isEditable && onSave && !readOnly && (
            <button
              onClick={handleSave}
              disabled={!isDirty || saving}
              className="w-6 h-6 rounded flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Save"
            >
              {saving ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Save className="w-3 h-3" />
              )}
            </button>
          )}
          <button
            onClick={handleCopy}
            className="w-6 h-6 rounded flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors"
            title="Copy content"
          >
            {copied ? <Check className="w-3 h-3 text-[#38D39F]" /> : <Copy className="w-3 h-3" />}
          </button>
          {onDownload && (
            <button
              onClick={() => onDownload(entry)}
              className="w-6 h-6 rounded flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors"
              title="Download"
            >
              <Download className="w-3 h-3" />
            </button>
          )}
          {showClose && (
            <button
              onClick={onClose}
              className="w-6 h-6 rounded flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Read-only banner */}
      {readOnly && (
        <div className="flex items-start gap-2 px-3 py-2 border-b border-border bg-[#f0c56c]/5 text-[11px] text-[#f0c56c]">
          <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <p>
            {readOnlyDescription ?? (
              <>
                This is a core agent file. To make changes safely, <span className="font-semibold">download it</span>, edit locally, then <span className="font-semibold">re-upload</span> via the file browser.
              </>
            )}
          </p>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto min-h-0">
        {loading && (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-5 h-5 text-text-muted animate-spin" />
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center h-full gap-2 px-6">
            <AlertCircle className="w-6 h-6 text-[#d05f5f]" />
            <p className="text-xs text-[#d05f5f] text-center">{error}</p>
          </div>
        )}

        {!loading && !error && content !== null && (
          <>
            {previewType === "image" ? (
              <div className="flex items-center justify-center p-4 h-full">
                <img
                  src={`data:image/${getFileExtension(entry.name)};base64,${content}`}
                  alt={entry.name}
                  className="max-w-full max-h-full object-contain rounded border border-border"
                />
              </div>
            ) : isEditable ? (
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                readOnly={readOnly}
                className="w-full h-full p-3 bg-transparent text-xs font-mono text-foreground leading-relaxed resize-none focus:outline-none"
                spellCheck={false}
              />
            ) : (
              <pre className="p-3 text-xs font-mono text-foreground leading-relaxed whitespace-pre-wrap break-all">
                {content}
              </pre>
            )}
          </>
        )}
      </div>

      {/* Dirty state footer */}
      {isDirty && onSave && !readOnly && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          className="flex items-center justify-between px-3 py-2 border-t border-border bg-[#f0c56c]/5"
        >
          <span className="text-[10px] text-[#f0c56c]">Unsaved changes</span>
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-[10px] font-medium text-[#38D39F] hover:underline disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save now"}
          </button>
        </motion.div>
      )}
    </motion.div>
  );
}
