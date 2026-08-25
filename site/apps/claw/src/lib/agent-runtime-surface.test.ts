import { describe, expect, it } from "vitest";

import { agentPrimarySurface } from "./agent-runtime-surface";

describe("agentPrimarySurface", () => {
  it.each(["opencode", "codex", "claude-code", "goose", "kimi-code"])(
    "routes the %s coding runtime to the activity timeline",
    (runtime) => {
      expect(agentPrimarySurface(runtime)).toBe("activity");
    },
  );

  it.each(["openclaw", "openclaw-pro", "hermes-agent", null, undefined])(
    "keeps %s on the gateway chat surface",
    (runtime) => {
      expect(agentPrimarySurface(runtime)).toBe("chat");
    },
  );
});
