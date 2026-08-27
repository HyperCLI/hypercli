// Agent-owned config-file writers.
//
// The hosted contract: the frontend assembles a starter pack of Markdown
// files and hands it to a runtime writer. The runtime writer is the only
// place that knows where each file lands. The platform Files API does the
// actual writes against the STOPPED agent's volume; the runtime is started
// only after every file is staged and verified.
//
// Locations (verified against the runtime sources):
// - OpenClaw reads AGENTS/SOUL/IDENTITY/USER/BOOTSTRAP/MEMORY from the
//   workspace root: `.openclaw/workspace/<NAME>.md`
//   (openclaw src/agents/workspace.ts WORKSPACE_BOOTSTRAP_FILENAMES).
// - Hermes keeps persona at $HERMES_HOME/SOUL.md, durable memory at
//   $HERMES_HOME/memories/{MEMORY,USER}.md, and project instructions at the
//   workspace cwd AGENTS.md. There is no Hermes bootstrap ritual file and no
//   IDENTITY.md equivalent (hermes agent/prompt_builder.py, tools/memory_tool.py).
import { OPENCLAW_WORKSPACE_PREFIX } from "@/lib/openclaw-config";
import { debugFlow } from "@/lib/debug-flow";

export const HERMES_HOME_PREFIX = ".hermes";
export const HERMES_MEMORIES_PREFIX = `${HERMES_HOME_PREFIX}/memories`;

export interface AgentConfigFile {
  name: string;
  content: string;
}

export interface StagedAgentConfigFile extends AgentConfigFile {
  path: string;
}

export interface WriteAgentConfigFilesOptions {
  agentId: string;
  files: AgentConfigFile[];
  writeFileBytes: (agentId: string, path: string, content: ArrayBuffer) => Promise<unknown>;
  readFileBytes: (agentId: string, path: string) => Promise<ArrayBuffer | Uint8Array>;
}

export interface WrittenAgentConfigFile {
  name: string;
  path: string;
  bytes: number;
}

export interface WriteAgentConfigFilesResult {
  written: WrittenAgentConfigFile[];
}

function asBytes(content: ArrayBuffer | Uint8Array): Uint8Array {
  return content instanceof Uint8Array
    ? new Uint8Array(content.buffer, content.byteOffset, content.byteLength)
    : new Uint8Array(content);
}

function equalBytes(left: ArrayBuffer | Uint8Array, right: ArrayBuffer | Uint8Array): boolean {
  const leftBytes = asBytes(left);
  const rightBytes = asBytes(right);
  if (leftBytes.byteLength !== rightBytes.byteLength) return false;
  return leftBytes.every((value, index) => value === rightBytes[index]);
}

export abstract class AgentConfigFileWriter {
  abstract readonly runtime: string;

  /** Resolve the volume-relative destination path for one starter file. */
  abstract resolvePath(file: AgentConfigFile): string | null;

  protected scope(): string {
    return `config-files:${this.runtime}`;
  }

  stageFiles(files: readonly AgentConfigFile[]): StagedAgentConfigFile[] {
    const staged: StagedAgentConfigFile[] = [];
    for (const file of files) {
      const path = this.resolvePath(file);
      if (!path) {
        debugFlow(this.scope(), "file not supported by runtime, skipped", { name: file.name });
        continue;
      }
      staged.push({ ...file, path });
    }
    return staged;
  }

  /**
   * Write and verify every staged file. Fails closed: one unwritable or
   * mismatched file throws, because booting with a half-staged pack is how
   * agents end up with clobbered workspaces.
   */
  async writeConfigFiles({
    agentId,
    files,
    writeFileBytes,
    readFileBytes,
  }: WriteAgentConfigFilesOptions): Promise<WriteAgentConfigFilesResult> {
    const staged = this.stageFiles(files);
    debugFlow(this.scope(), "writeConfigFiles", { agentId, filesCount: staged.length });
    const written: WrittenAgentConfigFile[] = [];
    const encoder = new TextEncoder();

    for (const file of staged) {
      const content = encoder.encode(file.content).buffer as ArrayBuffer;
      debugFlow(this.scope(), "write start", { path: file.path, bytes: content.byteLength });
      await writeFileBytes(agentId, file.path, content);
      const persisted = await readFileBytes(agentId, file.path);
      if (!equalBytes(content, persisted)) {
        debugFlow(this.scope(), "write verification failed", { path: file.path });
        throw new Error(`Workspace file verification failed for ${file.path}`);
      }
      debugFlow(this.scope(), "write ok", { path: file.path, bytes: content.byteLength });
      written.push({ name: file.name, path: file.path, bytes: content.byteLength });
    }

    return { written };
  }
}

export class OpenClawConfigFileWriter extends AgentConfigFileWriter {
  readonly runtime = "openclaw";

  resolvePath(file: AgentConfigFile): string | null {
    const name = file.name.trim();
    if (!name) return null;
    return `${OPENCLAW_WORKSPACE_PREFIX}/${name}`;
  }
}

/**
 * Hermes routes starter files by role, not by name convention: persona is
 * home-scoped, durable memory lives under memories/, and only project
 * instructions land in the workspace cwd. Bootstrap-ritual and structured
 * identity files have no Hermes reader and are skipped.
 */
export class HermesConfigFileWriter extends AgentConfigFileWriter {
  readonly runtime = "hermes";

  private static readonly PATHS: Record<string, string> = {
    "AGENTS.md": "AGENTS.md",
    "SOUL.md": `${HERMES_HOME_PREFIX}/SOUL.md`,
    "MEMORY.md": `${HERMES_MEMORIES_PREFIX}/MEMORY.md`,
    "USER.md": `${HERMES_MEMORIES_PREFIX}/USER.md`,
  };

  resolvePath(file: AgentConfigFile): string | null {
    return HermesConfigFileWriter.PATHS[file.name] ?? null;
  }
}

export function createAgentConfigFileWriter(agentType: string | null | undefined): AgentConfigFileWriter {
  return agentType === "hermes" ? new HermesConfigFileWriter() : new OpenClawConfigFileWriter();
}
