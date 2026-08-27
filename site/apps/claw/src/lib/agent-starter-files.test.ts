import { describe, expect, it, vi } from "vitest";

import {
  AgentStarterFileStagingError,
  OPENCLAW_PRESEEDED_CONFIG_PATH,
  describeStarterFileFailures,
  prepareOpenClawStarterFiles,
  stageAgentStarterFilesAndStart,
  uniqueStarterFileName,
  uploadAgentStarterFiles,
  validateOpenClawStarterFiles,
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

function canonicalStarterFiles(): AgentStarterFile[] {
  return ["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "BOOTSTRAP.md"]
    .map((name) => starterFile(name, `# ${name}\n\n${name} content`));
}

function inMemoryFileApi(events: string[] = []) {
  const storage = new Map<string, Uint8Array>();
  return {
    storage,
    writeFileBytes: vi.fn(async (_agentId: string, path: string, content: ArrayBuffer) => {
      events.push(`write:${path}`);
      storage.set(path, new Uint8Array(content).slice());
    }),
    readFileBytes: vi.fn(async (_agentId: string, path: string) => {
      events.push(`read:${path}`);
      const content = storage.get(path);
      if (!content) throw Object.assign(new Error("Not found"), { statusCode: 404 });
      return content.slice();
    }),
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

  it("writes and verifies the runtime config and complete workspace before START", async () => {
    const events: string[] = [];
    const files = canonicalStarterFiles();
    const fileApi = inMemoryFileApi(events);

    const { uploaded, failures } = await stageAgentStarterFilesAndStart({
      agentId: "agent-1",
      files,
      writeFileBytes: fileApi.writeFileBytes,
      readFileBytes: fileApi.readFileBytes,
      startAgent: async (agentId) => {
        events.push(`start:${agentId}`);
      },
    });

    expect(failures).toEqual([]);
    expect(uploaded).toHaveLength(5);
    expect(events).toEqual([
      `write:${OPENCLAW_PRESEEDED_CONFIG_PATH}`,
      `read:${OPENCLAW_PRESEEDED_CONFIG_PATH}`,
      "write:.openclaw/workspace/AGENTS.md",
      "read:.openclaw/workspace/AGENTS.md",
      "write:.openclaw/workspace/SOUL.md",
      "read:.openclaw/workspace/SOUL.md",
      "write:.openclaw/workspace/IDENTITY.md",
      "read:.openclaw/workspace/IDENTITY.md",
      "write:.openclaw/workspace/USER.md",
      "read:.openclaw/workspace/USER.md",
      "write:.openclaw/workspace/BOOTSTRAP.md",
      "read:.openclaw/workspace/BOOTSTRAP.md",
      "start:agent-1",
    ]);
  });

  it("leaves the Agent stopped when its staging owner changes before START", async () => {
    const files = canonicalStarterFiles();
    const fileApi = inMemoryFileApi();
    const startAgent = vi.fn(async () => undefined);
    let abort = false;
    const readFileBytes = vi.fn(async (agentId: string, path: string) => {
      const content = await fileApi.readFileBytes(agentId, path);
      if (path.endsWith("BOOTSTRAP.md")) abort = true;
      return content;
    });

    await expect(stageAgentStarterFilesAndStart({
      agentId: "agent-1",
      files,
      writeFileBytes: fileApi.writeFileBytes,
      readFileBytes,
      startAgent,
      shouldAbort: () => abort,
    })).rejects.toThrow("Workspace setup was cancelled before launch. The agent remains stopped.");

    expect(startAgent).not.toHaveBeenCalled();
  });

  it("leaves the Agent stopped when required workspace files cannot be written", async () => {
    const started: string[] = [];
    const fileApi = inMemoryFileApi();
    const writeFileBytes = vi.fn(async (agentId: string, path: string, content: ArrayBuffer) => {
      if (path === OPENCLAW_PRESEEDED_CONFIG_PATH) {
        await fileApi.writeFileBytes(agentId, path, content);
        return;
      }
      throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
    });

    const staged = stageAgentStarterFilesAndStart({
      agentId: "agent-1",
      files: canonicalStarterFiles(),
      writeFileBytes,
      readFileBytes: fileApi.readFileBytes,
      startAgent: async (agentId) => {
        started.push(agentId);
      },
    });

    const error = await staged.catch((reason) => reason);
    expect(error).toBeInstanceOf(AgentStarterFileStagingError);
    expect(error).toMatchObject({
      result: {
        uploaded: [],
        failures: expect.arrayContaining([
          expect.objectContaining({ name: "AGENTS.md" }),
          expect.objectContaining({ name: "BOOTSTRAP.md" }),
        ]),
      },
    });
    expect(started).toEqual([]);
  });

  it("leaves the Agent stopped when readback differs from the staged bytes", async () => {
    const started = vi.fn(async () => undefined);
    const fileApi = inMemoryFileApi();
    const readFileBytes = vi.fn(async (agentId: string, path: string) => {
      const content = await fileApi.readFileBytes(agentId, path);
      return path.endsWith("SOUL.md") ? new TextEncoder().encode("wrong") : content;
    });

    await expect(stageAgentStarterFilesAndStart({
      agentId: "agent-1",
      files: canonicalStarterFiles(),
      writeFileBytes: fileApi.writeFileBytes,
      readFileBytes,
      startAgent: started,
    })).rejects.toThrow("verification failed for .openclaw/workspace/SOUL.md");

    expect(started).not.toHaveBeenCalled();
  });

  it("rejects a partial pack before writing retained state or starting", async () => {
    const fileApi = inMemoryFileApi();
    const startAgent = vi.fn(async () => undefined);
    const files = canonicalStarterFiles().filter((file) => file.name !== "IDENTITY.md");

    expect(() => validateOpenClawStarterFiles(files))
      .toThrow("Missing required OpenClaw starter file: IDENTITY.md");
    await expect(stageAgentStarterFilesAndStart({
      agentId: "agent-1",
      files,
      writeFileBytes: fileApi.writeFileBytes,
      readFileBytes: fileApi.readFileBytes,
      startAgent,
    })).rejects.toThrow("Missing required OpenClaw starter file: IDENTITY.md");
    expect(fileApi.writeFileBytes).not.toHaveBeenCalled();
    expect(startAgent).not.toHaveBeenCalled();
  });

  it("materializes and validates the exact workspace bytes before staging", async () => {
    const sourceFiles = canonicalStarterFiles();
    const sourceRead = vi.spyOn(sourceFiles[0]!, "arrayBuffer");

    const prepared = await prepareOpenClawStarterFiles(sourceFiles);

    expect(sourceRead).toHaveBeenCalledOnce();
    expect(new TextDecoder().decode(await prepared[0]!.arrayBuffer()))
      .toBe("# AGENTS.md\n\nAGENTS.md content");
    expect(prepared[0]!.size).toBe((await prepared[0]!.arrayBuffer()).byteLength);
  });

  it("rejects unreadable, empty, and oversized workspace files before staging", async () => {
    const unreadable = canonicalStarterFiles();
    unreadable[1] = {
      ...unreadable[1]!,
      arrayBuffer: async () => { throw new Error("disk read failed"); },
    };
    await expect(prepareOpenClawStarterFiles(unreadable))
      .rejects.toThrow("SOUL.md could not be read as UTF-8 Markdown: disk read failed");

    const empty = canonicalStarterFiles();
    empty[2] = starterFile("IDENTITY.md", "");
    await expect(prepareOpenClawStarterFiles(empty)).rejects.toThrow("IDENTITY.md cannot be empty");

    const oversized = canonicalStarterFiles();
    oversized[3] = starterFile("USER.md", "x".repeat(20_001));
    await expect(prepareOpenClawStarterFiles(oversized))
      .rejects.toThrow("USER.md exceeds the 20,000 character limit");
  });

  it("surfaces START failure only after every workspace byte was verified", async () => {
    const events: string[] = [];
    const fileApi = inMemoryFileApi(events);
    const startError = new Error("Agent entered FAILED while confirming launch.");

    await expect(stageAgentStarterFilesAndStart({
      agentId: "agent-1",
      files: canonicalStarterFiles(),
      writeFileBytes: fileApi.writeFileBytes,
      readFileBytes: fileApi.readFileBytes,
      startAgent: async () => {
        events.push("start:agent-1");
        throw startError;
      },
    })).rejects.toBe(startError);

    expect(events.at(-1)).toBe("start:agent-1");
    expect(fileApi.readFileBytes).toHaveBeenCalledTimes(6);
  });
});
