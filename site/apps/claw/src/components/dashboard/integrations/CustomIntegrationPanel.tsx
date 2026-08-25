"use client";

import React from "react";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Cable, Check, ExternalLink, Loader2, RotateCcw, ShieldCheck, Square, Wrench } from "lucide-react";
import { Input, Label, Textarea } from "@hypercli/shared-ui";

import { IntegrationBrandPulse } from "../chat-integrations/IntegrationBrandPulse";
import {
  buildCustomIntegrationAgentPrompt,
  buildCustomIntegrationMatch,
  customIntegrationActivityLabel,
  parseCustomIntegrationRunResult,
  type CustomIntegrationConnectionType,
  type CustomIntegrationMatch,
  type CustomIntegrationRequest,
  type CustomIntegrationRunner,
  type CustomIntegrationRunResult,
} from "./custom-integration-agent";

const CONNECTION_TYPES: Array<{ id: CustomIntegrationConnectionType; label: string; detail: string }> = [
  { id: "auto", label: "Let agent decide", detail: "Inspect the workspace and choose the best supported path." },
  { id: "api", label: "API", detail: "Read or update data through an API." },
  { id: "webhook", label: "Webhook", detail: "React to events or send updates." },
  { id: "other", label: "Other", detail: "Use another connection pattern." },
];

const EMPTY_DRAFT: CustomIntegrationRequest = {
  serviceName: "",
  connectionType: "auto",
  workflow: "",
  documentationUrl: "",
};

interface CustomIntegrationPanelProps {
  connected: boolean;
  runEphemeralPrompt?: CustomIntegrationRunner;
}

function buttonClass(tone: "primary" | "secondary" = "secondary") {
  if (tone === "primary") {
    return "inline-flex h-8 items-center gap-1.5 rounded-full bg-button-primary px-3 text-xs font-black uppercase tracking-[0.12em] text-button-primary-foreground transition-all hover:-translate-y-0.5 hover:bg-button-primary-hover disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-50";
  }
  return "inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface-low/70 px-3 text-xs font-black uppercase tracking-[0.12em] text-text-secondary backdrop-blur transition-all hover:-translate-y-0.5 hover:border-border-strong hover:bg-surface-high hover:text-foreground disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-50";
}

function heroCopy(
  serviceName: string,
  running: boolean,
  cancelling: boolean,
  match: CustomIntegrationMatch | null,
  result: CustomIntegrationRunResult | null,
  error: string | null,
): { title: string; subtitle: string } {
  const service = serviceName.trim();
  if (cancelling) {
    return {
      title: "Stopping setup",
      subtitle: "Waiting for the private setup session to stop and clean up before another run can begin.",
    };
  }
  if (running) {
    return {
      title: service ? `Setting up ${service}` : "Setting up integration",
      subtitle: "Your agent is working in a private session and will surface only the steps that require you.",
    };
  }
  if (error) {
    return match
      ? { title: "Retry setup", subtitle: "Review the confirmed service, then start another private setup run." }
      : { title: "Review integration details", subtitle: "Check the service name and documentation URL, then try again." };
  }
  if (result?.status === "complete") return { title: service ? `${service} ready` : "Integration ready", subtitle: result.summary };
  if (result?.status === "needs_user_action") return { title: service ? `Finish ${service} setup` : "Finish setup", subtitle: result.summary };
  if (result?.status === "blocked") return { title: "Setup paused", subtitle: result.summary };
  if (match) return { title: "Is this the right integration?", subtitle: "Confirm the exact service and intended use before setup begins." };
  return {
    title: "Connect any tool",
    subtitle: "Tell your agent which tool you use and what you want it to do. You'll review everything before setup begins.",
  };
}

export function CustomIntegrationPanel({ connected, runEphemeralPrompt }: CustomIntegrationPanelProps) {
  const [draft, setDraft] = React.useState<CustomIntegrationRequest>(EMPTY_DRAFT);
  const [running, setRunning] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [match, setMatch] = React.useState<CustomIntegrationMatch | null>(null);
  const [result, setResult] = React.useState<CustomIntegrationRunResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [activities, setActivities] = React.useState<string[]>([]);
  const [confirmedStepIds, setConfirmedStepIds] = React.useState<Set<string>>(new Set());
  const abortRef = React.useRef<AbortController | null>(null);
  const operationRef = React.useRef(0);
  const serviceNameId = React.useId();
  const workflowId = React.useId();
  const documentationUrlId = React.useId();
  const readyToReview = Boolean(draft.serviceName.trim());
  const draftIsEmpty = !draft.serviceName && draft.connectionType === "auto" && !draft.workflow && !draft.documentationUrl;
  const allRequiredStepsConfirmed = Boolean(
    result?.status === "needs_user_action" &&
    result.userSteps.length > 0 &&
    result.userSteps.every((step) => confirmedStepIds.has(step.id)),
  );
  const displayServiceName = match?.serviceName ?? draft.serviceName;
  const connectionTypeLabel = CONNECTION_TYPES.find((option) => option.id === match?.connectionType)?.label;
  const hero = heroCopy(displayServiceName, running, cancelling, match, result, error);

  React.useEffect(() => () => {
    operationRef.current += 1;
    abortRef.current?.abort();
  }, []);

  const updateDraft = <Key extends keyof CustomIntegrationRequest,>(key: Key, value: CustomIntegrationRequest[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setMatch(null);
    setResult(null);
    setError(null);
  };

  const appendActivity = React.useCallback((label: string) => {
    setActivities((current) => {
      if (current[current.length - 1] === label) return current;
      return [...current, label].slice(-5);
    });
  }, []);

  const reviewIntegration = () => {
    try {
      setMatch(buildCustomIntegrationMatch(draft));
      setResult(null);
      setError(null);
    } catch {
      setError("Check the service name and documentation URL, then review the integration again.");
    }
  };

  const runSetup = React.useCallback(async (confirmedIds: string[] = []) => {
    if (!runEphemeralPrompt || !connected || running || !draft.serviceName.trim() || !match) return;
    let prompt: string;
    try {
      prompt = buildCustomIntegrationAgentPrompt(draft, {
        confirmedMatch: match,
        previousResult: result,
        confirmedStepIds: confirmedIds,
      });
    } catch {
      setError("Review the confirmed service details, then start setup again.");
      return;
    }

    const operation = operationRef.current + 1;
    operationRef.current = operation;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setCancelling(false);
    setError(null);
    setActivities(["Starting private setup"]);
    try {
      const response = await runEphemeralPrompt(prompt, {
        signal: controller.signal,
        timeoutMs: 300_000,
        maxResponseChars: 32_768,
        onEvent: (event) => {
          if (operation !== operationRef.current) return;
          const label = customIntegrationActivityLabel(event);
          if (label) appendActivity(label);
        },
      });
      if (operation !== operationRef.current || controller.signal.aborted) return;
      let parsed: CustomIntegrationRunResult;
      try {
        parsed = parseCustomIntegrationRunResult(response);
      } catch {
        setError("The setup response was incomplete, so no result was accepted. Retry the private setup run.");
        return;
      }
      setResult(parsed);
      setConfirmedStepIds(new Set());
      setActivities((current) => current.includes("Setup run finished") ? current : [...current, "Setup run finished"].slice(-5));
    } catch {
      if (operation !== operationRef.current || controller.signal.aborted) return;
      setError("The private setup session stopped before it finished. Retry setup; private diagnostics remain hidden.");
    } finally {
      if (operation === operationRef.current) {
        setRunning(false);
        setCancelling(false);
        if (controller.signal.aborted) setActivities([]);
        abortRef.current = null;
      }
    }
  }, [appendActivity, connected, draft, match, result, runEphemeralPrompt, running]);

  const cancelRun = () => {
    if (!running || cancelling || !abortRef.current) return;
    setCancelling(true);
    abortRef.current.abort();
  };

  const resetResult = () => {
    operationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setCancelling(false);
    setMatch(null);
    setResult(null);
    setError(null);
    setActivities([]);
    setConfirmedStepIds(new Set());
  };

  const clearDraft = () => {
    resetResult();
    setDraft(EMPTY_DRAFT);
  };

  const toggleConfirmedStep = (stepId: string) => {
    setConfirmedStepIds((current) => {
      const next = new Set(current);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

  const renderCompletedActions = () => result && result.completed.length > 0 ? (
    <div className="rounded-2xl border border-border bg-background/65 p-4 sm:p-5">
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Handled behind the scenes</p>
      <ul className="mt-3 space-y-2">
        {result.completed.map((item) => (
          <li key={item} className="flex items-start gap-2 text-xs leading-5 text-text-secondary">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-selection-accent" aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  ) : null;

  return (
    <section aria-labelledby="custom-integration-title" aria-live="polite" className="group relative mb-3 overflow-hidden rounded-[1.75rem] border border-selection-accent/35 bg-background shadow-2xl">
      <Cable aria-hidden="true" className="pointer-events-none absolute -right-14 -top-10 h-52 w-52 rotate-12 text-selection-accent opacity-[0.14] sm:-right-16 sm:h-64 sm:w-64" />

      <header className="relative z-10 p-4 sm:p-5">
        <div className="flex items-center gap-4 sm:gap-5">
          <IntegrationBrandPulse active={running} accentColor="var(--selection-accent)">
            <Cable className="h-14 w-14 text-selection-accent sm:h-[4.5rem] sm:w-[4.5rem]" aria-hidden="true" />
          </IntegrationBrandPulse>
          <div className="min-w-0 flex-1">
            <motion.h2
              key={hero.title}
              id="custom-integration-title"
              initial={{ opacity: 0, y: 18, filter: "blur(7px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ type: "spring", stiffness: 330, damping: 32, mass: 0.8 }}
              className="truncate text-left text-[clamp(1.55rem,5.6vw,3.05rem)] font-black uppercase leading-[0.9] tracking-[0.01em] text-selection-accent"
            >
              {hero.title}
            </motion.h2>
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-text-secondary sm:text-sm">{hero.subtitle}</p>
          </div>
        </div>
      </header>

      <div className="relative z-10 space-y-3 border-t border-border bg-surface-low/70 px-4 py-4 text-xs leading-5 text-text-secondary backdrop-blur-md sm:px-5">
        {error ? (
          <p role="alert" className="flex items-start gap-2 rounded-2xl border border-warning/25 bg-warning/10 px-3 py-2 text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {error}
          </p>
        ) : null}

        {(!connected || !runEphemeralPrompt) && !running ? (
          <p role="status" className="flex items-start gap-2 rounded-2xl border border-border bg-background/65 px-3 py-3 text-text-secondary">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" /> Reconnect the agent before connecting a tool.
          </p>
        ) : null}

        {!match && !result && !running ? (
          <>
            <div className="flex items-start gap-3 rounded-2xl border border-selection-accent/25 bg-selection-accent/10 px-3 py-3 text-selection-accent">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold text-foreground">Confirm first, then guided setup</p>
                <p className="mt-1">Review the service, source, and intended use before the agent installs or configures anything.</p>
              </div>
            </div>

            <div className="space-y-4 rounded-2xl border border-border bg-background/65 p-4 sm:p-5">
              <div>
                <Label htmlFor={serviceNameId} className="text-sm font-bold text-foreground">What do you want to connect?</Label>
                <p className="mt-1 text-[11px] leading-4 text-text-muted">A service name is enough to begin. Add official documentation when the name could refer to more than one product.</p>
              </div>
              <Input
                id={serviceNameId}
                value={draft.serviceName}
                onChange={(event) => updateDraft("serviceName", event.target.value)}
                placeholder="Notion"
                maxLength={80}
                required
                autoComplete="off"
                disabled={running}
                className="h-12 rounded-xl border-border bg-background text-sm focus-visible:border-selection-accent"
              />

              <div className="border-t border-border pt-4">
                <Label htmlFor={workflowId} className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">What should it do? <span className="font-medium normal-case tracking-normal">Optional</span></Label>
                <Textarea
                  id={workflowId}
                  value={draft.workflow}
                  onChange={(event) => updateDraft("workflow", event.target.value)}
                  placeholder="Create project notes from meeting summaries and search pages when I ask."
                  maxLength={1_000}
                  disabled={running}
                  className="mt-2 min-h-24 resize-y rounded-xl border-border bg-background text-sm leading-6 focus-visible:border-selection-accent"
                />
                <p className="mt-2 text-[11px] leading-4 text-text-muted">Leave this blank if you only want the connection prepared.</p>
              </div>

              <details className="group/details border-t border-border pt-4">
                <summary className="cursor-pointer text-[10px] font-black uppercase tracking-[0.16em] text-text-muted transition-colors hover:text-foreground">Advanced details</summary>
                <div className="mt-4 space-y-4">
                  <fieldset className="space-y-3">
                    <legend className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Connection type</legend>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {CONNECTION_TYPES.map((option) => {
                        const selected = draft.connectionType === option.id;
                        return (
                          <label key={option.id} className={`flex min-h-16 cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition-colors ${selected ? "border-selection-accent/40 bg-selection-accent/10" : "border-border bg-surface-low/50 hover:border-border-strong hover:bg-surface-high/70"}`}>
                            <input type="radio" name="custom-integration-connection-type" value={option.id} checked={selected} onChange={() => updateDraft("connectionType", option.id)} className="mt-0.5 h-4 w-4 shrink-0 accent-selection-accent" />
                            <span className="min-w-0"><span className="block text-xs font-bold text-foreground">{option.label}</span><span className="mt-0.5 block text-[11px] leading-4 text-text-muted">{option.detail}</span></span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                  <div>
                    <Label htmlFor={documentationUrlId} className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Documentation URL <span className="font-medium normal-case tracking-normal">Optional</span></Label>
                    <Input id={documentationUrlId} type="url" value={draft.documentationUrl} onChange={(event) => updateDraft("documentationUrl", event.target.value)} placeholder="https://developers.example.com" maxLength={2_048} autoComplete="url" className="mt-2 h-12 rounded-xl border-border bg-background text-sm focus-visible:border-selection-accent" />
                  </div>
                </div>
              </details>

              <div className="flex items-start gap-2.5 border-t border-border pt-3 text-[11px] leading-4 text-text-muted">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                <p><span className="font-semibold text-foreground">Do not paste credentials here.</span> The agent will ask only when a secure external authorization step is unavoidable.</p>
              </div>
            </div>
          </>
        ) : running ? (
          <div role="status" className="min-h-64 rounded-2xl border border-selection-accent/25 bg-background/65 p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-selection-accent" aria-hidden="true" />
              <div>
                <p className="text-sm font-bold text-foreground">Working in a private setup session</p>
                <p className="mt-1 text-[11px] leading-4 text-text-muted">Tool arguments, command output, and private values stay hidden from this card.</p>
              </div>
            </div>
            <ol className="mt-5 space-y-3">
              {activities.map((activity, index) => {
                const active = index === activities.length - 1;
                return (
                  <li key={`${index}:${activity}`} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${active ? "border-selection-accent/30 bg-selection-accent/10 text-foreground" : "border-border bg-surface-low/60 text-text-secondary"}`}>
                    {active ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-selection-accent" aria-hidden="true" /> : <Check className="h-4 w-4 shrink-0 text-selection-accent" aria-hidden="true" />}
                    <span>{activity}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : match && !result ? (
          <>
            <div className="flex items-start gap-3 rounded-2xl border border-selection-accent/25 bg-selection-accent/10 px-4 py-4 text-selection-accent">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-bold text-foreground">Verify the match before setup</p>
                <p className="mt-1">The setup run will use exactly this service and interpretation. If anything looks wrong, edit your request.</p>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-background/65 p-4 sm:p-5">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Service to connect</p>
              <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-lg font-black text-foreground">{match.serviceName}</h3>
                  <p className="mt-0.5 text-[11px] text-text-muted">Connection path: {connectionTypeLabel}</p>
                </div>
                {match.documentationUrl ? (
                  <a href={match.documentationUrl} target="_blank" rel="noopener noreferrer" className={buttonClass()}>
                    Provided docs · {new URL(match.documentationUrl).hostname} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                ) : null}
              </div>
              {!match.documentationUrl ? (
                <p className="mt-3 text-[11px] leading-4 text-text-muted">No documentation source was provided. Edit the details if this name could refer to more than one product.</p>
              ) : null}
              <div className="mt-4 border-t border-border pt-4">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">What we understood</p>
                <p className="mt-2 text-xs leading-5 text-foreground">{match.intendedUse}</p>
              </div>
            </div>
          </>
        ) : result ? (
          <>
            {result.status === "complete" ? (
              <div className="flex items-start gap-3 rounded-2xl border border-selection-accent/25 bg-selection-accent/10 px-4 py-4 text-selection-accent">
                <Check className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <div><p className="font-bold text-foreground">Setup completed</p><p className="mt-1">{result.summary}</p></div>
              </div>
            ) : result.status === "blocked" ? (
              <div className="flex items-start gap-3 rounded-2xl border border-warning/25 bg-warning/10 px-4 py-4 text-warning">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <div><p className="font-bold text-foreground">Setup cannot continue safely</p><p className="mt-1">{result.summary}</p></div>
              </div>
            ) : null}

            {renderCompletedActions()}

            {result.status === "needs_user_action" ? (
              <div className="rounded-2xl border border-border bg-background/65 p-4 sm:p-5">
                <div>
                  <p className="text-sm font-bold text-foreground">Only these steps need you</p>
                  <p className="mt-1 text-[11px] leading-4 text-text-muted">Complete each external action, mark it done, then let the agent verify and continue.</p>
                </div>
                <div className="mt-4 space-y-3">
                  {result.userSteps.map((step, index) => {
                    const checked = confirmedStepIds.has(step.id);
                    const destinationHost = step.url ? new URL(step.url).hostname : null;
                    return (
                      <div key={step.id} className={`rounded-2xl border p-4 ${checked ? "border-selection-accent/30 bg-selection-accent/10" : "border-border bg-surface-low/50"}`}>
                        <div className="flex items-start gap-3">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[11px] font-black text-foreground">{index + 1}</span>
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-foreground">{step.title}</p>
                            <p className="mt-1 text-[11px] leading-5 text-text-secondary">{step.instructions}</p>
                            {step.url && destinationHost ? (
                              <a href={step.url} target="_blank" rel="noopener noreferrer" className={`${buttonClass()} mt-3`}>
                                {step.actionLabel ?? "Open setup"} · {destinationHost} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                              </a>
                            ) : null}
                          </div>
                        </div>
                        <label className="mt-3 flex cursor-pointer items-center gap-2 border-t border-border pt-3 text-[11px] font-semibold text-foreground">
                          <input type="checkbox" checked={checked} onChange={() => toggleConfirmedStep(step.id)} className="h-4 w-4 rounded border-border accent-selection-accent" />
                          I completed: {step.title}
                        </label>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      <footer className="relative z-10 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-high/35 px-4 py-3 backdrop-blur-md sm:px-5">
        {running ? (
          <button type="button" onClick={cancelRun} disabled={cancelling} className={buttonClass()}>
            {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Square className="h-3.5 w-3.5" aria-hidden="true" />}
            {cancelling ? "Cancelling" : "Cancel"}
          </button>
        ) : result ? (
          <>
            <button type="button" onClick={resetResult} className={buttonClass()}><RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Edit request</button>
            {result.status === "needs_user_action" ? (
              <button type="button" onClick={() => void runSetup(Array.from(confirmedStepIds))} disabled={!allRequiredStepsConfirmed || !connected || !runEphemeralPrompt} className={buttonClass("primary")}>Continue setup <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></button>
            ) : (
              <button type="button" onClick={() => void runSetup()} disabled={!connected || !runEphemeralPrompt} className={buttonClass("primary")}><Wrench className="h-3.5 w-3.5" aria-hidden="true" /> {result.status === "complete" ? "Verify again" : "Retry setup"}</button>
            )}
          </>
        ) : match ? (
          <>
            <button type="button" onClick={resetResult} className={buttonClass()}><RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Edit details</button>
            <button type="button" onClick={() => void runSetup()} disabled={!connected || !runEphemeralPrompt} className={buttonClass("primary")}>Yes, start setup <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></button>
          </>
        ) : (
          <>
            <button type="button" onClick={clearDraft} disabled={draftIsEmpty} className={buttonClass()}><RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Clear form</button>
            <button type="button" onClick={reviewIntegration} disabled={!readyToReview} className={buttonClass("primary")}>Review integration <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></button>
          </>
        )}
      </footer>
    </section>
  );
}
