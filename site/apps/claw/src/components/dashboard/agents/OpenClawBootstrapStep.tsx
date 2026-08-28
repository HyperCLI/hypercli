"use client";

import React from "react";
import { ChevronDown } from "lucide-react";
import { Switch } from "@hypercli/shared-ui";
import {
  createOpenClawBootstrapDraft,
  normalizeOpenClawBootstrapInputs,
  OPENCLAW_BOOTSTRAP_PACK_VERSION,
  type OpenClawBootstrapDraft,
  type OpenClawBootstrapInputs,
} from "@/lib/openclaw-bootstrap-pack";
import { assembleOpenClawBootstrapPack } from "@/lib/bootstrap-templates";

interface OpenClawBootstrapStepProps {
  agentName: string;
  draft: OpenClawBootstrapDraft | null;
  onChange: (draft: OpenClawBootstrapDraft) => void;
  stage: OpenClawBootstrapStage;
  wide?: boolean;
  modal?: boolean;
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

function exampleClassName(selected: boolean, modal: boolean) {
  return `${modal ? "min-h-[120px] rounded-[16px] px-5 py-5 text-left" : "min-h-[142px] rounded-[11px] px-4 py-4 text-center"} min-w-0 border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-selection-accent/45 ${
    selected
      ? "border-selection-accent/60 bg-[rgb(var(--selection-accent-rgb)_/_0.12)] shadow-[inset_0_0_0_1px_rgb(var(--selection-accent-rgb)_/_0.08)]"
      : "border-border bg-background hover:border-border-strong hover:bg-[rgb(var(--selection-accent-rgb)_/_0.04)]"
  }`;
}

export function OpenClawBootstrapStep({
  agentName,
  draft,
  onChange,
  stage,
  wide = false,
  modal = false,
}: OpenClawBootstrapStepProps) {
  const [fallbackDraft, setFallbackDraft] = React.useState<OpenClawBootstrapDraft | null>(null);
  const [contextEnabled, setContextEnabled] = React.useState(() => Boolean(
    draft?.inputs.userName
    || draft?.inputs.timezone
    || draft?.inputs.companyRole
    || draft?.inputs.toolsNotes
    || draft?.inputs.memoryNotes
    || draft?.inputs.includeMemory,
  ));
  React.useEffect(() => {
    if (draft) return;
    try {
      setFallbackDraft(createOpenClawBootstrapDraft(agentName));
    } catch {
      // Templates unavailable; step renders an empty pack until they resolve.
    }
  }, [agentName, draft]);
  const effectiveDraft = draft ?? fallbackDraft ?? {
    version: OPENCLAW_BOOTSTRAP_PACK_VERSION,
    inputs: normalizeOpenClawBootstrapInputs(null, agentName),
    files: [],
    generationSource: "deterministic" as const,
  };

  React.useEffect(() => {
    if (!draft || draft.inputs.agentName === agentName) return;
    try {
      const files = assembleOpenClawBootstrapPack({ ...draft.inputs, agentName });
      onChange({
        ...draft,
        inputs: { ...draft.inputs, agentName },
        files,
        generationSource: "deterministic",
      });
    } catch {
      // Templates unavailable; keep the prior pack until they resolve.
    }
  }, [agentName, draft, onChange]);

  const updateInputs = (patch: Partial<OpenClawBootstrapInputs>) => {
    const inputs = { ...effectiveDraft.inputs, ...patch, agentName };
    onChange({ ...effectiveDraft, inputs, generationSource: "deterministic" });
    try {
      const files = assembleOpenClawBootstrapPack(inputs);
      onChange({ ...effectiveDraft, inputs, files, generationSource: "deterministic" });
    } catch {
      // Templates unavailable; inputs still update so the step stays usable.
    }
  };

  const inputClassName = modal
    ? "min-h-[104px] w-full resize-y rounded-[14px] border border-border bg-surface-low px-4 py-3 text-[16px] leading-6 text-foreground outline-none placeholder:text-text-muted focus:border-border-strong focus-visible:ring-2 focus-visible:ring-selection-accent/40"
    : "min-h-[146px] w-full resize-y rounded-[11px] border border-border bg-background px-3.5 py-3 text-[13px] leading-5 text-foreground outline-none placeholder:text-text-muted focus:border-border-strong focus-visible:ring-2 focus-visible:ring-selection-accent/40";

  return (
    <div
      data-slot="openclaw-bootstrap-step"
      className={`min-h-full ${wide ? "xl:h-full xl:min-h-0" : ""}`}
    >
      <section
        data-slot="shape-agent-content"
        data-workspace-stage={stage}
        className={modal
          ? "mx-auto min-h-0 w-full max-w-[960px] py-1 sm:py-3"
          : `min-h-0 rounded-[14px] border border-border bg-surface-high p-4 sm:p-5 ${wide ? "xl:h-full xl:overflow-y-auto" : ""}`}
      >
        {stage === "objective" ? (
          <>
            <h3 className={modal ? "text-[18px] font-semibold leading-6 text-foreground" : "text-[22px] font-semibold leading-7 tracking-[-0.02em] text-foreground"}>
              What do you want to get done?
            </h3>
            <textarea
              id="agent-objective"
              aria-label="Role and outcome"
              aria-describedby="objective-helper"
              value={effectiveDraft.inputs.purpose}
              onChange={(event) => updateInputs({ purpose: event.target.value })}
              placeholder="Describe how you want it to work."
              maxLength={300}
              rows={4}
              className={`${inputClassName} mt-3`}
            />
            <p id="objective-helper" className={modal ? "mt-3 max-w-[72ch] text-[15px] leading-6 text-text-muted" : "mt-2 max-w-[68ch] text-[13px] leading-5 text-text-muted"}>
              Give {agentName} an objective, project, or responsibility. It will figure out how to help make it happen. Be as specific or broad as you like; you can always refine it later.
            </p>

            <ExampleDivider modal={modal} />
            <div role="group" aria-label="Objective examples" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {OBJECTIVE_EXAMPLES.map((example) => {
                const selected = effectiveDraft.inputs.purpose.trim() === example.value;
                return (
                  <button
                    key={example.label}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => updateInputs({ purpose: example.value })}
                    className={exampleClassName(selected, modal)}
                  >
                    <strong className={modal ? "block break-words text-[17px] font-semibold leading-6 text-foreground" : "block break-words text-[14px] font-semibold leading-5 text-foreground"}>{example.label}</strong>
                    <span className={modal ? "mt-3 block max-w-[35ch] break-words text-[15px] leading-6 text-text-muted" : "mx-auto mt-2 block max-w-[27ch] break-words text-[11px] leading-4 text-text-muted"}>{example.description}</span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <h3 className={modal ? "text-[18px] font-semibold leading-6 text-foreground" : "text-[22px] font-semibold leading-7 tracking-[-0.02em] text-foreground"}>
              How should it approach the work?
            </h3>
            <textarea
              id="agent-personality"
              aria-label="Working style"
              aria-describedby="personality-helper"
              value={effectiveDraft.inputs.tone}
              onChange={(event) => updateInputs({ tone: event.target.value })}
              placeholder="Describe what you want done."
              maxLength={300}
              rows={4}
              className={`${inputClassName} mt-3`}
            />
            <p id="personality-helper" className={modal ? "mt-3 max-w-[72ch] text-[15px] leading-6 text-text-muted" : "mt-2 max-w-[68ch] text-[13px] leading-5 text-text-muted"}>
              Describe how you want it to think, communicate, and make decisions. You can refine this later in conversation.
            </p>

            <ExampleDivider modal={modal} />
            <div role="group" aria-label="Personality examples" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {PERSONALITY_EXAMPLES.map((example) => {
                const selected = effectiveDraft.inputs.tone.trim() === example.value;
                return (
                  <button
                    key={example.label}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => updateInputs({ tone: example.value })}
                    className={exampleClassName(selected, modal)}
                  >
                    <strong className={modal ? "block break-words text-[17px] font-semibold leading-6 text-foreground" : "block break-words text-[14px] font-semibold leading-5 text-foreground"}>{example.label}</strong>
                    <span className={modal ? "mt-3 block max-w-[35ch] break-words text-[15px] leading-6 text-text-muted" : "mx-auto mt-2 block max-w-[27ch] break-words text-[11px] leading-4 text-text-muted"}>{example.description}</span>
                  </button>
                );
              })}
            </div>

            <div className={modal ? "openclaw-context-card mt-6 rounded-[18px] border border-border bg-background p-5 sm:p-6" : "mt-5 rounded-[14px] border border-border bg-background p-4"}>
              <div className="flex items-start gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className={modal ? "text-[17px] font-semibold text-foreground" : "text-[13px] font-semibold text-foreground"}>Personal and work context</h4>
                    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-text-secondary">Optional</span>
                  </div>
                  <p className={modal ? "mt-1 text-[14px] leading-5 text-text-muted" : "mt-0.5 text-[11px] leading-4 text-text-muted"}>Optional response preferences, tool notes, and starting memory.</p>
                </div>
                <Switch
                  checked={contextEnabled}
                  aria-label="Enable personal and work context"
                  onCheckedChange={setContextEnabled}
                  className="mt-0.5"
                />
              </div>

              {contextEnabled ? (
                <div className="mt-5 grid gap-4">
                  <ContextPanel title="Response style" subtitle="Usual length and structure">
                    <BootstrapField
                      label="Response style"
                      hideLabel
                      value={effectiveDraft.inputs.responseStyle}
                      onChange={(responseStyle) => updateInputs({ responseStyle })}
                      placeholder="Lead with the answer. Be concise by default and expand when detail is useful."
                      multiline
                      rows={2}
                      modal={modal}
                    />
                  </ContextPanel>

                  <ContextPanel title="About you" subtitle="Name, time zone, role">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <BootstrapField
                        label="Preferred name"
                        value={effectiveDraft.inputs.userName}
                        onChange={(userName) => updateInputs({ userName })}
                        placeholder="What should it call you?"
                        modal={modal}
                      />
                      <BootstrapField
                        label="Time zone"
                        value={effectiveDraft.inputs.timezone}
                        onChange={(timezone) => updateInputs({ timezone })}
                        placeholder="America/Montreal"
                        modal={modal}
                      />
                      <BootstrapField
                        label="Company or role"
                        value={effectiveDraft.inputs.companyRole}
                        onChange={(companyRole) => updateInputs({ companyRole })}
                        placeholder="Optional work context"
                        multiline
                        rows={2}
                        className="sm:col-span-2"
                        modal={modal}
                      />
                    </div>
                  </ContextPanel>

                  <ContextPanel title="Tools and environment" subtitle="Systems, conventions, access limits">
                    <BootstrapField
                      label="Tools and environment"
                      hideLabel
                      value={effectiveDraft.inputs.toolsNotes}
                      onChange={(toolsNotes) => updateInputs({ toolsNotes })}
                      placeholder="Don't include passwords or secret keys."
                      multiline
                      rows={2}
                      modal={modal}
                    />
                    <p className="mt-2 text-[13px] leading-5 text-text-muted">Systems or environment the agent should know</p>
                    <div className="mt-4 rounded-[14px] bg-background-secondary p-4 sm:p-5">
                      <div className="flex items-start gap-4">
                        <div className="min-w-0 flex-1">
                          <h5 className="text-[15px] font-semibold text-foreground">Start with a memory file</h5>
                          <p className="mt-1 text-[13px] leading-5 text-text-muted">Durable, non-sensitive context. May be visible during normal sessions.</p>
                        </div>
                        <Switch
                          checked={effectiveDraft.inputs.includeMemory}
                          aria-label="Start with a memory file"
                          onCheckedChange={(includeMemory) => updateInputs({ includeMemory })}
                          className="mt-0.5"
                        />
                      </div>
                      {effectiveDraft.inputs.includeMemory ? (
                        <BootstrapField
                          label="Starting memory"
                          hideLabel
                          value={effectiveDraft.inputs.memoryNotes}
                          onChange={(memoryNotes) => updateInputs({ memoryNotes })}
                          placeholder="Important decisions or lasting context, not a transcript or activity log"
                          multiline
                          rows={3}
                          className="mt-4"
                          modal={modal}
                        />
                      ) : null}
                    </div>
                  </ContextPanel>
                </div>
              ) : null}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function ExampleDivider({ modal }: { modal: boolean }) {
  return (
    <div className={modal ? "openclaw-example-divider my-7 flex items-center gap-4" : "my-4 flex items-center gap-3"} aria-hidden="true">
      <span className="h-px flex-1 bg-border" />
      <span className={modal ? "shrink-0 text-[15px] font-medium text-text-muted" : "shrink-0 text-[9px] font-bold uppercase tracking-[0.12em] text-text-muted"}>Or start with an example</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function ContextPanel({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="group overflow-hidden rounded-[16px] bg-surface-high"
    >
      <summary className="flex cursor-pointer list-none items-center gap-4 px-5 py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selection-accent/45 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-semibold text-foreground">{title}</span>
          <span className="mt-1 block text-[13px] leading-5 text-text-muted">{subtitle}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="mx-5 border-t border-border pb-5 pt-4">{children}</div>
    </details>
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
  hideLabel = false,
  modal = false,
}: {
  label: string;
  helper?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  className?: string;
  hideLabel?: boolean;
  modal?: boolean;
}) {
  const inputId = React.useId();
  const helperId = React.useId();
  const shared = modal
    ? `${hideLabel ? "" : "mt-2"} w-full rounded-[12px] border border-border bg-background px-3.5 text-[15px] text-foreground outline-none placeholder:text-text-muted focus:border-border-strong focus-visible:ring-2 focus-visible:ring-selection-accent/40`
    : `${hideLabel ? "" : "mt-2"} w-full rounded-[9px] border border-border bg-background px-3 text-[12px] text-foreground outline-none placeholder:text-text-muted focus:border-border-strong`;
  return (
    <div className={`block ${className}`}>
      <label htmlFor={inputId} className={hideLabel ? "sr-only" : modal ? "text-[15px] font-semibold leading-5 text-foreground" : "text-[12px] font-semibold leading-4 text-foreground"}>{label}</label>
      {helper ? <span id={helperId} className="mt-1 block text-[11px] leading-4 text-text-muted">{helper}</span> : null}
      {multiline ? (
        <textarea
          id={inputId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          rows={rows}
          aria-describedby={helper ? helperId : undefined}
          className={`${shared} resize-y py-3 leading-6`}
        />
      ) : (
        <input
          id={inputId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-describedby={helper ? helperId : undefined}
          className={`${shared} ${modal ? "h-12" : "h-10"}`}
        />
      )}
    </div>
  );
}
