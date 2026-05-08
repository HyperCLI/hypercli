import { describe, expect, it } from "vitest";

import { resolveOpenClawSessionKey } from "./openclaw-session-key";

describe("openclaw session keys", () => {
  it("keeps the default root session on main", () => {
    expect(resolveOpenClawSessionKey("main")).toBe("main");
    expect(resolveOpenClawSessionKey("")).toBe("main");
    expect(resolveOpenClawSessionKey(undefined)).toBe("main");
  });

  it("uses agent-scoped main sessions for real agents", () => {
    expect(resolveOpenClawSessionKey("agent-123")).toBe("agent:agent-123:main");
    expect(resolveOpenClawSessionKey("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "agent:550e8400-e29b-41d4-a716-446655440000:main",
    );
  });
});
