"use client";

import React from "react";
import { ChevronDown } from "lucide-react";
import {
  buildDeterministicOpenClawBootstrapPack,
  createOpenClawBootstrapDraft,
  type OpenClawBootstrapDraft,
  type OpenClawBootstrapInputs,
} from "@/lib/openclaw-bootstrap-pack";

interface OpenClawBootstrapStepProps {
  agentName: string;
  draft: OpenClawBootstrapDraft | null;
  onChange: (draft: OpenClawBootstrapDraft) => void;
  stage: OpenClawBootstrapStage;
  wide?: boolean;
}

export type OpenClawBootstrapStage = "objective" | "personality";

const OBJECTIVE_EXAMPLES = [
  {
    label: "Build a product",
    description: "Turn an idea into working software.",
    value: "Build a product. Turn an idea into working software.",
  },
  {
    label: "Generate pipeline",
    description: "Find prospects and create qualified sales opportunities.",
    value: "Build me a pipeline of qualified enterprise prospects and start conversations with the right decision-makers.",
  },
  {
    label: "Run operations",
    description: "Keep projects, people, and priorities moving.",
    value: "Run operations. Keep projects, people, and priorities moving.",
  },
  {
    label: "Grow demand",
    description: "Create campaigns and uncover growth opportunities.",
    value: "Grow demand. Create campaigns and uncover growth opportunities.",
  },
  {
    label: "Analyze the business",
    description: "Turn data and information into insights and decisions.",
    value: "Analyze the business. Turn data and information into insights and decisions.",
  },
  {
    label: "Research a market",
    description: "Investigate an industry, competitors, and opportunities.",
    value: "Research a market. Investigate an industry, competitors, and opportunities.",
  },
] as const;

const PERSONALITY_EXAMPLES = [
  { label: "The Inventor", description: "Bold, technical, creative, and unconventional.", value: "Be bold, technical, creative, and unconventional." },
  { label: "The Detective", description: "Observant, skeptical, and relentless about finding the truth.", value: "Be observant, skeptical, and relentless about finding the truth." },
  { label: "The Closer", description: "Confident, persuasive, competitive, and outcome-driven.", value: "Be confident, persuasive, competitive, and outcome-driven." },
  { label: "The Operator", description: "Organized, proactive, and relentless about execution.", value: "Be a relentless operator who moves fast, challenges my assumptions, and does not need much hand-holding." },
  { label: "The Coach", description: "Positive, patient, motivating, and people-first.", value: "Be positive, patient, motivating, and people-first." },
  { label: "The Cynic", description: "Brilliant, independent, brutally direct, and skeptical of everything.", value: "Be brilliant, independent, brutally direct, and skeptical of everything." },
] as const;

function exampleClassName(selected: boolean) {
  return `min-h-[142px] min-w-0 rounded-[11px] border px-4 py-4 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-selection-accent/45 ${
    selected
      ? "border-selection-accent/60 bg-[rgb(var(--selection-accent-rgb)_/_0.12)] shadow-[inset_0_0_0_1px_rgb(var(--selection-accent-rgb)_/_0.08)]"
      : "border-border bg-background hover:border-border-strong hover:bg-[rgb(var(--selection-accent-rgb)_/_0.04)]"
  }`;
}

function newDraft(agentName: string, inputs?: Partial<OpenClawBootstrapInputs>): OpenClawBootstrapDraft {
  return createOpenClawBootstrapDraft(agentName, inputs);
}

export function OpenClawBootstrapStep({
  agentName,
  draft,
  onChange,
  stage,
  wide = false,
}: OpenClawBootstrapStepProps) {
  const effectiveDraft = draft ?? newDraft(agentName);

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
    onChange({ ...effectiveDraft, inputs, files, generationSource: "deterministic" });
  };

  return (
    <div
      data-slot="openclaw-bootstrap-step"
      className={`min-h-full ${wide ? "xl:h-full xl:min-h-0" : ""}`}
    >
      <section
        data-slot="shape-agent-content"
        data-workspace-stage={stage}
        className={`min-h-0 rounded-[14px] border border-border bg-surface-high p-4 sm:p-5 ${wide ? "xl:h-full xl:overflow-y-auto" : ""}`}
      >
        {stage === "objective" ? (
          <>
            <div className="min-w-0">
              <h3 className="text-[22px] font-semibold leading-7 tracking-[-0.02em] text-foreground">What do you want to get done?</h3>
              <p id="objective-helper" className="mt-1.5 max-w-[68ch] text-[13px] leading-5 text-text-muted">
                Give {agentName} an objective, project, or responsibility. It will figure out how to help make it happen. Be as specific or broad as you like; you can always refine it later.
              </p>
            </div>

            <div className="relative mt-5">
              <label htmlFor="agent-objective" className="sr-only">Role and outcome</label>
              <textarea
                id="agent-objective"
                value={effectiveDraft.inputs.purpose}
                onChange={(event) => updateInputs({ purpose: event.target.value })}
                maxLength={300}
                rows={5}
                aria-describedby="objective-helper objective-count"
                className="min-h-[146px] w-full resize-y rounded-[11px] border border-border bg-background px-3.5 py-3 pb-7 text-[13px] leading-5 text-foreground outline-none placeholder:text-text-muted focus:border-border-strong focus-visible:ring-2 focus-visible:ring-selection-accent/40"
              />
              <span id="objective-count" className="pointer-events-none absolute bottom-2 right-3 text-[10px] tabular-nums text-text-muted">{effectiveDraft.inputs.purpose.length}/300</span>
            </div>

            <div className="my-4 flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-border" />
              <span className="shrink-0 text-[9px] font-bold uppercase tracking-[0.12em] text-text-muted">Or start with an example</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <div role="group" aria-label="Objective examples" className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {OBJECTIVE_EXAMPLES.map((example) => {
                const selected = effectiveDraft.inputs.purpose.trim() === example.value;
                return (
                  <button
                    key={example.label}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => updateInputs({ purpose: example.value })}
                    className={exampleClassName(selected)}
                  >
                    <strong className="block break-words text-[14px] font-semibold leading-5 text-foreground">{example.label}</strong>
                    <span className="mx-auto mt-2 block max-w-[27ch] break-words text-[11px] leading-4 text-text-muted">{example.description}</span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div className="min-w-0">
              <h3 className="text-[22px] font-semibold leading-7 tracking-[-0.02em] text-foreground">How should {agentName} approach the work?</h3>
              <p id="personality-helper" className="mt-1.5 max-w-[68ch] text-[13px] leading-5 text-text-muted">
                Describe how you want your teammate to think, communicate, make decisions, and get things done. Choose the closest starting style; you can always make it your own later.
              </p>
            </div>

            <div className="relative mt-5">
              <label htmlFor="agent-personality" className="sr-only">Working style</label>
              <textarea
                id="agent-personality"
                value={effectiveDraft.inputs.tone}
                onChange={(event) => updateInputs({ tone: event.target.value })}
                maxLength={300}
                rows={5}
                aria-describedby="personality-helper personality-count"
                className="min-h-[146px] w-full resize-y rounded-[11px] border border-border bg-background px-3.5 py-3 pb-7 text-[13px] leading-5 text-foreground outline-none placeholder:text-text-muted focus:border-border-strong focus-visible:ring-2 focus-visible:ring-selection-accent/40"
              />
              <span id="personality-count" className="pointer-events-none absolute bottom-2 right-3 text-[10px] tabular-nums text-text-muted">{effectiveDraft.inputs.tone.length}/300</span>
            </div>

            <div className="my-4 flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-border" />
              <span className="shrink-0 text-[9px] font-bold uppercase tracking-[0.12em] text-text-muted">Or start with an example</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <div role="group" aria-label="Personality examples" className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {PERSONALITY_EXAMPLES.map((example) => {
                const selected = effectiveDraft.inputs.tone.trim() === example.value;
                return (
                  <button
                    key={example.label}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => updateInputs({ tone: example.value })}
                    className={exampleClassName(selected)}
                  >
                    <strong className="block break-words text-[14px] font-semibold leading-5 text-foreground">{example.label}</strong>
                    <span className="mx-auto mt-2 block max-w-[27ch] break-words text-[11px] leading-4 text-text-muted">{example.description}</span>
                  </button>
                );
              })}
            </div>

            <details className="group mt-5 border-t border-border pt-4">
              <summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg py-1 outline-none focus-visible:ring-2 focus-visible:ring-selection-accent/45 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-foreground">Personal and work context</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-text-muted">Optional response preferences, tool notes, and starting memory.</span>
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-text-muted transition-transform group-open:rotate-180" />
              </summary>
              <div className={`mt-4 grid gap-4 ${wide ? "md:grid-cols-2" : ""}`}>
                <BootstrapField
                  label="Response style"
                  helper="Choose its usual length and structure."
                  value={effectiveDraft.inputs.responseStyle}
                  onChange={(responseStyle) => updateInputs({ responseStyle })}
                  multiline
                  rows={2}
                  className={wide ? "md:col-span-2" : ""}
                />
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
          </>
        )}
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
