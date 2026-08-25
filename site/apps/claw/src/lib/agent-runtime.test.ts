import { describe, expect, it } from "vitest";

import { isBuzzAgentRuntime, isHermesAgentRuntime } from "./agent-runtime";

describe("isBuzzAgentRuntime", () => {
  it("accepts buzz-backed runtimes", () => {
    for (const runtime of ["buzz-agent", "opencode", "codex", "claude-code", "goose", "kimi-code"]) {
      expect(isBuzzAgentRuntime(runtime)).toBe(true);
    }
  });

  it("rejects hermes, openclaw, and empty runtimes", () => {
    expect(isBuzzAgentRuntime("hermes-agent")).toBe(false);
    expect(isBuzzAgentRuntime("openclaw")).toBe(false);
    expect(isBuzzAgentRuntime("openclaw-pro")).toBe(false);
    expect(isBuzzAgentRuntime(null)).toBe(false);
    expect(isBuzzAgentRuntime(undefined)).toBe(false);
  });

  it("stays distinct from the hermes runtime check", () => {
    expect(isHermesAgentRuntime("hermes-agent")).toBe(true);
    expect(isHermesAgentRuntime("buzz-agent")).toBe(false);
  });
});
