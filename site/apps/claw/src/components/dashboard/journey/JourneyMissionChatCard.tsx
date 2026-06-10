"use client";

import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  BookOpenText,
  ChevronDown,
  CheckCircle2,
  FileText,
  Link2,
  MessageSquareText,
  Repeat,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import {
  getJourneyCapabilitiesForDay,
  type JourneyCapabilityCard,
  type JourneyCapabilityContext,
} from "./journey-capabilities";
import { buildJourneyPrompt } from "./journey-prompt-builder";
import type { JourneyCompletionEvent, JourneyDay } from "./types";

interface JourneyMissionField {
  id: string;
  label: string;
  placeholder: string;
  textarea?: boolean;
}

interface JourneyMissionExample {
  label: string;
  values: Record<string, string>;
}

interface JourneyMissionCardConfig {
  title: string;
  description: string;
  icon: LucideIcon;
  fields: JourneyMissionField[];
  examples: JourneyMissionExample[];
  primaryLabel: string;
  secondaryLabel?: string;
  primaryKind: "prompt" | "day-action";
}

export interface JourneyMissionChatCardProps {
  agentName?: string | null;
  preferredName?: string | null;
  day: JourneyDay;
  capabilityContext?: JourneyCapabilityContext;
  defaultValues?: Record<string, string>;
  defaultPreviewOpen?: boolean;
  defaultPreviewCapabilityId?: string | null;
  onSetPrompt: (prompt: string, completionEvent?: JourneyCompletionEvent | null, completionDayId?: string | null, receiptText?: string | null) => void;
  onRunDayAction: (day: JourneyDay) => void;
  onRunCapabilityPrompt: (capability: JourneyCapabilityCard, day: JourneyDay) => void;
  onOpenCapability: (capability: JourneyCapabilityCard, day: JourneyDay) => void;
}

const MISSION_CONFIGS: Record<string, JourneyMissionCardConfig> = {
  brief: {
    title: "Shape the first brief",
    description: "Give your agent a role, a useful outcome, and a few places where it should ask before acting.",
    icon: BookOpenText,
    primaryLabel: "Start with this brief",
    primaryKind: "prompt",
    fields: [
      { id: "role", label: "Role", placeholder: "Keep the project moving and catch follow-ups." },
      { id: "goodHelp", label: "Good help looks like", placeholder: "Clear summaries, risks, owners, and next steps." },
      { id: "askBefore", label: "Ask before", placeholder: "Changing files, sending updates, or making risky choices." },
      { id: "startingDirection", label: "Starting direction", placeholder: "Track project follow-ups and prepare status updates." },
    ],
    examples: [
      {
        label: "Project partner",
        values: {
          role: "Keep this project moving and help me notice loose ends.",
          goodHelp: "Summaries with decisions, blockers, owners, and next steps.",
          askBefore: "Changing shared work, sending updates, or making commitments for me.",
          startingDirection: "Track project follow-ups and prepare status updates.",
        },
      },
      {
        label: "Draft reviewer",
        values: {
          role: "Review drafts before I share them.",
          goodHelp: "Point out unclear parts, missing context, risks, and suggested edits.",
          askBefore: "Changing the meaning, adding claims, or sending anything externally.",
          startingDirection: "Review work before I send it.",
        },
      },
    ],
  },
  sources: {
    title: "Add one trusted source",
    description: "Point your agent at something real: a file, note, screenshot, recording, or example it should learn from.",
    icon: FileText,
    primaryLabel: "Add a source",
    secondaryLabel: "Draft source note",
    primaryKind: "day-action",
    fields: [
      { id: "source", label: "Source", placeholder: "A project brief, screenshot, call recording, or decision note." },
      { id: "whyTrust", label: "Why it matters", placeholder: "It explains the current priorities and decisions." },
      { id: "lookFor", label: "What to look for", placeholder: "Decisions, risks, open questions, and next steps." },
      { id: "ignore", label: "What to ignore", placeholder: "Old decisions, stale comments, or parts that are not relevant." },
    ],
    examples: [
      {
        label: "Decision note",
        values: {
          source: "A note with recent project decisions.",
          whyTrust: "It is the latest source of truth for direction and owners.",
          lookFor: "Decisions, blockers, owners, and follow-ups.",
          ignore: "Older guesses that the team has already replaced.",
        },
      },
      {
        label: "Screenshot",
        values: {
          source: "A screenshot of the current design or workflow.",
          whyTrust: "It shows what people are actually looking at.",
          lookFor: "Confusing areas, missing context, and useful next steps.",
          ignore: "Polish details that are not part of this review.",
        },
      },
    ],
  },
  rules: {
    title: "Set working boundaries",
    description: "Define where your agent can move quickly and where it should pause for your judgment.",
    icon: ShieldCheck,
    primaryLabel: "Draft boundaries",
    primaryKind: "prompt",
    fields: [
      { id: "canDo", label: "Can do", placeholder: "Summarize notes, draft updates, organize next steps." },
      { id: "askFirst", label: "Ask first", placeholder: "Before deleting, sending, buying, or changing shared work." },
      { id: "neverDo", label: "Never do", placeholder: "Send messages, delete files, or make commitments without approval." },
      { id: "tone", label: "Tone", placeholder: "Direct, calm, concise, and clear about uncertainty." },
    ],
    examples: [
      {
        label: "Careful operator",
        values: {
          canDo: "Summarize context, draft text, and suggest next steps.",
          askFirst: "Before deleting files, sending messages, changing billing, or affecting other people.",
          neverDo: "Make irreversible changes or contact anyone without approval.",
          tone: "Calm, concise, and explicit about risks or uncertainty.",
        },
      },
      {
        label: "Fast drafter",
        values: {
          canDo: "Draft options, structure work, and identify blockers.",
          askFirst: "Before making irreversible edits or contacting anyone.",
          neverDo: "Present guesses as facts or skip approval for external work.",
          tone: "Practical, brief, and action-oriented.",
        },
      },
    ],
  },
  "real-work": {
    title: "Try one real task",
    description: "Give your agent useful work from today so you can see what it understands and what it still needs.",
    icon: MessageSquareText,
    primaryLabel: "Try this task",
    primaryKind: "prompt",
    fields: [
      { id: "goal", label: "Goal", placeholder: "Prepare a status update for the project." },
      { id: "context", label: "Context", placeholder: "Use the current notes, recent decisions, and known blockers.", textarea: true },
      { id: "output", label: "Useful output", placeholder: "A concise update with risks, owners, and next steps." },
      { id: "audience", label: "Audience", placeholder: "Me, my team, a client, or another reviewer." },
    ],
    examples: [
      {
        label: "Status update",
        values: {
          goal: "Prepare a status update for this project.",
          context: "The team needs progress, blockers, owners, and next steps.",
          output: "A concise update I can edit before sharing.",
          audience: "My project team.",
        },
      },
      {
        label: "Find the next step",
        values: {
          goal: "Help me decide the safest next step.",
          context: "There are open questions and a few risks I have not organized yet.",
          output: "A short recommendation with tradeoffs and what to ask next.",
          audience: "Me before I act.",
        },
      },
    ],
  },
  understanding: {
    title: "Review what it understood",
    description: "Capture what is right, what is missing, and what your agent should remember before more work.",
    icon: CheckCircle2,
    primaryLabel: "Review understanding",
    primaryKind: "prompt",
    fields: [
      { id: "right", label: "Got right", placeholder: "It understands the project goal and next decision." },
      { id: "missing", label: "Missing", placeholder: "It does not know the approval path or source of truth yet." },
      { id: "remember", label: "Remember", placeholder: "Always call out owners, blockers, and when it needs approval." },
      { id: "change", label: "Should change", placeholder: "Ask for audience and constraints before drafting final work." },
    ],
    examples: [
      {
        label: "Correct direction",
        values: {
          right: "The goal, audience, and next decision are clear.",
          missing: "The approval path and current source of truth are not clear yet.",
          remember: "Call out owners, blockers, and questions before suggesting action.",
          change: "Ask before treating a recommendation as final.",
        },
      },
      {
        label: "Needs refinement",
        values: {
          right: "It captured the broad goal and useful output.",
          missing: "It missed constraints, tone, and who the work is for.",
          remember: "Ask for audience and constraints before drafting final work.",
          change: "Slow down when context is thin and name what is missing.",
        },
      },
    ],
  },
  connections: {
    title: "Map where work happens",
    description: "Choose where your agent should look, draft, or ask for approval once it leaves this chat.",
    icon: Link2,
    primaryLabel: "Choose a connection",
    secondaryLabel: "Draft connection plan",
    primaryKind: "day-action",
    fields: [
      { id: "where", label: "Where work lives", placeholder: "Slack, Gmail, GitHub, Linear, Notion, calendar, or files." },
      { id: "mayDo", label: "May help with", placeholder: "Read updates, draft responses, summarize issues." },
      { id: "approval", label: "Needs approval for", placeholder: "Sending, changing status, assigning owners, or closing work." },
      { id: "firstConnection", label: "First connection", placeholder: "The one place with the most useful source material." },
    ],
    examples: [
      {
        label: "Team chat",
        values: {
          where: "Slack or another team chat.",
          mayDo: "Summarize threads and draft updates.",
          approval: "Sending messages or tagging people.",
          firstConnection: "Team chat, starting with read and draft scope.",
        },
      },
      {
        label: "Project tracker",
        values: {
          where: "GitHub, Linear, Jira, or another tracker.",
          mayDo: "Summarize issues, draft comments, and find blockers.",
          approval: "Changing status, assigning owners, or closing work.",
          firstConnection: "Project tracker, starting with issue summaries.",
        },
      },
    ],
  },
  repeatable: {
    title: "Make useful work repeatable",
    description: "Turn one task into a clear workflow your agent can come back to again.",
    icon: Repeat,
    primaryLabel: "Draft workflow",
    primaryKind: "prompt",
    fields: [
      { id: "trigger", label: "Trigger", placeholder: "Every Friday, after a meeting, or when a new issue appears." },
      { id: "steps", label: "Steps", placeholder: "Check sources, summarize changes, call out blockers, draft next steps.", textarea: true },
      { id: "result", label: "Good result", placeholder: "A reusable update with decisions, risks, owners, and next actions." },
      { id: "review", label: "Review point", placeholder: "Ask me before sending or changing shared work." },
    ],
    examples: [
      {
        label: "Weekly summary",
        values: {
          trigger: "Every Friday afternoon.",
          steps: "Review project notes, issues, and recent messages. Summarize progress, blockers, and next steps.",
          result: "A concise weekly update I can edit before sharing.",
          review: "Ask before sharing the update with anyone else.",
        },
      },
      {
        label: "Project check-in",
        values: {
          trigger: "Before each project check-in.",
          steps: "Review decisions, open questions, and owner updates. Flag missing context.",
          result: "A check-in brief with risks, questions, owners, and recommended next steps.",
          review: "Ask before turning recommendations into commitments.",
        },
      },
    ],
  },
};

function valuesFromFields(fields: JourneyMissionField[]): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field.id, ""]));
}

function hasAnyValue(values: Record<string, string>): boolean {
  return Object.values(values).some((value) => value.trim().length > 0);
}

export function JourneyMissionChatCard({
  agentName,
  preferredName,
  day,
  capabilityContext,
  defaultValues,
  defaultPreviewOpen = false,
  defaultPreviewCapabilityId = null,
  onSetPrompt,
  onRunDayAction,
  onOpenCapability,
}: JourneyMissionChatCardProps) {
  const reducedMotion = useReducedMotion();
  const displayName = agentName?.trim() || "your agent";
  const config = MISSION_CONFIGS[day.id] ?? MISSION_CONFIGS["real-work"];
  const Icon = config.icon;
  const [values, setValues] = useState(() => ({ ...valuesFromFields(config.fields), ...defaultValues }));
  const [previewOpen, setPreviewOpen] = useState(defaultPreviewOpen);
  const [previewCapabilityId, setPreviewCapabilityId] = useState<string | null>(defaultPreviewCapabilityId);
  const capabilityCards = useMemo(
    () => getJourneyCapabilitiesForDay(day.id, capabilityContext).slice(0, 2),
    [capabilityContext, day.id],
  );
  const promptPreview = useMemo(
    () => buildJourneyPrompt({
      dayId: day.id,
      agentName: displayName,
      preferredName,
      values,
      selectedCapabilityId: previewCapabilityId,
      capabilityContext,
    }).prompt,
    [day.id, displayName, preferredName, values, capabilityContext, previewCapabilityId],
  );
  const canDraftPrompt = config.primaryKind === "day-action" || hasAnyValue(values);

  function updateField(fieldId: string, value: string) {
    setValues((current) => ({ ...current, [fieldId]: value }));
  }

  function applyExample(example: JourneyMissionExample) {
    setValues((current) => ({ ...current, ...example.values }));
  }

  function buildPromptResult(selectedCapabilityId?: string | null) {
    return buildJourneyPrompt({
      dayId: day.id,
      agentName: displayName,
      preferredName,
      values,
      selectedCapabilityId,
      capabilityContext,
    });
  }

  function setPromptFromResult(selectedCapabilityId?: string | null) {
    const result = buildPromptResult(selectedCapabilityId);
    onSetPrompt(result.prompt, result.completionEvent, result.completionDayId, result.receiptText);
  }

  function runPrimaryAction() {
    if (config.primaryKind === "day-action") {
      onRunDayAction(day);
      return;
    }
    setPromptFromResult(previewCapabilityId);
  }

  function runSecondaryPrompt() {
    setPromptFromResult(previewCapabilityId);
  }

  function runCapabilityPrompt(capability: JourneyCapabilityCard) {
    setPreviewCapabilityId(capability.id);
    setPromptFromResult(capability.id);
  }

  return (
    <motion.section
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="w-full max-w-[39rem] rounded-[1.2rem] border border-white/10 bg-[#141415]/95 p-4 text-foreground shadow-[0_18px_70px_rgba(0,0,0,0.28)] sm:p-5"
      aria-label={`Journey mission ${day.day}: ${day.title}`}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--selection-accent-rgb)_/_0.1)] text-[var(--selection-accent)]">
          <Icon className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.22)] bg-[rgb(var(--selection-accent-rgb)_/_0.08)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--selection-accent)]">
            <Sparkles className="h-3 w-3" />
            Mission {day.day}
          </div>
          <h2 className="mt-2 text-lg font-semibold leading-tight tracking-[-0.025em] text-foreground">{config.title}</h2>
          <p className="mt-1 text-sm leading-6 text-text-secondary">{config.description}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-2.5">
        {config.fields.map((field) => (
          <label key={field.id} className="block rounded-xl border border-white/10 bg-white/[0.035] p-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">{field.label}</span>
            {field.textarea ? (
              <textarea
                value={values[field.id] ?? ""}
                onChange={(event) => updateField(field.id, event.target.value)}
                placeholder={field.placeholder}
                rows={3}
                className="mt-2 w-full resize-none rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm leading-5 text-foreground outline-none placeholder:text-text-muted focus:border-[rgb(var(--selection-accent-rgb)_/_0.45)] focus:ring-2 focus:ring-[rgb(var(--selection-accent-rgb)_/_0.18)]"
              />
            ) : (
              <input
                value={values[field.id] ?? ""}
                onChange={(event) => updateField(field.id, event.target.value)}
                placeholder={field.placeholder}
                className="mt-2 h-9 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-foreground outline-none placeholder:text-text-muted focus:border-[rgb(var(--selection-accent-rgb)_/_0.45)] focus:ring-2 focus:ring-[rgb(var(--selection-accent-rgb)_/_0.18)]"
              />
            )}
          </label>
        ))}
      </div>

      {config.examples.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Mission examples">
          {config.examples.map((example) => (
            <button
              key={example.label}
              type="button"
              onClick={() => applyExample(example)}
              className="rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1 text-[11px] font-semibold text-text-secondary transition-colors hover:border-[rgb(var(--selection-accent-rgb)_/_0.3)] hover:bg-[rgb(var(--selection-accent-rgb)_/_0.08)] hover:text-[var(--selection-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.5)]"
            >
              {example.label}
            </button>
          ))}
        </div>
      ) : null}

      {capabilityCards.length > 0 ? (
        <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">Useful capabilities</p>
          <div className="mt-2 grid gap-2">
            {capabilityCards.map((capability) => {
              const CapabilityIcon = capability.icon;
              return (
                <div key={capability.id} className="rounded-lg border border-white/10 bg-white/[0.035] p-2.5">
                  <div className="flex items-start gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[rgb(var(--selection-accent-rgb)_/_0.1)] text-[var(--selection-accent)]">
                      <CapabilityIcon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-5 text-foreground">{capability.title}</p>
                      <p className="mt-0.5 text-xs leading-5 text-text-secondary">{capability.description}</p>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => runCapabilityPrompt(capability)}
                      className="h-7 rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.28)] bg-[rgb(var(--selection-accent-rgb)_/_0.08)] px-2.5 text-xs font-semibold text-[var(--selection-accent)] transition-colors hover:bg-[rgb(var(--selection-accent-rgb)_/_0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.5)]"
                    >
                      {capability.actionLabel}
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenCapability(capability, day)}
                      className="h-7 rounded-full px-2.5 text-xs font-medium text-text-muted transition-colors hover:bg-white/8 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.45)]"
                    >
                      See capability
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={runPrimaryAction}
          disabled={!canDraftPrompt}
          className="inline-flex h-9 items-center gap-2 rounded-full bg-[var(--selection-accent)] px-3.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.55)]"
        >
          {config.primaryLabel}
          <ArrowRight className="h-4 w-4" />
        </button>
        {config.secondaryLabel ? (
          <button
            type="button"
            onClick={runSecondaryPrompt}
            className="h-9 rounded-full px-3 text-sm font-medium text-text-muted transition-colors hover:bg-white/8 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.45)]"
          >
            {config.secondaryLabel}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setPreviewOpen((open) => !open)}
          className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-text-muted transition-colors hover:bg-white/8 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.45)]"
          aria-expanded={previewOpen}
        >
          Preview prompt
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${previewOpen ? "rotate-180" : ""}`} />
        </button>
      </div>
      {previewOpen ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-black/25 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
            {previewCapabilityId ? "Preview with capability" : "Preview"}
          </p>
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-text-secondary">{promptPreview}</pre>
        </div>
      ) : null}
    </motion.section>
  );
}
