/**
 * `hyper skills` — inventory, inspect, export, and install bundled skills.
 *
 *   hyper skills                  inventory table: name, description, commands
 *   hyper skills list | ls        alias of bare `hyper skills`
 *   hyper skills <name-or-prefix> print the skill body markdown (like cat)
 *   hyper skills export <dir>     write every bundled skill as <dir>/<name>/SKILL.md
 *   hyper skills install <agent-id> [--dir PATH]
 *
 * export is offline by design: skill data is read from <pkg>/skills/*.json,
 * so it never touches ctx.client() and works with no API key.
 *
 * install is the fused convenience of the documented two-step:
 *   hyper skills export /tmp/sk
 *   hyper agents exec <id> -- mkdir -p <skills-dir>/<name>
 *   hyper agents cp /tmp/sk/<name>/SKILL.md <id>:<skills-dir>/<name>/SKILL.md
 *
 * Two path forms are needed because of today's SDK surface:
 *   - Deployments.cpTo is file-only and sync-root-relative (the Reef file
 *     API rejects absolute paths), so each SKILL.md is pushed individually
 *     under the relative target dir;
 *   - Deployments.exec has no cwd option, so the mkdir -p argv carries the
 *     absolute path (agent sync root + relative dir).
 * The sync root comes from the agent's launchConfig.sync_root when set,
 * else the runtime default (/home/node for openclaw/coding runtimes,
 * /home/hermes for hermes-agent; ts-sdk agents.ts:142/311/1364).
 *
 * Local duplication note: resolveAgentRef/api/describeFailure/onePositional/
 * str are small copies of the agents.ts helpers, which are not exported;
 * keep them in step with cli/src/commands/agents.ts.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APIError, type Agent, type Deployments } from '@hypercli.com/sdk';
import { parseCommandArgs, type ParsedCommand } from '../core/argv.js';
import { CliError, UsageError } from '../core/errors.js';
import { renderGroupHelp } from '../core/help.js';
import { getSkill, listSkills, type BundledSkill } from '../core/skills-runtime.js';
import type { CommandContext } from '../core/types.js';

export const name = 'skills';
export const summary = 'List, inspect, export, and install bundled skills.';
export const usage = [
  'hyper skills [--json]',
  'hyper skills ls|list [--json]',
  'hyper skills <name-or-prefix> [--json]',
  'hyper skills export <dir> [--json]',
  'hyper skills install <agent-id> [--dir PATH] [--json]',
  '',
  'inject the bundled skills into an agent manually:',
  '  hyper skills export /tmp/sk',
  '  hyper agents exec <id> -- mkdir -p <skills-dir>/<name>',
  '  hyper agents cp /tmp/sk/<name>/SKILL.md <id>:<skills-dir>/<name>/SKILL.md',
];

/** Cap on the COMMANDS column; DESCRIPTION takes the remaining terminal width. */
const COMMANDS_MAX = 44;
const DESCRIPTION_MIN = 16;

/**
 * Verified runtime -> skills directory mapping. Paths are relative to the
 * agent sync root (the Reef file API rejects absolute paths). Evidence:
 *   openclaw, openclaw-pro: hypercli-agent-images/openclaw/init.sh:5,12
 *     (STATE_DIR=$HOME/.openclaw, OPENCLAW_SKILLS_DIR=$STATE_DIR/skills)
 *   hermes-agent: hypercli-agent-images/hermes-agent/entrypoint.sh:7,14 and
 *     Dockerfile (`ENV HERMES_HOME=/home/hermes/.hermes`, dir ${HERMES_HOME}/skills)
 *   opencode: hypercli-agent-images/coding/init.sh:18,66-72 seeds
 *     $HOME/.agents/skills; opencode loads global ~/.agents/skills/<name>/SKILL.md
 *     (https://opencode.ai/docs/skills/, discovery section)
 *   buzz-agent: coding/init.sh:48-62 installs its skill into .agents/skills
 *   goose: coding/init.sh:74-83 mirrors skills into .goose/skills and
 *     coding/goose/test.py:61,92 asserts that link
 *   codex, claude-code: coding/init.sh:74-83 mirrors .codex/.claude skills
 * kimi-code and generic have no verified default: they require --dir.
 */
const SKILLS_DIR_BY_RUNTIME: Readonly<Record<string, string>> = {
  openclaw: '.openclaw/skills',
  'openclaw-pro': '.openclaw/skills',
  'hermes-agent': '.hermes/skills',
  opencode: '.agents/skills',
  'buzz-agent': '.agents/skills',
  goose: '.goose/skills',
  codex: '.codex/skills',
  'claude-code': '.claude/skills',
};

/**
 * Default sync root per runtime (ts-sdk agents.ts:142/311/1364). Coding
 * runtimes and openclaw live under /home/node; hermes-agent under
 * /home/hermes. launchConfig.sync_root wins when the agent was launched
 * with an explicit root.
 */
const SYNC_ROOT_BY_RUNTIME: Readonly<Record<string, string>> = {
  openclaw: '/home/node',
  'openclaw-pro': '/home/node',
  'hermes-agent': '/home/hermes',
  opencode: '/home/node',
  'buzz-agent': '/home/node',
  codex: '/home/node',
  'claude-code': '/home/node',
  goose: '/home/node',
  'kimi-code': '/home/node',
};

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/**
 * Exact name, then unambiguous prefix (rules and error text live in core).
 * A bare segment like `auth` also resolves in the `hypercli-` namespace, so
 * `hyper skills auth` finds hypercli-auth.
 */
function findSkill(target: string): BundledSkill {
  try {
    return getSkill(target);
  } catch (err) {
    if (target.startsWith('hypercli')) throw err;
    try {
      return getSkill(`hypercli-${target}`);
    } catch {
      throw err;
    }
  }
}

function printHelp(): void {
  process.stdout.write(`${renderGroupHelp({ name, summary, usage, run })}\n`);
}

function displayMarkdown(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return normalized;
  const end = normalized.indexOf('\n---', 4);
  if (end === -1) return normalized;
  return normalized.slice(end + '\n---'.length).replace(/^\n+/, '');
}

// ---------------------------------------------------------------------------
// shared argv/error helpers (local copies of the unexported agents.ts set)
// ---------------------------------------------------------------------------

function onePositional(parsed: ParsedCommand, what: string): string {
  if (parsed.positionals.length === 0) throw new UsageError(`missing ${what}`);
  if (parsed.positionals.length > 1) {
    throw new UsageError(`unexpected extra arguments: ${parsed.positionals.slice(1).join(' ')}`);
  }
  return parsed.positionals[0];
}

function str(parsed: ParsedCommand, key: string): string | undefined {
  const value = parsed.values[key];
  return typeof value === 'string' ? value : undefined;
}

function describeFailure(err: unknown): string {
  if (err instanceof APIError) return `HTTP ${err.statusCode}: ${err.detail}`;
  return err instanceof Error ? err.message : String(err);
}

/** Wrap one SDK call: UsageError/CliError pass through, everything else -> CliError. */
async function api<T>(what: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw new CliError(`${what} failed: ${describeFailure(err)}`);
  }
}

function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 12) : id;
}

const FULL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a user-typed <id> reference to a full agent id (exact, then
 * unambiguous prefix over id/name/handle/hostname). Ambiguity lists
 * candidates as a UsageError; no match is a CliError.
 */
async function resolveAgentRef(d: Deployments, ref: string): Promise<string> {
  const raw = String(ref ?? '').trim();
  if (!raw) throw new UsageError('missing agent id. See hyper skills install --help.');
  if (FULL_UUID.test(raw)) return raw;

  const agents = await api('list agents', () => d.list());
  const fields = (a: Agent): string[] =>
    [a.id, a.name, a.handle, a.hostname].filter(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );

  const exact = agents.filter((a) => fields(a).some((v) => v === raw));
  if (exact.length === 1) return exact[0].id;

  const matches =
    exact.length > 1 ? exact : agents.filter((a) => fields(a).some((v) => v.startsWith(raw)));
  if (matches.length === 1) return matches[0].id;
  if (matches.length > 1) {
    const lines = matches
      .slice(0, 10)
      .map((a) => `  ${a.id}  ${a.name ?? ''}  ${a.state}`)
      .join('\n');
    throw new UsageError(`ambiguous agent reference '${raw}':\n${lines}`);
  }
  throw new CliError(`no agent matches '${raw}'`);
}

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

/**
 * Write every bundled skill as <dir>/<name>/SKILL.md with the compiled
 * markdown byte-verbatim. Directories are created as needed and existing
 * SKILL.md files are overwritten; unrelated files in <dir> are left alone.
 * Returns the written file paths in display order.
 */
function exportSkills(dir: string): string[] {
  if (existsSync(dir) && !statSync(dir).isDirectory()) {
    throw new CliError(`export target exists and is not a directory: ${dir}`);
  }
  const written: string[] = [];
  for (const entry of listSkills()) {
    const skill = getSkill(entry.name);
    const skillDir = join(dir, skill.name);
    mkdirSync(skillDir, { recursive: true });
    const file = join(skillDir, 'SKILL.md');
    writeFileSync(file, skill.markdown, 'utf8');
    written.push(file);
  }
  return written;
}

async function cmdExport(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args);
  if (parsed.help) return printHelp();
  const dir = onePositional(parsed, 'target directory (hyper skills export <dir>)');

  const written = exportSkills(dir);
  const names = listSkills().map((s) => s.name);
  for (const file of written) ctx.output.info(`wrote ${file}`);
  ctx.output.result(
    { dir, skills: names },
    recordLabelValue([
      ['dir', dir],
      ['skills', names.join(', ')],
    ]),
  );
}

/** Label/value block: two columns, labels left-padded. */
function recordLabelValue(rows: ReadonlyArray<readonly [string, string]>): string {
  const width = Math.max(0, ...rows.map(([key]) => key.length));
  return rows.map(([key, value]) => `${key.padEnd(width)}  ${value}`.trimEnd()).join('\n');
}

// ---------------------------------------------------------------------------
// install
// ---------------------------------------------------------------------------

interface InstallTarget {
  /** Sync-root-relative dir for cpTo (the Reef file API rejects absolute paths). */
  rel: string;
  /** Absolute dir for the exec mkdir -p argv (exec has no cwd option). */
  absolute: string;
}

/** The agent's sync root: launchConfig.sync_root when set, else the runtime default. */
function agentSyncRoot(agent: Agent): string | null {
  const configured = agent.launchConfig?.sync_root;
  if (typeof configured === 'string' && configured.trim()) {
    return configured.trim().replace(/\/+$/, '');
  }
  return SYNC_ROOT_BY_RUNTIME[(agent.runtime ?? '').toLowerCase()] ?? null;
}

function resolveInstallTarget(agent: Agent, dirOption: string | undefined): InstallTarget {
  const runtime = (agent.runtime ?? '').toLowerCase();
  const syncRoot = agentSyncRoot(agent);

  let rel: string;
  if (dirOption === undefined) {
    const mapped = SKILLS_DIR_BY_RUNTIME[runtime];
    if (mapped === undefined) {
      throw new UsageError(
        `no verified default skills directory for runtime '${agent.runtime ?? 'unknown'}' — ` +
          'pass --dir <path> (sync-root-relative, or absolute under the sync root)',
      );
    }
    rel = mapped;
  } else {
    const cleaned = dirOption.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/\/+$/, '');
    if (cleaned.startsWith('/')) {
      if (syncRoot === null) {
        throw new UsageError('cannot verify the sync root of this agent. See hyper skills --help.');
      }
      if (cleaned !== syncRoot && !cleaned.startsWith(`${syncRoot}/`)) {
        throw new UsageError(
          `--dir must stay inside the agent sync root ${syncRoot} (got '${dirOption}')`,
        );
      }
      rel = cleaned.slice(syncRoot.length).replace(/^\/+/, '');
    } else {
      rel = cleaned;
    }
  }

  if (!rel || rel.split('/').some((segment) => segment === '' || segment === '..')) {
    throw new UsageError(`--dir must be a clean path inside the sync root (got '${dirOption ?? ''}')`);
  }
  if (syncRoot === null) {
    throw new UsageError(
      `cannot determine the sync root of this ${agent.runtime ?? 'unknown'} agent — ` +
        'install manually: hyper skills export /tmp/sk && hyper agents exec <id> -- mkdir -p <dir> && hyper agents cp ...',
    );
  }
  return { rel, absolute: `${syncRoot}/${rel}` };
}

async function cmdInstall(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, { dir: { type: 'string' } });
  if (parsed.help) return printHelp();
  const ref = onePositional(parsed, 'agent id');
  const dirOption = str(parsed, 'dir');

  const client = await ctx.client();
  const d = client.deployments;
  const id = await resolveAgentRef(d, ref);
  const agent = await api('get agent', () => d.get(id));
  const target = resolveInstallTarget(agent, dirOption);

  const names = listSkills().map((s) => s.name);
  if (names.length === 0) {
    throw new CliError('no skills bundled — rebuild with scripts/build-skills.mjs');
  }

  const tmp = mkdtempSync(join(tmpdir(), 'hyper-skills-'));
  try {
    exportSkills(tmp);
    ctx.output.info(`creating ${target.absolute} on ${shortId(id)}`);
    const mkdir = await api('mkdir on agent', () =>
      d.exec(id, ['mkdir', '-p', ...names.map((n) => `${target.absolute}/${n}`)], { timeout: 30 }),
    );
    if (mkdir.exitCode !== 0) {
      const detail = (mkdir.stderr || mkdir.stdout).trim();
      throw new CliError(`mkdir on agent failed (exit ${mkdir.exitCode})${detail ? `: ${detail}` : ''}`);
    }
    for (const skillName of names) {
      const relPath = `${target.rel}/${skillName}/SKILL.md`;
      await api('copy up', () => d.cpTo(id, join(tmp, skillName, 'SKILL.md'), relPath));
      ctx.output.info(`pushed ${shortId(id)}:${relPath}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  ctx.output.result(
    { agent_id: id, runtime: agent.runtime, dir: target.rel, skills: names },
    `installed ${names.length} skill(s) into ${shortId(id)}:${target.absolute}`,
  );
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

export async function run(ctx: CommandContext, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  if (subcommand === 'export') return cmdExport(ctx, rest);
  if (subcommand === 'install') return cmdInstall(ctx, rest);

  const parsed = parseCommandArgs(args);
  if (parsed.help) {
    printHelp();
    return;
  }

  const [target, ...extra] = parsed.positionals;

  if (extra.length > 0) {
    throw new UsageError(`usage: ${usage[0]}\n       ${usage[1]}\n       ${usage[2]}`);
  }

  if (!target || target === 'list' || target === 'ls') {
    const skills = listSkills();
    const width = (process.stdout.columns ?? 80) >= 40 ? (process.stdout.columns ?? 80) : 80;
    const nameWidth = Math.max('NAME'.length, ...skills.map((s) => s.name.length));
    let commandsWidth = Math.min(
      COMMANDS_MAX,
      Math.max('COMMANDS'.length, ...skills.map((s) => s.commands.join(', ').length)),
    );
    let descriptionWidth = width - nameWidth - commandsWidth - 4;
    if (descriptionWidth < DESCRIPTION_MIN) {
      descriptionWidth = DESCRIPTION_MIN;
      commandsWidth = Math.max('COMMANDS'.length, width - nameWidth - descriptionWidth - 4);
    }
    const commandCells = skills.map((s) => truncate(s.commands.join(', '), commandsWidth));
    ctx.output.result(
      skills.map((s) => ({ name: s.name, description: s.description, commands: s.commands })),
      {
        columns: ['NAME', 'DESCRIPTION', 'COMMANDS'],
        rows: skills.map((s, i) => [
          s.name,
          truncate(s.description, descriptionWidth),
          commandCells[i],
        ]),
      },
    );
    return;
  }

  const skill = findSkill(target);
  ctx.output.result(
    {
      name: skill.name,
      description: skill.description,
      commands: skill.commands,
      markdown: skill.markdown,
    },
    displayMarkdown(skill.markdown),
  );
}
