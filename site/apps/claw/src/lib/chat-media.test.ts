import { describe, expect, it } from "vitest";

import {
  classifyChatMediaReference,
  extractContentMediaReferences,
  findFileForMediaReference,
  mediaWorkspacePathFromReference,
} from "./chat-media";

describe("chat media references", () => {
  it("classifies OpenClaw workspace MEDIA paths as generated workspace media", () => {
    const reference = classifyChatMediaReference("MEDIA:/home/node/.openclaw/workspace/865621.jpg");

    expect(reference).toMatchObject({
      kind: "workspace",
      raw: "MEDIA:/home/node/.openclaw/workspace/865621.jpg",
      media: {
        displayPath: "/home/865621.jpg",
        file: {
          name: "865621.jpg",
          path: ".openclaw/workspace/865621.jpg",
          type: "image/jpeg",
        },
      },
    });
  });

  it("matches local media handles back to workspace files with UUID suffixes", () => {
    const file = {
      name: "bosquejo.png",
      path: "/home/node/.openclaw/workspace/bosquejo.png",
      type: "image/png",
    };

    expect(findFileForMediaReference([
      file,
    ], "media://inbound/bosquejo---741bc582-9e41-492d-9a13-d8ecd3a2e0b8.png")).toBe(file);
  });

  it("extracts quoted inline MEDIA workspace paths before markdown rendering", () => {
    const result = extractContentMediaReferences(
      "Generated: MEDIA:\"/home/node/.openclaw/workspace/865621.jpg\"\nDone.",
    );

    expect(result.content).toBe("Generated:\nDone.");
    expect(result.mediaFiles).toHaveLength(1);
    expect(result.mediaFiles[0]).toMatchObject({
      displayPath: "/home/865621.jpg",
      file: { path: ".openclaw/workspace/865621.jpg" },
    });
    expect(result.directMedia).toHaveLength(0);
    expect(result.pendingMedia).toBe(false);
  });

  it("extracts direct audio MEDIA urls and strips raw url text", () => {
    const result = extractContentMediaReferences("Audio reply\nMEDIA:https://cdn.example.test/output/final.wav");

    expect(result.content).toBe("Audio reply");
    expect(result.mediaFiles).toHaveLength(0);
    expect(result.directMedia).toEqual([
      {
        kind: "audio",
        url: "https://cdn.example.test/output/final.wav",
        fileName: "final.wav",
        raw: "https://cdn.example.test/output/final.wav",
      },
    ]);
  });

  it("consumes markdown MEDIA local handles without leaking media URLs", () => {
    const result = extractContentMediaReferences(
      "![MEDIA](media://inbound/generated---741bc582-9e41-492d-9a13-d8ecd3a2e0b8.png)",
    );

    expect(result.content).toBe("");
    expect(result.mediaFiles).toHaveLength(0);
    expect(result.directMedia).toEqual([
      {
        kind: "local",
        raw: "media://inbound/generated---741bc582-9e41-492d-9a13-d8ecd3a2e0b8.png",
        label: "Preview unavailable",
      },
    ]);
  });

  it("consumes bare inline local media handles without losing the media scheme", () => {
    const result = extractContentMediaReferences(
      "Here is media://inbound/generated---741bc582-9e41-492d-9a13-d8ecd3a2e0b8.png",
    );

    expect(result.content).toBe("Here is");
    expect(result.directMedia).toEqual([
      {
        kind: "local",
        raw: "media://inbound/generated---741bc582-9e41-492d-9a13-d8ecd3a2e0b8.png",
        label: "Preview unavailable",
      },
    ]);
  });

  it("tracks incomplete MEDIA sentinels as pending without exposing text", () => {
    const result = extractContentMediaReferences("Working\nMEDIA:");

    expect(result.content).toBe("Working");
    expect(result.mediaFiles).toHaveLength(0);
    expect(result.directMedia).toHaveLength(0);
    expect(result.pendingMedia).toBe(true);
  });

  it("strips wrappers and trailing sentence punctuation from media paths", () => {
    expect(mediaWorkspacePathFromReference("MEDIA:(/home/node/.openclaw/workspace/865621.jpg)."))
      .toBe("/home/node/.openclaw/workspace/865621.jpg");
  });
});
