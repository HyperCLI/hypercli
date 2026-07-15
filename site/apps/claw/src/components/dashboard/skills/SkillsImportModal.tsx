"use client";

import * as React from "react";
import { ArrowLeft, ArrowRight, FileText, Loader2, Plus, Upload, X } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@hypercli/shared-ui";
import {
  SkillConfirmationPanel,
  SkillMarkdownEditor,
  SkillRequirementNotice,
  type SkillConfirmationAction,
} from "@hypercli/shared-ui/skills";

import type { SkillConfirmationCallback, SkillImportItem } from "./skill-authoring";

async function importItemFromFile(file: File): Promise<SkillImportItem | null> {
  const lower = file.name.toLowerCase();
  if (!lower.endsWith(".md") && !lower.endsWith(".txt")) return null;
  return { id: file.name, name: file.name, type: "file", content: await readFileAsText(file) };
}

function readFileAsText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
    reader.readAsText(file);
  });
}

async function importItemsFromFiles(files: File[]): Promise<SkillImportItem[]> {
  return (await Promise.all(files.map(importItemFromFile))).filter((item): item is SkillImportItem => Boolean(item));
}

type SkillImportStage = "selection" | "review" | "confirmation";

export interface SkillsImportModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (items: SkillImportItem[]) => Promise<void> | void;
  renderPreview?: (content: string) => React.ReactNode;
  confirmationTitle?: React.ReactNode;
  confirmationDescription?: React.ReactNode;
  onActivate?: SkillConfirmationCallback<SkillImportItem[]>;
  onTest?: SkillConfirmationCallback<SkillImportItem[]>;
  onKeepPreview?: SkillConfirmationCallback<SkillImportItem[]>;
  keepPreviewLabel?: string;
  activateLabel?: string;
}

export function SkillsImportModal(props: SkillsImportModalProps) {
  if (!props.open) return null;
  return <SkillsImportModalContent {...props} />;
}

function SkillsImportModalContent({
  open,
  onClose,
  onImport,
  renderPreview,
  confirmationTitle,
  confirmationDescription,
  onActivate,
  onTest,
  onKeepPreview,
  keepPreviewLabel,
  activateLabel,
}: SkillsImportModalProps) {
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [items, setItems] = React.useState<SkillImportItem[]>([]);
  const [importing, setImporting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [stage, setStage] = React.useState<SkillImportStage>("selection");
  const [importedItems, setImportedItems] = React.useState<SkillImportItem[] | null>(null);
  const [confirmationAction, setConfirmationAction] = React.useState<SkillConfirmationAction | null>(null);
  const operationRef = React.useRef(0);

  React.useEffect(() => () => {
    operationRef.current += 1;
  }, []);

  const handleClose = React.useCallback(() => {
    operationRef.current += 1;
    setDragging(false);
    setItems([]);
    setImporting(false);
    setError(null);
    setStage("selection");
    setImportedItems(null);
    setConfirmationAction(null);
    onClose();
  }, [onClose]);

  const addFiles = async (fileList: FileList | File[]) => {
    const operation = ++operationRef.current;
    try {
      const selectedFiles = Array.from(fileList);
      const nextItems = await importItemsFromFiles(selectedFiles);
      if (operation !== operationRef.current) return;
      setStage("selection");
      const unsupportedCount = selectedFiles.length - nextItems.length;
      setError(
        unsupportedCount > 0
          ? `${unsupportedCount} file${unsupportedCount === 1 ? " was" : "s were"} skipped. Only .md and .txt files are supported.`
          : nextItems.length > 0
            ? null
            : "Choose a .md or .txt skill file.",
      );
      setItems((current) => {
        const byId = new Map(current.map((item) => [item.id, item]));
        nextItems.forEach((item) => byId.set(item.id, item));
        return Array.from(byId.values());
      });
    } catch (cause) {
      if (operation !== operationRef.current) return;
      setError(cause instanceof Error ? cause.message : "Could not read the selected skill file.");
    }
  };

  const handleImport = async () => {
    if (items.length === 0) return;
    const operation = ++operationRef.current;
    setImporting(true);
    setError(null);
    try {
      await onImport(items);
      if (operation !== operationRef.current) return;
      if (onActivate || onTest || onKeepPreview) {
        setImportedItems(items);
        setStage("confirmation");
      } else {
        handleClose();
      }
    } catch (cause) {
      if (operation !== operationRef.current) return;
      setError(cause instanceof Error ? cause.message : "Failed to import skills.");
    } finally {
      if (operation === operationRef.current) setImporting(false);
    }
  };

  const handleConfirmation = async (action: SkillConfirmationAction) => {
    if (!importedItems) return;
    const operation = ++operationRef.current;
    const callback = action === "activate" ? onActivate : action === "test" ? onTest : onKeepPreview;
    setConfirmationAction(action);
    setError(null);
    try {
      await callback?.(importedItems);
      if (operation !== operationRef.current) return;
      handleClose();
    } catch (cause) {
      if (operation !== operationRef.current) return;
      setError(cause instanceof Error ? cause.message : `Failed to ${action === "keep-preview" ? "keep the preview" : action} imported skills.`);
    } finally {
      if (operation === operationRef.current) setConfirmationAction(null);
    }
  };

  const reviewBlocksImport = items.some((item) => !item.content.trim());

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) handleClose(); }}>
      <DialogContent closeLabel="Close import skill" overlayClassName="z-[79] bg-background/70 backdrop-blur-sm" className="z-[80] flex max-h-[calc(100dvh-2rem)] w-full flex-col gap-0 overflow-hidden rounded-2xl border-border bg-background p-0 shadow-2xl sm:max-w-[560px]">
        <DialogHeader className="gap-0 border-b border-border px-5 py-3 pr-12 text-left">
          <DialogTitle className="text-sm leading-normal text-foreground">{stage === "confirmation" ? "Confirm Skill" : stage === "review" ? "Review Skill Files" : "Import Skill"}</DialogTitle>
          <DialogDescription className="mt-0.5 text-[11px] leading-snug text-text-muted">
             {stage === "review" ? "Preview each selected file before importing." : stage === "confirmation" ? "Choose what to do with the imported skills." : "Upload Markdown or plain-text skill files for a local preview."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {stage === "selection" && (
            <>
              <div
                onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
                onDrop={(event) => { event.preventDefault(); setDragging(false); void addFiles(event.dataTransfer.files); }}
                className={`rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors ${dragging ? "border-primary bg-primary/10" : "border-border bg-surface-low/25"}`}
              >
                <Upload className={`mx-auto mb-2.5 h-7 w-7 ${dragging ? "text-primary" : "text-text-muted"}`} />
                <p className="text-[13px] font-semibold text-foreground">Drop .md or .txt skill files here</p>
                <p className="mt-1 text-[11px] leading-snug text-text-muted">Select one or more Markdown or plain-text files to review before importing.</p>
                <div className="mt-3 flex justify-center">
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="rounded-lg border border-border bg-background/60 px-2.5 py-1.5 text-[11px] font-semibold text-foreground transition-colors hover:border-border-strong hover:bg-surface-high">Browse files</button>
                </div>
                <input ref={fileInputRef} type="file" multiple accept=".md,.txt" onChange={(event) => { if (event.target.files) void addFiles(event.target.files); event.currentTarget.value = ""; }} className="hidden" />
              </div>

              {items.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {items.map((item) => (
                    <div key={item.id} className="flex items-center gap-2.5 rounded-xl border border-border bg-surface-low/35 px-3 py-2">
                      <FileText className="h-4 w-4 shrink-0 text-text-muted" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold leading-tight text-foreground">{item.name}</p>
                        <p className="text-[10px] leading-tight text-text-muted">{item.name.toLowerCase().endsWith(".md") ? "Markdown file" : "Text file"}</p>
                      </div>
                      <button type="button" aria-label={`Remove ${item.name}`} onClick={() => setItems((current) => current.filter((candidate) => candidate.id !== item.id))} className="rounded-md p-1 text-text-muted transition-colors hover:bg-surface-high hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {stage === "review" && (
            <div className="space-y-3">
              {items.map((item) => <SkillMarkdownEditor key={item.id} value={item.content} readOnly showActions={false} defaultMode="preview" title={item.name} renderPreview={renderPreview} />)}
              {reviewBlocksImport && <SkillRequirementNotice tone="warning" title="Empty file">Add content to each selected file before importing it.</SkillRequirementNotice>}
            </div>
          )}

           {stage === "confirmation" && importedItems && (
             <SkillConfirmationPanel title={confirmationTitle ?? `${importedItems.length} skill${importedItems.length === 1 ? "" : "s"} imported`} description={confirmationDescription ?? "Save the imported skills to the agent, test them first, or keep them as previews."} activateLabel={activateLabel} onActivate={onActivate ? () => void handleConfirmation("activate") : undefined} onTest={onTest ? () => void handleConfirmation("test") : undefined} onKeepPreview={() => void handleConfirmation("keep-preview")} keepPreviewLabel={keepPreviewLabel} pendingAction={confirmationAction} error={error} />
           )}
          {error && stage !== "confirmation" && <p className="mt-3 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-[11px] leading-snug text-error">{error}</p>}
        </div>

        {stage !== "confirmation" && (
          <footer className="flex shrink-0 justify-end border-t border-border px-5 py-3">
            <div className="flex w-full max-w-full flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <Button type="button" variant="outline" size="sm" onClick={stage === "review" ? () => setStage("selection") : handleClose} className="min-w-0 max-w-full shrink whitespace-normal hover:bg-surface-high hover:text-foreground dark:hover:bg-surface-high">
                {stage === "review" && <ArrowLeft />}
                {stage === "review" ? "Back" : "Cancel"}
              </Button>
              {stage === "selection" ? (
                <Button type="button" size="sm" onClick={() => { setError(null); setStage("review"); }} disabled={items.length === 0} className="min-w-0 max-w-full shrink whitespace-normal">
                  Review ({items.length})
                  <ArrowRight />
                </Button>
              ) : (
                <Button type="button" size="sm" onClick={() => void handleImport()} disabled={items.length === 0 || importing || reviewBlocksImport} className="min-w-0 max-w-full shrink whitespace-normal">
                  {importing ? <Loader2 className="animate-spin" /> : <Plus />}
                  Import{items.length > 0 ? ` (${items.length})` : ""}
                </Button>
              )}
            </div>
          </footer>
        )}
      </DialogContent>
    </Dialog>
  );
}
