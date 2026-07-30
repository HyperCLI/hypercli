import { describe, expect, it } from "vitest";

import { agentPrimarySurface } from "./agent-runtime-surface";

describe("agentPrimarySurface", () => {
  it.each(["opencode", "codex", "claude-code", "goose", "kimi-code"])(
    "routes the %s coding runtime to shell",
    (runtime) => {
      expect(agentPrimarySurface(runtime)).toBe("shell");
    },
  );

  it.each(["openclaw", "openclaw-pro", null, undefined])(
    "keeps %s on the gateway chat surface",
    (runtime) => {
      expect(agentPrimarySurface(runtime)).toBe("chat");
    },
  );
});
