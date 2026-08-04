import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_NAME_COMBINATION_COUNT,
  generateAgentName,
  isGeneratedAgentName,
} from "./agent-name";

describe("agent name generation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps a broad three-word namespace", () => {
    expect(AGENT_NAME_COMBINATION_COUNT).toBe(2_080_768);
    expect(generateAgentName()).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
  });

  it("walks the namespace without repeating unavailable names", () => {
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      const view = array as Uint32Array;
      view[0] = 0;
      return array;
    });

    const first = generateAgentName();
    const second = generateAgentName([first.toUpperCase()]);

    expect(first).toBe("bright-atlas-anchor");
    expect(second).toBe("bright-atlas-bridge");
  });

  it("recognizes generated names without accepting blocked or custom words", () => {
    expect(isGeneratedAgentName("bright-atlas-anchor")).toBe(true);
    expect(isGeneratedAgentName("bright-signal-anchor")).toBe(false);
    expect(isGeneratedAgentName("my-custom-agent")).toBe(false);
  });
});
