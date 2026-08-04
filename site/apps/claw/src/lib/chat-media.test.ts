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

  it("extracts direct video MEDIA urls and strips raw url text", () => {
    const result = extractContentMediaReferences("Video clip\nMEDIA:https://cdn.example.test/output/clip.mp4");

    expect(result.content).toBe("Video clip");
    expect(result.mediaFiles).toHaveLength(0);
    expect(result.directMedia).toEqual([
      {
        kind: "video",
        url: "https://cdn.example.test/output/clip.mp4",
        fileName: "clip.mp4",
        raw: "https://cdn.example.test/output/clip.mp4",
      },
    ]);
  });

  it("extracts known direct image urls instead of treating all HTTP resources as images", () => {
    const result = extractContentMediaReferences("Image\nMEDIA:https://cdn.example.test/output/final.png");

    expect(result.content).toBe("Image");
    expect(result.directMedia).toEqual([
      {
        kind: "image",
        url: "https://cdn.example.test/output/final.png",
        fileName: "final.png",
        raw: "https://cdn.example.test/output/final.png",
      },
    ]);
  });

  it("extracts typed media data urls", () => {
    const url = "data:image/png;base64,aW1hZ2U=";
    const result = extractContentMediaReferences(`MEDIA:${url}`);

    expect(result.content).toBe("");
    expect(result.directMedia).toEqual([
      {
        kind: "image",
        url,
        fileName: "media",
        raw: url,
      },
    ]);
  });

  it("classifies known non-image direct MEDIA urls as links", () => {
    const result = extractContentMediaReferences("Source\nMEDIA:https://cdn.example.test/src/app.tsx");

    expect(result.content).toBe("Source");
    expect(result.directMedia).toEqual([
      {
        kind: "link",
        url: "https://cdn.example.test/src/app.tsx",
        fileName: "app.tsx",
        raw: "https://cdn.example.test/src/app.tsx",
      },
    ]);
  });

  it("preserves unknown HTTP resources instead of assuming they are images", () => {
    const content = "Resource\nMEDIA:https://cdn.example.test/output/opaque-resource";
    const result = extractContentMediaReferences(content);

    expect(result.content).toBe(content);
    expect(result.mediaFiles).toHaveLength(0);
    expect(result.directMedia).toHaveLength(0);
    expect(result.pendingMedia).toBe(false);
    expect(classifyChatMediaReference("https://cdn.example.test/output/opaque-resource"))
      .toMatchObject({ kind: "unsupported" });
  });

  it("preserves ordinary prose containing MEDIA text", () => {
    for (const content of [
      "MEDIA: literacy matters",
      "The MEDIA: section explains photos.",
    ]) {
      expect(extractContentMediaReferences(content)).toEqual({
        content,
        mediaFiles: [],
        directMedia: [],
        pendingMedia: false,
      });
    }
  });

  it("rejects executable schemes before classifying media extensions", () => {
    expect(classifyChatMediaReference("javascript:play.mp3")).toEqual({
      kind: "unsupported",
      raw: "javascript:play.mp3",
      label: "Preview unavailable",
    });
    expect(classifyChatMediaReference("data:text/html;base64,PHNjcmlwdD4=")).toEqual({
      kind: "unsupported",
      raw: "data:text/html;base64,PHNjcmlwdD4=",
      label: "Preview unavailable",
    });
    expect(classifyChatMediaReference("\u0000javascript:play.mp3")).toMatchObject({ kind: "unsupported" });
    expect(classifyChatMediaReference("java\nscript:play.mp3")).toMatchObject({ kind: "unsupported" });
  });

  it("requires type context before classifying blob media urls", () => {
    expect(classifyChatMediaReference("blob:opaque-media")).toMatchObject({ kind: "unsupported" });
    expect(classifyChatMediaReference("blob:audio", {
      name: "reply.mp3",
      path: "/workspace/reply.mp3",
      type: "audio/mpeg",
    })).toMatchObject({ kind: "audio", url: "blob:audio", fileName: "reply.mp3" });
  });

  it("classifies ICS local MEDIA handles as recognized file references", () => {
    const result = extractContentMediaReferences(
      "Calendar ready\nMEDIA:media://inbound/placeholder-calendar---741bc582-9e41-492d-9a13-d8ecd3a2e0b8.ics",
    );

    expect(result.content).toBe("Calendar ready");
    expect(result.mediaFiles).toHaveLength(0);
    expect(result.directMedia).toEqual([
      {
        kind: "file",
        fileName: "placeholder-calendar.ics",
        raw: "media://inbound/placeholder-calendar---741bc582-9e41-492d-9a13-d8ecd3a2e0b8.ics",
      },
    ]);
    expect(result.pendingMedia).toBe(false);
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

  it("only hides incomplete MEDIA sentinels while they are streaming", () => {
    const result = extractContentMediaReferences("Working\nMEDIA:", { streaming: true });

    expect(result.content).toBe("Working");
    expect(result.mediaFiles).toHaveLength(0);
    expect(result.directMedia).toHaveLength(0);
    expect(result.pendingMedia).toBe(true);

    expect(extractContentMediaReferences("MEDIA")).toEqual({
      content: "MEDIA",
      mediaFiles: [],
      directMedia: [],
      pendingMedia: false,
    });
    expect(extractContentMediaReferences("MEDIA:")).toEqual({
      content: "MEDIA:",
      mediaFiles: [],
      directMedia: [],
      pendingMedia: false,
    });
  });

  it("defers ambiguous trailing MEDIA urls while streaming", () => {
    const partial = extractContentMediaReferences(
      "Preparing speech\nMEDIA:https://cdn.example.test/output/reply.m",
      { streaming: true },
    );

    expect(partial.content).toBe("Preparing speech");
    expect(partial.directMedia).toHaveLength(0);
    expect(partial.pendingMedia).toBe(true);

    const settledInvalid = extractContentMediaReferences(
      "Preparing speech\nMEDIA:https://cdn.example.test/output/reply.m",
    );
    expect(settledInvalid.content).toBe("Preparing speech\nMEDIA:https://cdn.example.test/output/reply.m");
    expect(settledInvalid.directMedia).toHaveLength(0);
    expect(settledInvalid.pendingMedia).toBe(false);

    const complete = extractContentMediaReferences(
      "Preparing speech\nMEDIA:https://cdn.example.test/output/reply.mp3",
      { streaming: true },
    );
    expect(complete.directMedia).toMatchObject([{ kind: "audio", url: "https://cdn.example.test/output/reply.mp3" }]);
    expect(complete.pendingMedia).toBe(false);
  });

  it("strips wrappers and trailing sentence punctuation from media paths", () => {
    expect(mediaWorkspacePathFromReference("MEDIA:(/home/node/.openclaw/workspace/865621.jpg)."))
      .toBe("/home/node/.openclaw/workspace/865621.jpg");
  });
});
