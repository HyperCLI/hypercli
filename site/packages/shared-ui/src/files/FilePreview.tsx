"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import Image, { type ImageLoader } from "next/image";
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
  FileArchive,
  FileAudio,
  FileVideo,
  FileJson,
  Folder,
  AlertCircle,
  Lock,
} from "lucide-react";
import type { FileEntry } from "./types";
import { formatFileSize, getFileBackupBadge } from "./FileRow";
import { parseZipPreview } from "./zip-preview";
import { inferFileMimeType, resolveFileType, type ResolvedFileType } from "./file-types";
import { writeClipboardText } from "../utils/browser-clipboard";

// ── Types ──

export type FilePreviewMarkdownRenderer = (content: string, className?: string) => ReactNode;

export interface FilePreviewProps {
  entry: FileEntry;
  content: string | Uint8Array | null;
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
  renderMarkdown?: FilePreviewMarkdownRenderer;
  copyText?: (text: string) => boolean | Promise<boolean>;
}

// ── Helpers ──

const PREVIEW_ACTION_BUTTON_CLASS =
  "flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-low hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30";
const PREVIEW_ACTION_ICON_CLASS = "h-3.5 w-3.5";
const PREVIEW_HEADER_ICON_CLASS = "w-4 h-4 text-text-muted flex-shrink-0";
const MARKDOWN_MODE_BUTTON_CLASS = "rounded-md px-2 py-1 text-[10px] font-medium transition-colors";
const filePreviewImageLoader: ImageLoader = ({ src }) => src;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function imageSrcFromText(name: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("data:") || trimmed.startsWith("blob:") || trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `data:${inferFileMimeType(name, "image/png")};base64,${trimmed}`;
}

function useImagePreviewSrc(name: string, content: string | Uint8Array | null): string | null {
  const blobUrl = useMemo(() => {
    if (!(content instanceof Uint8Array)) return null;
    return URL.createObjectURL(new Blob([toArrayBuffer(content)], { type: inferFileMimeType(name, "image/png") }));
  }, [content, name]);

  useEffect(() => {
    if (!blobUrl) return;
    return () => URL.revokeObjectURL(blobUrl);
  }, [blobUrl]);

  if (content instanceof Uint8Array) return blobUrl;
  if (typeof content === "string") return imageSrcFromText(name, content);
  return null;
}

function renderPreviewIcon(fileType: ResolvedFileType) {
  switch (fileType.iconKind) {
    case "image": return <FileImage className={PREVIEW_HEADER_ICON_CLASS} />;
    case "archive": return <FileArchive className={PREVIEW_HEADER_ICON_CLASS} />;
    case "audio": return <FileAudio className={PREVIEW_HEADER_ICON_CLASS} />;
    case "video": return <FileVideo className={PREVIEW_HEADER_ICON_CLASS} />;
    case "code":
    case "settings": return <FileCode className={PREVIEW_HEADER_ICON_CLASS} />;
    case "json": return <FileJson className={PREVIEW_HEADER_ICON_CLASS} />;
    default: return <FileText className={PREVIEW_HEADER_ICON_CLASS} />;
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
  renderMarkdown,
  copyText = writeClipboardText,
}: FilePreviewProps) {
  const [editContent, setEditContent] = useState(typeof content === "string" ? content : "");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [markdownMode, setMarkdownMode] = useState<"preview" | "raw">("preview");

  const fileType = useMemo(() => resolveFileType(entry.name), [entry.name]);
  const previewType = fileType.previewKind;
  const isMarkdown = previewType === "markdown";
  const isEditable = fileType.editable;
  const textContent = typeof content === "string" ? content : "";
  const imageSrc = useImagePreviewSrc(entry.name, content);
  const backupStatus = getFileBackupBadge(entry.backupComparison, entry.type === "directory");
  const archivePreview = useMemo(() => {
    if (previewType !== "archive" || !(content instanceof Uint8Array)) return null;
    try {
      return { data: parseZipPreview(content), error: null };
    } catch (err) {
      return { data: null, error: err instanceof Error ? err.message : "Could not preview archive." };
    }
  }, [content, previewType]);

  // Sync content when loaded
  const [lastContent, setLastContent] = useState(content);
  if (content !== lastContent) {
    setLastContent(content);
    setEditContent(typeof content === "string" ? content : "");
  }

  const isDirty = dirty || editContent !== textContent;

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
    if (await copyText(editContent || textContent)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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
        {renderPreviewIcon(fileType)}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground truncate">
            {entry.name}
            {isDirty && <span className="ml-1 text-warning">*</span>}
          </p>
          {entry.size !== undefined && (
            <p className="text-[9px] text-text-muted">{formatFileSize(entry.size)}</p>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {backupStatus && (
            <span
              role="img"
              aria-label={backupStatus.label}
              title={backupStatus.title}
              className={`inline-flex h-2.5 w-2.5 items-center rounded-full border ${backupStatus.className}`}
            />
          )}
          {isMarkdown && (
            <div className="mr-1 flex items-center rounded-lg border border-border bg-background/40 p-0.5" aria-label="Markdown view mode">
              <button
                type="button"
                onClick={() => setMarkdownMode("preview")}
                aria-pressed={markdownMode === "preview"}
                className={`${MARKDOWN_MODE_BUTTON_CLASS} ${markdownMode === "preview" ? "bg-surface-low text-foreground" : "text-text-muted hover:text-foreground"}`}
              >
                Preview
              </button>
              <button
                type="button"
                onClick={() => setMarkdownMode("raw")}
                aria-pressed={markdownMode === "raw"}
                className={`${MARKDOWN_MODE_BUTTON_CLASS} ${markdownMode === "raw" ? "bg-surface-low text-foreground" : "text-text-muted hover:text-foreground"}`}
              >
                Raw
              </button>
            </div>
          )}
          {readOnly && (
            <span
              title="This file is read-only. Download, edit locally, then re-upload."
              className="inline-flex items-center gap-1 rounded bg-warning/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-warning"
            >
              <Lock className="w-2.5 h-2.5" />
              {readOnlyLabel}
            </span>
          )}
          {isEditable && onSave && !readOnly && (
            <button
              onClick={handleSave}
              disabled={!isDirty || saving}
              className={PREVIEW_ACTION_BUTTON_CLASS}
              title="Save"
            >
              {saving ? (
                <Loader2 className={`${PREVIEW_ACTION_ICON_CLASS} animate-spin`} />
              ) : (
                <Save className={PREVIEW_ACTION_ICON_CLASS} />
              )}
            </button>
          )}
          <button
            onClick={handleCopy}
            className={PREVIEW_ACTION_BUTTON_CLASS}
            title="Copy content"
          >
            {copied ? (
              <Check className={`${PREVIEW_ACTION_ICON_CLASS} text-[var(--selection-accent)]`} />
            ) : (
              <Copy className={PREVIEW_ACTION_ICON_CLASS} />
            )}
          </button>
          {onDownload && (
            <button
              onClick={() => onDownload(entry)}
              className={PREVIEW_ACTION_BUTTON_CLASS}
              title="Download"
            >
              <Download className={PREVIEW_ACTION_ICON_CLASS} />
            </button>
          )}
          {showClose && (
            <button
              onClick={onClose}
              className={PREVIEW_ACTION_BUTTON_CLASS}
            >
              <X className={PREVIEW_ACTION_ICON_CLASS} />
            </button>
          )}
        </div>
      </div>

      {/* Read-only banner */}
      {readOnly && (
        <div className="flex items-start gap-2 border-b border-border bg-warning/10 px-3 py-2 text-[11px] text-warning">
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
            <AlertCircle className="w-6 h-6 text-destructive" />
            <p className="text-center text-xs text-destructive">{error}</p>
          </div>
        )}

        {!loading && !error && content !== null && (
          <>
            {previewType === "image" ? (
              <div className="flex items-center justify-center p-4 h-full">
                <div className="relative h-full w-full overflow-hidden rounded border border-border">
                  {imageSrc ? (
                    <Image
                      src={imageSrc}
                      alt={entry.name}
                      fill
                      sizes="(max-width: 768px) 100vw, 720px"
                      loader={filePreviewImageLoader}
                      unoptimized
                      className="object-contain"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
                    </div>
                  )}
                </div>
              </div>
            ) : previewType === "archive" ? (
              <div className="flex min-h-full flex-col">
                {archivePreview?.error ? (
                  <div className="flex flex-col items-center justify-center h-full gap-2 px-6">
                    <AlertCircle className="w-6 h-6 text-destructive" />
                    <p className="text-center text-xs text-destructive">{archivePreview.error}</p>
                  </div>
                ) : archivePreview?.data ? (
                  <>
                    <div className="flex flex-shrink-0 items-center gap-3 border-b border-border px-3 py-2 text-[11px] text-text-muted">
                      <span>{archivePreview.data.fileCount.toLocaleString()} files</span>
                      <span>{archivePreview.data.directoryCount.toLocaleString()} folders</span>
                      {archivePreview.data.truncated && (
                        <span>Showing first {archivePreview.data.entries.length.toLocaleString()} of {archivePreview.data.totalEntries.toLocaleString()}</span>
                      )}
                    </div>
                    {archivePreview.data.entries.length > 0 ? (
                      <div className="divide-y divide-border">
                        {archivePreview.data.entries.map((archiveEntry, index) => {
                          const ArchiveEntryIcon = archiveEntry.directory ? Folder : FileText;
                          return (
                            <div key={`${archiveEntry.name}-${index}`} className="flex min-w-0 items-center gap-2 px-3 py-2 text-xs">
                              <ArchiveEntryIcon className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-mono text-foreground" title={archiveEntry.name}>{archiveEntry.name}</p>
                                {archiveEntry.unsafePath && (
                                  <p className="mt-0.5 text-[10px] text-warning">Potentially unsafe path</p>
                                )}
                              </div>
                              {!archiveEntry.directory && (
                                <div className="shrink-0 text-right text-[10px] text-text-muted">
                                  <p>{formatFileSize(archiveEntry.uncompressedSize)}</p>
                                  {archiveEntry.compressedSize !== archiveEntry.uncompressedSize && (
                                    <p>{formatFileSize(archiveEntry.compressedSize)} compressed</p>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex h-full items-center justify-center px-6 text-center text-xs text-text-muted">
                        This archive is empty.
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex h-full items-center justify-center px-6 text-center text-xs text-text-muted">
                    Archive preview needs file bytes.
                  </div>
                )}
              </div>
            ) : isMarkdown && markdownMode === "preview" ? (
              <div className="min-h-full p-4 text-sm text-text-secondary">
                {renderMarkdown ? (
                  renderMarkdown(editContent, "text-sm")
                ) : (
                  <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-words text-foreground">
                    {editContent}
                  </pre>
                )}
              </div>
            ) : previewType === "binary" ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-xs text-text-muted">
                <FileText className="h-6 w-6 opacity-60" />
                <p>{fileType.label} preview is not available yet.</p>
                {onDownload && <p>Download the file to inspect it locally.</p>}
              </div>
            ) : isEditable ? (
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                readOnly={readOnly}
                aria-label={`${entry.name} contents`}
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
          className="flex items-center justify-between border-t border-border bg-warning/10 px-3 py-2"
        >
          <span className="text-[10px] text-warning">Unsaved changes</span>
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-[10px] font-medium text-[var(--selection-accent)] hover:underline disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save now"}
          </button>
        </motion.div>
      )}
    </motion.div>
  );
}
