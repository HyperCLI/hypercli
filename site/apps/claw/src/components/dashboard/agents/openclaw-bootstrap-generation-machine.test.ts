import { describe, expect, it } from "vitest";

import {
  createOpenClawBootstrapGenerationState,
  isOpenClawBootstrapGenerationActive,
  openClawBootstrapGenerationReducer,
} from "./openclaw-bootstrap-generation-machine";

describe("openClawBootstrapGenerationReducer", () => {
  it("tracks each background file through queued, generating, and terminal states", () => {
    let state = createOpenClawBootstrapGenerationState();
    state = openClawBootstrapGenerationReducer(state, {
      type: "QUEUE",
      runId: 4,
      names: ["AGENTS.md", "SOUL.md", "USER.md"],
    });
    state = openClawBootstrapGenerationReducer(state, { type: "START", runId: 4, name: "AGENTS.md" });
    state = openClawBootstrapGenerationReducer(state, { type: "SUCCEED", runId: 4, name: "AGENTS.md" });
    state = openClawBootstrapGenerationReducer(state, { type: "START", runId: 4, name: "SOUL.md" });
    state = openClawBootstrapGenerationReducer(state, {
      type: "FALL_BACK",
      runId: 4,
      name: "SOUL.md",
      error: "timed out",
    });

    expect(state.files).toEqual({
      "AGENTS.md": { status: "ready" },
      "SOUL.md": { status: "fallback", error: "timed out" },
      "USER.md": { status: "queued" },
    });
    expect(isOpenClawBootstrapGenerationActive(state)).toBe(true);
  });

  it("ignores completions from a superseded run", () => {
    let state = openClawBootstrapGenerationReducer(createOpenClawBootstrapGenerationState(), {
      type: "QUEUE",
      runId: 2,
      names: ["AGENTS.md"],
    });
    state = openClawBootstrapGenerationReducer(state, {
      type: "RESET_TO_FALLBACK",
      runId: 3,
      names: ["AGENTS.md", "SOUL.md", "USER.md"],
    });

    expect(openClawBootstrapGenerationReducer(state, {
      type: "SUCCEED",
      runId: 2,
      name: "AGENTS.md",
    })).toBe(state);
    expect(isOpenClawBootstrapGenerationActive(state)).toBe(false);
  });
});
