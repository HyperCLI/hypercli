import { describe, expect, it } from "vitest";
import { agentTtsDecision, agentTtsOptions, hasAgentVoice } from "./voice-feature-service";

describe("voice feature service", () => {
  it("disables read-aloud when the agent has no voice", () => {
    expect(hasAgentVoice(null)).toBe(false);
    expect(agentTtsDecision({ avatar_audio_url: " " })).toEqual({
      name: "disabled",
      reason: "missing-agent-voice",
      options: {},
    });
    expect(agentTtsOptions(null)).toEqual({});
  });

  it("clones from the agent's reference audio when a voice is configured", () => {
    const agent = { avatar_audio_url: "https://example.com/voice.wav" };

    expect(hasAgentVoice(agent)).toBe(true);
    expect(agentTtsDecision(agent)).toEqual({
      name: "clone-voice",
      reason: "agent-voice-reference",
      options: { referenceAudioUrl: "https://example.com/voice.wav" },
    });
    expect(agentTtsOptions(agent)).toEqual({ referenceAudioUrl: "https://example.com/voice.wav" });
  });

  it("never selects a preset voice", () => {
    expect(agentTtsOptions({ avatar_audio_url: "https://example.com/voice.wav" }).voice).toBeUndefined();
  });
});
