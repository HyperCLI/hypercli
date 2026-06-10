import { JOURNEY_CAPABILITY_SUGGESTIONS, type JourneyCapabilityContext, type JourneyCapabilitySuggestion } from "./journey-capabilities";
import { JOURNEY_DAYS } from "./journey-days";
import type { JourneyCompletionEvent } from "./types";

export interface JourneyBriefDraft {
  preferredName?: string;
  role?: string;
  duties?: string;
  trustedSources?: string[];
  boundaries?: string[];
  realTasks?: string[];
  reviewNotes?: string[];
  connections?: string[];
  workflows?: string[];
}

export interface JourneyPromptInput {
  dayId: string;
  agentName?: string | null;
  preferredName?: string | null;
  values?: Record<string, string | null | undefined>;
  selectedCapabilityId?: string | null;
  capabilityContext?: JourneyCapabilityContext;
  existingBrief?: JourneyBriefDraft | null;
}

export interface JourneyPromptResult {
  prompt: string;
  completionEvent: JourneyCompletionEvent;
  completionDayId: string;
  receiptText: string;
}

export interface JourneyPromptTemplate {
  dayId: string;
  completionEvent: JourneyCompletionEvent;
  purpose: string;
  fields: Record<string, string>;
  briefUpdates: string[];
  output: string[];
  safeStep: string;
}

const JOURNEY_PROMPT_TEMPLATES: Record<string, JourneyPromptTemplate> = {
  brief: {
    dayId: "brief",
    completionEvent: "brief-started",
    purpose: "Create the first working brief: role, duties, what good help looks like, and where the agent should pause to ask.",
    fields: {
      role: "Role or duty",
      goodHelp: "What good help looks like",
      askBefore: "When to ask before acting",
      startingDirection: "Starting direction",
    },
    briefUpdates: ["Role", "Duties", "Good help", "When to ask"],
    output: ["Draft a concise first brief", "Name what is missing", "Ask one follow-up question if the brief is incomplete"],
    safeStep: "Do not assume responsibilities that were not named. Ask before expanding the role.",
  },
  sources: {
    dayId: "sources",
    completionEvent: "source-added",
    purpose: "Turn one source into usable context: what it is, why it matters, what to extract, and what to ignore.",
    fields: {
      source: "Source",
      whyTrust: "Why this source matters",
      lookFor: "What to look for",
      ignore: "What to ignore",
    },
    briefUpdates: ["Trusted source", "Useful note", "What to extract", "What to ignore"],
    output: ["Summarize the source role", "List what to extract", "Suggest the best way to attach or write this source"],
    safeStep: "Treat this as context to verify, not a reason to invent missing facts.",
  },
  rules: {
    dayId: "rules",
    completionEvent: "rules-confirmed",
    purpose: "Turn user judgment into working boundaries for action, tone, and escalation.",
    fields: {
      canDo: "Can do",
      askFirst: "Ask first",
      neverDo: "Never do",
      tone: "Tone",
    },
    briefUpdates: ["Can do", "Ask first", "Never do", "Tone", "Escalation"],
    output: ["Draft clear rules", "Call out risky actions", "Name anything important that is missing"],
    safeStep: "Prefer asking before actions that affect files, money, messages, permissions, or other people.",
  },
  "real-work": {
    dayId: "real-work",
    completionEvent: "chat-sent",
    purpose: "Try one real task so the user can see what the agent understands and where it needs more context.",
    fields: {
      goal: "Goal",
      context: "Context",
      output: "Useful output",
      audience: "Audience",
    },
    briefUpdates: ["Real task", "Desired output", "Audience", "Safe first step"],
    output: ["Restate the goal", "Name missing information", "Draft the requested output or a safe first step"],
    safeStep: "Start with the smallest useful step. Do not pretend missing context is known.",
  },
  understanding: {
    dayId: "understanding",
    completionEvent: "reviewed-understanding",
    purpose: "Review what the agent understood, what it missed, and what it should remember before more work.",
    fields: {
      right: "Got right",
      missing: "Missing",
      remember: "Remember",
      change: "Should change",
    },
    briefUpdates: ["What is clear", "What is missing", "What to remember", "Corrections"],
    output: ["Reflect back the agent's current understanding", "Apply corrections", "Name what should carry forward"],
    safeStep: "Ask for clarification before treating corrections as complete or permanent.",
  },
  connections: {
    dayId: "connections",
    completionEvent: "integrations-opened",
    purpose: "Map where work happens and define safe scope before connecting the agent to work tools.",
    fields: {
      where: "Where work lives",
      mayDo: "May help with",
      approval: "Needs approval for",
      firstConnection: "First connection",
    },
    briefUpdates: ["Work tools", "Allowed help", "Approval scope", "First connection"],
    output: ["Recommend the first connection", "Describe the safest scope", "List what should require approval"],
    safeStep: "Suggest read or draft scope before send, edit, assign, purchase, or delete scope.",
  },
  repeatable: {
    dayId: "repeatable",
    completionEvent: "workflow-drafted",
    purpose: "Turn one useful task into a repeatable workflow the agent can come back to.",
    fields: {
      trigger: "Trigger",
      steps: "Steps",
      result: "Good result",
      review: "Review point",
    },
    briefUpdates: ["Trigger", "Sources", "Steps", "Rules", "Good result"],
    output: ["Draft a repeatable workflow", "Name sources to check", "Define review or approval points"],
    safeStep: "Keep the workflow reviewable before it acts on external work.",
  },
};

function firstNonEmptyString(...values: Array<string | null | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function normalizedAgentName(agentName: string | null | undefined): string {
  return firstNonEmptyString(agentName) ?? "your agent";
}

function valueLines(template: JourneyPromptTemplate, values: JourneyPromptInput["values"]): { provided: string[]; missing: string[] } {
  const provided: string[] = [];
  const missing: string[] = [];

  for (const [fieldId, label] of Object.entries(template.fields)) {
    const value = firstNonEmptyString(values?.[fieldId]);
    if (value) {
      provided.push(`- ${label}: ${value}`);
    } else {
      missing.push(`- ${label}`);
    }
  }

  return { provided, missing };
}

function briefDraftLines(existingBrief: JourneyBriefDraft | null | undefined): string[] {
  if (!existingBrief) return [];
  const lines: string[] = [];
  const singleValues: Array<[string, string | undefined]> = [
    ["Preferred name", existingBrief.preferredName],
    ["Role", existingBrief.role],
    ["Duties", existingBrief.duties],
  ];

  for (const [label, value] of singleValues) {
    const trimmed = firstNonEmptyString(value);
    if (trimmed) lines.push(`- ${label}: ${trimmed}`);
  }

  const listValues: Array<[string, string[] | undefined]> = [
    ["Trusted sources", existingBrief.trustedSources],
    ["Boundaries", existingBrief.boundaries],
    ["Real tasks", existingBrief.realTasks],
    ["Review notes", existingBrief.reviewNotes],
    ["Connections", existingBrief.connections],
    ["Workflows", existingBrief.workflows],
  ];

  for (const [label, values] of listValues) {
    const compact = values?.map((value) => value.trim()).filter(Boolean);
    if (compact?.length) lines.push(`- ${label}: ${compact.join("; ")}`);
  }

  return lines;
}

function capabilityById(capabilityId: string | null | undefined): JourneyCapabilitySuggestion | null {
  if (!capabilityId) return null;
  return JOURNEY_CAPABILITY_SUGGESTIONS.find((capability) => capability.id === capabilityId) ?? null;
}

function capabilityGuidance(capability: JourneyCapabilitySuggestion | null, context: JourneyCapabilityContext | undefined): string[] {
  if (!capability) return [];
  const lines = [`- Capability to consider: ${capability.title}`];

  if (capability.id === "understand-images") {
    lines.push("- Use image context to describe what matters, missing context, and useful next steps. Do not infer intent from the image alone.");
  } else if (capability.id === "understand-audio") {
    lines.push("- If audio is provided, extract decisions, questions, owners, and next steps. Flag uncertain details.");
  } else if (capability.id === "create-images") {
    lines.push("- If a visual output is useful, draft image direction with purpose, subject, mood, constraints, and success criteria.");
  } else if (capability.id === "create-voice") {
    lines.push("- If a spoken handoff is useful, keep it clear, warm, under one minute, and focused on what changed and what happens next.");
  } else if (capability.id === "repeat-video") {
    lines.push("- If a video concept is useful, include audience, source material, scene outline, and what the viewer should understand.");
  } else if (capability.id === "repeat-3d") {
    lines.push("- If a 3D asset is useful, capture object or scene, intended use, preserved details, and what a good result should include.");
  }

  if (context?.hasImageAttachment) lines.push("- Current context includes an image attachment.");
  if (context?.hasAudioAttachment) lines.push("- Current context includes audio context.");
  if (context?.hasFileAttachment) lines.push("- Current context includes attached source material.");

  return lines;
}

function section(title: string, lines: string[]): string | null {
  if (lines.length === 0) return null;
  return `${title}\n${lines.join("\n")}`;
}

export function buildJourneyPrompt(input: JourneyPromptInput): JourneyPromptResult {
  const day = JOURNEY_DAYS.find((entry) => entry.id === input.dayId) ?? JOURNEY_DAYS[0];
  const template = JOURNEY_PROMPT_TEMPLATES[day.id] ?? JOURNEY_PROMPT_TEMPLATES.brief;
  const agentName = normalizedAgentName(input.agentName);
  const preferredName = firstNonEmptyString(input.preferredName);
  const { provided, missing } = valueLines(template, input.values);
  const selectedCapability = capabilityById(input.selectedCapabilityId);
  const existingBrief = briefDraftLines(input.existingBrief);
  const capability = capabilityGuidance(selectedCapability, input.capabilityContext);
  const sections = [
    `Journey mission: ${day.title}`,
    `You are helping shape ${agentName} into a useful teammate.`,
    `Mission purpose: ${template.purpose}`,
    preferredName ? `Address the user as: ${preferredName}` : null,
    section("Context from the user:", provided.length ? provided : ["- No mission details provided yet."]),
    section("Missing details:", missing),
    section("Existing Agent Brief context:", existingBrief),
    section("Capability guidance:", capability),
    section("Update these Agent Brief areas:", template.briefUpdates.map((item) => `- ${item}`)),
    section("Return:", template.output.map((item) => `- ${item}`)),
    `Safe next step: ${template.safeStep}`,
    missing.length > 0 ? "If a missing detail is important, ask one clear follow-up question before assuming." : "If anything is still ambiguous, ask one clear follow-up question before assuming.",
  ].filter(Boolean);

  return {
    prompt: sections.join("\n\n"),
    completionEvent: template.completionEvent,
    completionDayId: day.id,
    receiptText: selectedCapability?.receipt ?? day.receipt,
  };
}

export function buildJourneyBriefPrompt(input: Omit<JourneyPromptInput, "dayId" | "values"> & { starterDirection?: string | null }): JourneyPromptResult {
  return buildJourneyPrompt({
    ...input,
    dayId: "brief",
    values: {
      startingDirection: input.starterDirection,
    },
  });
}

export function buildJourneyCapabilityPrompt(input: JourneyPromptInput & { selectedCapabilityId: string }): JourneyPromptResult {
  return buildJourneyPrompt(input);
}

export function journeyPromptTemplateFor(dayId: string): JourneyPromptTemplate | null {
  return JOURNEY_PROMPT_TEMPLATES[dayId] ?? null;
}
