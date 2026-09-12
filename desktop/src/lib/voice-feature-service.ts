export interface ReadAloudOptions {
  /** Preset voice name for the /ws/voice socket (`speak`). */
  voice?: string;
  /**
   * The agent's uploaded voice reference. When present the read-aloud path
   * clones from it (`speakClone`) instead of using a preset voice.
   */
  referenceAudioUrl?: string;
}

export interface AgentVoiceSummary {
  avatar_audio_url?: string | null;
}

export type AgentTtsDecision =
  | { name: "disabled"; reason: "missing-agent-voice"; options: ReadAloudOptions }
  | { name: "clone-voice"; reason: "agent-voice-reference"; options: ReadAloudOptions };

export function hasAgentVoice(agent: AgentVoiceSummary | null | undefined): boolean {
  return Boolean(agent?.avatar_audio_url?.trim());
}

/**
 * The single read-aloud voice mode is cloning: an agent with reference audio
 * speaks in its own voice, an agent without one has no read-aloud mode at
 * all. There is no preset-voice stand-in — the header speaker button and the
 * Voice replies switch render disabled for unvoiced agents off this decision.
 */
export function agentTtsDecision(agent: AgentVoiceSummary | null | undefined): AgentTtsDecision {
  const referenceAudioUrl = agent?.avatar_audio_url?.trim();
  if (!referenceAudioUrl) {
    return { name: "disabled", reason: "missing-agent-voice", options: {} };
  }
  return {
    name: "clone-voice",
    reason: "agent-voice-reference",
    options: { referenceAudioUrl },
  };
}

export function agentTtsOptions(agent: AgentVoiceSummary | null | undefined): ReadAloudOptions {
  return agentTtsDecision(agent).options;
}
