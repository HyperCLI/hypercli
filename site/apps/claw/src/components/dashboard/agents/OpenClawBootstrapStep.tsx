"use client";

import React from "react";
import { Check, FileText, LoaderCircle, RefreshCw } from "lucide-react";
import {
  OPENCLAW_BOOTSTRAP_REQUIRED_FILES,
  buildDeterministicOpenClawBootstrapPack,
  createOpenClawBootstrapDraft,
  type OpenClawBootstrapDraft,
  type OpenClawBootstrapFileName,
  type OpenClawBootstrapInputs,
} from "@/lib/openclaw-bootstrap-pack";

interface OpenClawBootstrapStepProps {
  agentName: string;
  draft: OpenClawBootstrapDraft | null;
  onChange: (draft: OpenClawBootstrapDraft) => void;
  onGenerate?: (inputs: OpenClawBootstrapInputs) => Promise<OpenClawBootstrapDraft["files"]>;
}

const FILE_LABELS: Record<OpenClawBootstrapFileName, string> = {
  "AGENTS.md": "Operating instructions",
  "SOUL.md": "Voice and boundaries",
  "USER.md": "User context",
  "MEMORY.md": "Curated starting memory",
};

function newDraft(agentName: string, inputs?: Partial<OpenClawBootstrapInputs>): OpenClawBootstrapDraft {
  return createOpenClawBootstrapDraft(agentName, inputs);
}

export function OpenClawBootstrapStep({
  agentName,
  draft,
  onChange,
  onGenerate,
}: OpenClawBootstrapStepProps) {
  const [activeFile, setActiveFile] = React.useState<OpenClawBootstrapFileName>("AGENTS.md");
  const [generatingIndex, setGeneratingIndex] = React.useState(0);
  const [generationPending, setGenerationPending] = React.useState(false);
  const [usingFallback, setUsingFallback] = React.useState(false);
  const initialGenerationStartedRef = React.useRef(false);
  const generationRequestRef = React.useRef(0);
  const effectiveDraft = draft ?? newDraft(agentName);
  const generationNames = effectiveDraft.inputs.includeMemory && effectiveDraft.inputs.memoryNotes.trim()
    ? [...OPENCLAW_BOOTSTRAP_REQUIRED_FILES, "MEMORY.md" as const]
    : [...OPENCLAW_BOOTSTRAP_REQUIRED_FILES];

  React.useEffect(() => {
    if (generatingIndex < 0) return;
    const timeout = window.setTimeout(() => {
      if (generatingIndex >= generationNames.length - 1) {
        if (generationPending) return;
        if (!draft) onChange(newDraft(agentName));
        setGeneratingIndex(-1);
      } else {
        setGeneratingIndex((current) => current + 1);
      }
    }, 320);
    return () => window.clearTimeout(timeout);
  }, [agentName, draft, generatingIndex, generationNames.length, generationPending, onChange]);

  const runAssistedGeneration = React.useCallback(async (rawInputs: OpenClawBootstrapInputs) => {
    const requestId = generationRequestRef.current + 1;
    generationRequestRef.current = requestId;
    const inputs = { ...rawInputs, agentName };
    const fallbackFiles = buildDeterministicOpenClawBootstrapPack(inputs);
    setGeneratingIndex(0);
    setGenerationPending(Boolean(onGenerate));
    setUsingFallback(false);
    onChange({
      ...effectiveDraft,
      inputs,
      files: fallbackFiles,
      generationSource: "deterministic",
    });
    if (!onGenerate) return;
    try {
      const files = await onGenerate(inputs);
      if (generationRequestRef.current !== requestId) return;
      onChange({
        ...effectiveDraft,
        inputs,
        files,
        generationSource: "model",
      });
    } catch {
      if (generationRequestRef.current !== requestId) return;
      setUsingFallback(true);
    } finally {
      if (generationRequestRef.current === requestId) setGenerationPending(false);
    }
  }, [agentName, effectiveDraft, onChange, onGenerate]);

  React.useEffect(() => {
    if (initialGenerationStartedRef.current) return;
    initialGenerationStartedRef.current = true;
    if (!onGenerate || effectiveDraft.generationSource === "model") return;
    void runAssistedGeneration(effectiveDraft.inputs);
  }, [effectiveDraft.generationSource, effectiveDraft.inputs, onGenerate, runAssistedGeneration]);

  React.useEffect(() => {
    if (!draft || draft.inputs.agentName === agentName) return;
    generationRequestRef.current += 1;
    setGenerationPending(false);
    onChange({
      ...draft,
      inputs: { ...draft.inputs, agentName },
      files: buildDeterministicOpenClawBootstrapPack({ ...draft.inputs, agentName }),
      generationSource: "deterministic",
    });
  }, [agentName, draft, onChange]);

  const updateInputs = (patch: Partial<OpenClawBootstrapInputs>) => {
    generationRequestRef.current += 1;
    setGenerationPending(false);
    const inputs = { ...effectiveDraft.inputs, ...patch, agentName };
    const files = buildDeterministicOpenClawBootstrapPack(inputs);
    if (!files.some((file) => file.name === activeFile)) setActiveFile("AGENTS.md");
    onChange({ ...effectiveDraft, inputs, files, generationSource: "deterministic" });
  };

  const regenerate = () => {
    void runAssistedGeneration(effectiveDraft.inputs);
  };

  const selectedFile = effectiveDraft.files.find((file) => file.name === activeFile)
    ?? effectiveDraft.files[0];

  return (
    <div className="grid min-h-0 gap-4 md:grid-cols-[minmax(240px,0.9fr)_minmax(300px,1.1fr)]">
      <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <div className="rounded-[14px] border border-border bg-surface-high p-4">
          <p className="text-[13px] font-semibold text-foreground">Shape the agent</p>
          <p className="mt-1 text-[11px] leading-4 text-text-muted">
            These structured details become real OpenClaw workspace instructions. You can edit the generated files before launch.
          </p>
          {usingFallback ? (
            <p className="mt-2 text-[10px] leading-4 text-text-muted">
              Assisted generation was unavailable, so this preview uses the deterministic template.
            </p>
          ) : null}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <BootstrapField
              label="What should it help with?"
              value={effectiveDraft.inputs.purpose}
              onChange={(purpose) => updateInputs({ purpose })}
              multiline
            />
            <BootstrapField
              label="Voice and tone"
              value={effectiveDraft.inputs.tone}
              onChange={(tone) => updateInputs({ tone })}
              multiline
            />
            <BootstrapField
              label="Your name"
              value={effectiveDraft.inputs.userName}
              onChange={(userName) => updateInputs({ userName })}
              placeholder="Optional"
            />
            <BootstrapField
              label="Timezone"
              value={effectiveDraft.inputs.timezone}
              onChange={(timezone) => updateInputs({ timezone })}
              placeholder="e.g. America/New_York"
            />
            <BootstrapField
              label="Company / role"
              value={effectiveDraft.inputs.companyRole}
              onChange={(companyRole) => updateInputs({ companyRole })}
              placeholder="Optional"
            />
            <BootstrapField
              label="Response style"
              value={effectiveDraft.inputs.responseStyle}
              onChange={(responseStyle) => updateInputs({ responseStyle })}
              multiline
            />
          </div>
          <BootstrapField
            label="Local tool notes"
            value={effectiveDraft.inputs.toolsNotes}
            onChange={(toolsNotes) => updateInputs({ toolsNotes })}
            placeholder="Accounts, systems, or environment details the agent should know"
            multiline
            className="mt-3"
          />
          <label className="mt-4 flex items-start gap-2.5 rounded-[11px] border border-border bg-background px-3 py-3">
            <input
              type="checkbox"
              checked={effectiveDraft.inputs.includeMemory}
              onChange={(event) => updateInputs({ includeMemory: event.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-border accent-[var(--button-primary)]"
            />
            <span>
              <span className="block text-[12px] font-semibold text-foreground">Add starting memory</span>
              <span className="mt-0.5 block text-[10px] leading-4 text-text-muted">
                Only include durable, non-sensitive context. Memory may be visible in ordinary agent sessions.
              </span>
            </span>
          </label>
          {effectiveDraft.inputs.includeMemory ? (
            <BootstrapField
              label="Curated starting context"
              value={effectiveDraft.inputs.memoryNotes}
              onChange={(memoryNotes) => updateInputs({ memoryNotes })}
              placeholder="Decisions or context worth carrying forward—not a transcript"
              multiline
              className="mt-3"
            />
          ) : null}
        </div>
      </div>

      <div className="flex min-h-[360px] flex-col overflow-hidden rounded-[14px] border border-border bg-background">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-3">
          <div>
            <p className="text-[12px] font-semibold text-foreground">Workspace bootstrap pack</p>
            <p className="mt-0.5 text-[10px] text-text-muted">Canonical files, staged before the agent starts</p>
          </div>
          <button
            type="button"
            onClick={regenerate}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-border bg-surface-high px-2.5 text-[11px] font-semibold text-foreground hover:border-border-strong"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${generatingIndex >= 0 ? "animate-spin" : ""}`} />
            Regenerate
          </button>
        </div>

        <div className="border-b border-border bg-surface-low px-3 py-2">
          <div className="grid gap-1.5 sm:grid-cols-2">
            {generationNames.map((name, index) => {
              const busy = generatingIndex === index;
              const complete = generatingIndex < 0 || index < generatingIndex;
              return (
                <div key={name} className="flex items-center gap-2 rounded-[8px] px-2 py-1.5 text-[10px]">
                  {busy ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin text-selection-accent" />
                  ) : complete ? (
                    <Check className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 text-text-muted" />
                  )}
                  <span className={busy ? "font-semibold text-foreground" : "text-text-muted"}>
                    {busy ? `Generating ${name}` : name}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex gap-1 overflow-x-auto border-b border-border px-2 pt-2">
          {effectiveDraft.files.map((file) => (
            <button
              key={file.name}
              type="button"
              onClick={() => setActiveFile(file.name)}
              title={FILE_LABELS[file.name]}
              className={`shrink-0 rounded-t-[8px] border-x border-t px-2.5 py-2 font-mono text-[10px] ${
                selectedFile?.name === file.name
                  ? "border-border bg-surface-high text-foreground"
                  : "border-transparent text-text-muted hover:text-foreground"
              }`}
            >
              {file.name}
            </button>
          ))}
        </div>

        {selectedFile ? (
          <textarea
            aria-label={`${selectedFile.name} preview`}
            value={selectedFile.content}
            onChange={(event) => {
              generationRequestRef.current += 1;
              setGenerationPending(false);
              const files = effectiveDraft.files.map((file) => (
                file.name === selectedFile.name ? { ...file, content: event.target.value } : file
              ));
              onChange({ ...effectiveDraft, files });
            }}
            spellCheck={false}
            className="min-h-[220px] flex-1 resize-none bg-background p-4 font-mono text-[11px] leading-5 text-foreground outline-none"
          />
        ) : null}
      </div>
    </div>
  );
}

function BootstrapField({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
}) {
  const shared = "mt-1.5 w-full rounded-[9px] border border-border bg-background px-3 text-[11px] text-foreground outline-none placeholder:text-text-muted focus:border-border-strong";
  return (
    <label className={`block ${className}`}>
      <span className="text-[11px] font-semibold text-foreground">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          rows={3}
          className={`${shared} resize-y py-2 leading-4`}
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className={`${shared} h-9`}
        />
      )}
    </label>
  );
}
