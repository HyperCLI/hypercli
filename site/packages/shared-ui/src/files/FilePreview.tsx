"use client";

import { useCallback, useMemo, useState, type ReactNode, type RefCallback } from "react";
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
  CalendarDays,
  Folder,
  AlertCircle,
  Lock,
  ShieldCheck,
} from "lucide-react";
import type { FileEntry } from "./types";
import { formatFileSize, getFileBackupBadge } from "./FileRow";
import { formatFileTechnicalDetails } from "./error-details";
import { parseZipPreview } from "./zip-preview";
import { inferFileMimeType, isFileByteContent, resolveFileType, type ResolvedFileType } from "./file-types";
import { RecoveryState } from "../components/patterns/recovery";
import { writeClipboardText } from "../utils/browser-clipboard";
import { TooltipHint } from "../components/ui/tooltip";

// ── Types ──

export type FilePreviewMarkdownRenderer = (content: string, className?: string) => ReactNode;

export interface FilePreviewProps {
  entry: FileEntry;
  content: string | Uint8Array | null;
  loading: boolean;
  error: string | null;
  unavailableReason?: string | null;
  dirty?: boolean;
  /** When true, the editor becomes read-only and the Save button is hidden.
   *  Used for core agent files that should be edited via download/re-upload. */
  readOnly?: boolean;
  readOnlyLabel?: string;
  readOnlyDescription?: ReactNode;
  onClose: () => void;
  showClose?: boolean;
  onSave?: (path: string, content: string) => Promise<void>;
  onBeforeWrite?: () => boolean;
  onDownload?: (entry: FileEntry) => void;
  onRetry?: () => void;
  renderMarkdown?: FilePreviewMarkdownRenderer;
  copyText?: (text: string) => boolean | Promise<boolean>;
}

// ── Helpers ──

const PREVIEW_ACTION_BUTTON_CLASS =
  "flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-low hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30";
const PREVIEW_ACTION_ICON_CLASS = "h-3.5 w-3.5";
const PREVIEW_HEADER_ICON_CLASS = "w-4 h-4 text-text-muted flex-shrink-0";
const VIEW_MODE_BUTTON_CLASS = "rounded-md px-2 py-1 text-[10px] font-medium transition-colors";
const filePreviewImageLoader: ImageLoader = ({ src }) => src;
const HTML_PREVIEW_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "connect-src 'none'",
  "font-src data:",
  "form-action 'none'",
  "frame-src 'none'",
  "img-src data: blob:",
  "media-src data: blob:",
  "navigate-to 'none'",
  "object-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  "worker-src 'none'",
].join("; ");
const HTML_PREVIEW_PERMISSIONS = "accelerometer 'none'; camera 'none'; geolocation 'none'; microphone 'none'; payment 'none'; usb 'none'";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function imageSrcFromText(entry: FileEntry, value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("data:") || trimmed.startsWith("blob:") || trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `data:${inferFileMimeType(entry, "image/png")};base64,${trimmed}`;
}

function createSandboxedHtmlDocument(source: string): string {
  const withoutNavigationMetadata = source
    .replace(/<base\b[^>]*>/gi, "")
    .replace(/<meta\b[^>]*>/gi, (tag) => (
      /\bhttp-equiv\s*=\s*(?:"\s*refresh\s*"|'\s*refresh\s*'|refresh(?:\s|\/?>))/i.test(tag) ? "" : tag
    ));
  return [
    "<!doctype html>",
    '<meta charset="utf-8">',
    '<meta name="referrer" content="no-referrer">',
    `<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}">`,
    withoutNavigationMetadata,
  ].join("");
}

function useFileObjectUrl(
  entry: FileEntry,
  content: string | Uint8Array | null,
  enabled: boolean,
): readonly [string | null, RefCallback<HTMLSpanElement>] {
  const mimeType = inferFileMimeType(entry);
  const [objectUrlState, setObjectUrlState] = useState<{
    content: Uint8Array;
    mimeType: string;
    url: string;
  } | null>(null);

  const objectUrlAnchorRef = useCallback<RefCallback<HTMLSpanElement>>((element) => {
    if (!element || !enabled || !isFileByteContent(content)) {
      if (element) setObjectUrlState(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([toArrayBuffer(content)], { type: mimeType }));
    setObjectUrlState({ content, mimeType, url });
    return () => URL.revokeObjectURL(url);
  }, [content, enabled, mimeType]);

  const objectUrl = enabled
    && isFileByteContent(content)
    && objectUrlState?.content === content
    && objectUrlState.mimeType === mimeType
    ? objectUrlState.url
    : null;
  return [objectUrl, objectUrlAnchorRef];
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
    case "calendar": return <CalendarDays className={PREVIEW_HEADER_ICON_CLASS} />;
    default: return <FileText className={PREVIEW_HEADER_ICON_CLASS} />;
  }
}

// ── Component ──

export function FilePreview({
  entry,
  content,
  loading,
  error,
  unavailableReason,
  dirty = false,
  readOnly = false,
  readOnlyLabel = "Read-only",
  readOnlyDescription,
  onClose,
  showClose = true,
  onSave,
  onBeforeWrite,
  onDownload,
  onRetry,
  renderMarkdown,
  copyText = writeClipboardText,
}: FilePreviewProps) {
  const [editContent, setEditContent] = useState(typeof content === "string" ? content : "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [viewModeState, setViewModeState] = useState<{ path: string; mode: "preview" | "raw" }>({
    path: entry.path,
    mode: "preview",
  });
  const [failedPreviewSource, setFailedPreviewSource] = useState<string | null>(null);

  const fileType = useMemo(() => resolveFileType(entry), [entry]);
  const unknownTextDetected = !fileType.known && typeof content === "string";
  const invalidTextBytes = fileType.readMode === "text" && isFileByteContent(content);
  const previewType = unknownTextDetected
    ? "text"
    : invalidTextBytes
      ? "binary"
      : fileType.previewKind;
  const isMarkdown = previewType === "markdown";
  const isHtml = previewType === "html";
  const hasViewMode = isMarkdown || isHtml;
  const viewMode = viewModeState.path === entry.path ? viewModeState.mode : "preview";
  const setViewMode = (mode: "preview" | "raw") => setViewModeState({ path: entry.path, mode });
  const isEditable = (fileType.editable || unknownTextDetected) && !invalidTextBytes;
  const textContent = typeof content === "string" ? content : "";
  const nativePreviewEnabled = previewType === "image" || previewType === "audio" || previewType === "video" || previewType === "pdf";
  const [objectUrl, objectUrlAnchorRef] = useFileObjectUrl(
    entry,
    content,
    nativePreviewEnabled,
  );
  const nativePreviewPending = nativePreviewEnabled && isFileByteContent(content) && !objectUrl;
  const imageSrc = isFileByteContent(content)
    ? objectUrl
    : typeof content === "string"
      ? imageSrcFromText(entry, content)
      : null;
  const nativePreviewSource = previewType === "image" ? imageSrc : objectUrl;
  const nativePreviewFailed = Boolean(nativePreviewSource && failedPreviewSource === nativePreviewSource);
  const backupStatus = getFileBackupBadge(entry.backupComparison, entry.type === "directory");
  const archivePreview = useMemo(() => {
    if (previewType !== "archive" || !isFileByteContent(content)) return null;
    try {
      return { data: parseZipPreview(content), error: null };
    } catch (err) {
      return { data: null, error: formatFileTechnicalDetails(err) ?? "The archive contents could not be read." };
    }
  }, [content, previewType]);
  const htmlPreviewDocument = useMemo(
    () => isHtml ? createSandboxedHtmlDocument(editContent) : "",
    [editContent, isHtml],
  );

  // Sync content when loaded
  const [lastContent, setLastContent] = useState(content);
  if (content !== lastContent) {
    setLastContent(content);
    setEditContent(typeof content === "string" ? content : "");
  }

  const isDirty = dirty || editContent !== textContent;

  const handleSave = async () => {
    if (!onSave || !isDirty) return;
    if (onBeforeWrite && !onBeforeWrite()) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(entry.path, editContent);
    } catch (err) {
      setSaveError(formatFileTechnicalDetails(err) ?? "The save request was unavailable.");
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    if (await copyText(editContent)) {
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
      <span ref={objectUrlAnchorRef} hidden aria-hidden="true" />
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
            <TooltipHint label={backupStatus.title}>
              <span
                role="img"
                aria-label={backupStatus.label}
                tabIndex={0}
                className={`inline-flex h-2.5 w-2.5 items-center rounded-full border ${backupStatus.className}`}
              />
            </TooltipHint>
          )}
          {hasViewMode && (
            <div className="mr-1 flex items-center rounded-lg border border-border bg-background/40 p-0.5" aria-label={`${fileType.label} view mode`}>
              <button
                type="button"
                onClick={() => setViewMode("preview")}
                aria-pressed={viewMode === "preview"}
                className={`${VIEW_MODE_BUTTON_CLASS} ${viewMode === "preview" ? "bg-surface-low text-foreground" : "text-text-muted hover:text-foreground"}`}
              >
                Preview
              </button>
              <button
                type="button"
                onClick={() => setViewMode("raw")}
                aria-pressed={viewMode === "raw"}
                className={`${VIEW_MODE_BUTTON_CLASS} ${viewMode === "raw" ? "bg-surface-low text-foreground" : "text-text-muted hover:text-foreground"}`}
              >
                Raw
              </button>
            </div>
          )}
          {readOnly && (
            <TooltipHint label="This file is read-only. Download, edit locally, then re-upload.">
              <span tabIndex={0} className="inline-flex items-center gap-1 rounded bg-warning/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-warning">
                <Lock className="w-2.5 h-2.5" />
                {readOnlyLabel}
              </span>
            </TooltipHint>
          )}
          {isEditable && onSave && !readOnly && (
            <TooltipHint label="Save" disabled={!isDirty || saving}>
              <button aria-label="Save" onClick={handleSave} disabled={!isDirty || saving} className={PREVIEW_ACTION_BUTTON_CLASS}>
                {saving ? (
                  <Loader2 className={`${PREVIEW_ACTION_ICON_CLASS} animate-spin`} />
                ) : (
                  <Save className={PREVIEW_ACTION_ICON_CLASS} />
                )}
              </button>
            </TooltipHint>
          )}
          {typeof content === "string" && (
            <TooltipHint label="Copy content">
              <button aria-label="Copy content" onClick={handleCopy} className={PREVIEW_ACTION_BUTTON_CLASS}>
                {copied ? (
                  <Check className={`${PREVIEW_ACTION_ICON_CLASS} text-[var(--selection-accent)]`} />
                ) : (
                  <Copy className={PREVIEW_ACTION_ICON_CLASS} />
                )}
              </button>
            </TooltipHint>
          )}
          {onDownload && (
            <TooltipHint label="Download">
              <button aria-label="Download" onClick={() => onDownload(entry)} className={PREVIEW_ACTION_BUTTON_CLASS}>
                <Download className={PREVIEW_ACTION_ICON_CLASS} />
              </button>
            </TooltipHint>
          )}
          {showClose && (
            <button
              type="button"
              aria-label="Close file preview"
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
          <div role="status" aria-label="Loading file preview" className="flex items-center justify-center h-full">
            <Loader2 className="w-5 h-5 text-text-muted animate-spin" />
          </div>
        )}

        {error && (
          <div className="flex h-full items-center justify-center">
            <RecoveryState
              presentation="empty"
              icon={AlertCircle}
              title={onRetry ? "Try again to preview this file" : onDownload ? "Download this file to continue" : "Return to the folder and try again"}
              description={onRetry && onDownload
                ? "The file is still available. Retry the preview or download it to continue."
                : onRetry
                  ? "The file is still available. Try the preview once more."
                  : onDownload
                    ? "The file is still available. Download it to continue."
                    : "The file is still available. Return to the folder and open it again."}
              technicalDetails={formatFileTechnicalDetails(error)}
              detailsLabel="Technical details"
              primaryAction={onRetry
                ? { label: "Try again", onAction: onRetry }
                : onDownload
                  ? { label: "Download", onAction: () => onDownload(entry), icon: Download }
                  : undefined}
              secondaryAction={onRetry && onDownload
                ? { label: "Download", onAction: () => onDownload(entry), icon: Download }
                : undefined}
              announcement="assertive"
              headingLevel={3}
              className="min-h-full max-w-xl px-6 py-8"
            />
          </div>
        )}

        {!loading && !error && unavailableReason && (
          <div role="status" aria-live="polite" className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-xs text-text-muted">
            <FileText className="h-6 w-6 opacity-60" />
            <p>{unavailableReason}</p>
            {onDownload && <p>Download the file to inspect it locally.</p>}
          </div>
        )}

        {!loading && !error && !unavailableReason && content !== null && (
          <>
            {previewType === "image" ? (
              <div className="flex items-center justify-center p-4 h-full">
                <div className="relative h-full w-full overflow-hidden rounded border border-border">
                  {imageSrc && !nativePreviewFailed ? (
                    <Image
                      src={imageSrc}
                      alt={entry.name}
                      fill
                      sizes="(max-width: 768px) 100vw, 720px"
                      loader={filePreviewImageLoader}
                      unoptimized
                      className="object-contain"
                      onError={() => setFailedPreviewSource(imageSrc)}
                    />
                  ) : (
                    <div role="status" aria-live="polite" className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-xs text-text-muted">
                      <FileImage className="h-6 w-6 opacity-60" />
                      <p>{nativePreviewFailed ? "This browser could not display the image." : nativePreviewPending ? "Preparing image preview." : "Image preview needs file bytes."}</p>
                      {onDownload && <p>Download the file to inspect it locally.</p>}
                    </div>
                  )}
                </div>
              </div>
            ) : previewType === "audio" ? (
              <div className="flex h-full items-center justify-center p-6">
                {objectUrl && !nativePreviewFailed ? (
                  <div className="elevation-shadow-soft w-full max-w-xl rounded-2xl border border-border bg-surface-low p-5">
                    <div className="mb-4 flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-background">
                        <FileAudio className="h-4 w-4 text-text-muted" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-foreground">{entry.name}</p>
                        <p className="text-[10px] text-text-muted">{inferFileMimeType(entry)}</p>
                      </div>
                    </div>
                    <audio
                      aria-label={`Audio preview for ${entry.name}`}
                      controls
                      preload="metadata"
                      src={objectUrl}
                      onError={() => setFailedPreviewSource(objectUrl)}
                      className="h-10 w-full"
                    />
                  </div>
                ) : (
                  <div role="status" aria-live="polite" className="flex flex-col items-center gap-2 text-center text-xs text-text-muted">
                    <FileAudio className="h-6 w-6 opacity-60" />
                    <p>{nativePreviewFailed ? "This browser cannot play this audio format." : nativePreviewPending ? "Preparing audio preview." : "Audio preview needs file bytes."}</p>
                    {onDownload && <p>Download the file to play it locally.</p>}
                  </div>
                )}
              </div>
            ) : previewType === "video" ? (
              <div className="flex h-full items-center justify-center bg-black/30 p-4">
                {objectUrl && !nativePreviewFailed ? (
                  <video
                    aria-label={`Video preview for ${entry.name}`}
                    controls
                    playsInline
                    preload="metadata"
                    src={objectUrl}
                    onError={() => setFailedPreviewSource(objectUrl)}
                    className="max-h-full max-w-full rounded-xl border border-border bg-black shadow-2xl"
                  />
                ) : (
                  <div role="status" aria-live="polite" className="flex flex-col items-center gap-2 text-center text-xs text-text-muted">
                    <FileVideo className="h-6 w-6 opacity-60" />
                    <p>{nativePreviewFailed ? "This browser cannot play this video format." : nativePreviewPending ? "Preparing video preview." : "Video preview needs file bytes."}</p>
                    {onDownload && <p>Download the file to play it locally.</p>}
                  </div>
                )}
              </div>
            ) : previewType === "pdf" ? (
              <div className="h-full bg-surface-low p-3">
                {objectUrl ? (
                  <object
                    aria-label={`PDF preview for ${entry.name}`}
                    data={objectUrl}
                    type="application/pdf"
                    className="h-full w-full rounded-lg border border-border bg-white"
                  >
                    <div role="status" aria-live="polite" className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-xs text-text-muted">
                      <FileText className="h-6 w-6 opacity-60" />
                      <p>This browser could not display the PDF.</p>
                    </div>
                  </object>
                ) : (
                  <div role="status" aria-live="polite" className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-xs text-text-muted">
                    <FileText className="h-6 w-6 opacity-60" />
                    <p>{nativePreviewPending ? "Preparing PDF preview." : "PDF preview needs file bytes."}</p>
                    {onDownload && <p>Download the file to inspect it locally.</p>}
                  </div>
                )}
              </div>
            ) : previewType === "archive" ? (
              <div className="flex min-h-full flex-col">
                {archivePreview?.error ? (
                  <div className="flex min-h-72 flex-1 items-center justify-center">
                    <RecoveryState
                      presentation="empty"
                      icon={FileArchive}
                      title={onDownload ? "Download this archive to inspect it" : "Try opening this archive another way"}
                      description="The archive is still available. Download it or use another archive viewer to continue."
                      technicalDetails={formatFileTechnicalDetails(archivePreview.error)}
                      detailsLabel="Technical details"
                      primaryAction={onDownload
                        ? { label: "Download", onAction: () => onDownload(entry), icon: Download }
                        : undefined}
                      headingLevel={3}
                      className="min-h-72 max-w-xl px-6 py-8"
                    />
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
                    <p className="border-b border-border px-3 py-1.5 text-[10px] text-text-muted">
                      Contents only. Files inside are not opened or extracted.
                    </p>
                    {archivePreview.data.entries.length > 0 ? (
                      <div className="divide-y divide-border">
                        {archivePreview.data.entries.map((archiveEntry, index) => {
                          const ArchiveEntryIcon = archiveEntry.directory ? Folder : FileText;
                          return (
                            <div key={`${archiveEntry.name}-${index}`} className="flex min-w-0 items-center gap-2 px-3 py-2 text-xs">
                              <ArchiveEntryIcon className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                              <div className="min-w-0 flex-1">
                                <TooltipHint label={archiveEntry.name}>
                                  <p className="truncate font-mono text-foreground" tabIndex={0}>{archiveEntry.name}</p>
                                </TooltipHint>
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
            ) : isHtml && viewMode === "preview" ? (
              <div className="flex h-full min-h-80 flex-col bg-white">
                <div role="status" aria-label="HTML preview security" className="flex flex-shrink-0 items-center gap-2 border-b border-border bg-surface-low px-3 py-2 text-[10px] text-text-muted">
                  <ShieldCheck className="h-3.5 w-3.5 text-[var(--selection-accent)]" />
                  <span>Sandboxed preview. Scripts and form submissions are disabled; network resources are blocked.</span>
                </div>
                <iframe
                  title={`Sandboxed HTML preview for ${entry.name}`}
                  srcDoc={htmlPreviewDocument}
                  sandbox=""
                  referrerPolicy="no-referrer"
                  allow={HTML_PREVIEW_PERMISSIONS}
                  className="min-h-0 w-full flex-1 border-0 bg-white"
                />
              </div>
            ) : isMarkdown && viewMode === "preview" ? (
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
                <p>{invalidTextBytes ? "This file is not valid UTF-8, so editing is disabled." : `${fileType.label} preview is not available.`}</p>
                {onDownload && <p>Download the file to inspect it locally.</p>}
              </div>
            ) : isEditable ? (
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                readOnly={readOnly || saving}
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

      {saveError && (
        <RecoveryState
          presentation="compact"
          icon={Save}
          title="Try saving again"
          description="Your edits are still here and have not been discarded."
          technicalDetails={formatFileTechnicalDetails(saveError)}
          detailsLabel="Technical details"
          primaryAction={{
            label: "Save again",
            pendingLabel: "Saving...",
            pending: saving,
            onAction: () => { void handleSave(); },
          }}
          onDismiss={() => setSaveError(null)}
          dismissLabel="Dismiss save message"
          announcement="assertive"
          headingLevel={3}
          className="mx-3 mb-2 flex-shrink-0"
        />
      )}

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
