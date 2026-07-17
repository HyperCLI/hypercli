"use client";

import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  FileText,
  Loader2,
  RotateCcw,
  Sparkles,
  TestTube2,
  X,
} from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmojiIconPicker,
} from "@hypercli/shared-ui";
import {
  SkillConfirmationPanel,
  SkillMarkdownEditor,
  type SkillConfirmationAction,
} from "@hypercli/shared-ui/skills";

import {
  draftToGeneratedSkill,
  type SkillConfirmationCallback,
  type SkillDraftData,
  type SkillGeneratedOutput,
} from "./skill-authoring";

const SKILL_EMOJI_ICON_OPTIONS = [
  { value: "\u{1F527}", label: "Wrench" },
  { value: "\u2699\uFE0F", label: "Gear" },
  { value: "\u{1F4CA}", label: "Chart" },
  { value: "\u{1F4AC}", label: "Chat" },
  { value: "\u{1F419}", label: "Octopus" },
  { value: "\u2614", label: "Umbrella" },
  { value: "\u{1F9ED}", label: "Compass" },
  { value: "\u{1F50D}", label: "Search" },
  { value: "\u{1F4C1}", label: "Folder" },
  { value: "\u{1F3A8}", label: "Palette" },
  { value: "\u26A1", label: "Lightning" },
  { value: "\u{1F6E0}\uFE0F", label: "Tools" },
  { value: "\u{1F4CB}", label: "Clipboard" },
  { value: "\u{1F916}", label: "Robot" },
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

type SkillCreateMode = "choose" | "form" | "ai" | "preview" | "confirmation";
type SkillFormStep = "identity" | "instructions" | "dependencies";
type SkillFormErrors = Partial<Record<"name" | "description" | "homepage" | "instructions", string>>;

const STRUCTURED_FORM_STEPS: Array<{ id: SkillFormStep; label: string }> = [
  { id: "identity", label: "Identity" },
  { id: "instructions", label: "Instructions" },
  { id: "dependencies", label: "Dependencies" },
];

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function splitList(value: string): string[] {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

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
  if (step === "instructions" && !draft.instructions.trim()) errors.instructions = "Instructions are required.";
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
                complete ? "bg-primary text-primary-foreground" : active ? "bg-foreground text-background" : "bg-surface-high text-text-muted"
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

function CreateChoice({ icon: Icon, title, detail, tone = "neutral", disabled = false, onClick }: { icon: React.ElementType; title: string; detail: string; tone?: "neutral" | "ai"; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        tone === "ai" ? "border-warning/35 bg-warning/10 hover:border-warning/55" : "border-border bg-surface-low/35 hover:border-border-strong hover:bg-surface-low/60"
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

export interface SkillsCreateModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (skill: SkillGeneratedOutput) => Promise<void> | void;
  notice?: React.ReactNode;
  renderPreview?: (content: string) => React.ReactNode;
  confirmationTitle?: React.ReactNode;
  confirmationDescription?: React.ReactNode;
  onActivate?: SkillConfirmationCallback<SkillGeneratedOutput>;
  onTest?: SkillConfirmationCallback<SkillGeneratedOutput>;
  onKeepPreview?: SkillConfirmationCallback<SkillGeneratedOutput>;
  keepPreviewLabel?: string;
  activateLabel?: string;
  onGenerate?: (description: string, signal: AbortSignal) => Promise<SkillDraftData>;
}

export function SkillsCreateModal(props: SkillsCreateModalProps) {
  if (!props.open) return null;
  return <SkillsCreateModalContent {...props} />;
}

function SkillsCreateModalContent({
  open,
  onClose,
  onSave,
  notice,
  renderPreview,
  confirmationTitle,
  confirmationDescription,
  onActivate,
  onTest,
  onKeepPreview,
  keepPreviewLabel,
  activateLabel,
  onGenerate,
}: SkillsCreateModalProps) {
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
  const [testing, setTesting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savedSkill, setSavedSkill] = React.useState<SkillGeneratedOutput | null>(null);
  const [confirmationAction, setConfirmationAction] = React.useState<SkillConfirmationAction | null>(null);
  const generationAbortRef = React.useRef<AbortController | null>(null);
  const draftPersistedRef = React.useRef(false);
  const operationRef = React.useRef(0);

  React.useEffect(() => () => {
    operationRef.current += 1;
    generationAbortRef.current?.abort();
  }, []);

  const handleClose = React.useCallback(() => {
    operationRef.current += 1;
    generationAbortRef.current?.abort();
    generationAbortRef.current = null;
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
    setTesting(false);
    setError(null);
    setSavedSkill(null);
    setConfirmationAction(null);
    draftPersistedRef.current = false;
    onClose();
  }, [onClose]);

  const updateDraft = (patch: Partial<SkillDraftData>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
    setFormErrors((current) => {
      const next = { ...current };
      Object.keys(patch).forEach((key) => delete next[key as keyof SkillFormErrors]);
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
    draftPersistedRef.current = false;
    setError(null);
    setMode("preview");
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || generating) return;
    if (!onGenerate) {
      setError("Skill generation is unavailable until the agent chat is ready.");
      return;
    }
    const operation = ++operationRef.current;
    const controller = new AbortController();
    generationAbortRef.current?.abort();
    generationAbortRef.current = controller;
    setGenerating(true);
    setError(null);
    try {
      const nextDraft = await onGenerate(prompt.trim(), controller.signal);
      if (operation !== operationRef.current) return;
      setDraft(nextDraft);
      setDependencyText({ bins: nextDraft.requiresBins.join(", "), env: nextDraft.requiresEnv.join(", ") });
      setGenerated(draftToGeneratedSkill(nextDraft));
      setPreviewSource("ai");
      draftPersistedRef.current = false;
      setMode("preview");
    } catch (cause) {
      if (operation !== operationRef.current || controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "Failed to generate skill.");
    } finally {
      if (operation === operationRef.current) {
        setGenerating(false);
        generationAbortRef.current = null;
      }
    }
  };

  const cancelGeneration = () => {
    operationRef.current += 1;
    generationAbortRef.current?.abort();
    generationAbortRef.current = null;
    setGenerating(false);
    setMode("choose");
  };

  const handlePreviewEdit = () => {
    setError(null);
    setMode(previewSource === "form" ? "form" : "ai");
    if (previewSource === "form") setFormStep("dependencies");
  };

  const handleSave = async () => {
    const operation = ++operationRef.current;
    setSaving(true);
    setError(null);
    try {
      if (!draftPersistedRef.current) {
        await onSave(activeGenerated);
        draftPersistedRef.current = true;
      }
      if (operation !== operationRef.current) return;
      if (onActivate || onTest || onKeepPreview) {
        setSavedSkill(activeGenerated);
        setMode("confirmation");
      } else {
        handleClose();
      }
    } catch (cause) {
      if (operation !== operationRef.current) return;
      setError(cause instanceof Error ? cause.message : "Failed to save skill.");
    } finally {
      if (operation === operationRef.current) setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!onTest || testing) return;
    const operation = ++operationRef.current;
    setTesting(true);
    setError(null);
    try {
      if (!draftPersistedRef.current) {
        await onSave(activeGenerated);
        draftPersistedRef.current = true;
      }
      if (operation !== operationRef.current) return;
      await onTest(activeGenerated);
      if (operation !== operationRef.current) return;
      handleClose();
    } catch (cause) {
      if (operation !== operationRef.current) return;
      setError(cause instanceof Error ? cause.message : "Failed to test skill.");
    } finally {
      if (operation === operationRef.current) setTesting(false);
    }
  };

  const handleConfirmation = async (action: SkillConfirmationAction) => {
    if (!savedSkill) return;
    const operation = ++operationRef.current;
    const callback = action === "activate" ? onActivate : action === "test" ? onTest : onKeepPreview;
    setConfirmationAction(action);
    setError(null);
    try {
      await callback?.(savedSkill);
      if (operation !== operationRef.current) return;
      handleClose();
    } catch (cause) {
      if (operation !== operationRef.current) return;
      setError(cause instanceof Error ? cause.message : `Failed to ${action === "keep-preview" ? "keep the preview" : action} skill.`);
    } finally {
      if (operation === operationRef.current) setConfirmationAction(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) handleClose(); }}>
      <DialogContent closeLabel="Close create skill" overlayClassName="z-[79] bg-background/70 backdrop-blur-sm" className="z-[80] flex max-h-[calc(100dvh-2rem)] w-full flex-col gap-0 overflow-hidden rounded-2xl border-border bg-background p-0 shadow-2xl sm:max-w-[600px]">
        <DialogHeader className="gap-0 border-b border-border px-5 py-3 pr-12 text-left">
          <DialogTitle className="text-sm leading-normal text-foreground">
            {mode === "choose" ? "Create Skill" : mode === "form" ? "Structured Form" : mode === "ai" ? "Describe with AI" : mode === "preview" ? "Preview SKILL.md" : "Skill ready"}
          </DialogTitle>
          <DialogDescription className="mt-0.5 text-[11px] leading-snug text-text-muted">
            {mode === "choose" ? "Choose how to draft a skill." : mode === "form" ? "Build step-by-step with full control" : mode === "preview" ? "Review the generated instruction pack." : mode === "confirmation" ? "Choose what to do with the draft." : "This flow creates a local preview only."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {notice && mode !== "form" && mode !== "confirmation" && <div className="mb-3 rounded-xl border border-primary/25 bg-primary/10 px-3 py-2 text-[11px] leading-snug text-primary">{notice}</div>}
          {mode === "choose" && (
            <div className="space-y-2.5">
              <CreateChoice icon={FileText} title="Structured Form" detail="Build a skill with explicit metadata, dependencies, templates, and markdown preview." onClick={() => { setMode("form"); setFormStep("identity"); }} />
              <CreateChoice
                icon={Sparkles}
                title="Describe with AI"
                detail={onGenerate ? "Describe what you want. Your agent creates a temporary-session draft for review." : "Connect to the agent to generate a temporary-session draft."}
                tone="ai"
                disabled={!onGenerate}
                onClick={() => setMode("ai")}
              />
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
                    <input value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} placeholder="github-helper" className={`h-9 w-full rounded-xl border bg-surface-low/45 px-3 font-mono text-xs text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-primary/50 ${formErrors.name ? "border-error/60" : "border-border"}`} />
                    <span className="mt-1 block text-[10px] text-text-muted">Lowercase letters, digits, and hyphens only.</span>
                    <SkillFieldError message={formErrors.name} />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">Description <span className="text-error">*</span></span>
                    <textarea value={draft.description} onChange={(event) => updateDraft({ description: event.target.value })} rows={4} placeholder="What this skill does and when the agent should use it." className={`w-full rounded-xl border bg-surface-low/45 px-3 py-2 text-xs leading-snug text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-primary/50 ${formErrors.description ? "border-error/60" : "border-border"}`} />
                    <SkillFieldError message={formErrors.description} />
                  </label>
                  <div className="grid gap-4 sm:grid-cols-[260px_minmax(0,1fr)]">
                    <div>
                      <span className="mb-2 block text-[11px] font-semibold text-text-secondary">Emoji</span>
                      <EmojiIconPicker selectedIcon={draft.emoji} onSelectIcon={(emoji) => updateDraft({ emoji })} options={SKILL_EMOJI_ICON_OPTIONS} ariaLabel="Skill emoji" />
                    </div>
                    <label className="block">
                      <span className="mb-2 block text-[11px] font-semibold text-text-secondary">Homepage (optional)</span>
                      <input value={draft.homepage} onChange={(event) => updateDraft({ homepage: event.target.value })} placeholder="https://..." className={`h-9 w-full rounded-xl border bg-surface-low/45 px-3 text-xs text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-primary/50 ${formErrors.homepage ? "border-error/60" : "border-border"}`} />
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
                        <button key={template.id} type="button" onClick={() => updateDraft({ instructions: template.content })} className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${active ? "border-primary/60 bg-primary/10" : "border-border bg-surface-low/35 hover:border-border-strong hover:bg-surface-high"}`}>
                          <span className="block text-xs font-semibold text-foreground">{template.name}</span>
                          <span className="mt-0.5 block text-[10px] leading-snug text-text-muted">{template.description}</span>
                        </button>
                      );
                    })}
                  </div>
                  <SkillMarkdownEditor value={draft.instructions} onChange={(instructions) => updateDraft({ instructions })} showActions={false} dirty={false} title="Instructions.md" renderPreview={renderPreview} className={formErrors.instructions ? "border-error/60" : undefined} />
                  <SkillFieldError message={formErrors.instructions} />
                </div>
              )}

              {formStep === "dependencies" && (
                <div className="space-y-4">
                  <SectionHeading title="Dependencies" detail="Gate this skill so it only loads when dependencies are available." />
                  <label className="block">
                    <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">Required binaries</span>
                    <input value={dependencyText.bins} onChange={(event) => { setDependencyText((current) => ({ ...current, bins: event.target.value })); updateDraft({ requiresBins: splitList(event.target.value) }); }} placeholder="jq, docker, gh (comma-separated)" className="h-9 w-full rounded-xl border border-border bg-surface-low/45 px-3 font-mono text-[11px] text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-primary/50" />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">Required environment variables</span>
                    <input value={dependencyText.env} onChange={(event) => { setDependencyText((current) => ({ ...current, env: event.target.value })); updateDraft({ requiresEnv: splitList(event.target.value) }); }} placeholder="API_KEY, TOKEN (comma-separated)" className="h-9 w-full rounded-xl border border-border bg-surface-low/45 px-3 font-mono text-[11px] text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-primary/50" />
                  </label>
                </div>
              )}
            </div>
          )}

          {mode === "ai" && (
            <div className="space-y-3">
              <div>
                <h3 className="text-[13px] font-semibold text-foreground">Describe your skill</h3>
                <p className="mt-1 text-[11px] leading-snug text-text-muted">Your agent uses a temporary session to create a structured draft. You review everything before saving.</p>
              </div>
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={generating} rows={4} placeholder="I want a skill that checks website health using curl..." className="w-full rounded-lg border border-border bg-surface-low/45 px-2.5 py-2 text-xs leading-snug text-foreground outline-none placeholder:text-text-muted focus:border-warning/60 disabled:opacity-60" />
              <div className="flex flex-wrap gap-2">
                {["Check website health", "Search GitHub repos", "Get weather forecasts", "Run Docker containers"].map((example) => (
                  <button key={example} type="button" disabled={generating} onClick={() => setPrompt(example)} className="rounded-full border border-border bg-surface-low/35 px-2.5 py-1 text-[10px] text-text-muted transition-colors hover:bg-surface-high hover:text-foreground disabled:opacity-50">{example}</button>
                ))}
              </div>
              {generating && (
                <div role="status" aria-label="Generating your skill" aria-live="polite" className="flex items-center gap-2 rounded-xl border border-warning/25 bg-warning/10 px-3 py-2 text-[11px] font-medium text-warning">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Generating your skill...
                </div>
              )}
            </div>
          )}

          {mode === "preview" && (
            <SkillMarkdownEditor
              value={activeGenerated.content}
              readOnly
              showActions={false}
              defaultMode="preview"
              title="Generated SKILL.md"
              renderPreview={renderPreview}
            />
          )}
           {mode === "confirmation" && savedSkill && (
              <SkillConfirmationPanel title={confirmationTitle ?? `${savedSkill.name} is ready`} description={confirmationDescription ?? "Save the skill to the agent, test it first, or keep it as a preview."} activateLabel={activateLabel} onActivate={onActivate ? () => void handleConfirmation("activate") : undefined} onTest={onTest ? () => void handleConfirmation("test") : undefined} onKeepPreview={() => void handleConfirmation("keep-preview")} keepPreviewLabel={keepPreviewLabel} pendingAction={confirmationAction} error={error} />
           )}
          {error && mode !== "confirmation" && <p className="mt-4 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">{error}</p>}
        </div>

        {mode !== "confirmation" && <footer className={mode === "preview" ? `grid shrink-0 gap-2 border-t border-border px-5 py-3 ${previewSource === "ai" && onTest ? "grid-cols-3" : "grid-cols-2"}` : "flex shrink-0 flex-col-reverse items-stretch gap-2 border-t border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between"}>
          <button type="button" onClick={() => { if (mode === "choose") handleClose(); else if (mode === "form") handleFormBack(); else if (mode === "preview") handlePreviewEdit(); else cancelGeneration(); }} className={`inline-flex h-8 w-full items-center justify-center gap-1 rounded-lg border border-border px-3 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-high hover:text-foreground ${mode === "preview" ? "" : "sm:w-auto"}`}>
            {mode === "preview" ? <RotateCcw className="h-3.5 w-3.5" /> : mode === "choose" ? <X className="h-3.5 w-3.5" /> : <ArrowLeft className="h-3.5 w-3.5" />}
            {mode === "choose" ? "Cancel" : mode === "preview" ? "Edit" : mode === "form" && formStep !== "identity" ? "Previous" : "Back"}
          </button>
          {mode === "form" ? (
            <button type="button" onClick={formStep === "dependencies" ? handlePreview : handleFormNext} className="inline-flex h-8 w-full items-center justify-center gap-1 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover sm:w-auto">
              {formStep === "dependencies" ? "Preview" : "Next"} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : mode === "ai" ? (
            <button type="button" onClick={handleGenerate} disabled={!prompt.trim() || generating} className="inline-flex h-8 w-full items-center justify-center gap-1 rounded-lg bg-warning px-3 text-xs font-semibold text-background transition-colors hover:bg-warning/90 disabled:opacity-45 sm:w-auto">
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {generating ? "Generating" : "Generate Skill"}
            </button>
          ) : mode === "preview" ? (
            <div className="contents">
              {previewSource === "ai" && onTest ? (
                <button type="button" onClick={() => void handleTest()} disabled={saving || testing} className="inline-flex h-8 w-full items-center justify-center gap-1 rounded-lg border border-border px-3 text-xs font-semibold text-text-secondary transition-colors hover:bg-surface-high hover:text-foreground disabled:opacity-45">
                  {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TestTube2 className="h-3.5 w-3.5" />}
                  {testing ? "Starting..." : "Test"}
                </button>
              ) : null}
              <button type="button" onClick={() => void handleSave()} disabled={saving || testing} className="inline-flex h-8 w-full items-center justify-center gap-1 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-45">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Save Skill
              </button>
            </div>
          ) : null}
        </footer>}
      </DialogContent>
    </Dialog>
  );
}
