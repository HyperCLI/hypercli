"use client";

import React from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { FilePreview, type FileEntry } from "@hypercli/shared-ui/files";
import { MarkdownContent } from "@/components/dashboard/chat/MarkdownContent";
import {
  buildDeterministicOpenClawBootstrapPack,
  createOpenClawBootstrapDraft,
  type OpenClawBootstrapDraft,
  type OpenClawBootstrapFileName,
  type OpenClawBootstrapInputs,
} from "@/lib/openclaw-bootstrap-pack";
import {
  isOpenClawBootstrapGenerationActive,
  type OpenClawBootstrapGenerationState,
} from "./openclaw-bootstrap-generation-machine";

interface OpenClawBootstrapStepProps {
  agentName: string;
  draft: OpenClawBootstrapDraft | null;
  onChange: (draft: OpenClawBootstrapDraft) => void;
  generation: OpenClawBootstrapGenerationState;
  onRegenerate: () => void;
  wide?: boolean;
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

function renderMarkdown(content: string, className?: string) {
  return <MarkdownContent content={content} className={className} />;
}

export function OpenClawBootstrapStep({
  agentName,
  draft,
  onChange,
  generation,
  onRegenerate,
  wide = false,
}: OpenClawBootstrapStepProps) {
  const [activeFile, setActiveFile] = React.useState<OpenClawBootstrapFileName>("AGENTS.md");
  const effectiveDraft = draft ?? newDraft(agentName);
  const generationActive = isOpenClawBootstrapGenerationActive(generation);

  React.useEffect(() => {
    if (!draft || draft.inputs.agentName === agentName) return;
    onChange({
      ...draft,
      inputs: { ...draft.inputs, agentName },
      files: buildDeterministicOpenClawBootstrapPack({ ...draft.inputs, agentName }),
      generationSource: "deterministic",
    });
  }, [agentName, draft, onChange]);

  const updateInputs = (patch: Partial<OpenClawBootstrapInputs>) => {
    const inputs = { ...effectiveDraft.inputs, ...patch, agentName };
    const files = buildDeterministicOpenClawBootstrapPack(inputs);
    if (!files.some((file) => file.name === activeFile)) setActiveFile("AGENTS.md");
    onChange({ ...effectiveDraft, inputs, files, generationSource: "deterministic" });
  };

  const selectedFile = effectiveDraft.files.find((file) => file.name === activeFile)
    ?? effectiveDraft.files[0];
  const selectedFileEntry: FileEntry | null = selectedFile
    ? { name: selectedFile.name, path: selectedFile.name, type: "file" }
    : null;

  return (
    <div
      data-slot="openclaw-bootstrap-step"
      className={`grid min-h-full gap-4 ${wide ? "xl:h-full xl:min-h-0 xl:grid-cols-[minmax(320px,0.9fr)_minmax(400px,1.1fr)] xl:grid-rows-[minmax(0,1fr)]" : ""}`}
    >
      <section data-slot="shape-agent-content" className={`min-h-0 rounded-[14px] border border-border bg-surface-high p-4 sm:p-5 ${wide ? "xl:overflow-y-auto" : ""}`}>
        <h3 className="text-[15px] font-semibold leading-5 text-foreground">Shape the agent</h3>
        <p className="mt-1.5 max-w-[58ch] text-[12px] leading-5 text-text-muted">
          Define its role and communication style. Add personal or work context only when it will improve the answers.
        </p>

        <div className={`mt-5 grid gap-x-4 gap-y-4 ${wide ? "md:grid-cols-2" : ""}`}>
          <BootstrapField
            label="What should this agent help you accomplish?"
            helper="Describe its main goals, recurring tasks, and important limits."
            value={effectiveDraft.inputs.purpose}
            onChange={(purpose) => updateInputs({ purpose })}
            multiline
            rows={3}
            className={wide ? "md:col-span-2" : ""}
          />
          <BootstrapField
            label="Tone of voice"
            helper="Direct, calm, warm, or another voice."
            value={effectiveDraft.inputs.tone}
            onChange={(tone) => updateInputs({ tone })}
            multiline
            rows={2}
          />
          <BootstrapField
            label="Response style"
            helper="Choose its usual length and structure."
            value={effectiveDraft.inputs.responseStyle}
            onChange={(responseStyle) => updateInputs({ responseStyle })}
            multiline
            rows={2}
          />
        </div>

        <details className="group mt-5 border-t border-border pt-4">
          <summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg py-1 outline-none focus-visible:ring-2 focus-visible:ring-selection-accent/45 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-foreground">Personal and work context</span>
              <span className="mt-0.5 block text-[11px] leading-4 text-text-muted">Optional details, tool notes, and starting memory.</span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-text-muted transition-transform group-open:rotate-180" />
          </summary>
          <div className={`mt-4 grid gap-4 ${wide ? "md:grid-cols-2" : ""}`}>
            <BootstrapField
              label="Preferred name"
              value={effectiveDraft.inputs.userName}
              onChange={(userName) => updateInputs({ userName })}
              placeholder="What should the agent call you?"
            />
            <BootstrapField
              label="Your time zone"
              value={effectiveDraft.inputs.timezone}
              onChange={(timezone) => updateInputs({ timezone })}
              placeholder="e.g. America/New_York"
            />
            <BootstrapField
              label="Company or role"
              value={effectiveDraft.inputs.companyRole}
              onChange={(companyRole) => updateInputs({ companyRole })}
              placeholder="Optional work context"
            />
            <BootstrapField
              label="Tools and environment"
              helper="Add useful systems, conventions, or access limits. Do not include passwords or secret keys."
              value={effectiveDraft.inputs.toolsNotes}
              onChange={(toolsNotes) => updateInputs({ toolsNotes })}
              placeholder="Systems or environment details the agent should know"
              multiline
              rows={2}
              className={wide ? "md:col-span-2" : ""}
            />
          </div>
          <label className="mt-4 flex items-start gap-2.5 border-t border-border pt-4">
            <input
              type="checkbox"
              checked={effectiveDraft.inputs.includeMemory}
              onChange={(event) => updateInputs({ includeMemory: event.target.checked })}
              className="mt-1 h-4 w-4 rounded border-border accent-[var(--button-primary)]"
            />
            <span>
              <span className="block text-[13px] font-semibold text-foreground">Create a starting memory file</span>
              <span className="mt-0.5 block text-[11px] leading-4 text-text-muted">
                Add durable, non-sensitive context. It may be visible during normal agent sessions.
              </span>
            </span>
          </label>
          {effectiveDraft.inputs.includeMemory ? (
            <BootstrapField
              label="What should it remember?"
              value={effectiveDraft.inputs.memoryNotes}
              onChange={(memoryNotes) => updateInputs({ memoryNotes })}
              placeholder="Important decisions or lasting context, not a transcript or activity log"
              multiline
              rows={3}
              className="mt-4"
            />
          ) : null}
        </details>
      </section>

      <section aria-label="Workspace file editor" className={`flex h-[400px] min-h-0 flex-col overflow-hidden rounded-[14px] border border-border bg-background ${wide ? "xl:h-auto" : ""}`}>
        <div className="flex min-w-0 items-end gap-2 border-b border-border px-2">
          <div className="flex min-w-0 flex-1 justify-start gap-1 overflow-x-auto pt-2" role="group" aria-label="Workspace files">
            {effectiveDraft.files.map((file) => (
              <button
                key={file.name}
                type="button"
                aria-pressed={selectedFile?.name === file.name}
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
          <button
            type="button"
            onClick={onRegenerate}
            className="mb-2 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border border-border bg-surface-high px-2.5 text-[11px] font-semibold text-foreground hover:border-border-strong"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${generationActive ? "animate-spin" : ""}`} />
            {generationActive ? "Restart generation" : "Regenerate files"}
          </button>
        </div>

        {selectedFile && selectedFileEntry ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <FilePreview
              key={selectedFile.name}
              entry={selectedFileEntry}
              content={selectedFile.content}
              loading={false}
              error={null}
              onClose={() => {}}
              showClose={false}
              onSave={async (_path, content) => {
                const files = effectiveDraft.files.map((file) => (
                  file.name === selectedFile.name ? { ...file, content } : file
                ));
                onChange({ ...effectiveDraft, files });
              }}
              renderMarkdown={renderMarkdown}
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}

function BootstrapField({
  label,
  helper,
  value,
  onChange,
  placeholder,
  multiline = false,
  rows = 3,
  className = "",
}: {
  label: string;
  helper?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  className?: string;
}) {
  const inputId = React.useId();
  const helperId = React.useId();
  const shared = "mt-2 w-full rounded-[9px] border border-border bg-background px-3 text-[12px] text-foreground outline-none placeholder:text-text-muted focus:border-border-strong";
  return (
    <div className={`block ${className}`}>
      <label htmlFor={inputId} className="text-[12px] font-semibold leading-4 text-foreground">{label}</label>
      {helper ? <span id={helperId} className="mt-1 block text-[11px] leading-4 text-text-muted">{helper}</span> : null}
      {multiline ? (
        <textarea
          id={inputId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          rows={rows}
          aria-describedby={helper ? helperId : undefined}
          className={`${shared} resize-y py-2.5 leading-5`}
        />
      ) : (
        <input
          id={inputId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-describedby={helper ? helperId : undefined}
          className={`${shared} h-10`}
        />
      )}
    </div>
  );
}
