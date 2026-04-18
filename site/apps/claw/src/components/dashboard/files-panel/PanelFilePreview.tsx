"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { X, Save, Download, Copy, Check, Loader2, FileText, FileImage, FileCode, AlertCircle } from "lucide-react";
import type { FileEntry } from "./types";
import { formatFileSize } from "./PanelFileRow";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"]);
const CODE_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "py", "rs", "go", "rb", "java", "c", "cpp", "h", "sh", "bash", "zsh", "css", "scss", "html", "xml", "sql", "graphql", "yaml", "yml", "toml", "ini", "conf", "env", "dockerfile"]);

function getPreviewType(name: string): "image" | "code" | "text" {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (CODE_EXTENSIONS.has(ext) || ext === "md" || ext === "mdx") return "code";
  return "text";
}

interface PanelFilePreviewProps {
  entry: FileEntry;
  content: string | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onSave?: (path: string, content: string) => Promise<void>;
  onDownload?: (entry: FileEntry) => void;
}

export function PanelFilePreview({ entry, content, loading, error, onClose, onSave, onDownload }: PanelFilePreviewProps) {
  const [editContent, setEditContent] = useState(content ?? "");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const previewType = getPreviewType(entry.name);
  const isEditable = previewType === "code" || previewType === "text";

  const [lastContent, setLastContent] = useState(content);
  if (content !== lastContent) { setLastContent(content); setEditContent(content ?? ""); }

  const isDirty = editContent !== (content ?? "");

  const handleSave = async () => { if (!onSave || !isDirty) return; setSaving(true); try { await onSave(entry.path, editContent); } finally { setSaving(false); } };
  const handleCopy = async () => { try { await navigator.clipboard.writeText(editContent || content || ""); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {} };

  return (
    <div className="flex flex-col h-full border-l border-border">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-shrink-0">
        {previewType === "image" ? <FileImage className="w-3.5 h-3.5 text-text-muted" /> : previewType === "code" ? <FileCode className="w-3.5 h-3.5 text-text-muted" /> : <FileText className="w-3.5 h-3.5 text-text-muted" />}
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-foreground truncate">{entry.name}{isDirty && <span className="text-[#f0c56c] ml-1">*</span>}</p>
          {entry.size !== undefined && <p className="text-[9px] text-text-muted">{formatFileSize(entry.size)}</p>}
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {isEditable && onSave && (
            <button onClick={handleSave} disabled={!isDirty || saving} className="w-6 h-6 rounded flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors disabled:opacity-30" title="Save">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            </button>
          )}
          <button onClick={handleCopy} className="w-6 h-6 rounded flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors" title="Copy">
            {copied ? <Check className="w-3 h-3 text-[#38D39F]" /> : <Copy className="w-3 h-3" />}
          </button>
          {onDownload && <button onClick={() => onDownload(entry)} className="w-6 h-6 rounded flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors" title="Download"><Download className="w-3 h-3" /></button>}
          <button onClick={onClose} className="w-6 h-6 rounded flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors"><X className="w-3 h-3" /></button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto min-h-0">
        {loading && <div className="flex items-center justify-center h-full"><Loader2 className="w-5 h-5 text-text-muted animate-spin" /></div>}
        {error && <div className="flex flex-col items-center justify-center h-full gap-2 px-6"><AlertCircle className="w-6 h-6 text-[#d05f5f]" /><p className="text-xs text-[#d05f5f] text-center">{error}</p></div>}
        {!loading && !error && content !== null && (
          previewType === "image" ? (
            <div className="flex items-center justify-center p-4 h-full">
              <img src={`data:image/${entry.name.split(".").pop()};base64,${content}`} alt={entry.name} className="max-w-full max-h-full object-contain rounded border border-border" />
            </div>
          ) : isEditable ? (
            <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} className="w-full h-full p-3 bg-transparent text-xs font-mono text-foreground leading-relaxed resize-none focus:outline-none" spellCheck={false} />
          ) : (
            <pre className="p-3 text-xs font-mono text-foreground leading-relaxed whitespace-pre-wrap break-all">{content}</pre>
          )
        )}
      </div>

      {/* Dirty footer */}
      {isDirty && onSave && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="flex items-center justify-between px-3 py-1.5 border-t border-border bg-[#f0c56c]/5">
          <span className="text-[10px] text-[#f0c56c]">Unsaved changes</span>
          <button onClick={handleSave} disabled={saving} className="text-[10px] font-medium text-[#38D39F] hover:underline disabled:opacity-50">{saving ? "Saving..." : "Save now"}</button>
        </motion.div>
      )}
    </div>
  );
}
