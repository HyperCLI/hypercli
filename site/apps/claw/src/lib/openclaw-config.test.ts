import { describe, expect, it } from "vitest";

import { extractVoicePathFromMessage } from "./openclaw-config";

describe("OpenClaw voice path extraction", () => {
  it.each([
    "voice-123.webm",
    "audio-summary.wav",
    "reply-message.mp3",
    "tts-serena.opus",
    "speech-report.m4a",
  ])("recognizes generated audio output %s", (fileName) => {
    expect(extractVoicePathFromMessage(`Generated speech saved at ${fileName}`))
      .toBe(`/home/node/.openclaw/workspace/${fileName}`);
  });

  it("does not treat arbitrary mentioned audio files as generated voice replies", () => {
    expect(extractVoicePathFromMessage("Review meeting-recording.mp3 later.")).toBeNull();
  });
});
