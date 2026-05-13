import { describe, expect, it, vi } from "vitest";

import { hydrateOpenClawSession } from "./openclaw-session";
import { resolveOpenClawSessionKey } from "./openclaw-session-key";

describe("openclaw session keys", () => {
  it("keeps the default root session on main", () => {
    expect(resolveOpenClawSessionKey("main")).toBe("main");
    expect(resolveOpenClawSessionKey("")).toBe("main");
    expect(resolveOpenClawSessionKey(undefined)).toBe("main");
  });

  it("keeps deployment ids out of gateway session keys", () => {
    expect(resolveOpenClawSessionKey("agent-123")).toBe("main");
    expect(resolveOpenClawSessionKey("550e8400-e29b-41d4-a716-446655440000")).toBe("main");
  });

  it("keeps deployment-scoped chat history separate from gateway file agent ids", async () => {
    const gateway = {
      configGet: vi.fn(async () => ({})),
      configSchema: vi.fn(async () => null),
      chatHistory: vi.fn(async () => []),
      agentsList: vi.fn(async () => [
        { id: "550e8400-e29b-41d4-a716-446655440000" },
        { id: "main" },
      ]),
      sessionsList: vi.fn(async () => []),
      cronList: vi.fn(async () => []),
      modelsList: vi.fn(async () => []),
      filesList: vi.fn(async () => []),
    };

    const hydrated = await hydrateOpenClawSession(gateway as any, "550e8400-e29b-41d4-a716-446655440000");

    expect(gateway.chatHistory).toHaveBeenCalledWith("main", 200);
    expect(gateway.filesList).toHaveBeenCalledWith("main");
    expect(hydrated.gwAgentId).toBe("main");
  });
});
