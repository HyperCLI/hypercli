import { describe, expect, it } from "vitest";

import {
  buildDeterministicOpenClawBootstrapPack,
  buildOpenClawBootstrapGenerationMessages,
  createDefaultOpenClawBootstrapInputs,
  openClawBootstrapBackupPath,
  parseGeneratedOpenClawBootstrapPack,
  validateOpenClawBootstrapPack,
} from "./openclaw-bootstrap-pack";

describe("OpenClaw bootstrap pack", () => {
  it("builds the canonical required files without retired runtime files", () => {
    const files = buildDeterministicOpenClawBootstrapPack(
      createDefaultOpenClawBootstrapInputs("Cairn"),
    );

    expect(files.map((file) => file.name)).toEqual(["AGENTS.md", "SOUL.md", "USER.md"]);
    expect(files.map((file) => file.name)).not.toContain("TOOLS.md");
    expect(files.map((file) => file.name)).not.toContain("BOOTSTRAP.md");
    expect(files.find((file) => file.name === "AGENTS.md")?.content).toContain("## Tools");
    expect(files.find((file) => file.name === "SOUL.md")?.content).toContain("You are Cairn");
  });

  it("adds MEMORY.md only when the user opts in with durable context", () => {
    const withoutNotes = buildDeterministicOpenClawBootstrapPack({
      ...createDefaultOpenClawBootstrapInputs("Cairn"),
      includeMemory: true,
    });
    const withNotes = buildDeterministicOpenClawBootstrapPack({
      ...createDefaultOpenClawBootstrapInputs("Cairn"),
      includeMemory: true,
      memoryNotes: "The user is preparing a product launch.",
    });

    expect(withoutNotes.map((file) => file.name)).not.toContain("MEMORY.md");
    expect(withNotes.map((file) => file.name)).toContain("MEMORY.md");
  });

  it("validates required names and resolves backup paths", () => {
    const files = buildDeterministicOpenClawBootstrapPack(
      createDefaultOpenClawBootstrapInputs("Cairn"),
    );

    expect(validateOpenClawBootstrapPack(files)).toEqual(files);
    expect(openClawBootstrapBackupPath("AGENTS.md")).toBe(".openclaw/workspace/AGENTS.md");
    expect(() => validateOpenClawBootstrapPack(files.filter((file) => file.name !== "USER.md")))
      .toThrow("Missing required OpenClaw bootstrap file: USER.md");
  });

  it("builds the model prompt in the frontend and validates its JSON response", () => {
    const inputs = {
      ...createDefaultOpenClawBootstrapInputs("Cairn"),
      userName: "Morgan",
    };
    const messages = buildOpenClawBootstrapGenerationMessages(inputs);
    const files = buildDeterministicOpenClawBootstrapPack(inputs);

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("Never emit BOOTSTRAP.md");
    expect(messages[1].content).toContain('"agentName":"Cairn"');
    expect(messages[1].content).toContain('"userName":"Morgan"');
    expect(parseGeneratedOpenClawBootstrapPack(JSON.stringify({ files }), inputs)).toEqual(files);
  });

  it("rejects model output with retired files or an unrequested memory file", () => {
    const inputs = createDefaultOpenClawBootstrapInputs("Cairn");
    const files = buildDeterministicOpenClawBootstrapPack(inputs);

    expect(() => parseGeneratedOpenClawBootstrapPack(JSON.stringify({
      files: [...files, { name: "BOOTSTRAP.md", content: "wrong" }],
    }), inputs)).toThrow("Unsupported OpenClaw bootstrap file");
    expect(() => parseGeneratedOpenClawBootstrapPack(JSON.stringify({
      files: [...files, { name: "MEMORY.md", content: "# MEMORY.md\n\nUnexpected." }],
    }), inputs)).toThrow("invalid MEMORY.md selection");
  });
});
