import { describe, expect, it, vi } from "vitest";

import {
  describeStarterFileFailures,
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

    const { uploaded, failures } = await uploadAgentStarterFiles({
      agentId: "agent-1",
      files,
      writeFileBytes,
    });

    expect(failures).toEqual([]);
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

  it("retries a workspace route that is not serving yet until the write lands", async () => {
    vi.useFakeTimers();
    try {
      const attempts: string[] = [];
      // 409 (deployment still starting), 404 (agent hostname edge has no origin
      // yet) and a browser network failure are all transient launch states.
      const writeFileBytes = vi.fn(async (_agentId: string, path: string) => {
        attempts.push(path);
        if (attempts.length === 1) throw Object.assign(new Error("Conflict"), { statusCode: 409 });
        if (attempts.length === 2) throw Object.assign(new Error("404 page not found"), { statusCode: 404 });
        if (attempts.length === 3) throw new TypeError("Failed to fetch");
        if (attempts.length === 4) throw Object.assign(new Error("Unavailable"), { statusCode: 503 });
      });

      const upload = uploadAgentStarterFiles({
        agentId: "agent-1",
        files: [starterFile("AGENTS.md", "agents"), starterFile("SOUL.md", "soul")],
        writeFileBytes,
      });
      await vi.runAllTimersAsync();
      const { uploaded, failures } = await upload;

      expect(failures).toEqual([]);
      expect(uploaded.map((file) => file.path)).toEqual([
        ".openclaw/workspace/AGENTS.md",
        ".openclaw/workspace/SOUL.md",
      ]);
      expect(attempts).toEqual([
        ".openclaw/workspace/AGENTS.md",
        ".openclaw/workspace/AGENTS.md",
        ".openclaw/workspace/AGENTS.md",
        ".openclaw/workspace/AGENTS.md",
        ".openclaw/workspace/AGENTS.md",
        ".openclaw/workspace/SOUL.md",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry permanent starter file upload failures", async () => {
    const error = Object.assign(new Error("Forbidden"), { statusCode: 403 });
    const writeFileBytes = vi.fn(async () => {
      throw error;
    });

    const { uploaded, failures } = await uploadAgentStarterFiles({
      agentId: "agent-1",
      files: [starterFile("AGENTS.md", "agents")],
      writeFileBytes,
    });

    expect(uploaded).toEqual([]);
    expect(failures.map((failure) => failure.error)).toEqual([error]);
    expect(writeFileBytes).toHaveBeenCalledOnce();
  });

  it("keeps uploading the rest of the pack after one file fails", async () => {
    const writeFileBytes = vi.fn(async (_agentId: string, path: string) => {
      if (path.endsWith("SOUL.md")) throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
    });

    const { uploaded, failures } = await uploadAgentStarterFiles({
      agentId: "agent-1",
      files: [
        starterFile("AGENTS.md", "agents"),
        starterFile("SOUL.md", "soul"),
        starterFile("USER.md", "user"),
      ],
      writeFileBytes,
    });

    expect(uploaded.map((file) => file.name)).toEqual(["AGENTS.md", "USER.md"]);
    expect(failures.map((failure) => failure.name)).toEqual(["SOUL.md"]);
    expect(describeStarterFileFailures(failures)).toContain("SOUL.md");
  });

  it("starts the Agent alongside staging so the write route can come up", async () => {
    const events: string[] = [];
    const files = [
      starterFile("AGENTS.md", "# AGENTS.md"),
      starterFile("SOUL.md", "# SOUL.md"),
      starterFile("USER.md", "# USER.md"),
    ];

    const { uploaded, failures } = await stageAgentStarterFilesAndStart({
      agentId: "agent-1",
      files,
      writeFileBytes: async (_agentId, path) => {
        events.push(`write:${path}`);
      },
      startAgent: async (agentId) => {
        events.push(`start:${agentId}`);
      },
    });

    expect(failures).toEqual([]);
    expect(uploaded).toHaveLength(3);
    expect(events).toEqual([
      "start:agent-1",
      "write:.openclaw/workspace/AGENTS.md",
      "write:.openclaw/workspace/SOUL.md",
      "write:.openclaw/workspace/USER.md",
    ]);
  });

  it("starts the Agent even when no starter file can be written", async () => {
    const started: string[] = [];

    const { uploaded, failures } = await stageAgentStarterFilesAndStart({
      agentId: "agent-1",
      files: [starterFile("AGENTS.md", "agents"), starterFile("SOUL.md", "soul")],
      writeFileBytes: async () => {
        throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
      },
      startAgent: async (agentId) => {
        started.push(agentId);
      },
    });

    expect(started).toEqual(["agent-1"]);
    expect(uploaded).toEqual([]);
    expect(failures).toHaveLength(2);
    expect(describeStarterFileFailures(failures)).toMatch(/^Agent started, but 2 starter files could not be uploaded/);
  });

  it("stops retrying and surfaces the launch failure when the start fails", async () => {
    vi.useFakeTimers();
    try {
      const startError = new Error("Agent entered FAILED while confirming launch.");
      const writeFileBytes = vi.fn(async () => {
        throw Object.assign(new Error("Conflict"), { statusCode: 409 });
      });

      const staged = stageAgentStarterFilesAndStart({
        agentId: "agent-1",
        files: [starterFile("AGENTS.md", "agents")],
        writeFileBytes,
        startAgent: async () => {
          throw startError;
        },
      });
      const settled = expect(staged).rejects.toBe(startError);
      await vi.runAllTimersAsync();
      await settled;

      expect(writeFileBytes).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
