import { describe, expect, it } from "vitest";

import {
  createOpenClawConfigValue,
  describeOpenClawConfigNode,
  normalizeOpenClawConfigSchema,
  normalizeOpenClawConfigSchemaNode,
  resolveOpenClawConfigUiHint,
} from "../src/gateway.js";

describe("OpenClaw config schema helpers", () => {
  it("preserves the schema envelope when uiHints are present", () => {
    const normalized = normalizeOpenClawConfigSchema({
      schema: {
        type: "object",
        properties: {
          gateway: { type: "object" },
        },
      },
      uiHints: {
        gateway: { label: "Gateway", order: 30 },
      },
      version: "2026-03-13",
      generatedAt: "2026-03-13T00:00:00.000Z",
    });

    expect(normalized).toEqual({
      schema: {
        type: "object",
        properties: {
          gateway: { type: "object" },
        },
      },
      uiHints: {
        gateway: { label: "Gateway", order: 30 },
      },
      version: "2026-03-13",
      generatedAt: "2026-03-13T00:00:00.000Z",
    });
  });

  it("wraps raw schema objects for older callers", () => {
    const normalized = normalizeOpenClawConfigSchema({
      type: "object",
      properties: {
        gateway: { type: "object" },
      },
    });

    expect(normalized).toEqual({
      schema: {
        type: "object",
        properties: {
          gateway: { type: "object" },
        },
      },
      uiHints: {},
    });
  });

  it("resolves wildcard uiHints to the most specific match", () => {
    const match = resolveOpenClawConfigUiHint(
      {
        "agents.list.*.heartbeat.target": { label: "Target" },
        "agents.list.*.heartbeat": { label: "Heartbeat" },
      },
      "agents.list.main.heartbeat.target",
    );

    expect(match).toEqual({
      path: "agents.list.*.heartbeat.target",
      hint: { label: "Target" },
    });
  });

  it("describes collapsed additionalProperties maps", () => {
    const descriptor = describeOpenClawConfigNode({
      type: "object",
      additionalProperties: true,
    });

    expect(descriptor.additionalProperties).toBe(true);
    expect(descriptor.additionalPropertySchema).toBeNull();
    expect(descriptor.isDynamicMap).toBe(true);
  });

  it("normalizes nullable schema nodes and derives default values", () => {
    const node = normalizeOpenClawConfigSchemaNode({
      oneOf: [
        { type: "null" },
        { type: "object", additionalProperties: true },
      ],
    });

    expect(node).toEqual({ type: "object", additionalProperties: true });
    expect(createOpenClawConfigValue(node)).toEqual({});
  });
});
