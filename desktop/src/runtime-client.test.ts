/**
 * The session-picker gate (Sidebar `AgentRow` click → `SessionPicker`, plus
 * the sessions sweep). The pinned regression: the row click gated on
 * `runtimeFamily === "acp"`, so OpenClaw and Hermes agents selected straight
 * into their default session and never showed the new-session/session-picker
 * modal ACP agents get. The gate is the capability table's transport, so
 * every session-backed family picks sessions from one place.
 */
import { describe, expect, it, vi } from "vitest";
import type { AgentSummary } from "./api";
import { canPickChatSession, canRuntimeChat, runtimeChatCapability } from "./runtime-client";

// The capability predicates never call into api.ts; the mock keeps the heavy
// client layer (tauri core, SDK construction) out of the module graph.
vi.mock("./api", () => ({
  runtimeChatAbort: vi.fn(),
  runtimeHistory: vi.fn(),
  runtimeHistoryForSession: vi.fn(),
  streamRuntimeMessage: vi.fn(),
}));

function agentWithRuntime(runtime: string | null): AgentSummary {
  return {
    id: "agent-1",
    name: "Agent",
    handle: null,
    avatar_url: null,
    avatar_audio_url: null,
    runtime,
    state: "RUNNING",
    hostname: null,
    launch_epoch: 0,
    size: null,
  };
}

describe("canPickChatSession", () => {
  it("picks sessions for every ACP coding runtime", () => {
    for (const runtime of ["opencode", "codex", "claude-code", "goose", "kimi-code", "buzz-agent"]) {
      expect(canPickChatSession(agentWithRuntime(runtime))).toBe(true);
    }
  });

  it("picks sessions for OpenClaw and Hermes through their canonical session client", () => {
    for (const runtime of ["openclaw", "openclaw-pro", "hermes-agent"]) {
      expect(canPickChatSession(agentWithRuntime(runtime))).toBe(true);
    }
  });

  it("does not offer sessions for the generic runtime or an unknown one", () => {
    expect(canPickChatSession(agentWithRuntime("generic"))).toBe(false);
    expect(canPickChatSession(agentWithRuntime(null))).toBe(false);
  });

  it("agrees with the chat capability: session-backed families are chattable", () => {
    for (const runtime of ["opencode", "openclaw", "hermes-agent"]) {
      const agent = agentWithRuntime(runtime);
      expect(canPickChatSession(agent)).toBe(true);
      expect(canRuntimeChat(agent)).toBe(true);
      expect(runtimeChatCapability(agent).unavailable).toBeNull();
    }
    expect(runtimeChatCapability(agentWithRuntime("generic")).transport).toBe("none");
  });
});
