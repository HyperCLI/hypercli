import { describe, expect, it } from "vitest";

import {
  deriveAttachmentPresentationState,
  deriveToolWrittenFiles,
} from "./chat-attachment-state";

describe("chat attachment state", () => {
  it("derives files from completed write tool calls", () => {
    expect(deriveToolWrittenFiles([
      {
        name: "write_file",
        args: JSON.stringify({ path: "/home/node/.openclaw/workspace/demo-calendar.ics" }),
        result: JSON.stringify({ status: "ok" }),
      },
    ])).toEqual([
      {
        name: "demo-calendar.ics",
        path: "/home/node/.openclaw/workspace/demo-calendar.ics",
        type: "text/calendar",
      },
    ]);
  });

  it("does not derive files from pending write tool calls", () => {
    expect(deriveToolWrittenFiles([
      {
        name: "write_file",
        args: JSON.stringify({ path: "/home/node/.openclaw/workspace/pending-calendar.ics" }),
      },
    ])).toEqual([]);
  });

  it("lets concrete files win over matching media handles", () => {
    const state = deriveAttachmentPresentationState({
      files: [
        {
          name: "demo-calendar.ics",
          path: "/home/node/.openclaw/workspace/demo-calendar.ics",
          type: "text/calendar",
        },
      ],
      mediaUrls: ["media://inbound/demo-calendar---741bc582-9e41-492d-9a13-d8ecd3a2e0b8.ics"],
    });

    expect(state.status).toBe("ready");
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({
      state: "file",
      file: { name: "demo-calendar.ics" },
    });
  });

  it("turns write-tool paths into exclusive file presentation items", () => {
    const state = deriveAttachmentPresentationState({
      mediaUrls: ["media://inbound/demo-calendar---741bc582-9e41-492d-9a13-d8ecd3a2e0b8.ics"],
      toolCalls: [
        {
          name: "write",
          args: JSON.stringify({ path: "/home/node/.openclaw/workspace/demo-calendar.ics" }),
          result: "path provided",
        },
      ],
    });

    expect(state.status).toBe("ready");
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({
      state: "file",
      file: {
        name: "demo-calendar.ics",
        path: "/home/node/.openclaw/workspace/demo-calendar.ics",
        type: "text/calendar",
      },
    });
  });

  it("keeps unresolved local image handles unavailable", () => {
    const state = deriveAttachmentPresentationState({
      mediaUrls: ["media://inbound/generated-demo---741bc582-9e41-492d-9a13-d8ecd3a2e0b8.png"],
    });

    expect(state.status).toBe("ready");
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({ state: "unavailable", label: "Preview unavailable" });
  });
});
