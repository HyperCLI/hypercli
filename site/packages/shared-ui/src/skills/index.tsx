"use client";

import * as React from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  FileText,
  Layers3,
  Loader2,
  PackageCheck,
  Sparkles,
} from "lucide-react";

import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { TooltipHint } from "../components/ui/tooltip";
import { cn } from "../utils/cn";
import { writeClipboardText } from "../utils/browser-clipboard";

export type SkillCardStatus = "active" | "disabled" | "needs-setup" | "blocked" | "preview";
export type SkillCardTone = SkillCardStatus | "neutral";
export type SkillCardOrigin = "built-in" | "extension" | "registry" | "custom" | "unknown" | "created" | "imported";

export interface SkillCardBadge {
  label: string;
  icon?: React.ElementType;
  tone?: SkillCardTone;
}

export interface SkillCardModel {
  id: string;
  name: string;
  description: string;
  category: string;
  emoji?: string;
  origin?: SkillCardOrigin;
  status?: SkillCardStatus;
  statusLabel?: string;
  statusTone?: SkillCardTone;
  badges?: SkillCardBadge[];
}

function toneClasses(tone: SkillCardTone): string {
  if (tone === "active") return "border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] text-[var(--selection-accent)]";
  if (tone === "needs-setup") return "border-warning/35 bg-warning/10 text-warning";
  if (tone === "blocked") return "border-error/35 bg-error/10 text-error";
  if (tone === "disabled") return "border-border bg-surface-high/45 text-text-muted";
  if (tone === "preview") return "border-warning/35 bg-warning/10 text-warning";
  return "border-border bg-surface-low/60 text-text-secondary";
}

function dotClasses(tone: SkillCardTone): string {
  if (tone === "active") return "bg-primary";
  if (tone === "preview" || tone === "needs-setup") return "bg-warning";
  return "bg-text-muted";
}

export function SkillStatusPill({ label, tone, showDot = true }: { label: string; tone: SkillCardTone; showDot?: boolean }) {
  return (
    <span className={`inline-flex h-5 max-w-full items-center gap-1 rounded-full border px-2 text-[9px] font-semibold leading-none ${toneClasses(tone)}`}>
      {showDot && <span className={`h-1.5 w-1.5 rounded-full ${dotClasses(tone)}`} aria-hidden="true" />}
      <span className="truncate">{label}</span>
    </span>
  );
}

export interface SkillCardProps {
  skill: SkillCardModel;
  control?: React.ReactNode;
  actions?: React.ReactNode;
  showMetadata?: boolean;
  statusPosition?: "header" | "footer";
  actionLabel?: string;
  actionDisabled?: boolean;
  actionLoading?: boolean;
  onAction?: () => void;
}

export function SkillCard({ skill, control, actions, showMetadata = true, statusPosition = "header", actionLabel, actionDisabled, actionLoading, onAction }: SkillCardProps) {
  const statusTone = skill.statusTone ?? skill.status ?? "neutral";
  const statusLabel = skill.statusLabel ?? (skill.status ? `${skill.status.charAt(0).toUpperCase()}${skill.status.slice(1)}` : undefined);
  const originLabel = skill.origin ? `${skill.origin.charAt(0).toUpperCase()}${skill.origin.slice(1)}` : undefined;
  const badgeLabels = skill.badges?.slice(0, 3).map((badge) => badge.label) ?? [];
  const chipSummary = [originLabel, skill.category, ...badgeLabels].filter(Boolean).join(" • ");

  return (
    <article className={`group flex min-h-[136px] flex-col overflow-hidden rounded-xl border border-border bg-surface-low/45 p-3 text-left transition-colors hover:border-border-strong hover:bg-surface-low/70 ${statusTone === "disabled" ? "opacity-65" : ""}`}>
      <div className="flex items-start gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background/70 text-foreground">
          {skill.emoji ? <span className="text-[13px] leading-none" aria-hidden="true">{skill.emoji}</span> : <FileText className="h-3 w-3 text-text-secondary" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="min-w-0 truncate text-[13px] font-semibold leading-5 text-foreground">{skill.name}</h3>
            {(control || (statusLabel && statusPosition === "header")) && <div className="flex shrink-0 items-center gap-1.5">{control}{statusLabel && statusPosition === "header" && <SkillStatusPill label={statusLabel} tone={statusTone} />}</div>}
          </div>
          <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-text-muted">{skill.description}</p>
        </div>
      </div>

      <div data-slot="skill-card-footer" className="mt-auto flex min-w-0 items-center gap-2 pt-2.5">
        {showMetadata && <TooltipHint label={chipSummary}>
          <div data-slot="skill-card-metadata" className="min-w-0 flex-1 overflow-hidden" tabIndex={0}>
            <div className="flex min-w-0 flex-nowrap gap-1 overflow-hidden whitespace-nowrap">
              {originLabel && <span className="shrink-0 rounded-md border border-border bg-background/50 px-1.5 py-0.5 text-[9px] leading-none text-text-muted">{originLabel}</span>}
              <span className="shrink-0 rounded-md border border-border bg-background/50 px-1.5 py-0.5 text-[9px] leading-none text-text-muted">{skill.category}</span>
              {skill.badges?.slice(0, 3).map((badge) => {
                const Icon = badge.icon;
                return <span key={badge.label} className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] leading-none ${toneClasses(badge.tone ?? "neutral")}`}>{Icon && <Icon className="h-3 w-3" />}{badge.label}</span>;
              })}
            </div>
          </div>
        </TooltipHint>}
        {statusLabel && statusPosition === "footer" && <div data-slot="skill-card-status" className="min-w-0 flex-1"><SkillStatusPill label={statusLabel} tone={statusTone} /></div>}
        {(actions || actionLabel) && <div data-slot="skill-card-actions" className="ml-auto min-w-0 shrink-0">
          {actions ?? (actionLabel ? (
            <button type="button" onClick={onAction} disabled={actionDisabled || actionLoading} className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border bg-background/60 px-2 text-[10px] font-semibold text-foreground transition-colors hover:border-border-strong hover:bg-surface-high disabled:cursor-not-allowed disabled:opacity-45">
              {actionLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />}
              {actionLabel}
            </button>
          ) : null)}
        </div>}
      </div>
    </article>
  );
}

export interface SkillCategoryFilterOption {
  id: string;
  label: string;
  count?: number;
  group?: string;
}

export interface SkillCategoryFilterProps {
  options: SkillCategoryFilterOption[];
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  totalCount?: number;
  className?: string;
}

export function SkillCategoryFilter({ options, selectedIds, onSelectedIdsChange, totalCount, className }: SkillCategoryFilterProps) {
  const selected = new Set(selectedIds);
  const label = selectedIds.length === 0 ? "All skills" : selectedIds.length === 1 ? options.find((option) => option.id === selectedIds[0])?.label ?? "1 filter" : `${selectedIds.length} filters`;
  const groupedOptions = new Map<string, SkillCategoryFilterOption[]>();
  options.forEach((option) => {
    const group = option.group ?? "Categories";
    groupedOptions.set(group, [...(groupedOptions.get(group) ?? []), option]);
  });
  const groups = Array.from(groupedOptions);
  const renderOption = (option: SkillCategoryFilterOption) => (
    <CommandItem key={option.id} value={`${option.label} ${option.id}`} aria-label={`${option.label}, ${option.count ?? 0}, ${selected.has(option.id) ? "selected" : "not selected"}`} aria-checked={selected.has(option.id)} className="rounded-md data-[selected=true]:bg-primary/10 data-[selected=true]:text-foreground" onSelect={() => onSelectedIdsChange(selected.has(option.id) ? selectedIds.filter((id) => id !== option.id) : [...selectedIds, option.id])}>
      <Checkbox checked={selected.has(option.id)} tabIndex={-1} aria-hidden="true" />
      <span className="flex-1 truncate">{option.label}</span>
      {typeof option.count === "number" && <span className="text-xs text-text-muted">{option.count}</span>}
    </CommandItem>
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" aria-label={`Filter skills. ${label}`} className={cn("min-w-36 justify-between rounded-full border-border bg-background/55 text-xs hover:bg-surface-high hover:text-foreground data-[state=open]:bg-surface-high data-[state=open]:text-foreground dark:border-border dark:bg-background/55 dark:hover:bg-surface-high", selectedIds.length > 0 && "border-warning/40 text-warning", className)}>
          <span className="flex min-w-0 items-center gap-1.5"><Layers3 className="h-3.5 w-3.5" /><span className="truncate">{label}</span></span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(18rem,calc(100vw-2rem))] p-0">
        <Command>
          <CommandInput placeholder="Search filters..." aria-label="Search skill filters" />
          <CommandList aria-multiselectable="true" className="p-1">
            <CommandEmpty>No matching filters.</CommandEmpty>
            <CommandItem value="all skills" aria-label={`All skills, ${selectedIds.length === 0 ? "selected" : "not selected"}`} aria-checked={selectedIds.length === 0} onSelect={() => onSelectedIdsChange([])} className="rounded-md data-[selected=true]:bg-primary/10 data-[selected=true]:text-foreground">
              <Checkbox checked={selectedIds.length === 0} tabIndex={-1} aria-hidden="true" />
              <span className="flex-1">All skills</span>
              <span className="text-xs text-text-muted">{totalCount ?? options.reduce((total, option) => total + (option.count ?? 0), 0)}</span>
            </CommandItem>
            {groups.map(([group, groupOptions]) => <CommandGroup key={group} heading={group}>{groupOptions.map(renderOption)}</CommandGroup>)}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function SkillsEmptyState({ title, detail, icon: Icon = PackageCheck }: { title: string; detail?: string; icon?: React.ElementType }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-surface-low/25 px-5 py-10 text-center">
      <Icon className="mx-auto mb-2.5 h-5 w-5 text-text-muted" />
      <p className="text-[13px] font-semibold text-foreground">{title}</p>
      {detail && <p className="mx-auto mt-1 max-w-md text-[11px] leading-snug text-text-muted">{detail}</p>}
    </div>
  );
}

export function SkillMarkdownPreview({ content }: { content: string }) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    try {
      const didCopy = await writeClipboardText(content);
      setCopied(didCopy);
      if (didCopy) window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-background/75">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">Generated SKILL.md</span>
        <button type="button" onClick={handleCopy} className="inline-flex h-6 items-center gap-1 rounded-md border border-border px-2 text-[10px] font-semibold text-text-secondary transition-colors hover:bg-surface-high hover:text-foreground">
          {copied ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap p-3 font-mono text-[11px] leading-normal text-text-secondary">{content}</pre>
    </div>
  );
}

export interface SkillMarkdownEditorProps {
  value: string;
  onChange?: (value: string) => void;
  onApply?: () => Promise<void> | void;
  onCancel?: () => void;
  dirty?: boolean;
  saving?: boolean;
  readOnly?: boolean;
  showActions?: boolean;
  defaultMode?: "preview" | "raw";
  title?: string;
  applyLabel?: string;
  renderPreview?: (content: string) => React.ReactNode;
  className?: string;
}

export function SkillMarkdownEditor({ value, onChange, onApply, onCancel, dirty = true, saving = false, readOnly = false, showActions = true, defaultMode = "raw", title = "SKILL.md", applyLabel = "Save & apply", renderPreview, className }: SkillMarkdownEditorProps) {
  const [mode, setMode] = React.useState<"preview" | "raw">(defaultMode);
  return (
    <section className={cn("overflow-hidden rounded-xl border border-border bg-background/70", className)}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          <span className="truncate font-mono text-[10px] font-semibold text-foreground">{title}</span>
          {readOnly ? <span className="text-[9px] font-medium text-text-muted">Read-only</span> : dirty && <span className="text-[9px] font-medium text-warning">Unsaved changes</span>}
        </div>
        <div className="flex items-center rounded-lg border border-border bg-surface-low/45 p-0.5" aria-label="Markdown view mode">
          {(["preview", "raw"] as const).map((nextMode) => <button key={nextMode} type="button" aria-pressed={mode === nextMode} onClick={() => setMode(nextMode)} className={cn("h-6 rounded-md px-2 text-[10px] font-medium capitalize transition-colors", mode === nextMode ? "bg-surface-high text-foreground" : "text-text-muted hover:bg-surface-high hover:text-foreground")}>{nextMode}</button>)}
        </div>
      </header>
      <div className="min-h-64 max-h-[55dvh] overflow-auto">
        {mode === "preview" ? <div className="min-h-64 p-4 text-sm text-text-secondary">{renderPreview ? renderPreview(value) : <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">{value}</pre>}</div> : <textarea value={value} onChange={(event) => onChange?.(event.target.value)} readOnly={readOnly} spellCheck={false} aria-label={`${title} contents`} className="min-h-64 w-full resize-y bg-transparent p-3 font-mono text-xs leading-relaxed text-foreground outline-none" />}
      </div>
      {showActions && !readOnly && onApply && (
        <footer className="flex flex-col-reverse gap-2 border-t border-border bg-surface-low/25 px-3 py-2 sm:flex-row sm:justify-end">
          {onCancel && <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving} className="hover:bg-surface-high hover:text-foreground dark:hover:bg-surface-high">Cancel</Button>}
          <Button type="button" size="sm" onClick={() => void onApply()} disabled={!dirty || saving || !value.trim()}>{saving ? <Loader2 className="animate-spin" /> : <Check />}{saving ? "Saving..." : applyLabel}</Button>
        </footer>
      )}
    </section>
  );
}

export type SkillConfirmationAction = "activate" | "test" | "keep-preview";

export interface SkillConfirmationPanelProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  activateLabel?: string;
  testLabel?: string;
   keepPreviewLabel?: string;
  onActivate?: () => void;
  onTest?: () => void;
  onKeepPreview?: () => void;
  pendingAction?: SkillConfirmationAction | null;
  error?: React.ReactNode;
  className?: string;
}

export function SkillConfirmationPanel({ title = "Skill ready", description = "Choose what to do with this skill next.", activateLabel = "Activate", testLabel = "Test skill", keepPreviewLabel = "Keep as preview", onActivate, onTest, onKeepPreview, pendingAction, error, className }: SkillConfirmationPanelProps) {
  const busy = Boolean(pendingAction);
  return (
    <section className={cn("rounded-2xl border border-border bg-surface-low/35 p-4", className)} aria-live="polite">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] text-[var(--selection-accent)]"><PackageCheck className="h-4 w-4" /></span>
        <div className="min-w-0"><h3 className="text-sm font-semibold text-foreground">{title}</h3>{description && <div className="mt-1 text-[11px] leading-snug text-text-muted">{description}</div>}</div>
      </div>
      {error && <div className="mt-3 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-[11px] text-error">{error}</div>}
      <div className="mt-4 flex w-full max-w-full flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
        {onKeepPreview && <Button type="button" variant="ghost" size="sm" onClick={onKeepPreview} disabled={busy} className="min-w-0 max-w-full shrink whitespace-normal hover:bg-surface-high hover:text-foreground dark:hover:bg-surface-high">{pendingAction === "keep-preview" && <Loader2 className="animate-spin" />}{keepPreviewLabel}</Button>}
        {onTest && <Button type="button" variant="outline" size="sm" onClick={onTest} disabled={busy} className="min-w-0 max-w-full shrink whitespace-normal hover:bg-surface-high hover:text-foreground dark:hover:bg-surface-high">{pendingAction === "test" ? <Loader2 className="animate-spin" /> : <Sparkles />}{testLabel}</Button>}
        {onActivate && <Button type="button" size="sm" onClick={onActivate} disabled={busy} className="min-w-0 max-w-full shrink whitespace-normal">{pendingAction === "activate" ? <Loader2 className="animate-spin" /> : <Check />}{activateLabel}</Button>}
      </div>
    </section>
  );
}

export type SkillRequirementNoticeTone = "neutral" | "warning" | "error";

export interface SkillRequirementNoticeProps {
  title?: React.ReactNode;
  requirements?: React.ReactNode[];
  children?: React.ReactNode;
  tone?: SkillRequirementNoticeTone;
  className?: string;
}

export function SkillRequirementNotice({ title = "Requirements", requirements, children, tone = "warning", className }: SkillRequirementNoticeProps) {
  const toneClass = tone === "error" ? "border-error/25 bg-error/10 text-error" : tone === "warning" ? "border-warning/25 bg-warning/10 text-warning" : "border-border bg-surface-low/45 text-text-secondary";
  return (
    <aside className={cn("flex min-w-0 items-start gap-2 rounded-lg border px-3 py-2 text-[11px] leading-snug", toneClass, className)}>
      <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && "mt-0.5")}>{children}</div>}
        {requirements && requirements.length > 0 && <ul className={cn("space-y-0.5", title && "mt-1")}>{requirements.map((requirement, index) => <li key={index}>{requirement}</li>)}</ul>}
      </div>
    </aside>
  );
}
