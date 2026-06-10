import type { LucideIcon } from "lucide-react";

import { getPlugin } from "@/components/dashboard/integrations/plugin-registry";

export type JourneyCapabilityGroup = "understand" | "create" | "find" | "remember" | "reach" | "repeat";

export interface JourneyCapabilitySuggestion {
  id: string;
  pluginId: string;
  group: JourneyCapabilityGroup;
  title: string;
  description: string;
  actionLabel: string;
  prompt: string;
  receipt: string;
  dayIds: string[];
}

export type JourneyCapabilityCard = JourneyCapabilitySuggestion & {
  displayName: string;
  icon: LucideIcon;
  reason?: string;
};

type ScoredJourneyCapabilityCard = JourneyCapabilityCard & {
  score: number;
};

export interface JourneyCapabilityContext {
  input?: string | null;
  hasImageAttachment?: boolean;
  hasAudioAttachment?: boolean;
  hasFileAttachment?: boolean;
}

interface CapabilityContextMatch {
  reason: string;
  score: number;
}

const VISUAL_CONTEXT_PATTERN = /\b(image|images|screenshot|photo|picture|visual|design|brand|mockup|diagram|figma|logo|thumbnail|poster|illustration)\b/i;
const AUDIO_CONTEXT_PATTERN = /\b(audio|voice|call|meeting|recording|transcript|podcast|spoken|listen|heard)\b/i;
const VOICE_OUTPUT_PATTERN = /\b(spoken|voice|narrate|narration|explain|handoff|update|read aloud|audio update)\b/i;
const VIDEO_CONTEXT_PATTERN = /\b(video|demo|walkthrough|workflow|clip|storyboard|sequence|recording)\b/i;
const THREE_D_CONTEXT_PATTERN = /\b(3d|asset|object|scene|spatial|prototype|model)\b/i;

export const JOURNEY_CAPABILITY_SUGGESTIONS: JourneyCapabilitySuggestion[] = [
  {
    id: "understand-images",
    pluginId: "builtin-vision",
    group: "understand",
    title: "Understand image context",
    description: "Use images as source material when the work is visual or hard to explain in words.",
    actionLabel: "Try with an image",
    prompt: "Use vision on an image I share. Describe what matters, call out missing context, and suggest one useful next step.",
    receipt: "Vision is now part of this mission.",
    dayIds: ["sources", "real-work"],
  },
  {
    id: "understand-audio",
    pluginId: "builtin-speech",
    group: "understand",
    title: "Turn audio into notes",
    description: "Teach your agent from calls, voice notes, or spoken context without rewriting everything first.",
    actionLabel: "Try with audio",
    prompt: "Help me turn an audio file into notes. Ask me to attach audio, then extract decisions, questions, and next steps.",
    receipt: "Your agent can use audio as source material.",
    dayIds: ["sources", "understanding"],
  },
  {
    id: "create-images",
    pluginId: "builtin-images",
    group: "create",
    title: "Shape a visual draft",
    description: "Turn a brief into image direction when the useful output is visual.",
    actionLabel: "Draft image direction",
    prompt: "Turn this brief into an image direction. Ask what the image is for, then draft a concise visual brief with subject, mood, constraints, and success criteria.",
    receipt: "This mission now has a visual output path.",
    dayIds: ["real-work"],
  },
  {
    id: "create-voice",
    pluginId: "builtin-voice",
    group: "create",
    title: "Draft a spoken update",
    description: "Use voice when the agent needs to explain, narrate, or hand off work clearly.",
    actionLabel: "Draft voice update",
    prompt: "Draft a short spoken update from this context. Keep it clear, warm, and under one minute. Include what changed, what matters, and what should happen next.",
    receipt: "This mission now has a spoken handoff path.",
    dayIds: ["real-work", "connections"],
  },
  {
    id: "repeat-video",
    pluginId: "builtin-video",
    group: "repeat",
    title: "Make a workflow visible",
    description: "Turn repeatable work into a short video concept people can understand quickly.",
    actionLabel: "Draft video concept",
    prompt: "Turn one useful workflow into a short video concept. Include the audience, scene outline, source material, and what the viewer should understand by the end.",
    receipt: "This workflow now has a video concept path.",
    dayIds: ["repeatable"],
  },
  {
    id: "repeat-3d",
    pluginId: "builtin-3d",
    group: "create",
    title: "Brief a 3D asset",
    description: "Use 3D when the work needs an object, scene, prototype, or spatial reference.",
    actionLabel: "Draft 3D brief",
    prompt: "Help me shape a 3D asset brief. Ask what object or scene matters, how it will be used, what details should be preserved, and what a good result should include.",
    receipt: "This workflow now has a 3D asset path.",
    dayIds: ["repeatable"],
  },
];

function contextMatchForCapability(
  capability: JourneyCapabilitySuggestion,
  context: JourneyCapabilityContext | undefined,
): CapabilityContextMatch | null {
  if (!context) return null;
  const input = context.input?.trim() ?? "";

  if (capability.id === "understand-images") {
    if (context.hasImageAttachment) return { reason: "Image attached", score: 40 };
    if (VISUAL_CONTEXT_PATTERN.test(input)) return { reason: "Current draft mentions visual work", score: 26 };
  }

  if (capability.id === "understand-audio") {
    if (context.hasAudioAttachment) return { reason: "Audio attached", score: 40 };
    if (AUDIO_CONTEXT_PATTERN.test(input)) return { reason: "Current draft mentions audio or speech", score: 26 };
  }

  if (capability.id === "create-images" && VISUAL_CONTEXT_PATTERN.test(input)) {
    return { reason: "Current draft may need a visual output", score: 24 };
  }

  if (capability.id === "create-voice" && VOICE_OUTPUT_PATTERN.test(input)) {
    return { reason: "Current draft may need a spoken handoff", score: 24 };
  }

  if (capability.id === "repeat-video" && VIDEO_CONTEXT_PATTERN.test(input)) {
    return { reason: "Current draft may become a video workflow", score: 24 };
  }

  if (capability.id === "repeat-3d" && THREE_D_CONTEXT_PATTERN.test(input)) {
    return { reason: "Current draft may need a 3D asset", score: 24 };
  }

  return null;
}

function isScoredCapabilityCard(value: ScoredJourneyCapabilityCard | null): value is ScoredJourneyCapabilityCard {
  return value !== null;
}

export function getJourneyCapabilitiesForDay(
  dayId: string,
  context?: JourneyCapabilityContext,
): JourneyCapabilityCard[] {
  if (dayId === "brief") return [];

  return JOURNEY_CAPABILITY_SUGGESTIONS
    .map((capability) => {
      const plugin = getPlugin(capability.pluginId);
      if (!plugin) return null;
      const contextMatch = contextMatchForCapability(capability, context);
      const dayScore = capability.dayIds.includes(dayId) ? 10 : 0;
      const score = dayScore + (contextMatch?.score ?? 0);
      if (score <= 0) return null;
      return {
        ...capability,
        displayName: plugin.displayName,
        icon: plugin.icon,
        ...(contextMatch ? { reason: contextMatch.reason } : {}),
        score,
      };
    })
    .filter(isScoredCapabilityCard)
    .sort((a, b) => b.score - a.score)
    .map(({ score: _score, ...capability }) => capability);
}
