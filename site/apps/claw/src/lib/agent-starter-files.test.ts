import { describe, expect, it, vi } from "vitest";

import {
  stageAgentStarterFilesAndStart,
  uniqueStarterFileName,
  uploadAgentStarterFiles,
  type AgentStarterFile,
} from "./agent-starter-files";

function starterFile(name: string, content: string, type = "text/plain"): AgentStarterFile {
  return {
    name,
    size: content.length,
    type,
    arrayBuffer: async () => new TextEncoder().encode(content).buffer as ArrayBuffer,
  };
}

describe("agent starter files", () => {
  it("creates unique safe starter file names", () => {
    const usedNames = new Set<string>();

    expect(uniqueStarterFileName("Launch Brief.txt", usedNames)).toBe("launch-brief.txt");
    expect(uniqueStarterFileName("launch-brief.txt", usedNames)).toBe("launch-brief-1.txt");
    expect(uniqueStarterFileName("", usedNames)).toBe("file");
  });

  it("uploads starter files to workspace storage", async () => {
    const writeFileBytes = vi.fn(async () => undefined);
    const files = [starterFile("Launch Brief.txt", "hello"), starterFile("launch-brief.txt", "again")];

    const uploaded = await uploadAgentStarterFiles({
      agentId: "agent-1",
      files,
      writeFileBytes,
    });

    expect(uploaded.map((file) => file.path)).toEqual([
      ".openclaw/workspace/launch-brief.txt",
      ".openclaw/workspace/launch-brief-1.txt",
    ]);
    expect(writeFileBytes).toHaveBeenNthCalledWith(
      1,
      "agent-1",
      ".openclaw/workspace/launch-brief.txt",
      expect.anything(),
    );
    expect(writeFileBytes).toHaveBeenNthCalledWith(
      2,
      "agent-1",
      ".openclaw/workspace/launch-brief-1.txt",
      expect.anything(),
    );
  });

  it("stages every canonical file on the retained volume before starting the agent", async () => {
    const events: string[] = [];
    const files = [
      starterFile("AGENTS.md", "# AGENTS.md"),
      starterFile("SOUL.md", "# SOUL.md"),
      starterFile("USER.md", "# USER.md"),
    ];

    await stageAgentStarterFilesAndStart({
      agentId: "agent-1",
      files,
      writeFileBytes: async (_agentId, path) => {
        events.push(`write:${path}`);
      },
      startAgent: async (agentId) => {
        events.push(`start:${agentId}`);
      },
    });

    expect(events).toEqual([
      "write:.openclaw/workspace/AGENTS.md",
      "write:.openclaw/workspace/SOUL.md",
      "write:.openclaw/workspace/USER.md",
      "start:agent-1",
    ]);
  });
});
