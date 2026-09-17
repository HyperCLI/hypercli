/**
 * `hyper routines` — scheduled prompts for agents, plus on-demand runs.
 *
 * `hyper agents routines list|create|delete` stays untouched and rides
 * client.routines; this group is the top-level test surface (jobs.ts/voice.ts
 * shape: self-contained module, local helpers).
 *
 * `routines run` NOTE (no server-side run-now): the backend service
 * (hyperclaw-backend/routines/app/main.py) exposes only
 * list/create/get/patch/delete, and ts-sdk/src/routines.ts mirrors that.
 * `run` therefore replays the executor's semantics locally: fetch the
 * routine's agent, require RUNNING and an ACP-family runtime (mirror of
 * routines/app/executor.py `execute_routine`), then send the prompt over the
 * agent ACP bridge — session_id bound -> session/load (new session on
 * failure), else session/new. The turn inherently runs to a stop reason
 * (closing the socket would cancel it), so --wait only controls whether the
 * assistant reply is printed.
 */

import { createInterface } from 'node:readline/promises';
import {
  APIError,
  type CodingAgent,
  type Routine,
  type RoutineCreateOptions,
} from '@hypercli.com/sdk';
import { parseCommandArgs, parseUniversal, type ParsedCommand } from '../core/argv.js';
import { CliError, UsageError } from '../core/errors.js';
import { closestMatch, renderGroupHelp } from '../core/help.js';
import type { CommandContext } from '../core/types.js';
import { resolveAgentRef } from './agents.js';

export const name = 'routines';
export const summary = 'Manage scheduled agent routines and run them on demand.';
export const usage = [
  'hyper routines list [--agent ID] [--json]',
  'hyper routines get <routine-id> [--json]',
  'hyper routines create (--cron EXPR | --run-at ISO) --prompt TEXT [--agent ID] [--name N] [--session ID] [--disabled]',
  'hyper routines run <routine-id> [--wait] [--timeout S] [--json]',
  'hyper routines delete <routine-id> [--yes] [--json]',
];

const COMMANDS = ['list', 'ls', 'get', 'create', 'run', 'delete'];

/** Runtimes the routines executor accepts (routines/app/executor.py ACP_RUNTIMES). */
const ACP_RUNTIMES: ReadonlySet<string> = new Set([
  'buzz-agent',
  'opencode',
  'codex',
  'claude-code',
  'goose',
  'kimi-code',
]);

function printHelp(): void {
  process.stdout.write(`${renderGroupHelp({ name, summary, usage, run })}\n`);
}

// ---------------------------------------------------------------------------
// shared helpers (agents.ts/jobs.ts parity: label/value blocks, error mapping)
// ---------------------------------------------------------------------------

function describeError(err: unknown): string {
  if (err instanceof APIError) return `HTTP ${err.statusCode}: ${err.detail}`;
  return err instanceof Error ? err.message : String(err);
}

/** Wrap one SDK call: CliError/UsageError pass through, the rest -> CliError. */
async function api<T>(what: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw new CliError(`${what} failed: ${describeError(err)}`);
  }
}

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

/** Parse a seconds flag to milliseconds; bad input -> UsageError. */
function secondsFlag(parsed: ParsedCommand, key: string, fallback: number): number {
  const raw = str(parsed, key);
  if (raw === undefined) return Math.round(fallback * 1000);
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new UsageError(`--${key} must be a positive number of seconds (got '${raw}')`);
  }
  return Math.round(seconds * 1000);
}

function recordLabelValue(rows: ReadonlyArray<readonly [string, string]>): string {
  const width = Math.max(0, ...rows.map(([key]) => key.length));
  return rows.map(([key, value]) => `${key.padEnd(width)}  ${value}`.trimEnd()).join('\n');
}

// ---------------------------------------------------------------------------
// confirmation gate — only when interactive stdout, no --yes, not --json
// ---------------------------------------------------------------------------

function needsConfirmation(ctx: CommandContext, yes: boolean): boolean {
  return !yes && ctx.format !== 'json' && process.stdout.isTTY === true;
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^\s*y(es)?\s*$/i.test(await rl.question(question));
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// record shaping + schedule humanization
//   describeSchedule is a camelCase port of desktop's describeRoutine
//   (desktop/src/schedule.ts) — same humanizations, Routine fields directly.
//   Keep in lockstep: tests/routines.test.ts mirrors the pinned matrix in
//   desktop/src/schedule.test.ts; the first divergence should fail here.
// ---------------------------------------------------------------------------

function routineJson(routine: Routine): Record<string, unknown> {
  return {
    id: routine.id,
    name: routine.name,
    agent_id: routine.agentId,
    cron: routine.cron,
    run_at: routine.runAt,
    session_id: routine.sessionId,
    next_run_at: routine.nextRunAt,
    prompt: routine.prompt,
    enabled: routine.enabled,
    created_at: routine.createdAt,
    updated_at: routine.updatedAt,
  };
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function ordinal(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

function formatTime12h(hour: number, minute: number): string {
  const h = ((hour % 24) + 24) % 24;
  const m = ((minute % 60) + 60) % 60;
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad2(m)} ${suffix}`;
}

function dateInputValue(value: Date): string {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
}

/** Exported for the desktop-parity test matrix in tests/routines.test.ts. */
export function describeSchedule(routine: Routine): string {
  const runAt = routine.runAt?.trim();
  if (runAt) {
    const value = new Date(runAt);
    if (!Number.isNaN(value.getTime())) {
      return `Once on ${dateInputValue(value)} at ${formatTime12h(value.getHours(), value.getMinutes())}`;
    }
  }
  const cron = routine.cron?.trim() ?? '';
  const parts = cron.split(/\s+/);
  if (parts.length === 5) {
    const [minute, hour, dom, month, dow] = parts;
    if (hour === '*' && /^\d+$/.test(minute)) return `Hourly at :${pad2(Number(minute))}`;
    if (/^\d+$/.test(hour) && /^\d+$/.test(minute)) {
      const time = formatTime12h(Number(hour), Number(minute));
      if (dow === '1-5' && dom === '*' && month === '*') return `Weekdays at ${time}`;
      if (dow === '*' && dom === '*' && month === '*') return `Every day at ${time}`;
      if (/^[0-6]$/.test(dow) && dom === '*' && month === '*') {
        return `${WEEKDAY_NAMES[Number(dow)]}s at ${time}`;
      }
      if (dow === '*' && /^\d{1,2}$/.test(dom) && month === '*') {
        return `Monthly on the ${ordinal(Number(dom))} at ${time}`;
      }
      if (dow === '*' && /^\d{1,2}$/.test(dom) && /^\d{1,2}$/.test(month)) {
        const monthIndex = Number(month);
        if (monthIndex >= 1 && monthIndex <= 12) {
          return `${MONTH_NAMES[monthIndex - 1]} ${ordinal(Number(dom))} at ${time}`;
        }
      }
    }
  }
  return cron;
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

// ---------------------------------------------------------------------------
// list / get
// ---------------------------------------------------------------------------

async function cmdList(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, { agent: { type: 'string' } });
  if (parsed.help) return printHelp();
  const client = await ctx.client();
  const agentRef = str(parsed, 'agent');
  // Same resolution contract as `create`: prefixes resolve against the roster,
  // no match is a CliError — never pass a raw fragment to the backend (it
  // expects a UUID and 422s).
  const agentId = agentRef ? await resolveAgentRef(client.deployments, agentRef) : undefined;
  const routines = await api('list routines', () =>
    client.routines.list(agentId ? { agentId } : {}));
  ctx.output.info(`total ${routines.length}`);
  ctx.output.result(
    routines.map(routineJson),
    routines.length === 0
      ? 'No routines found.'
      : {
          columns: ['NAME', 'PROMPT', 'SCHEDULE', 'NEXT RUN', 'ENABLED', 'SESSION', 'ID'],
          rows: routines.map((r) => [
            r.name ?? '',
            truncate(r.prompt, 40),
            describeSchedule(r),
            r.nextRunAt ?? '',
            r.enabled ? 'yes' : 'no',
            r.sessionId ? r.sessionId.slice(0, 12) : '',
            r.id,
          ]),
        },
  );
}

async function cmdGet(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args);
  if (parsed.help) return printHelp();
  const routineId = onePositional(parsed, 'routine id');
  const client = await ctx.client();
  const routine = await api('get routine', () => client.routines.get(routineId));
  ctx.output.result(
    routineJson(routine),
    recordLabelValue(
      ([
        ['id', routine.id],
        ['name', routine.name ?? ''],
        ['agent_id', routine.agentId],
        ['schedule', describeSchedule(routine)],
        ['cron', routine.cron ?? ''],
        ['run_at', routine.runAt ?? ''],
        ['session_id', routine.sessionId ?? ''],
        ['next_run_at', routine.nextRunAt ?? ''],
        ['prompt', routine.prompt],
        ['enabled', routine.enabled ? 'yes' : 'no'],
        ['created_at', routine.createdAt ?? ''],
        ['updated_at', routine.updatedAt ?? ''],
      ] as Array<[string, string]>).filter(([, value]) => value !== ''),
    ),
  );
}

// ---------------------------------------------------------------------------
// create / delete — flag surface identical to `hyper agents routines create`
// ---------------------------------------------------------------------------

async function cmdCreate(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, {
    name: { type: 'string' },
    cron: { type: 'string' },
    'run-at': { type: 'string' },
    prompt: { type: 'string' },
    agent: { type: 'string' },
    session: { type: 'string' },
    disabled: { type: 'boolean', default: false },
  });
  if (parsed.help) return printHelp();
  if (parsed.positionals.length > 0) {
    throw new UsageError(`unexpected arguments: ${parsed.positionals.join(' ')}`);
  }
  const prompt = str(parsed, 'prompt');
  if (!prompt) throw new UsageError('--prompt is required');
  const cron = str(parsed, 'cron');
  const runAt = str(parsed, 'run-at');
  if ((cron === undefined) === (runAt === undefined)) {
    throw new UsageError('exactly one of --cron or --run-at is required');
  }

  const client = await ctx.client();
  const agentRef = str(parsed, 'agent');
  const body = {
    ...(agentRef ? { agentId: await resolveAgentRef(client.deployments, agentRef) } : {}),
    prompt,
    ...(cron !== undefined ? { cron } : {}),
    ...(runAt !== undefined ? { runAt } : {}),
    ...(str(parsed, 'name') ? { name: str(parsed, 'name') } : {}),
    ...(str(parsed, 'session') ? { sessionId: str(parsed, 'session') } : {}),
    enabled: parsed.values.disabled !== true,
  } as RoutineCreateOptions;
  const routine = await api('create routine', () => client.routines.create(body));
  ctx.output.result(
    routineJson(routine),
    recordLabelValue([
      ['created', routine.id],
      ['name', routine.name ?? ''],
      ['schedule', describeSchedule(routine)],
      ['agent', routine.agentId],
      ['next_run_at', routine.nextRunAt ?? ''],
    ]),
  );
}

async function cmdDelete(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, { yes: { type: 'boolean', short: 'y', default: false } });
  if (parsed.help) return printHelp();
  const routineId = onePositional(parsed, 'routine id');
  if (needsConfirmation(ctx, parsed.values.yes === true)) {
    if (!(await confirm(`Delete routine ${routineId}? [y/N] `))) {
      ctx.output.info('aborted');
      return;
    }
  }
  const client = await ctx.client();
  await api('delete routine', () => client.routines.delete(routineId));
  ctx.output.result({ deleted: routineId }, `deleted ${routineId}`);
}

// ---------------------------------------------------------------------------
// run — no server-side run-now exists, so this replays executor semantics
// (routines/app/executor.py): agent must be RUNNING and an ACP-family runtime;
// session_id bound -> session/load with new-session fallback, else session/new;
// one session/prompt turn, awaited to its stop reason.
// ---------------------------------------------------------------------------

/** Default run timeout — mirrors the backend executor
    (routines/app/config.py: executor_turn_timeout_seconds = 1800). */
const DEFAULT_RUN_TIMEOUT_SECONDS = 1800;

type RunStage = 'connect' | 'session' | 'prompt';

interface RunResult {
  sessionId: string;
  resume: boolean;
  stopReason: string | undefined;
  reply: string;
}

/** Text of one ACP content block (or block array); non-text blocks fold to ''. */
function acpContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(acpContentText).join('');
  if (content && typeof content === 'object') {
    const block = content as { type?: unknown; text?: unknown };
    if (block.type === 'text' && typeof block.text === 'string') return block.text;
  }
  return '';
}

async function cmdRunNow(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, {
    wait: { type: 'boolean', short: 'w', default: false },
    timeout: { type: 'string' },
  });
  if (parsed.help) return printHelp();
  const routineId = onePositional(parsed, 'routine id');
  const wait = parsed.values.wait === true;
  const timeoutMs = secondsFlag(parsed, 'timeout', DEFAULT_RUN_TIMEOUT_SECONDS);

  const client = await ctx.client();
  const routine = await api('get routine', () => client.routines.get(routineId));
  const agent = await api('get agent', () => client.deployments.get(routine.agentId));

  const state = String(agent.state ?? '').toUpperCase();
  if (state !== 'RUNNING') {
    throw new CliError(
      `routine run: agent ${agent.id} is ${agent.state} — start it first (hyper agents start ${agent.id.slice(0, 12)})`,
    );
  }
  const runtime = (agent.runtime ?? '').toLowerCase();
  if (!ACP_RUNTIMES.has(runtime)) {
    throw new CliError(
      `routine run is only supported on coding-agent runtimes (${[...ACP_RUNTIMES].join(', ')}); `
      + `agent ${agent.id.slice(0, 12)} is '${agent.runtime ?? 'unknown'}'`,
    );
  }

  ctx.output.info(`running routine ${routine.name ?? routine.id} on agent ${agent.id.slice(0, 12)}`);

  let stage: RunStage = 'connect';
  let closeActive: (() => void) | undefined;
  let timedOut = false;
  let timer!: ReturnType<typeof setTimeout>;
  // The SDK's prompt path takes no AbortSignal; on timeout close the live ACP
  // connection, which rejects the in-flight turn (agents chat parity).
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      closeActive?.();
      reject(new Error('timed out'));
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  });

  const work = (async (): Promise<RunResult> => {
    let reply = '';
    const acp = await (agent as unknown as CodingAgent).acpConnect({
      clientInfo: { name: 'hypercli-cli' },
      onUpdate: (notification) => {
        const update = notification.update as unknown as {
          sessionUpdate?: string;
          content?: unknown;
        };
        if (update.sessionUpdate !== 'agent_message_chunk') return;
        reply += acpContentText(update.content);
      },
    });
    try {
      closeActive = () => acp.close();
      stage = 'session';
      let sessionId: string;
      let resume = false;
      if (routine.sessionId) {
        try {
          await acp.loadSession(routine.sessionId);
          sessionId = routine.sessionId;
          resume = true;
        } catch (err) {
          ctx.output.info(
            `could not resume bound session ${routine.sessionId} (${describeError(err)}); starting a new session`,
          );
          sessionId = (await acp.newSession()).sessionId;
        }
      } else {
        sessionId = (await acp.newSession()).sessionId;
      }
      stage = 'prompt';
      const turn = await acp.prompt(sessionId, routine.prompt);
      return { sessionId, resume, stopReason: turn.stopReason ?? undefined, reply };
    } finally {
      closeActive = undefined;
      acp.close();
    }
  })();
  // The timeout guard can win while work is in flight — mark the loser handled.
  work.catch(() => {});

  let result: RunResult;
  try {
    result = await Promise.race([work, guard]);
  } catch (err) {
    if (timedOut) {
      throw new CliError(`routine run: ${stage} stage failed: timed out after ${timeoutMs / 1000}s`);
    }
    if (err instanceof CliError) throw err;
    throw new CliError(`routine run: ${stage} stage failed: ${describeError(err)}`);
  } finally {
    clearTimeout(timer as ReturnType<typeof setTimeout>);
  }

  const payload: Record<string, unknown> = {
    routine_id: routine.id,
    routine_name: routine.name,
    agent_id: agent.id,
    runtime: agent.runtime ?? '',
    session_id: result.sessionId,
    resumed: result.resume,
    stop_reason: result.stopReason ?? null,
    ...(wait ? { reply: result.reply } : {}),
  };
  const block = recordLabelValue([
    ['routine', routine.name ?? routine.id],
    ['agent', agent.id.slice(0, 12)],
    ['session', result.sessionId],
    ['resumed', result.resume ? 'yes' : 'no'],
    ['stop_reason', result.stopReason ?? ''],
  ]);
  ctx.output.result(payload, wait && result.reply ? `${block}\n\n${result.reply}` : block);
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

export async function run(ctx: CommandContext, args: string[]): Promise<number | void> {
  const pre = parseUniversal(args);
  if (pre.help || pre.positionals.length === 0) {
    printHelp();
    return;
  }
  const [sub] = pre.positionals;
  // Splice at the first positional TOKEN — never indexOf the word, which can
  // hit an earlier flag value (e.g. `routines --agent list list`).
  const subArgs = [...args];
  subArgs.splice(pre.firstPositionalIndex, 1);
  switch (sub) {
    case 'list':
    case 'ls':
      return cmdList(ctx, subArgs);
    case 'get':
      return cmdGet(ctx, subArgs);
    case 'create':
      return cmdCreate(ctx, subArgs);
    case 'run':
      return cmdRunNow(ctx, subArgs);
    case 'delete':
      return cmdDelete(ctx, subArgs);
    default: {
      const hint = closestMatch(sub, COMMANDS);
      throw new UsageError(
        `unknown routines command '${sub}'${hint ? ` — did you mean '${hint}'?` : ''}\nusage: ${usage.join('\n       ')}`,
      );
    }
  }
}
