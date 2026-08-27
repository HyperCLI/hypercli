import { describe, expect, it } from "vitest";

import { assembleOpenClawBootstrapPack } from "./bootstrap-templates";
import {
  buildOpenClawBootstrapFileGenerationMessages,
  buildOpenClawBootstrapFileResponseFormat,
  buildOpenClawBootstrapGenerationMessages,
  buildOpenClawBootstrapResponseFormat,
  createDefaultOpenClawBootstrapInputs,
  isModelGeneratedOpenClawBootstrapFile,
  materializeOpenClawBootstrapPackForStaging,
  openClawBootstrapBackupPath,
  parseGeneratedOpenClawBootstrapFile,
  parseGeneratedOpenClawBootstrapPack,
  parseOpenClawBootstrapDraft,
  resolveOpenClawBootstrapPack,
  validateOpenClawBootstrapPack,
} from "./openclaw-bootstrap-pack";

describe("OpenClaw bootstrap pack", () => {
  it("builds the canonical required files without retired runtime files", async () => {
    const files = await assembleOpenClawBootstrapPack(
      createDefaultOpenClawBootstrapInputs("Cairn"),
    );

    expect(files.map((file) => file.name)).toEqual([
      "AGENTS.md",
      "SOUL.md",
      "IDENTITY.md",
      "USER.md",
      "BOOTSTRAP.md",
    ]);
    expect(files.map((file) => file.name)).not.toContain("TOOLS.md");
    expect(files.find((file) => file.name === "AGENTS.md")?.content).toContain("## Tools");
    expect(files.find((file) => file.name === "SOUL.md")?.content).toContain("You are Cairn");
    expect(files.find((file) => file.name === "IDENTITY.md")?.content).toContain("- **Name:** Cairn");
    expect(files.find((file) => file.name === "BOOTSTRAP.md")?.content)
      .toContain("structured, multi-turn onboarding ritual");
    expect(isModelGeneratedOpenClawBootstrapFile("IDENTITY.md")).toBe(false);
    expect(isModelGeneratedOpenClawBootstrapFile("BOOTSTRAP.md")).toBe(false);
  });

  it("keeps BOOTSTRAP.md fully static regardless of inputs", async () => {
    const first = await assembleOpenClawBootstrapPack(createDefaultOpenClawBootstrapInputs("Cairn"));
    const second = await assembleOpenClawBootstrapPack({
      ...createDefaultOpenClawBootstrapInputs("Rook"),
      purpose: "Chaos.",
    });
    const firstBootstrap = first.find((file) => file.name === "BOOTSTRAP.md")?.content;
    const secondBootstrap = second.find((file) => file.name === "BOOTSTRAP.md")?.content;

    expect(firstBootstrap).toBe(secondBootstrap);
    expect(firstBootstrap).not.toContain("{{");
    expect(firstBootstrap).not.toContain("Cairn");
    expect(firstBootstrap).toContain("### Identity");
    expect(firstBootstrap).toContain("### Personality / Soul");
    expect(firstBootstrap).toContain("### Context");
    expect(firstBootstrap).toContain("### Research");
    expect(firstBootstrap).toContain("### Setup");
    expect(firstBootstrap).toContain("### Value proposition + close");
    expect(firstBootstrap).toContain("## Completion Criteria");

    const fallbackBootstrap = resolveOpenClawBootstrapPack(null, "Cairn")
      .find((file) => file.name === "BOOTSTRAP.md")?.content;
    expect(fallbackBootstrap).toBe(firstBootstrap);
  });

  it("adds MEMORY.md only when the user opts in with durable context", async () => {
    const withoutNotes = await assembleOpenClawBootstrapPack({
      ...createDefaultOpenClawBootstrapInputs("Cairn"),
      includeMemory: true,
    });
    const withNotes = await assembleOpenClawBootstrapPack({
      ...createDefaultOpenClawBootstrapInputs("Cairn"),
      includeMemory: true,
      memoryNotes: "The user is preparing a product launch.",
    });

    expect(withoutNotes.map((file) => file.name)).not.toContain("MEMORY.md");
    expect(withNotes.map((file) => file.name)).toContain("MEMORY.md");
    const staged = materializeOpenClawBootstrapPackForStaging(withNotes);
    expect(staged.map((file) => file.name)).toEqual(["AGENTS.md", "BOOTSTRAP.md"]);
    expect(staged.find((file) => file.name === "BOOTSTRAP.md")?.content)
      .toContain("### Draft MEMORY.md");
    expect(staged.find((file) => file.name === "BOOTSTRAP.md")?.content)
      .toContain("The user is preparing a product launch.");
  });

  it("moves profile drafts into native BOOTSTRAP.md as unconfirmed setup hints", async () => {
    const draftFiles = await assembleOpenClawBootstrapPack({
      ...createDefaultOpenClawBootstrapInputs("Cairn"),
      userName: "Morgan",
      timezone: "America/New_York",
      companyRole: "Founder at Example Co",
    });

    const staged = materializeOpenClawBootstrapPackForStaging(draftFiles);
    const bootstrap = staged.find((file) => file.name === "BOOTSTRAP.md")?.content ?? "";

    expect(staged.map((file) => file.name)).toEqual(["AGENTS.md", "BOOTSTRAP.md"]);
    expect(bootstrap).toContain("## Unconfirmed setup hints");
    expect(bootstrap).toContain("### Draft SOUL.md");
    expect(bootstrap).toContain("### Draft IDENTITY.md");
    expect(bootstrap).toContain("### Draft USER.md");
    expect(bootstrap).toContain("> - **Name:** Cairn");
    expect(bootstrap).toContain("> - **Name / what to call them:** Morgan");
    expect(bootstrap).toContain("> - **Timezone:** America/New_York");
    expect(bootstrap).toContain("### Compatibility sequencing");
    expect(bootstrap).toContain("do not modify `SOUL.md`, `IDENTITY.md`, or `USER.md`");
    expect(bootstrap).toContain("On the final onboarding turn");
    expect(bootstrap).toContain("Complete every remaining onboarding phase");
  });

  it("validates required names and resolves backup paths", async () => {
    const files = await assembleOpenClawBootstrapPack(
      createDefaultOpenClawBootstrapInputs("Cairn"),
    );

    expect(validateOpenClawBootstrapPack(files)).toEqual(files);
    expect(openClawBootstrapBackupPath("AGENTS.md")).toBe(".openclaw/workspace/AGENTS.md");
    expect(() => validateOpenClawBootstrapPack(files.filter((file) => file.name !== "USER.md")))
      .toThrow("Missing required OpenClaw bootstrap file: USER.md");
  });

  it("builds the model prompt in the frontend and validates its JSON response", async () => {
    const inputs = {
      ...createDefaultOpenClawBootstrapInputs("Cairn"),
      userName: "Morgan",
    };
    const messages = buildOpenClawBootstrapGenerationMessages(inputs);
    const files = await assembleOpenClawBootstrapPack(inputs);

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("Include AGENTS.md, SOUL.md, IDENTITY.md, USER.md, and BOOTSTRAP.md exactly once");
    expect(messages[0].content).toContain("Never emit TOOLS.md");
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
              minItems: 5,
              maxItems: 5,
              items: {
                properties: {
                  name: { enum: ["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "BOOTSTRAP.md"] },
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
    ).toEqual(["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "BOOTSTRAP.md", "MEMORY.md"]);
    expect(
      ((format.json_schema.schema.properties as Record<string, any>).files.maxItems),
    ).toBe(6);
  });

  it("rejects model output with retired files or an unrequested memory file", async () => {
    const inputs = createDefaultOpenClawBootstrapInputs("Cairn");
    const files = await assembleOpenClawBootstrapPack(inputs);

    expect(() => parseGeneratedOpenClawBootstrapPack(JSON.stringify({
      files: [...files, { name: "TOOLS.md", content: "wrong" }],
    }), inputs)).toThrow("Unsupported OpenClaw bootstrap file");
    expect(() => parseGeneratedOpenClawBootstrapPack(JSON.stringify({
      files: [...files, { name: "MEMORY.md", content: "# MEMORY.md\n\nUnexpected." }],
    }), inputs)).toThrow("invalid MEMORY.md selection");
  });

  it("upgrades saved v1 drafts without losing edited legacy files", () => {
    const inputs = createDefaultOpenClawBootstrapInputs("Cairn");
    const upgraded = parseOpenClawBootstrapDraft({
      version: 1,
      inputs,
      files: [
        { name: "AGENTS.md", content: "# AGENTS.md\n\nKeep this exact setup." },
        { name: "SOUL.md", content: "# SOUL.md\n\nQuiet and precise." },
        { name: "USER.md", content: "# USER.md\n\nCall the user Morgan." },
      ],
      generationSource: "model",
    });

    expect(upgraded?.version).toBe(3);
    expect(upgraded?.files.map((file) => file.name)).toEqual([
      "AGENTS.md",
      "SOUL.md",
      "IDENTITY.md",
      "USER.md",
      "BOOTSTRAP.md",
    ]);
    expect(upgraded?.files.find((file) => file.name === "AGENTS.md")?.content)
      .toContain("Keep this exact setup.");
    expect(upgraded?.files.find((file) => file.name === "IDENTITY.md")?.content)
      .toContain("- **Name:** Cairn");
  });

  it("upgrades saved v2 drafts while replacing their stale deterministic bootstrap", () => {
    const inputs = createDefaultOpenClawBootstrapInputs("Cairn");
    const current = assembleOpenClawBootstrapPack(inputs);
    const upgraded = parseOpenClawBootstrapDraft({
      version: 2,
      inputs,
      files: current.map((file) => (
        file.name === "BOOTSTRAP.md"
          ? { ...file, content: "# Old bootstrap\n\nDo the old flow." }
          : file
      )),
      generationSource: "mixed",
    });

    expect(upgraded?.version).toBe(3);
    expect(upgraded?.generationSource).toBe("mixed");
    expect(upgraded?.files.find((file) => file.name === "BOOTSTRAP.md")?.content)
      .toContain("structured, multi-turn onboarding ritual");
    expect(upgraded?.files.find((file) => file.name === "BOOTSTRAP.md")?.content)
      .not.toContain("Do the old flow");
    expect(parseOpenClawBootstrapDraft({
      version: "2",
      inputs,
      files: current,
    })).toBeNull();
  });
});
