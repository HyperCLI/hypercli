import { describe, expect, it } from "vitest";

import {
  buildDeterministicOpenClawBootstrapPack,
  buildOpenClawBootstrapFileGenerationMessages,
  buildOpenClawBootstrapFileResponseFormat,
  buildOpenClawBootstrapGenerationMessages,
  buildOpenClawBootstrapResponseFormat,
  createDefaultOpenClawBootstrapInputs,
  openClawBootstrapBackupPath,
  parseGeneratedOpenClawBootstrapFile,
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
    expect(messages[0].content).toContain("under 2,000 characters");
    expect(messages[1].content).toContain('"agentName":"Cairn"');
    expect(messages[1].content).toContain('"userName":"Morgan"');
    expect(parseGeneratedOpenClawBootstrapPack(JSON.stringify({ files }), inputs)).toEqual(files);
    expect(buildOpenClawBootstrapResponseFormat(inputs)).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "openclaw_bootstrap_pack",
        strict: true,
        schema: {
          properties: {
            files: {
              minItems: 3,
              maxItems: 3,
              items: {
                properties: {
                  name: { enum: ["AGENTS.md", "SOUL.md", "USER.md"] },
                  content: { maxLength: 2_000 },
                },
              },
            },
          },
        },
      },
    });
  });

  it("builds one length-scoped request and strict response schema per file", () => {
    const inputs = createDefaultOpenClawBootstrapInputs("Cairn");
    const messages = buildOpenClawBootstrapFileGenerationMessages("SOUL.md", inputs);
    const format = buildOpenClawBootstrapFileResponseFormat("SOUL.md");
    const content = "# SOUL.md\n\nBe direct, thoughtful, and honest.";

    expect(messages[0].content).toContain("Generate only SOUL.md");
    expect(messages[0].content).toContain("110-170 words");
    expect(messages[0].content).toContain("650-1,100 characters");
    expect(messages[0].content).toContain("never exceed 1,400 characters");
    expect(format).toMatchObject({
      json_schema: {
        name: "openclaw_soul",
        schema: {
          required: ["name", "content"],
          properties: {
            name: { enum: ["SOUL.md"] },
            content: { maxLength: 1_400 },
          },
        },
      },
    });
    expect(parseGeneratedOpenClawBootstrapFile(
      JSON.stringify({ name: "SOUL.md", content }),
      "SOUL.md",
    )).toEqual({ name: "SOUL.md", content });
    expect(() => parseGeneratedOpenClawBootstrapFile(
      JSON.stringify({ name: "USER.md", content }),
      "SOUL.md",
    )).toThrow("must be SOUL.md");
  });

  it("allows MEMORY.md in the response schema only when meaningful memory is requested", () => {
    const format = buildOpenClawBootstrapResponseFormat({
      includeMemory: true,
      memoryNotes: "The deployment window is Tuesdays.",
    });

    expect(
      ((format.json_schema.schema.properties as Record<string, any>).files.items.properties.name.enum),
    ).toEqual(["AGENTS.md", "SOUL.md", "USER.md", "MEMORY.md"]);
    expect(
      ((format.json_schema.schema.properties as Record<string, any>).files.maxItems),
    ).toBe(4);
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
