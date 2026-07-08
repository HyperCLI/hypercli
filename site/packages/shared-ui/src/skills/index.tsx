"use client";

import * as React from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  FileArchive,
  FileText,
  FolderOpen,
  Loader2,
  PackageCheck,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Upload,
  Wrench,
  X,
} from "lucide-react";

export type SkillCardTone = "active" | "needs-setup" | "disabled" | "preview" | "library" | "neutral";

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
  statusLabel: string;
  statusTone: SkillCardTone;
  pathLabel?: string;
  requirement?: string | null;
  badges?: SkillCardBadge[];
  mocked?: boolean;
}

export interface SkillsWorkspaceTab<T extends string = string> {
  id: T;
  label: string;
  count?: number;
}

export interface SkillsWorkspaceFilter<T extends string = string> {
  id: T;
  label: string;
  count?: number;
}

export interface SkillDraftData {
  name: string;
  description: string;
  emoji: string;
  homepage: string;
  instructions: string;
  requiresBins: string[];
  requiresEnv: string[];
  os: string[];
}

export interface SkillGeneratedOutput extends SkillDraftData {
  id: string;
  content: string;
  mocked: boolean;
}

export interface SkillImportFile {
  name: string;
  path: string;
  content?: string;
}

export interface SkillImportItem {
  id: string;
  name: string;
  type: "file" | "folder" | "zip";
  content?: string;
  files?: SkillImportFile[];
  fileCount?: number;
  mocked: boolean;
}

const EMOJI_OPTIONS = [
  "\u{1F527}",
  "\u2699\uFE0F",
  "\u{1F4CA}",
  "\u{1F4AC}",
  "\u{1F419}",
  "\u2614",
  "\u{1F9ED}",
  "\u{1F50D}",
  "\u{1F4C1}",
  "\u{1F3A8}",
  "\u26A1",
  "\u{1F6E0}\uFE0F",
  "\u{1F4CB}",
  "\u{1F916}",
];

const INSTRUCTION_TEMPLATES = [
  {
    id: "workflow",
    name: "Workflow",
    description: "Step-by-step procedure with validation",
    content: `# Workflow

## Purpose
Describe when this skill should be used.

## Prerequisites
List any tools, accounts, files, or context required.

## Steps
1. Gather the required context.
2. Run the core command or workflow.
3. Validate the result before reporting back.

## Error handling
- If a required dependency is missing, explain how to install it.
- If a command fails, preserve the error and suggest the safest next action.`,
  },
  {
    id: "api-wrapper",
    name: "API Wrapper",
    description: "Wrap a CLI tool or API safely",
    content: `# API Wrapper

## When to use
Use this skill when the user asks for this service or workflow.

## Authentication
Check authentication before making requests.

## Common commands
\`\`\`bash
tool status
tool list --format json
tool get <id>
\`\`\`

## Safety
- Do not expose secrets.
- Confirm destructive operations when intent is unclear.`,
  },
  {
    id: "data-processing",
    name: "Data Processing",
    description: "Transform, parse, or analyze data",
    content: `# Data Processing

## Input
Describe the expected input format and required fields.

## Processing
1. Validate the input structure.
2. Extract relevant fields.
3. Transform data according to the rules.
4. Validate the output.

## Output
Describe the expected output format.`,
  },
  {
    id: "blank",
    name: "Blank",
    description: "Start from scratch",
    content: `# Skill Name

Write clear instructions for when and how the agent should use this skill.`,
  },
];

function toneClasses(tone: SkillCardTone): string {
  if (tone === "active") return "border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] text-[var(--selection-accent)]";
  if (tone === "needs-setup") return "border-warning/35 bg-warning/10 text-warning";
  if (tone === "disabled") return "border-border bg-surface-high/45 text-text-muted";
  if (tone === "preview") return "border-primary/30 bg-primary/10 text-primary";
  if (tone === "library") return "border-border bg-background/50 text-text-secondary";
  return "border-border bg-surface-low/60 text-text-secondary";
}

function dotClasses(tone: SkillCardTone): string {
  if (tone === "active" || tone === "preview") return "bg-primary";
  if (tone === "needs-setup") return "bg-warning";
  if (tone === "library") return "bg-text-muted";
  return "bg-text-muted";
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function skillSlugFromName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function buildSkillMarkdown(data: SkillDraftData): string {
  const slug = skillSlugFromName(data.name) || "new-skill";
  const frontmatter = [
    "---",
    `name: ${slug}`,
    `description: "${data.description.replace(/"/g, "\\\"")}"`,
    data.homepage ? `homepage: ${data.homepage}` : null,
    "user-invocable: true",
    "disable-model-invocation: false",
    data.emoji ? `emoji: "${data.emoji}"` : null,
    data.requiresEnv.length > 0 ? `env: [${data.requiresEnv.map((key) => `"${key}"`).join(", ")}]` : null,
    data.requiresBins.length > 0 ? `bins: [${data.requiresBins.map((bin) => `"${bin}"`).join(", ")}]` : null,
    data.os.length > 0 ? `os: [${data.os.map((os) => `"${os}"`).join(", ")}]` : null,
    "---",
  ].filter(Boolean);

  return `${frontmatter.join("\n")}\n\n${data.instructions.trim() || "# Skill\n\nWrite your instructions here."}\n`;
}

export function draftToGeneratedSkill(data: SkillDraftData): SkillGeneratedOutput {
  return {
    ...data,
    id: skillSlugFromName(data.name) || "new-skill",
    content: buildSkillMarkdown(data),
    mocked: true,
  };
}

export function generateMockSkillFromPrompt(prompt: string): SkillDraftData {
  const lower = prompt.toLowerCase();
  if (lower.includes("github") || lower.includes("pull request") || lower.includes("issue")) {
    return {
      name: "github-helper",
      description: "Use GitHub CLI workflows for issues, pull requests, checks, releases, and repository lookups.",
      emoji: "\u{1F419}",
      homepage: "https://cli.github.com",
      requiresBins: ["gh"],
      requiresEnv: [],
      os: [],
      instructions: `# GitHub Helper

Use this skill when the user asks about GitHub issues, pull requests, checks, releases, repositories, or gh api queries.

## Commands
\`\`\`bash
gh auth status
gh pr list --json number,title,state
gh issue list --state open
\`\`\`

## Safety
- Prefer read-only commands unless the user clearly asks for a change.
- Confirm destructive operations before running them.`,
    };
  }
  if (lower.includes("weather") || lower.includes("forecast") || lower.includes("temperature")) {
    return {
      name: "weather-check",
      description: "Use wttr.in via curl for current weather, rain, temperature, forecasts, and travel planning.",
      emoji: "\u2614",
      homepage: "https://wttr.in/:help",
      requiresBins: ["curl"],
      requiresEnv: [],
      os: [],
      instructions: `# Weather Check

Use this skill when the user asks for current weather, forecasts, rain, temperature, or travel weather.

## Commands
\`\`\`bash
curl "wttr.in/London?format=3"
curl "wttr.in/London?format=j1"
\`\`\`

## Notes
- For severe weather, recommend official local weather services.
- For historical climate data, use an archive or dedicated API.`,
    };
  }

  const slug = skillSlugFromName(prompt) || "custom-skill";
  return {
    name: slug,
    description: `Handle ${prompt.trim()} tasks with a focused, repeatable workflow.`,
    emoji: "\u{1F527}",
    homepage: "",
    requiresBins: [],
    requiresEnv: [],
    os: [],
    instructions: `# ${slug.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ")}

## Purpose
${prompt.trim()}

## Workflow
1. Clarify the requested outcome.
2. Gather the required inputs.
3. Execute the safest available workflow.
4. Validate results before responding.

## Error handling
- Preserve useful errors for debugging.
- Explain missing dependencies or credentials clearly.`,
  };
}

export function SkillStatusPill({ label, tone, showDot = true }: { label: string; tone: SkillCardTone; showDot?: boolean }) {
  return (
    <span className={`inline-flex h-5 max-w-full items-center gap-1 rounded-full border px-2 text-[9px] font-semibold leading-none ${toneClasses(tone)}`}>
      {showDot && <span className={`h-1.5 w-1.5 rounded-full ${dotClasses(tone)}`} aria-hidden="true" />}
      <span className="truncate">{label}</span>
    </span>
  );
}

export function SkillCard({
  skill,
  actionLabel,
  actionDisabled,
  actionLoading,
  onAction,
}: {
  skill: SkillCardModel;
  actionLabel?: string;
  actionDisabled?: boolean;
  actionLoading?: boolean;
  onAction?: () => void;
}) {
  return (
    <article className={`group relative flex min-h-[136px] flex-col rounded-xl border border-border bg-surface-low/45 p-3 text-left shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] transition-colors hover:border-border-strong hover:bg-surface-low/70 ${skill.statusTone === "disabled" ? "opacity-65" : ""}`}>
      <div className="absolute right-2.5 top-2.5">
        <SkillStatusPill label={skill.statusLabel} tone={skill.statusTone} />
      </div>
      <div className="flex items-start gap-2.5 pr-16">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background/70 text-foreground">
          {skill.emoji ? (
            <span className="text-[16px] leading-none" aria-hidden="true">{skill.emoji}</span>
          ) : (
            <FileText className="h-3.5 w-3.5 text-text-secondary" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13px] font-semibold leading-tight text-foreground">{skill.name}</h3>
          <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-text-muted">{skill.description}</p>
        </div>
      </div>

      {skill.requirement && (
        <div className="mt-2 flex min-w-0 items-center gap-1.5 rounded-md border border-warning/20 bg-warning/10 px-2 py-1 text-[10px] font-medium leading-tight text-warning">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="min-w-0 truncate">{skill.requirement}</span>
        </div>
      )}

      <div className="mt-auto flex items-end justify-between gap-2 pt-3">
        <div className="flex min-w-0 flex-wrap gap-1">
          <span className="rounded-md border border-border bg-background/50 px-1.5 py-0.5 text-[9px] leading-none text-text-muted">{skill.category}</span>
          {skill.mocked && (
            <span className="rounded-md border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium leading-none text-primary">Local preview</span>
          )}
          {skill.badges?.slice(0, 3).map((badge) => {
            const Icon = badge.icon;
            return (
              <span key={badge.label} className="inline-flex items-center gap-1 rounded-md border border-border bg-background/50 px-1.5 py-0.5 text-[9px] leading-none text-text-muted">
                {Icon && <Icon className="h-3 w-3" />}
                {badge.label}
              </span>
            );
          })}
        </div>
        {actionLabel && (
          <button
            type="button"
            onClick={onAction}
            disabled={actionDisabled || actionLoading}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border bg-background/60 px-2 text-[10px] font-semibold text-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-45"
          >
            {actionLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />}
            {actionLabel}
          </button>
        )}
      </div>
    </article>
  );
}

export function SkillsWorkspaceShell<TabId extends string, FilterId extends string>({
  title,
  description,
  summary,
  actions,
  searchValue,
  searchPlaceholder = "Search skills...",
  onSearchChange,
  tabs,
  activeTab,
  onTabChange,
  filters,
  activeFilter,
  onFilterChange,
  children,
}: {
  title: string;
  description: React.ReactNode;
  summary?: React.ReactNode;
  actions?: React.ReactNode;
  searchValue: string;
  searchPlaceholder?: string;
  onSearchChange: (value: string) => void;
  tabs: SkillsWorkspaceTab<TabId>[];
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  filters?: SkillsWorkspaceFilter<FilterId>[];
  activeFilter?: FilterId;
  onFilterChange?: (filter: FilterId) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-surface-low/30 p-3 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold leading-tight text-foreground">{title}</h2>
            <div className="mt-1.5 max-w-2xl text-xs leading-snug text-text-muted">{description}</div>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:items-end">
            {summary && <div className="text-[11px] leading-tight text-text-muted sm:text-right">{summary}</div>}
            {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
          </div>
        </div>

        <div className="mt-4 grid gap-2.5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={searchValue}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-9 w-full rounded-lg border border-border bg-background/70 pl-9 pr-3 text-xs text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-primary/50"
            />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {tabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onTabChange(tab.id)}
                  className={`h-8 rounded-full border px-3 text-xs font-semibold transition-colors ${
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background/55 text-foreground hover:border-border-strong"
                  }`}
                >
                  {tab.label}{typeof tab.count === "number" ? ` (${tab.count})` : ""}
                </button>
              );
            })}
          </div>
        </div>

        {filters && activeFilter && onFilterChange && filters.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
            {filters.map((filter) => {
              const active = activeFilter === filter.id;
              return (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => onFilterChange(filter.id)}
                  className={`h-6 rounded-full px-2.5 text-[10px] font-semibold transition-colors ${
                    active
                      ? "bg-surface-high text-foreground"
                      : "text-text-muted hover:bg-surface-low hover:text-foreground"
                  }`}
                >
                  {filter.label}{typeof filter.count === "number" ? ` (${filter.count})` : ""}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {children}
    </div>
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
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-background/75">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">Generated SKILL.md</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex h-6 items-center gap-1 rounded-md border border-border px-2 text-[10px] font-semibold text-text-secondary transition-colors hover:text-foreground"
        >
          {copied ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap p-3 font-mono text-[11px] leading-normal text-text-secondary">{content}</pre>
    </div>
  );
}

export function DescriptionQuality({ description }: { description: string }) {
  const checks = React.useMemo(() => {
    const value = description.trim();
    return [
      { label: "Good length", pass: value.length >= 30 && value.length <= 180, hint: value.length < 30 ? "Add more detail" : "Shorten the description" },
      { label: "Trigger words", pass: /(for|to|when|using|via|with)/i.test(value), hint: "Include when the skill should trigger" },
      { label: "Action words", pass: /(check|get|send|list|create|manage|search|handle|audit|run)/i.test(value), hint: "Add action verbs" },
      { label: "Bounded scope", pass: !/(everything|anything|whatever)/i.test(value), hint: "Avoid vague scope" },
    ];
  }, [description]);
  const score = Math.round((checks.filter((check) => check.pass).length / checks.length) * 100);

  if (!description.trim()) {
    return (
      <div className="rounded-lg border border-border bg-surface-low/35 px-2.5 py-1.5 text-[10px] text-text-muted">
        Write a description so the agent knows when to trigger this skill.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface-low/35 px-2.5 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-text-secondary">
          <Sparkles className="h-3 w-3 text-primary" />
          Description quality
        </span>
        <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">{score}%</span>
      </div>
      <div className="mt-2 space-y-1">
        {checks.map((check) => (
          <div key={check.label} className="flex items-center gap-1.5 text-[10px] text-text-muted">
            {check.pass ? <Check className="h-3 w-3 text-primary" /> : <AlertTriangle className="h-3 w-3 text-warning" />}
            <span>{check.pass ? check.label : check.hint}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CreateChoice({ icon: Icon, title, detail, tone = "neutral", onClick }: { icon: React.ElementType; title: string; detail: string; tone?: "neutral" | "ai"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
        tone === "ai"
          ? "border-warning/35 bg-warning/10 hover:border-warning/55"
          : "border-border bg-surface-low/35 hover:border-border-strong hover:bg-surface-low/60"
      }`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background/70">
        <Icon className={tone === "ai" ? "h-4 w-4 text-warning" : "h-4 w-4 text-text-secondary"} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold leading-tight text-foreground">{title}</span>
        <span className="mt-1 block text-[11px] leading-snug text-text-muted">{detail}</span>
      </span>
      <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-text-muted" />
    </button>
  );
}

type SkillCreateMode = "choose" | "form" | "ai" | "preview";
type SkillFormStep = "identity" | "instructions" | "dependencies";
type SkillFormErrors = Partial<Record<"name" | "description" | "homepage" | "instructions", string>>;

const STRUCTURED_FORM_STEPS: Array<{ id: SkillFormStep; label: string }> = [
  { id: "identity", label: "Identity" },
  { id: "instructions", label: "Instructions" },
  { id: "dependencies", label: "Dependencies" },
];

const PLATFORM_OPTIONS = [
  { id: "darwin", label: "macOS" },
  { id: "linux", label: "Linux" },
  { id: "win32", label: "Windows" },
];

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function hasFormErrors(errors: SkillFormErrors): boolean {
  return Object.values(errors).some(Boolean);
}

function getFormStepErrors(draft: SkillDraftData, step: SkillFormStep): SkillFormErrors {
  const errors: SkillFormErrors = {};
  if (step === "identity") {
    const name = draft.name.trim();
    if (!name) errors.name = "Name is required.";
    else if (!NAME_PATTERN.test(name)) errors.name = "Use lowercase letters, digits, and hyphens only.";
    if (!draft.description.trim()) errors.description = "Description is required.";
    if (draft.homepage.trim()) {
      try {
        const url = new URL(draft.homepage.trim());
        if (url.protocol !== "http:" && url.protocol !== "https:") errors.homepage = "Use an http or https URL.";
      } catch {
        errors.homepage = "Enter a valid URL.";
      }
    }
  }
  if (step === "instructions" && !draft.instructions.trim()) {
    errors.instructions = "Instructions are required.";
  }
  return errors;
}

function normalizeSkillDraft(data: SkillDraftData): SkillDraftData {
  return {
    ...data,
    name: data.name.trim(),
    description: data.description.trim(),
    homepage: data.homepage.trim(),
    instructions: data.instructions.trim(),
    requiresBins: data.requiresBins.map((item) => item.trim()).filter(Boolean),
    requiresEnv: data.requiresEnv.map((item) => item.trim()).filter(Boolean),
    os: data.os.map((item) => item.trim()).filter(Boolean),
  };
}

function SkillFieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <span className="mt-1 block text-[10px] font-medium text-error">{message}</span>;
}

function SkillFormStepper({ activeStep }: { activeStep: SkillFormStep }) {
  const activeIndex = STRUCTURED_FORM_STEPS.findIndex((step) => step.id === activeStep);
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-3" aria-label="Skill creation progress">
      {STRUCTURED_FORM_STEPS.map((step, index) => {
        const active = index === activeIndex;
        const complete = index < activeIndex;
        return (
          <React.Fragment key={step.id}>
            <div
              title={step.label}
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${
                complete
                  ? "bg-primary text-primary-foreground"
                  : active
                    ? "bg-foreground text-background"
                    : "bg-surface-high text-text-muted"
              }`}
            >
              {complete ? <Check className="h-3.5 w-3.5" /> : index + 1}
            </div>
            {index < STRUCTURED_FORM_STEPS.length - 1 && <div className={`h-px min-w-0 ${complete ? "bg-primary" : "bg-border"}`} aria-hidden="true" />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function SectionHeading({ title, detail }: { title: string; detail: string }) {
  return (
    <div>
      <h3 className="text-[15px] font-semibold leading-tight text-foreground">{title}</h3>
      <p className="mt-1 text-[12px] leading-snug text-text-muted">{detail}</p>
    </div>
  );
}

export function SkillsCreateModal({
  open,
  onClose,
  onSave,
  notice,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (skill: SkillGeneratedOutput) => Promise<void> | void;
  notice?: React.ReactNode;
}) {
  const [mode, setMode] = React.useState<SkillCreateMode>("choose");
  const [formStep, setFormStep] = React.useState<SkillFormStep>("identity");
  const [prompt, setPrompt] = React.useState("");
  const [draft, setDraft] = React.useState<SkillDraftData>({
    name: "",
    description: "",
    emoji: "\u{1F527}",
    homepage: "",
    instructions: "",
    requiresBins: [],
    requiresEnv: [],
    os: [],
  });
  const [dependencyText, setDependencyText] = React.useState({ bins: "", env: "" });
  const [formErrors, setFormErrors] = React.useState<SkillFormErrors>({});
  const [generated, setGenerated] = React.useState<SkillGeneratedOutput | null>(null);
  const [previewSource, setPreviewSource] = React.useState<"form" | "ai">("form");
  const [generating, setGenerating] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const generationTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (!open) {
      if (generationTimerRef.current) window.clearTimeout(generationTimerRef.current);
      setMode("choose");
      setFormStep("identity");
      setPrompt("");
      setDraft({ name: "", description: "", emoji: "\u{1F527}", homepage: "", instructions: "", requiresBins: [], requiresEnv: [], os: [] });
      setDependencyText({ bins: "", env: "" });
      setFormErrors({});
      setGenerated(null);
      setPreviewSource("form");
      setGenerating(false);
      setSaving(false);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const updateDraft = (patch: Partial<SkillDraftData>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
    setFormErrors((current) => {
      const next = { ...current };
      Object.keys(patch).forEach((key) => {
        delete next[key as keyof SkillFormErrors];
      });
      return next;
    });
  };

  const activeGenerated = generated ?? draftToGeneratedSkill(normalizeSkillDraft(draft));

  const validateStep = (step: SkillFormStep) => {
    const nextErrors = getFormStepErrors(draft, step);
    setFormErrors(nextErrors);
    return !hasFormErrors(nextErrors);
  };

  const handleFormNext = () => {
    if (!validateStep(formStep)) return;
    setError(null);
    setFormStep(formStep === "identity" ? "instructions" : "dependencies");
  };

  const handleFormBack = () => {
    setError(null);
    setFormErrors({});
    if (formStep === "identity") {
      setMode("choose");
      return;
    }
    setFormStep(formStep === "dependencies" ? "instructions" : "identity");
  };

  const handlePreview = () => {
    for (const step of STRUCTURED_FORM_STEPS) {
      const nextErrors = getFormStepErrors(draft, step.id);
      if (hasFormErrors(nextErrors)) {
        setFormStep(step.id);
        setFormErrors(nextErrors);
        return;
      }
    }
    setGenerated(draftToGeneratedSkill(normalizeSkillDraft(draft)));
    setPreviewSource("form");
    setError(null);
    setMode("preview");
  };

  const handleGenerate = () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setError(null);
    if (generationTimerRef.current) window.clearTimeout(generationTimerRef.current);
    generationTimerRef.current = window.setTimeout(() => {
      const nextDraft = generateMockSkillFromPrompt(prompt);
      setDraft(nextDraft);
      setDependencyText({ bins: nextDraft.requiresBins.join(", "), env: nextDraft.requiresEnv.join(", ") });
      setGenerated(draftToGeneratedSkill(nextDraft));
      setPreviewSource("ai");
      setGenerating(false);
      setMode("preview");
    }, 300);
  };

  const handlePreviewEdit = () => {
    setError(null);
    setMode(previewSource === "form" ? "form" : "ai");
    if (previewSource === "form") setFormStep("dependencies");
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(activeGenerated);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to save skill.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button type="button" aria-label="Close create skill" onClick={onClose} className="absolute inset-0 cursor-default bg-background/70 backdrop-blur-sm" />
      <section role="dialog" aria-modal="true" aria-labelledby="create-skill-title" className="relative flex max-h-[90vh] w-full max-w-[600px] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-3">
          <div>
            <h2 id="create-skill-title" className="text-sm font-semibold text-foreground">
              {mode === "choose" ? "Create Skill" : mode === "form" ? "Structured Form" : mode === "ai" ? "Describe with AI" : "Preview SKILL.md"}
            </h2>
            <p className="mt-0.5 text-[11px] leading-snug text-text-muted">
              {mode === "choose" ? "Choose how to draft a skill." : mode === "form" ? "Build step-by-step with full control" : mode === "preview" ? "Review the generated instruction pack." : "This flow is a local preview until creation APIs land."}
            </p>
          </div>
          <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-low hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {notice && mode !== "form" && <div className="mb-3 rounded-xl border border-primary/25 bg-primary/10 px-3 py-2 text-[11px] leading-snug text-primary">{notice}</div>}
          {mode === "choose" && (
            <div className="space-y-2.5">
              <CreateChoice icon={FileText} title="Structured Form" detail="Build a skill with explicit metadata, dependencies, templates, and markdown preview." onClick={() => { setMode("form"); setFormStep("identity"); }} />
              <CreateChoice icon={Sparkles} title="Describe with AI" detail="Describe what you want. A mocked generator creates a draft for review." tone="ai" onClick={() => setMode("ai")} />
            </div>
          )}

          {mode === "form" && (
            <div className="space-y-5">
              <SkillFormStepper activeStep={formStep} />

              {formStep === "identity" && (
                <div className="space-y-4">
                  <SectionHeading title="Identity" detail="The name and description determine when your agent uses this skill." />
                  <label className="block">
                    <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">Name <span className="text-error">*</span></span>
                    <input
                      value={draft.name}
                      onChange={(event) => updateDraft({ name: event.target.value })}
                      placeholder="github-helper"
                      className={`h-9 w-full rounded-xl border bg-surface-low/45 px-3 font-mono text-xs text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-primary/50 ${formErrors.name ? "border-error/60" : "border-border"}`}
                    />
                    <span className="mt-1 block text-[10px] text-text-muted">Lowercase letters, digits, and hyphens only.</span>
                    <SkillFieldError message={formErrors.name} />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">Description <span className="text-error">*</span></span>
                    <textarea
                      value={draft.description}
                      onChange={(event) => updateDraft({ description: event.target.value })}
                      rows={4}
                      placeholder="What this skill does and when the agent should use it."
                      className={`w-full rounded-xl border bg-surface-low/45 px-3 py-2 text-xs leading-snug text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-primary/50 ${formErrors.description ? "border-error/60" : "border-border"}`}
                    />
                    <SkillFieldError message={formErrors.description} />
                  </label>
                  <DescriptionQuality description={draft.description} />
                  <div className="grid gap-4 sm:grid-cols-[260px_minmax(0,1fr)]">
                    <div>
                      <span className="mb-2 block text-[11px] font-semibold text-text-secondary">Emoji</span>
                      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Skill emoji">
                        {EMOJI_OPTIONS.map((emoji) => {
                          const active = draft.emoji === emoji;
                          return (
                            <button
                              key={emoji}
                              type="button"
                              aria-label={`Use emoji ${emoji}`}
                              onClick={() => updateDraft({ emoji })}
                              className={`flex h-7 w-7 items-center justify-center rounded-lg border text-[15px] transition-colors ${active ? "border-primary bg-primary/15" : "border-transparent hover:border-border hover:bg-surface-low"}`}
                            >
                              {emoji}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <label className="block">
                      <span className="mb-2 block text-[11px] font-semibold text-text-secondary">Homepage (optional)</span>
                      <input
                        value={draft.homepage}
                        onChange={(event) => updateDraft({ homepage: event.target.value })}
                        placeholder="https://..."
                        className={`h-9 w-full rounded-xl border bg-surface-low/45 px-3 text-xs text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-primary/50 ${formErrors.homepage ? "border-error/60" : "border-border"}`}
                      />
                      <SkillFieldError message={formErrors.homepage} />
                    </label>
                  </div>
                </div>
              )}

              {formStep === "instructions" && (
                <div className="space-y-4">
                  <SectionHeading title="Instructions" detail="The markdown body teaches the agent how to execute this skill." />
                  <div className="grid gap-2 sm:grid-cols-2">
                    {INSTRUCTION_TEMPLATES.map((template) => {
                      const active = draft.instructions === template.content;
                      return (
                        <button
                          key={template.id}
                          type="button"
                          onClick={() => updateDraft({ instructions: template.content })}
                          className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${active ? "border-primary/60 bg-primary/10" : "border-border bg-surface-low/35 hover:border-border-strong"}`}
                        >
                          <span className="block text-xs font-semibold text-foreground">{template.name}</span>
                          <span className="mt-0.5 block text-[10px] leading-snug text-text-muted">{template.description}</span>
                        </button>
                      );
                    })}
                  </div>
                  <label className="block">
                    <span className="sr-only">Instructions</span>
                    <textarea
                      value={draft.instructions}
                      onChange={(event) => updateDraft({ instructions: event.target.value })}
                      rows={12}
                      placeholder="Write your instructions in markdown..."
                      className={`min-h-[252px] w-full rounded-xl border bg-surface-low/45 px-3 py-3 font-mono text-[11px] leading-normal text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-primary/50 ${formErrors.instructions ? "border-error/60" : "border-border"}`}
                    />
                    <SkillFieldError message={formErrors.instructions} />
                  </label>
                </div>
              )}

              {formStep === "dependencies" && (
                <div className="space-y-4">
                  <SectionHeading title="Dependencies" detail="Gate this skill so it only loads when dependencies are available." />
                  <label className="block">
                    <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">Required binaries</span>
                    <input
                      value={dependencyText.bins}
                      onChange={(event) => {
                        setDependencyText((current) => ({ ...current, bins: event.target.value }));
                        updateDraft({ requiresBins: splitList(event.target.value) });
                      }}
                      placeholder="jq, docker, gh (comma-separated)"
                      className="h-9 w-full rounded-xl border border-border bg-surface-low/45 px-3 font-mono text-[11px] text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-primary/50"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">Required environment variables</span>
                    <input
                      value={dependencyText.env}
                      onChange={(event) => {
                        setDependencyText((current) => ({ ...current, env: event.target.value }));
                        updateDraft({ requiresEnv: splitList(event.target.value) });
                      }}
                      placeholder="API_KEY, TOKEN (comma-separated)"
                      className="h-9 w-full rounded-xl border border-border bg-surface-low/45 px-3 font-mono text-[11px] text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-primary/50"
                    />
                  </label>
                  <div>
                    <span className="mb-2 block text-[11px] font-semibold text-text-secondary">Platform</span>
                    <div className="flex flex-wrap gap-2">
                      {PLATFORM_OPTIONS.map((platform) => {
                        const active = draft.os.includes(platform.id);
                        return (
                          <button
                            key={platform.id}
                            type="button"
                            onClick={() => updateDraft({ os: active ? draft.os.filter((item) => item !== platform.id) : [...draft.os, platform.id] })}
                            className={`h-8 rounded-lg border px-3 text-[11px] font-medium transition-colors ${active ? "border-primary bg-primary/15 text-primary" : "border-border bg-surface-low/45 text-text-secondary hover:border-border-strong hover:text-foreground"}`}
                          >
                            {platform.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {mode === "ai" && (
            <div className="space-y-3">
              <div>
                <h3 className="text-[13px] font-semibold text-foreground">Describe your skill</h3>
                <p className="mt-1 text-[11px] leading-snug text-text-muted">This uses a deterministic local generator for now, not a model call.</p>
              </div>
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={generating} rows={4} placeholder="I want a skill that checks website health using curl..." className="w-full rounded-lg border border-border bg-surface-low/45 px-2.5 py-2 text-xs leading-snug text-foreground outline-none placeholder:text-text-muted focus:border-warning/60 disabled:opacity-60" />
              <div className="flex flex-wrap gap-2">
                {["Check website health", "Search GitHub repos", "Get weather forecasts", "Run Docker containers"].map((example) => (
                  <button key={example} type="button" disabled={generating} onClick={() => setPrompt(example)} className="rounded-full border border-border bg-surface-low/35 px-2.5 py-1 text-[10px] text-text-muted transition-colors hover:text-foreground disabled:opacity-50">
                    {example}
                  </button>
                ))}
              </div>
              {generating && (
                <div role="status" aria-label="Generating skill preview" aria-live="polite" className="flex items-center gap-2 rounded-xl border border-warning/25 bg-warning/10 px-3 py-2 text-[11px] font-medium text-warning">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Generating skill preview with the local draft builder...
                </div>
              )}
            </div>
          )}

          {mode === "preview" && <SkillMarkdownPreview content={activeGenerated.content} />}
          {error && <p className="mt-4 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">{error}</p>}
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={() => {
              if (mode === "choose") onClose();
              else if (mode === "form") handleFormBack();
              else if (mode === "preview") handlePreviewEdit();
              else setMode("choose");
            }}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-3 text-xs font-medium text-text-secondary transition-colors hover:text-foreground"
          >
            {mode === "preview" ? <RotateCcw className="h-3.5 w-3.5" /> : mode === "choose" ? <X className="h-3.5 w-3.5" /> : <ArrowLeft className="h-3.5 w-3.5" />}
            {mode === "choose" ? "Cancel" : mode === "preview" ? "Edit" : mode === "form" && formStep !== "identity" ? "Previous" : "Back"}
          </button>
          {mode === "form" ? (
            <button type="button" onClick={formStep === "dependencies" ? handlePreview : handleFormNext} className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground">
              {formStep === "dependencies" ? "Preview" : "Next"} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : mode === "ai" ? (
            <button type="button" onClick={handleGenerate} disabled={!prompt.trim() || generating} className="inline-flex h-8 items-center gap-1 rounded-lg bg-warning px-3 text-xs font-semibold text-background disabled:opacity-45">
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {generating ? "Generating" : "Generate Skill"}
            </button>
          ) : mode === "preview" ? (
            <button type="button" onClick={handleSave} disabled={saving} className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-45">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Save Skill
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}

async function importItemFromFile(file: File): Promise<SkillImportItem | null> {
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".zip")) {
    return { id: relativePath, name: file.name, type: "zip", fileCount: 1, mocked: true };
  }
  if (!lower.endsWith(".md") && !lower.endsWith(".txt")) return null;
  const content = await readFileAsText(file);
  return { id: relativePath, name: file.name, type: "file", content, fileCount: 1, mocked: true };
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
  const readItems = (await Promise.all(files.map(importItemFromFile))).filter(Boolean) as SkillImportItem[];
  const grouped = new Map<string, SkillImportFile[]>();
  const standalone: SkillImportItem[] = [];

  for (const item of readItems) {
    const path = item.id;
    if (path.includes("/") && item.type !== "zip") {
      const root = path.split("/")[0] || item.name;
      grouped.set(root, [...(grouped.get(root) ?? []), { name: item.name, path, content: item.content }]);
    } else {
      standalone.push(item);
    }
  }

  const folderItems = Array.from(grouped.entries()).map(([name, files]) => ({
    id: name,
    name,
    type: "folder" as const,
    files,
    fileCount: files.length,
    mocked: true,
  }));

  return [...standalone, ...folderItems];
}

export function SkillsImportModal({
  open,
  onClose,
  onImport,
  notice,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (items: SkillImportItem[]) => Promise<void> | void;
  notice?: React.ReactNode;
}) {
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const folderInputRef = React.useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [items, setItems] = React.useState<SkillImportItem[]>([]);
  const [importing, setImporting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setDragging(false);
      setItems([]);
      setImporting(false);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const addFiles = async (fileList: FileList | File[]) => {
    const nextItems = await importItemsFromFiles(Array.from(fileList));
    setItems((current) => {
      const byId = new Map(current.map((item) => [item.id, item]));
      nextItems.forEach((item) => byId.set(item.id, item));
      return Array.from(byId.values());
    });
  };

  const handleImport = async () => {
    if (items.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      await onImport(items);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to import skills.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button type="button" aria-label="Close import skill" onClick={onClose} className="absolute inset-0 cursor-default bg-background/70 backdrop-blur-sm" />
      <section role="dialog" aria-modal="true" aria-labelledby="import-skill-title" className="relative flex max-h-[90vh] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-3">
          <div>
            <h2 id="import-skill-title" className="text-sm font-semibold text-foreground">Import Skill</h2>
            <p className="mt-0.5 text-[11px] leading-snug text-text-muted">Upload files, folders, or a ZIP archive.</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-low hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {notice && <div className="mb-3 rounded-xl border border-primary/25 bg-primary/10 px-3 py-2 text-[11px] leading-snug text-primary">{notice}</div>}
          <div
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
            onDrop={(event) => { event.preventDefault(); setDragging(false); void addFiles(event.dataTransfer.files); }}
            className={`rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors ${dragging ? "border-primary bg-primary/10" : "border-border bg-surface-low/25"}`}
          >
            <Upload className={`mx-auto mb-2.5 h-7 w-7 ${dragging ? "text-primary" : "text-text-muted"}`} />
            <p className="text-[13px] font-semibold text-foreground">Drop skill files here</p>
            <p className="mt-1 text-[11px] leading-snug text-text-muted">Supports .md, .txt, folders, and .zip archives.</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button type="button" onClick={() => fileInputRef.current?.click()} className="rounded-lg border border-border bg-background/60 px-2.5 py-1.5 text-[11px] font-semibold text-foreground transition-colors hover:border-border-strong">
                Browse files
              </button>
              <button type="button" onClick={() => folderInputRef.current?.click()} className="rounded-lg border border-border bg-background/60 px-2.5 py-1.5 text-[11px] font-semibold text-foreground transition-colors hover:border-border-strong">
                Browse folder
              </button>
            </div>
            <input ref={fileInputRef} type="file" multiple accept=".md,.txt,.zip" onChange={(event) => { if (event.target.files) void addFiles(event.target.files); event.currentTarget.value = ""; }} className="hidden" />
            <input ref={folderInputRef} type="file" multiple onChange={(event) => { if (event.target.files) void addFiles(event.target.files); event.currentTarget.value = ""; }} className="hidden" {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} />
          </div>

          {items.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {items.map((item) => {
                const Icon = item.type === "folder" ? FolderOpen : item.type === "zip" ? FileArchive : FileText;
                return (
                  <div key={item.id} className="flex items-center gap-2.5 rounded-xl border border-border bg-surface-low/35 px-3 py-2">
                    <Icon className="h-4 w-4 shrink-0 text-text-muted" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold leading-tight text-foreground">{item.name}</p>
                      <p className="text-[10px] leading-tight text-text-muted">{item.type === "zip" ? "ZIP archive - mocked" : item.type === "folder" ? `${item.fileCount ?? 0} file(s)` : "Skill file"}</p>
                    </div>
                    <button type="button" onClick={() => setItems((current) => current.filter((candidate) => candidate.id !== item.id))} className="text-text-muted transition-colors hover:text-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {error && <p className="mt-3 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-[11px] leading-snug text-error">{error}</p>}
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-3">
          <span className="text-[11px] text-text-muted">{items.length > 0 ? `${items.length} item(s) ready` : "No items selected"}</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="h-8 rounded-lg border border-border px-3 text-xs font-medium text-text-secondary transition-colors hover:text-foreground">Cancel</button>
            <button type="button" onClick={handleImport} disabled={items.length === 0 || importing} className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-45">
              {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Import{items.length > 0 ? ` (${items.length})` : ""}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

export const skillCardBadgeIcons = {
  scripts: Wrench,
  references: FileText,
  assets: PackageCheck,
};
