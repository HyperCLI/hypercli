import { describe, expect, it, vi } from "vitest";

import {
  AgentStarterFileStagingError,
  OPENCLAW_CONFIG_PATH,
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
    deleteFile: vi.fn(async (_agentId: string, path: string) => {
      events.push(`delete:${path}`);
      if (!storage.delete(path)) throw Object.assign(new Error("Not found"), { statusCode: 404 });
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

  it("verifies the complete workspace and clears stale config before START", async () => {
    const events: string[] = [];
    const files = canonicalStarterFiles();
    const fileApi = inMemoryFileApi(events);

    const { uploaded, failures } = await stageAgentStarterFilesAndStart({
      agentId: "agent-1",
      files,
      writeFileBytes: fileApi.writeFileBytes,
      readFileBytes: fileApi.readFileBytes,
      deleteFile: fileApi.deleteFile,
      startAgent: async (agentId) => {
        events.push(`start:${agentId}`);
      },
    });

    expect(failures).toEqual([]);
    expect(uploaded).toHaveLength(2);
    expect(events).toEqual([
      "write:.openclaw/workspace/AGENTS.md",
      "read:.openclaw/workspace/AGENTS.md",
      "write:.openclaw/workspace/BOOTSTRAP.md",
      "read:.openclaw/workspace/BOOTSTRAP.md",
      `delete:${OPENCLAW_CONFIG_PATH}`,
      "delete:.openclaw/workspace/SOUL.md",
      "delete:.openclaw/workspace/IDENTITY.md",
      "delete:.openclaw/workspace/USER.md",
      "delete:.openclaw/workspace/MEMORY.md",
      "start:agent-1",
    ]);
    expect(new TextDecoder().decode(fileApi.storage.get(".openclaw/workspace/BOOTSTRAP.md")))
      .toContain("### Draft IDENTITY.md");
    expect(fileApi.writeFileBytes).not.toHaveBeenCalledWith(
      "agent-1",
      OPENCLAW_CONFIG_PATH,
      expect.anything(),
    );
  });

  it("deletes a setup-owned stale config after workspace verification", async () => {
    const events: string[] = [];
    const fileApi = inMemoryFileApi(events);
    fileApi.storage.set(OPENCLAW_CONFIG_PATH, new TextEncoder().encode('{"agents":{"defaults":{"skipBootstrap":true}}}'));
    for (const name of ["SOUL.md", "IDENTITY.md", "USER.md", "MEMORY.md"]) {
      fileApi.storage.set(`.openclaw/workspace/${name}`, new TextEncoder().encode("stale draft"));
    }

    await stageAgentStarterFilesAndStart({
      agentId: "agent-1",
      files: canonicalStarterFiles(),
      writeFileBytes: fileApi.writeFileBytes,
      readFileBytes: fileApi.readFileBytes,
      deleteFile: fileApi.deleteFile,
      startAgent: async (agentId) => {
        events.push(`start:${agentId}`);
      },
    });

    expect(fileApi.storage.has(OPENCLAW_CONFIG_PATH)).toBe(false);
    expect(fileApi.storage.has(".openclaw/workspace/SOUL.md")).toBe(false);
    expect(fileApi.storage.has(".openclaw/workspace/IDENTITY.md")).toBe(false);
    expect(fileApi.storage.has(".openclaw/workspace/USER.md")).toBe(false);
    expect(fileApi.storage.has(".openclaw/workspace/MEMORY.md")).toBe(false);
    expect(events.slice(-5)).toEqual([
      "delete:.openclaw/workspace/SOUL.md",
      "delete:.openclaw/workspace/IDENTITY.md",
      "delete:.openclaw/workspace/USER.md",
      "delete:.openclaw/workspace/MEMORY.md",
      "start:agent-1",
    ]);
  });

  it("retries an unrouted edge 404 while clearing stale config", async () => {
    vi.useFakeTimers();
    try {
      const fileApi = inMemoryFileApi();
      const startAgent = vi.fn(async () => undefined);
      const deleteFile = vi.fn(async () => {
        if (deleteFile.mock.calls.length === 1) {
          throw Object.assign(new Error("API Error 404: 404 page not found"), {
            statusCode: 404,
            detail: "404 page not found",
          });
        }
      });

      const staged = stageAgentStarterFilesAndStart({
        agentId: "agent-1",
        files: canonicalStarterFiles(),
        writeFileBytes: fileApi.writeFileBytes,
        readFileBytes: fileApi.readFileBytes,
        deleteFile,
        startAgent,
      });
      await vi.runAllTimersAsync();
      await staged;

      expect(deleteFile).toHaveBeenCalledTimes(6);
      expect(startAgent).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
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
      deleteFile: fileApi.deleteFile,
      startAgent,
      shouldAbort: () => abort,
    })).rejects.toThrow("Workspace setup was cancelled before launch. The agent remains stopped.");

    expect(startAgent).not.toHaveBeenCalled();
  });

  it("leaves the Agent stopped when required workspace files cannot be written", async () => {
    const started: string[] = [];
    const fileApi = inMemoryFileApi();
    const writeFileBytes = vi.fn(async () => {
      throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
    });

    const staged = stageAgentStarterFilesAndStart({
      agentId: "agent-1",
      files: canonicalStarterFiles(),
      writeFileBytes,
      readFileBytes: fileApi.readFileBytes,
      deleteFile: fileApi.deleteFile,
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
    expect(fileApi.deleteFile).not.toHaveBeenCalled();
  });

  it("leaves the Agent stopped when readback differs from the staged bytes", async () => {
    const started = vi.fn(async () => undefined);
    const fileApi = inMemoryFileApi();
    const readFileBytes = vi.fn(async (agentId: string, path: string) => {
      const content = await fileApi.readFileBytes(agentId, path);
      return path.endsWith("BOOTSTRAP.md") ? new TextEncoder().encode("wrong") : content;
    });

    await expect(stageAgentStarterFilesAndStart({
      agentId: "agent-1",
      files: canonicalStarterFiles(),
      writeFileBytes: fileApi.writeFileBytes,
      readFileBytes,
      deleteFile: fileApi.deleteFile,
      startAgent: started,
    })).rejects.toThrow("verification failed for .openclaw/workspace/BOOTSTRAP.md");

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
      deleteFile: fileApi.deleteFile,
      startAgent,
    })).rejects.toThrow("Missing required OpenClaw starter file: IDENTITY.md");
    expect(fileApi.writeFileBytes).not.toHaveBeenCalled();
    expect(startAgent).not.toHaveBeenCalled();
  });

  it("rejects pre-start memory outside the bootstrap hints", async () => {
    const files = [
      starterFile("AGENTS.md", "# AGENTS.md\n\nInstructions"),
      starterFile("BOOTSTRAP.md", "# BOOTSTRAP.md\n\nOnboard the user"),
      starterFile("MEMORY.md", "# MEMORY.md\n\nPremature completion evidence"),
    ];

    expect(() => validateOpenClawStarterFiles(files))
      .toThrow("Unsupported staged OpenClaw starter file: MEMORY.md");
    await expect(prepareOpenClawStarterFiles(files))
      .rejects.toThrow("Unsupported staged OpenClaw starter file: MEMORY.md");
  });

  it("leaves the Agent stopped when stale config cannot be cleared", async () => {
    const fileApi = inMemoryFileApi();
    const startAgent = vi.fn(async () => undefined);
    const deleteError = Object.assign(new Error("Forbidden"), { statusCode: 403 });

    await expect(stageAgentStarterFilesAndStart({
      agentId: "agent-1",
      files: canonicalStarterFiles(),
      writeFileBytes: fileApi.writeFileBytes,
      readFileBytes: fileApi.readFileBytes,
      deleteFile: vi.fn(async () => { throw deleteError; }),
      startAgent,
    })).rejects.toThrow("OpenClaw setup could not clear its incomplete configuration: Forbidden");

    expect(fileApi.writeFileBytes).toHaveBeenCalledTimes(2);
    expect(fileApi.readFileBytes).toHaveBeenCalledTimes(2);
    expect(startAgent).not.toHaveBeenCalled();
  });

  it("leaves the Agent stopped when stale profile or memory drafts cannot be cleared", async () => {
    const fileApi = inMemoryFileApi();
    const startAgent = vi.fn(async () => undefined);
    const deleteFile = vi.fn(async (_agentId: string, path: string) => {
      if (path.endsWith("IDENTITY.md")) {
        throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
      }
      throw Object.assign(new Error("Not found"), { statusCode: 404 });
    });

    await expect(stageAgentStarterFilesAndStart({
      agentId: "agent-1",
      files: canonicalStarterFiles(),
      writeFileBytes: fileApi.writeFileBytes,
      readFileBytes: fileApi.readFileBytes,
      deleteFile,
      startAgent,
    })).rejects.toThrow("OpenClaw setup could not clear its draft profile or memory files: Forbidden");

    expect(startAgent).not.toHaveBeenCalled();
  });

  it("materializes and validates the exact workspace bytes before staging", async () => {
    const sourceFiles = canonicalStarterFiles();
    const sourceRead = vi.spyOn(sourceFiles[0]!, "arrayBuffer");

    const prepared = await prepareOpenClawStarterFiles(sourceFiles);

    expect(sourceRead).toHaveBeenCalledOnce();
    expect(new TextDecoder().decode(await prepared[0]!.arrayBuffer()))
      .toBe("# AGENTS.md\n\nAGENTS.md content");
    expect(prepared.map((file) => file.name)).toEqual(["AGENTS.md", "BOOTSTRAP.md"]);
    expect(new TextDecoder().decode(await prepared[1]!.arrayBuffer()))
      .toContain("### Draft SOUL.md");
    expect(prepared[0]!.size).toBe((await prepared[0]!.arrayBuffer()).byteLength);

    const preparedAgain = await prepareOpenClawStarterFiles(prepared);
    const bootstrapAgain = new TextDecoder().decode(await preparedAgain[1]!.arrayBuffer());
    expect(bootstrapAgain.match(/## Unconfirmed setup hints/g)).toHaveLength(1);
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
      deleteFile: fileApi.deleteFile,
      startAgent: async () => {
        events.push("start:agent-1");
        throw startError;
      },
    })).rejects.toBe(startError);

    expect(events.at(-1)).toBe("start:agent-1");
    expect(fileApi.readFileBytes).toHaveBeenCalledTimes(2);
  });
});
