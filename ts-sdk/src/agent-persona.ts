export interface AgentPersonaFiles {
  soul: string;
  user: string;
}

export interface AgentPersonaProfile {
  /** Canonical runtime family label this profile serves. */
  readonly family: 'default' | 'openclaw_acp' | 'hermes_acp';
  /** SOUL.md location relative to the runtime's sync root. */
  soulPath(): string;
  /** USER.md location relative to the runtime's sync root. */
  userPath(): string;
  /**
   * Extra sync-include entries the persona files require when a launch pins
   * an explicit include list. Exclude-synced runtimes (openclaw/hermes)
   * already cover their native paths under the synced home root and return
   * nothing.
   */
  syncIncludes(): readonly string[];
  /**
   * Adapt raw markdown into the runtime's on-disk persona format. Every
   * supported runtime consumes plain markdown (no frontmatter), so the base
   * render is the identity; a runtime that gains a native format encodes the
   * adaptation here.
   */
  render(files: AgentPersonaFiles): AgentPersonaFiles;
}

export const DEFAULT_PERSONA_SOUL_PATH = '.hypercli/SOUL.md';
export const DEFAULT_PERSONA_USER_PATH = '.hypercli/USER.md';

/**
 * Platform-generic persona landing zone: a writable `.hypercli/` directory
 * under the agent home. Coding runtimes enumerate both files in their
 * default sync includes (DEFAULT_CODING_AGENT_SYNC_INCLUDES in agents.ts);
 * keep USER-first order aligned with that table.
 */
export class DefaultPersonaProfile implements AgentPersonaProfile {
  readonly family = 'default' as const;
  soulPath(): string {
    return DEFAULT_PERSONA_SOUL_PATH;
  }
  userPath(): string {
    return DEFAULT_PERSONA_USER_PATH;
  }
  syncIncludes(): readonly string[] {
    return [DEFAULT_PERSONA_USER_PATH, DEFAULT_PERSONA_SOUL_PATH];
  }
  render(files: AgentPersonaFiles): AgentPersonaFiles {
    return files;
  }
}

/**
 * OpenClaw reads SOUL.md / USER.md from the agent workspace root (upstream
 * src/agents/workspace-bootstrap-policy.ts, DEFAULT_SOUL_FILENAME /
 * DEFAULT_USER_FILENAME; six bootstrap filenames at WORKSPACE_BOOTSTRAP_
 * FILENAMES). The hosted image pins OPENCLAW_STATE_DIR=/home/node/.openclaw
 * (hypercli/docker/openclaw/entrypoint.sh) and leaves OPENCLAW_WORKSPACE_DIR
 * unset, so the workspace resolves to .openclaw/workspace relative to the
 * /home/node sync root. USER.md injection carries a fixed 4,000-character
 * cap upstream; renders stay untruncated here — dropping body content is a
 * caller decision, not a path-projection one.
 */
export class OpenClawPersonaProfile implements AgentPersonaProfile {
  readonly family = 'openclaw_acp' as const;
  soulPath(): string {
    return '.openclaw/workspace/SOUL.md';
  }
  userPath(): string {
    return '.openclaw/workspace/USER.md';
  }
  syncIncludes(): readonly string[] {
    return [];
  }
  render(files: AgentPersonaFiles): AgentPersonaFiles {
    return files;
  }
}

/**
 * Hermes reads its persona from HERMES_HOME: SOUL.md at the home root
 * (upstream agent/prompt_builder.py, _load_soul) and the user model under
 * the memories directory (upstream tools/memory_tool.py get_memory_dir() =
 * HERMES_HOME/memories, tools/memory_tool_store.py joining USER.md there).
 * The hosted image pins HERMES_HOME=/home/hermes/.hermes
 * (docker/hermes-agent/entrypoint.sh) with sync root /home/hermes.
 */
export class HermesPersonaProfile implements AgentPersonaProfile {
  readonly family = 'hermes_acp' as const;
  soulPath(): string {
    return '.hermes/SOUL.md';
  }
  userPath(): string {
    return '.hermes/memories/USER.md';
  }
  syncIncludes(): readonly string[] {
    return [];
  }
  render(files: AgentPersonaFiles): AgentPersonaFiles {
    return files;
  }
}

const OPENCLAW_PERSONA_PROFILE = new OpenClawPersonaProfile();
const HERMES_PERSONA_PROFILE = new HermesPersonaProfile();
const DEFAULT_PERSONA_PROFILE = new DefaultPersonaProfile();

// Canonical runtime labels only; the legacy wire spellings ('openclaw',
// 'hermes-agent') fold server-side (launch_contract.py LEGACY_RUNTIME_MIGRATIONS)
// and are deliberately absent here.
const AGENT_PERSONA_PROFILES: Readonly<Record<string, AgentPersonaProfile>> = {
  openclaw_acp: OPENCLAW_PERSONA_PROFILE,
  'openclaw-pro': OPENCLAW_PERSONA_PROFILE,
  hermes_acp: HERMES_PERSONA_PROFILE,
};
export { AGENT_PERSONA_PROFILES };

export function resolveAgentPersonaProfile(runtime: string | null | undefined): AgentPersonaProfile {
  return AGENT_PERSONA_PROFILES[runtime ?? ''] ?? DEFAULT_PERSONA_PROFILE;
}
