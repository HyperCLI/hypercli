import { beforeEach, describe, expect, it } from "vitest";
import { READ_ALOUD_PREF_KEY, readAloudEnabled } from "./voice-read";
import { setVoiceRepliesEnabled, setVoiceRepliesReadAloudEnabled, voiceRepliesEnabled } from "./voice-replies";

describe("voice replies preference", () => {
  const storage = new Map<string, string>();
  const store = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  };

  beforeEach(() => storage.clear());

  it("defaults each agent to off", () => {
    expect(voiceRepliesEnabled("agent-a", store)).toBe(false);
    expect(voiceRepliesEnabled("agent-b", store)).toBe(false);
  });

  it("persists per-agent state independently", () => {
    setVoiceRepliesEnabled("agent-a", true, store);

    expect(voiceRepliesEnabled("agent-a", store)).toBe(true);
    expect(voiceRepliesEnabled("agent-b", store)).toBe(false);

    setVoiceRepliesEnabled("agent-a", false, store);
    expect(voiceRepliesEnabled("agent-a", store)).toBe(false);
  });

  it("mirrors the active agent setting into the global read-aloud key", () => {
    setVoiceRepliesReadAloudEnabled("agent-a", true, store);
    expect(voiceRepliesEnabled("agent-a", store)).toBe(true);
    expect(storage.get(READ_ALOUD_PREF_KEY)).toBe("1");
    expect(readAloudEnabled(store)).toBe(true);

    setVoiceRepliesReadAloudEnabled("agent-a", false, store);
    expect(voiceRepliesEnabled("agent-a", store)).toBe(false);
    expect(readAloudEnabled(store)).toBe(false);
  });
});
