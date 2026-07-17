"use client";

import { AlertTriangle, ArrowRight, Check, Copy, ExternalLink, Loader2, RotateCcw } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { ResourceImage } from "@/components/ResourceImage";
import { ApprovalCard, type ApprovalState } from "@/components/dashboard/chat/ApprovalCard";
import type { ConnectorWorkflow, ConnectorWorkflowInputSlot } from "@/lib/connector-workflow";

export type ConnectorWorkflowInputValue = string | number | boolean | null;

export type ConnectorWorkflowInputCondition =
  | {
    inputSlot: ConnectorWorkflowInputSlot;
    operator: "equals";
    value: ConnectorWorkflowInputValue;
  }
  | {
    inputSlot: ConnectorWorkflowInputSlot;
    operator: "one-of";
    values: readonly ConnectorWorkflowInputValue[];
  }
  | {
    inputSlot: ConnectorWorkflowInputSlot;
    operator: "not-empty";
  };

export interface ConnectorWorkflowInputVisibility {
  all?: readonly ConnectorWorkflowInputCondition[];
  any?: readonly ConnectorWorkflowInputCondition[];
}

export interface ConnectorWorkflowInputControl {
  content: ReactNode;
  valid: boolean;
  value?: ConnectorWorkflowInputValue;
  visibleWhen?: ConnectorWorkflowInputVisibility;
  requiredWhen?: ConnectorWorkflowInputVisibility;
  disclosureWhen?: ConnectorWorkflowInputVisibility;
  disclosureLabel?: string;
}

export type ConnectorWorkflowInputControls = Partial<Record<ConnectorWorkflowInputSlot, ConnectorWorkflowInputControl>>;

interface ConnectorWorkflowGuideProps {
  workflow: ConnectorWorkflow | null;
  loading?: boolean;
  unavailable?: boolean;
  inputControls?: ConnectorWorkflowInputControls;
  showRuntimeFingerprint?: boolean;
  onRunShellProposal?: (command: string) => Promise<void>;
  onRetry?: () => void;
}

function externalLinkLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "");
    const pathPart = parsed.pathname.split("/").filter(Boolean)[0];
    if (hostname === "t.me" && pathPart) return `Open @${pathPart}`;
    if (hostname.endsWith("github.com")) return "Open GitHub";
    if (hostname.endsWith("discord.com")) return "Open Discord";
    if (hostname.endsWith("slack.com")) return "Open Slack";
    return `Open ${hostname}`;
  } catch {
    return "Open setup page";
  }
}

function inputValueIsNotEmpty(value: ConnectorWorkflowInputValue | undefined): boolean {
  return typeof value === "string" ? value.trim().length > 0 : value !== undefined && value !== null;
}

function inputConditionMatches(
  condition: ConnectorWorkflowInputCondition,
  inputControls: ConnectorWorkflowInputControls,
  visiting: Set<ConnectorWorkflowInputSlot>,
): boolean {
  const dependency = inputControls[condition.inputSlot];
  if (!dependency || !inputControlIsVisible(condition.inputSlot, inputControls, visiting)) return false;
  if (condition.operator === "equals") return dependency.value === condition.value;
  if (condition.operator === "one-of") return condition.values.some((value) => value === dependency.value);
  return inputValueIsNotEmpty(dependency.value);
}

function inputControlIsVisible(
  inputSlot: ConnectorWorkflowInputSlot,
  inputControls: ConnectorWorkflowInputControls,
  visiting: Set<ConnectorWorkflowInputSlot>,
): boolean {
  const control = inputControls[inputSlot];
  if (!control) return false;
  if (!control.visibleWhen) return true;
  if (visiting.has(inputSlot)) return false;

  const nextVisiting = new Set(visiting).add(inputSlot);
  return inputConditionsMatch(control.visibleWhen, inputControls, nextVisiting);
}

function inputConditionsMatch(
  conditions: ConnectorWorkflowInputVisibility,
  inputControls: ConnectorWorkflowInputControls,
  visiting: Set<ConnectorWorkflowInputSlot>,
): boolean {
  const { all, any } = conditions;
  const allMatch = !all || all.every((condition) => inputConditionMatches(condition, inputControls, visiting));
  const anyMatch = !any || any.some((condition) => inputConditionMatches(condition, inputControls, visiting));
  return allMatch && anyMatch;
}

export function connectorWorkflowInputControlIsVisible(
  inputSlot: ConnectorWorkflowInputSlot,
  inputControls: ConnectorWorkflowInputControls,
): boolean {
  return inputControlIsVisible(inputSlot, inputControls, new Set());
}

export function connectorWorkflowInputConditionsMatch(
  conditions: ConnectorWorkflowInputVisibility,
  inputControls: ConnectorWorkflowInputControls,
): boolean {
  return inputConditionsMatch(conditions, inputControls, new Set());
}

export function connectorWorkflowInputControlIsRequired(
  inputSlot: ConnectorWorkflowInputSlot,
  inputControls: ConnectorWorkflowInputControls,
): boolean {
  const control = inputControls[inputSlot];
  if (!control?.requiredWhen || !connectorWorkflowInputControlIsVisible(inputSlot, inputControls)) return false;
  return inputConditionsMatch(control.requiredWhen, inputControls, new Set([inputSlot]));
}

export function connectorWorkflowInputControlIsValid(
  inputSlot: ConnectorWorkflowInputSlot,
  inputControls: ConnectorWorkflowInputControls,
): boolean {
  const control = inputControls[inputSlot];
  if (!control) return false;
  if (!connectorWorkflowInputControlIsVisible(inputSlot, inputControls)) return true;
  if (!control.valid) return false;
  return !connectorWorkflowInputControlIsRequired(inputSlot, inputControls) || inputValueIsNotEmpty(control.value);
}

export function ConnectorWorkflowGuide({
  workflow,
  loading = false,
  unavailable = false,
  inputControls,
  showRuntimeFingerprint = true,
  onRunShellProposal,
  onRetry,
}: ConnectorWorkflowGuideProps) {
  const [approvalStates, setApprovalStates] = useState<Record<string, ApprovalState>>({});
  const [commandErrors, setCommandErrors] = useState<Record<string, boolean>>({});
  const [activeStepState, setActiveStepState] = useState<{ workflowIdentity: string; stepId: string } | null>(null);
  const [completionState, setCompletionState] = useState<{ workflowIdentity: string; stepIds: Set<string> } | null>(null);
  const [disclosureState, setDisclosureState] = useState<{ workflowIdentity: string; inputSlots: Set<ConnectorWorkflowInputSlot> } | null>(null);
  const [copiedValueKey, setCopiedValueKey] = useState<string | null>(null);
  const stepTitleRefs = useRef(new Map<string, HTMLButtonElement>());
  const workflowIdentity = workflow ? `${workflow.connectorId}:${workflow.runtimeFingerprint}:${workflow.steps.map((step) => step.id).join(",")}` : "";
  const activeStepId = activeStepState?.workflowIdentity === workflowIdentity ? activeStepState.stepId : null;
  const completedStepIds = completionState?.workflowIdentity === workflowIdentity ? completionState.stepIds : new Set<string>();
  const activateStep = (stepId: string) => setActiveStepState({ workflowIdentity, stepId });

  const copyValue = async (key: string, value: string) => {
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValueKey(key);
    } catch {
      setCopiedValueKey(null);
    }
  };

  if (loading) {
    return (
      <div role="status" className="flex items-center gap-2 rounded-2xl border border-border bg-background/60 px-3 py-3 text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" />
        Preparing guidance for this workspace version...
      </div>
    );
  }

  if (!workflow) {
    return unavailable ? (
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-warning/30 bg-warning/10 px-3 py-3 text-warning">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="min-w-0 flex-1">Setup guidance is not available for this workspace version. No changes were made.</p>
        {onRetry ? (
          <button type="button" onClick={onRetry} className="rounded-lg border border-warning/35 bg-background/60 px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-surface-high">
            Try again
          </button>
        ) : null}
      </div>
    ) : null;
  }

  const activeStepExists = workflow.steps.some((step) => step.id === activeStepId);
  const expandedStepId = activeStepExists ? activeStepId : workflow.steps[0]?.id ?? null;

  return (
    <div data-workflow-guide className="space-y-5">
      <p className="text-sm leading-6 text-text-secondary">{workflow.summary}</p>
      <ol data-workflow-timeline className="relative">
        {workflow.steps.length > 1 ? (
          <span
            aria-hidden="true"
            className="absolute bottom-6 left-5 top-6 w-px bg-border sm:left-6"
          />
        ) : null}
        {workflow.steps.map((step, index) => {
          const expanded = step.id === expandedStepId;
          const nextStep = workflow.steps[index + 1] ?? null;
          const firstStep = workflow.steps[0] ?? null;
          const command = step.command;
          const approvalState = approvalStates[step.id] ?? "pending";
          const stepInputControls = (step.inputSlots ?? [])
            .map((inputSlot) => ({ inputSlot, control: inputControls?.[inputSlot] }))
            .filter(({ inputSlot, control }) => !control || connectorWorkflowInputControlIsVisible(inputSlot, inputControls ?? {}));
          const inputsValid = stepInputControls.every(({ inputSlot, control }) => Boolean(control) && connectorWorkflowInputControlIsValid(inputSlot, inputControls ?? {}));
          const completed = completedStepIds.has(step.id) && inputsValid;
          const highlighted = expanded || approvalState === "approved" || completed;
          const reviewingCompletedFinalStep = !nextStep && completed;
          return (
            <li
              key={step.id}
              data-workflow-step={step.id}
              data-step-active={expanded ? "true" : "false"}
              data-step-complete={completed ? "true" : "false"}
              className={`relative grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-4 sm:grid-cols-[3rem_minmax(0,1fr)] sm:gap-x-5 ${index < workflow.steps.length - 1 ? "pb-5 sm:pb-6" : ""}`}
            >
              <button
                type="button"
                aria-label={`Step ${index + 1}: ${step.title}${completed ? " (completed)" : ""}`}
                aria-expanded={expanded}
                onClick={() => activateStep(step.id)}
                className={`relative z-10 flex h-10 w-10 items-center justify-center self-start rounded-full border text-sm font-black transition-all sm:h-12 sm:w-12 sm:text-base ${completed
                  ? "border-selection-accent bg-selection-accent text-selection-accent-foreground shadow-lg"
                  : highlighted
                    ? "shadow-lg"
                  : "border-border bg-surface-high text-foreground hover:border-border-strong hover:bg-surface-low"}`}
                style={highlighted && !completed ? {
                  backgroundColor: "var(--channel-accent, rgb(var(--selection-accent-rgb)))",
                  borderColor: "var(--channel-accent, rgb(var(--selection-accent-rgb)))",
                  color: "var(--channel-accent-foreground, var(--button-primary-foreground))",
                } : undefined}
              >
                {completed ? (
                  <span aria-hidden="true" className="absolute inset-0 grid place-items-center">
                    <Check className="block h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
                  </span>
                ) : index + 1}
              </button>

              <div className={`min-w-0 ${expanded ? "pt-0.5" : "pt-1.5 sm:pt-2.5"}`}>
                <button
                  ref={(node) => {
                    if (node) stepTitleRefs.current.set(step.id, node);
                    else stepTitleRefs.current.delete(step.id);
                  }}
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => activateStep(step.id)}
                  className={`block w-full text-left text-base font-semibold leading-7 transition-colors hover:text-selection-accent sm:text-lg ${completed ? "text-selection-accent" : "text-foreground"}`}
                >
                  {step.title}
                </button>

                {expanded ? (
                  <div className="animate-in fade-in slide-in-from-top-1 duration-200">
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-text-muted">{step.instructions}</p>
                    {step.referenceImage ? (
                      <figure className="mt-4 max-w-2xl overflow-hidden rounded-2xl border border-border-strong bg-background/70 shadow-sm">
                        <a
                          href={step.referenceImage.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="relative block aspect-video overflow-hidden bg-surface-low"
                          aria-label={`Open reference image: ${step.referenceImage.alt}`}
                        >
                          <ResourceImage
                            src={step.referenceImage.url}
                            alt={step.referenceImage.alt}
                            fill
                            sizes="(max-width: 640px) 100vw, 640px"
                            className="object-contain"
                          />
                        </a>
                        {step.referenceImage.caption ? (
                          <figcaption className="border-t border-border px-3 py-2 text-xs leading-5 text-text-muted">
                            {step.referenceImage.caption}
                          </figcaption>
                        ) : null}
                      </figure>
                    ) : null}
                    {stepInputControls.length > 0 ? (
                      <div data-workflow-inputs className="mt-4 grid gap-3">
                        {stepInputControls.map(({ inputSlot, control }) => {
                          const disclosed = Boolean(
                            control?.disclosureWhen &&
                            connectorWorkflowInputConditionsMatch(control.disclosureWhen, inputControls ?? {}),
                          );
                          const expanded = disclosureState?.workflowIdentity === workflowIdentity && disclosureState.inputSlots.has(inputSlot);
                          return (
                            <div key={inputSlot} data-workflow-input-slot={inputSlot}>
                              {control && disclosed && !expanded ? (
                                <button
                                  type="button"
                                  aria-expanded="false"
                                  onClick={() => setDisclosureState((current) => {
                                    const inputSlots = current?.workflowIdentity === workflowIdentity ? current.inputSlots : new Set<ConnectorWorkflowInputSlot>();
                                    return { workflowIdentity, inputSlots: new Set(inputSlots).add(inputSlot) };
                                  })}
                                  className="flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-background/65 px-3 py-3 text-left text-sm font-semibold text-foreground transition-colors hover:border-border-strong hover:bg-surface-high"
                                >
                                  <span>{control.disclosureLabel ?? "Show optional setting"}</span>
                                  <span className="text-xs font-medium text-text-muted">Optional</span>
                                </button>
                              ) : control?.content ?? (
                                <p role="alert" className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-warning">
                                  This protected field is not available in the current workspace.
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                    {step.url ? (
                      <a
                        href={step.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex h-9 items-center gap-2 rounded-xl border border-border-strong bg-background/70 px-3.5 text-sm font-semibold text-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-selection-accent hover:bg-surface-high"
                      >
                        {externalLinkLabel(step.url)} <ExternalLink className="h-4 w-4" />
                      </a>
                    ) : null}
                    {step.suggestedValue ? (
                      <div className="mt-3 max-w-xl rounded-xl border border-border-strong bg-background/80 p-1.5 pl-3 shadow-sm">
                        <p className="mb-1 text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Suggested value</p>
                        <div className="flex items-center gap-2">
                          <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-sm font-semibold text-foreground">
                            {step.suggestedValue}
                          </code>
                          <button
                            type="button"
                            aria-label={`Copy suggested value ${step.suggestedValue}`}
                            onClick={() => void copyValue(`${step.id}:suggestedValue`, step.suggestedValue!)}
                            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-surface-high px-2.5 text-xs font-semibold text-text-secondary transition-colors hover:bg-surface-low hover:text-foreground"
                          >
                            {copiedValueKey === `${step.id}:suggestedValue` ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                            {copiedValueKey === `${step.id}:suggestedValue` ? "Copied" : "Copy"}
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {step.externalCommand ? (
                      <div className="mt-3 flex max-w-xl items-center gap-2 rounded-xl border border-border-strong bg-background/80 p-1.5 pl-3 shadow-sm">
                        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-sm font-semibold text-foreground">
                          {step.externalCommand}
                        </code>
                        <button
                          type="button"
                          aria-label={`Copy external command ${step.externalCommand}`}
                          onClick={() => void copyValue(`${step.id}:externalCommand`, step.externalCommand!)}
                          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-surface-high px-2.5 text-xs font-semibold text-text-secondary transition-colors hover:bg-surface-low hover:text-foreground"
                        >
                          {copiedValueKey === `${step.id}:externalCommand` ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                          {copiedValueKey === `${step.id}:externalCommand` ? "Copied" : "Copy"}
                        </button>
                      </div>
                    ) : null}
                    {command ? (
                      <div className="mt-4">
                        <ApprovalCard
                          approvalId={step.id}
                          action="Run setup command"
                          summary="Review the exact command before it runs in this workspace."
                          risk="high"
                          preview={command}
                          state={approvalState}
                          onDeny={() => setApprovalStates((current) => ({ ...current, [step.id]: "denied" }))}
                          onApprove={async () => {
                            if (!onRunShellProposal) {
                              setCommandErrors((current) => ({ ...current, [step.id]: true }));
                              return;
                            }
                            try {
                              await onRunShellProposal(command);
                              setCommandErrors((current) => ({ ...current, [step.id]: false }));
                              setApprovalStates((current) => ({ ...current, [step.id]: "approved" }));
                            } catch {
                              setCommandErrors((current) => ({ ...current, [step.id]: true }));
                            }
                          }}
                        />
                        {commandErrors[step.id] ? (
                          <p role="alert" className="mt-2 text-destructive">The command did not complete. Review the workspace and try again.</p>
                        ) : null}
                      </div>
                    ) : null}
                    {nextStep || firstStep ? (
                      <div data-workflow-navigation className="mt-5 flex justify-start border-t border-border/70 pt-4">
                        <button
                          type="button"
                          aria-label={nextStep
                            ? `Next step: ${nextStep.title}`
                            : reviewingCompletedFinalStep
                              ? "Walkthrough complete: review from start"
                              : "Complete step"}
                          disabled={!inputsValid}
                          onClick={() => {
                            if (!inputsValid) return;
                            if (!reviewingCompletedFinalStep) {
                              setCompletionState((current) => {
                                const stepIds = current?.workflowIdentity === workflowIdentity ? current.stepIds : new Set<string>();
                                return { workflowIdentity, stepIds: new Set(stepIds).add(step.id) };
                              });
                            }
                            const destination = nextStep ?? (reviewingCompletedFinalStep ? firstStep : null);
                            if (!destination) return;
                            activateStep(destination.id);
                            stepTitleRefs.current.get(destination.id)?.focus();
                          }}
                          className="group/next inline-flex min-h-10 max-w-full items-center gap-3 rounded-xl border border-border-strong bg-background/75 px-3.5 py-2 text-left text-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-[var(--channel-accent,rgb(var(--selection-accent-rgb)))] hover:bg-surface-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--channel-accent,rgb(var(--selection-accent-rgb)))] disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-45"
                        >
                          <span className="min-w-0">
                            <span className="block text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">
                              {nextStep ? "Next step" : reviewingCompletedFinalStep ? "Walkthrough complete" : "Final step"}
                            </span>
                            <span className="block truncate text-sm font-semibold">
                              {nextStep?.title ?? (reviewingCompletedFinalStep ? "Review from start" : "Complete step")}
                            </span>
                          </span>
                          {nextStep ? (
                            <ArrowRight className="h-4 w-4 shrink-0 transition-transform group-hover/next:translate-x-0.5" />
                          ) : reviewingCompletedFinalStep ? (
                            <RotateCcw className="h-4 w-4 shrink-0 transition-transform group-hover/next:-rotate-45" />
                          ) : (
                            <Check className="h-4 w-4 shrink-0" />
                          )}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {showRuntimeFingerprint ? <p className="text-[11px] text-text-muted">Guidance generated for runtime {workflow.runtimeFingerprint}.</p> : null}
    </div>
  );
}
