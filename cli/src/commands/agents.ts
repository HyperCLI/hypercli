/**
 * `hyper agents` — manage hosted agents (deployments).
 *
 * Golden-pattern duties carried by this group:
 *   - <id> arguments accept an unambiguous id prefix (list + prefix match,
 *     ambiguous -> UsageError listing candidates). Later groups copy this.
 *   - Records render as label/value blocks and curated JSON bags; gateway
 *     tokens, jwt tokens, and secret-shaped values are redacted to last-4.
 *
 * Substitutions against the original spec (records.ts / Commands.adopt do not
 * exist in the frozen core, so this module ships local equivalents):
 *   - adopt(ctx) resolves the lazy SDK client (ctx.client()) once per call.
 *   - routines ride client.routines (RoutinesAPI), not d.routines.
 *   - activate calls client.agent.redeemGrantCode (agent.ts), not a
 *     deployments method.
 *   - token calls d.createScopedKey(id, name); the SDK has no typed scopes
 *     field, so repeated --scope values are joined into the key name.
 */

import { randomBytes } from 'node:crypto';
import { statSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import {
  APIError,
  type Agent,
  type AgentLaunchConfig,
  type AgentRouteConfig,
  type AgentSessionClient,
  type AgentState,
  type CodingAgent,
  type CodingAgentAcpClient,
  type Deployments,
  type HermesAgent,
  type HyperAgentGrantRedemptionResponse,
  type HyperCLI,
  type ManagedAgentRuntime,
  type OpenClawAgent,
  type Routine,
  type RoutineCreateOptions,
  type RoutineUpdateOptions,
} from '@hypercli.com/sdk';
import { parseCommandArgs, type ParsedCommand } from '../core/argv.js';
import { installOpenClawAuthBridge } from '../core/auth-store.js';
import { CliError, UsageError } from '../core/errors.js';
import { renderGroupHelp } from '../core/help.js';
import type { CommandContext } from '../core/types.js';

export const name = 'agents';
export const summary = 'Manage hosted agents (deployments, shells, logs, files, routines).';
export const usage = [
  'hyper agents ls [--state X]',
  'hyper agents status <id> [--verbose]',
  'hyper agents wait <id> [--state X] [--timeout S] [--interval S]',
  'hyper agents create <name> --runtime R [--model M] [--plan P] [--size S] [--param k=v ...] [--dry-run]',
  'hyper agents start <id>',
  'hyper agents set runtime <id> <runtime> [--reset-image]',
  'hyper agents chat <id> <prompt...> [-s|--session NAME] [--timeout S] [--stream]',
  'hyper agents stop <id> [--yes]',
  'hyper agents delete <id> [--yes]',
  'hyper agents exec <id> [--] CMD [ARGS...]',
  'hyper agents shell <id>',
  'hyper agents logs <id> [-f|--follow] [-n LINES]',
  'hyper agents cp <src> <dst>   (exactly one side must be <id>:<path>)',
  'hyper agents activate <code> [--extend-existing]',
  'hyper agents routines list [--agent ID]',
  'hyper agents routines create (--cron EXPR | --run-at ISO) --prompt TEXT [--agent ID] [--name N] [--session ID] [--disabled]',
  'hyper agents routines delete <routine-id> [--yes]',
];

/** Hidden commands work but stay out of the help listing. */
const HIDDEN = ['archive', 'restore', 'token', 'config', 'routes', 'models'];

const RUNTIME_COMMANDS: ReadonlyMap<string, string> = new Map([
  ['openclaw', 'createOpenClaw'],
  ['hermes', 'createHermesAgent'],
  ['goose', 'createGoose'],
  ['opencode', 'createOpenCode'],
  ['buzz', 'createBuzzAgent'],
]);

/** desktop/src/agent-utils parity: only these runtimes get the token ceremony. */
const OPENCLAW_SET: ReadonlySet<ManagedAgentRuntime> = new Set(['openclaw', 'openclaw-pro']);
const HERMES_SET: ReadonlySet<ManagedAgentRuntime> = new Set(['hermes-agent']);
/** CodingAgent family: chat rides the pod-side ACP bridge, never a gateway. */
const ACP_SET: ReadonlySet<ManagedAgentRuntime> = new Set(['opencode', 'goose', 'codex', 'claude-code', 'kimi-code', 'buzz-agent']);
const OPENCLAW_RUNTIMES: ReadonlySet<string> = OPENCLAW_SET;
const HERMES_RUNTIMES: ReadonlySet<string> = HERMES_SET;
const ACP_RUNTIMES: ReadonlySet<string> = ACP_SET;

const KNOWN_COMMANDS = new Set([
  'ls', 'list', 'status', 'wait', 'create', 'start', 'chat', 'stop', 'delete', 'exec',
  'shell', 'logs', 'cp', 'activate', 'routines', 'set', ...HIDDEN,
]);

const MANAGED_RUNTIMES: ReadonlySet<ManagedAgentRuntime> = new Set([
  'generic', ...OPENCLAW_SET, ...HERMES_SET, ...ACP_SET,
]);

// ---------------------------------------------------------------------------
// record helpers (local stand-ins for the records.ts contract)
// ---------------------------------------------------------------------------

function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 12) : id;
}

/** Label/value block (ut-style): two columns, labels left-padded. */
function recordLabelValue(rows: ReadonlyArray<readonly [string, string]>): string {
  const width = Math.max(0, ...rows.map(([key]) => key.length));
  return rows.map(([key, value]) => `${key.padEnd(width)}  ${value}`.trimEnd()).join('\n');
}

const SENSITIVE_KEY = /(secret|token|api[-_]?key|password|credential|jwt)/i;

function maskSecret(value: string): string {
  return value.length > 4 ? `...${value.slice(-4)}` : '****';
}

/** Deep-copy a record bag, masking any string stored under a secret-shaped key. */
function redactRecord(value: unknown, key?: string): unknown {
  if (typeof value === 'string') return key && SENSITIVE_KEY.test(key) ? maskSecret(value) : value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => redactRecord(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactRecord(v, k)]),
    );
  }
  return value;
}

/** Launch configs arrive with secrets already stripped; env can still carry tokens. */
function redactLaunchConfig(config: Record<string, unknown> | null): unknown {
  if (!config) return null;
  const copy: Record<string, unknown> = { ...config };
  delete copy.secrets;
  delete copy.registry_auth;
  return redactRecord(copy);
}

function iso(value: Date | null): string | null {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

/** The JSON record bag for an Agent. Never carries jwt or full tokens. */
function recordJsonRecord(agent: Agent, dashboard?: string): Record<string, unknown> {
  const bag: Record<string, unknown> = {
    id: agent.id,
    name: agent.name,
    display_name: agent.displayName,
    handle: agent.handle,
    runtime: agent.runtime,
    state: agent.state,
    hostname: agent.hostname,
    dashboard: dashboard ?? null,
    public_url: agent.publicUrl ?? null,
    desktop_url: agent.desktopUrl ?? null,
    shell_url: agent.shellUrl ?? null,
    size: agent.requestedSize,
    cpu: agent.cpu,
    memory: agent.memory,
    tags: agent.tags,
    launch_epoch: agent.launchEpoch,
    agent_slot_id: agent.agentSlotId,
    cluster_id: agent.clusterId,
    created_at: iso(agent.createdAt),
    updated_at: iso(agent.updatedAt),
    started_at: iso(agent.startedAt),
    stopped_at: iso(agent.stoppedAt),
    archived_at: iso(agent.archivedAt),
    routes: redactRecord(agent.routes),
    launch_config: redactLaunchConfig(agent.launchConfig),
    meta: agent.meta ? redactRecord(agent.meta) : null,
  };
  const gatewayToken = (agent as Partial<OpenClawAgent>).gatewayToken;
  if (typeof gatewayToken === 'string' && gatewayToken) bag.gateway_token = maskSecret(gatewayToken);
  const apiServerKey = (agent as { apiServerKey?: string | null }).apiServerKey;
  if (typeof apiServerKey === 'string' && apiServerKey) bag.api_server_key = maskSecret(apiServerKey);
  return bag;
}

function dashboardBase(ctx: CommandContext): string {
  return ctx.dev ? 'https://console.dev.hypercli.com' : 'https://console.hypercli.com';
}

// ---------------------------------------------------------------------------
// error mapping — bare catches convert to CliError with API status detail
// ---------------------------------------------------------------------------

function describeFailure(err: unknown): string {
  if (err instanceof APIError) return `HTTP ${err.statusCode}: ${err.detail}`;
  if (err instanceof Error) return err.message;
  return String(err);
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

// ---------------------------------------------------------------------------
// adopt + agent reference resolution (the golden id-prefix pattern)
// ---------------------------------------------------------------------------

/** Resolve the deployments API through the lazy client. */
async function adopt(ctx: CommandContext): Promise<{ client: HyperCLI; d: Deployments }> {
  const client = await ctx.client();
  return { client, d: client.deployments };
}

const FULL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a user-typed <id> reference to a full agent id.
 *
 *   hyper agents status a1b2      — prefix of exactly one id/name/handle/hostname
 *   ambiguous                      — UsageError (exit 2) listing candidates
 *   no match                       — CliError (exit 1)
 */
async function resolveAgentRef(d: Deployments, ref: string): Promise<string> {
  const raw = String(ref ?? '').trim();
  if (!raw) throw new UsageError('missing agent id. See hyper agents --help.');
  if (FULL_UUID.test(raw)) return raw;

  const agents = await api('list agents', () => d.list());
  const fields = (a: Agent): string[] =>
    [a.id, a.name, a.handle, a.hostname]
      .filter((v): v is string => typeof v === 'string' && v.length > 0);

  const exact = agents.filter((a) => fields(a).some((v) => v === raw));
  if (exact.length === 1) return exact[0].id;

  const matches = exact.length > 1
    ? exact
    : agents.filter((a) => fields(a).some((v) => v.startsWith(raw)));
  if (matches.length === 1) return matches[0].id;
  if (matches.length > 1) {
    const lines = matches
      .slice(0, 10)
      .map((a) => `  ${a.id}  ${a.displayName ?? a.name ?? ''}  ${a.state}`)
      .join('\n');
    throw new UsageError(`ambiguous agent reference '${raw}':\n${lines}`);
  }
  throw new CliError(`no agent matches '${raw}'`);
}

// ---------------------------------------------------------------------------
// shared argv helpers
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

function strList(parsed: ParsedCommand, key: string): string[] {
  const value = parsed.values[key];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return [];
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

/** Repeated --param k=v pairs into a flat map of strings. */
function parseParams(items: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of items) {
    const eq = item.indexOf('=');
    if (eq <= 0) throw new UsageError(`--param '${item}' must be KEY=VALUE with a nonempty key`);
    out[item.slice(0, eq)] = item.slice(eq + 1);
  }
  return out;
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
// ls
// ---------------------------------------------------------------------------

async function cmdLs(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, { state: { type: 'string' } });
  if (parsed.help) return printHelp();
  const { d } = await adopt(ctx);
  const state = str(parsed, 'state');
  const agents = await api('list agents', () => d.list(state ? { state } : {}));

  const counts = new Map<string, number>();
  for (const agent of agents) {
    const key = String(agent.state ?? 'unknown').toUpperCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const breakdown = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([stateName, n]) => `${stateName} ${n}`)
    .join(', ');
  ctx.output.info(`total ${agents.length}${breakdown ? ` (${breakdown})` : ''}`);

  ctx.output.result(
    agents.map((agent) => recordJsonRecord(agent, `${dashboardBase(ctx)}/agents/${agent.id}`)),
    agents.length === 0
      ? 'No agents found.'
      : {
          columns: ['ID', 'NAME', 'RUNTIME', 'STATE'],
          rows: agents.map((agent) => [
            shortId(agent.id),
            agent.displayName ?? agent.name ?? '',
            agent.runtime ?? '',
            agent.state,
          ]),
        },
  );
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

const PLAN_META_KEY = /plan|entitlement/i;

async function cmdStatus(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, { verbose: { type: 'boolean', default: false } });
  if (parsed.help) return printHelp();
  const ref = onePositional(parsed, 'agent id');
  const { d } = await adopt(ctx);
  const agent = await api('get agent', async () => d.get(await resolveAgentRef(d, ref)));
  const dashboard = `${dashboardBase(ctx)}/agents/${agent.id}`;
  const record = recordJsonRecord(agent, dashboard);

  const rows: Array<[string, string]> = [
    ['id', agent.id],
    ['name', agent.displayName ?? agent.name ?? ''],
    ['handle', agent.handle ?? ''],
    ['runtime', agent.runtime ?? ''],
    ['state', agent.state],
    ['dashboard', dashboard],
    ['hostname', agent.hostname ?? ''],
    ['size', agent.requestedSize ?? (agent.cpu ? `${agent.cpu}c/${agent.memory}G` : '')],
    ['launch_epoch', String(agent.launchEpoch)],
    ['agent_slot_id', agent.agentSlotId ?? ''],
    ['created_at', iso(agent.createdAt) ?? ''],
    ['started_at', iso(agent.startedAt) ?? ''],
    ['stopped_at', iso(agent.stoppedAt) ?? ''],
  ];
  // plan/entitlement fields, as returned on the record meta bag
  if (agent.meta) {
    for (const [key, value] of Object.entries(agent.meta)) {
      if (!PLAN_META_KEY.test(key)) continue;
      rows.push([key, typeof value === 'string' ? value : JSON.stringify(value)]);
    }
    const status = agent.meta.status;
    if (status && status.status === 'error') {
      rows.push(['error', [status.reason, status.message].filter(Boolean).join(': ') || 'error']);
    }
  }

  let table = recordLabelValue(rows.filter(([, value]) => value !== ''));
  if (parsed.values.verbose === true) {
    table += `\n\n${JSON.stringify(record, null, 2)}`;
  }
  ctx.output.result(record, table);
}

// ---------------------------------------------------------------------------
// wait
// ---------------------------------------------------------------------------

async function cmdWait(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, {
    state: { type: 'string' },
    timeout: { type: 'string' },
    interval: { type: 'string' },
  });
  if (parsed.help) return printHelp();
  const ref = onePositional(parsed, 'agent id');
  const target = (str(parsed, 'state') ?? 'RUNNING').toUpperCase() as AgentState;
  const timeoutMs = secondsFlag(parsed, 'timeout', 300);
  const intervalMs = secondsFlag(parsed, 'interval', 5);

  const { d } = await adopt(ctx);
  const id = await resolveAgentRef(d, ref);
  ctx.output.info(`waiting for agent ${shortId(id)} to reach ${target} (timeout ${timeoutMs / 1000}s)`);

  let agent: Agent;
  try {
    agent = target === 'RUNNING'
      ? await d.waitRunning(id, timeoutMs, intervalMs)
      : await d.waitForState(
        id,
        [target],
        timeoutMs,
        (['FAILED', 'DELETED'] as AgentState[]).filter((s) => s !== target),
        undefined,
        intervalMs,
      );
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw new CliError(`wait failed: ${describeFailure(err)}`);
  }

  ctx.output.result(
    recordJsonRecord(agent, `${dashboardBase(ctx)}/agents/${agent.id}`),
    `agent ${shortId(agent.id)} reached ${agent.state}`,
  );
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

async function cmdCreate(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, {
    runtime: { type: 'string' },
    model: { type: 'string' },
    plan: { type: 'string' },
    size: { type: 'string' },
    env: { type: 'string', multiple: true },
    param: { type: 'string', multiple: true },
    'dry-run': { type: 'boolean', default: false },
  });
  if (parsed.help) return printHelp();
  const agentName = onePositional(parsed, 'agent name');
  const runtime = str(parsed, 'runtime')?.toLowerCase();
  if (!runtime) {
    throw new UsageError(`--runtime is required (one of: ${[...RUNTIME_COMMANDS.keys()].join(', ')})`);
  }
  const method = RUNTIME_COMMANDS.get(runtime);
  if (!method) {
    throw new UsageError(
      `unknown runtime '${runtime}' (expected one of: ${[...RUNTIME_COMMANDS.keys()].join(', ')})`,
    );
  }

  const model = str(parsed, 'model');
  const plan = str(parsed, 'plan');
  const size = str(parsed, 'size');
  const env = parseParams(strList(parsed, 'env'));
  // Payload passthrough: openclaw strips the generic config bag in
  // createOpenClaw, so --param rides env there; the other runtimes carry a
  // free-form config bag that reaches the create payload.
  const params = parseParams(strList(parsed, 'param'));
  const dryRun = parsed.values['dry-run'] === true;

  // openclaw strips the generic config bag in createOpenClaw, so a model there
  // would be silently dropped; refuse instead of pretending.
  if (model && runtime === 'openclaw') {
    throw new UsageError(
      "--model is not supported for runtime 'openclaw' at create time; "
      + 'configure the model after launch with hyper agents config set <id> --param ...',
    );
  }

  // The SDK create contract has no plan field; --plan rides as a visible tag.
  const tags = plan ? [`plan:${plan}`] : undefined;

  const mergedEnv = { ...env, ...(runtime === 'openclaw' ? params : {}) };
  const configBag = runtime === 'openclaw' ? {} : { ...(model ? { model } : {}), ...params };
  const payload: Record<string, unknown> = {
    name: agentName,
    ...(size ? { size } : {}),
    ...(tags ? { tags } : {}),
    ...(Object.keys(mergedEnv).length > 0 ? { env: mergedEnv } : {}),
    ...(Object.keys(configBag).length > 0 ? { config: configBag } : {}),
    dryRun,
  };

  if (dryRun) {
    // Print the resolved payload, call nothing (not even ctx.client()).
    const printable = { runtime, method, options: payload };
    ctx.output.result(printable, JSON.stringify(printable, null, 2));
    return;
  }

  const { d } = await adopt(ctx);
  const created = await api('create agent', async () =>
    (d as unknown as Record<string, (options: unknown) => Promise<Agent>>)[method](payload));
  ctx.output.result(
    recordJsonRecord(created, `${dashboardBase(ctx)}/agents/${created.id}`),
    recordLabelValue([
      ['created', shortId(created.id)],
      ['name', created.displayName ?? created.name ?? ''],
      ['runtime', created.runtime ?? runtime],
      ['state', created.state],
    ]),
  );
  ctx.output.info(`start it with: hyper agents start ${shortId(created.id)}`);
}

// ---------------------------------------------------------------------------
// start — runtime dispatch (desktop/src/api.ts startAgent parity)
// ---------------------------------------------------------------------------

/**
 * The runtime-dispatched start shared by `agents start` and `agents chat`:
 * openclaw gets the gateway-token secret dance, hermes rehydrates its stored
 * launch config, every other runtime takes the plain start. Never prints
 * secrets; the token only travels between d.secret/setSecret/startOpenClaw.
 */
async function startAgentForRuntime(d: Deployments, agent: Agent): Promise<Agent> {
  const runtime = (agent.runtime ?? '').toLowerCase();
  const id = agent.id;
  if (OPENCLAW_RUNTIMES.has(runtime)) {
    // Ensure the openclaw gateway token before startOpenClaw: read the stored
    // secret; only a genuine 404 means "no token yet" — any other failure
    // aborts the start rather than invalidating live gateway sessions.
    let gatewayToken: string | null = null;
    try {
      const secret = await d.secret(id, 'OPENCLAW_GATEWAY_TOKEN');
      const value = String(secret.value ?? '').trim();
      if (value) gatewayToken = value;
    } catch (err) {
      if (!(err instanceof APIError) || err.statusCode !== 404) {
        throw new CliError(`start failed: could not read the gateway token secret: ${describeFailure(err)}`);
      }
    }
    if (!gatewayToken) {
      gatewayToken = randomBytes(32).toString('hex');
      await api('store gateway token', () => d.setSecret(id, 'OPENCLAW_GATEWAY_TOKEN', gatewayToken as string));
    }
    const stored = await api('rebuild launch config', () => d.storedLaunchConfig(id));
    return api('start agent', () =>
      d.startOpenClaw(id, { gatewayToken, launchConfig: stored as Omit<AgentLaunchConfig, 'config'> }));
  }
  if (HERMES_RUNTIMES.has(runtime)) {
    const stored = await api('rebuild launch config', () => d.storedLaunchConfig(id));
    return api('start agent', () => d.startHermesAgent(id, { launchConfig: stored }));
  }
  return api('start agent', () => d.start(id));
}

async function cmdStart(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args);
  if (parsed.help) return printHelp();
  const ref = onePositional(parsed, 'agent id');
  const { d } = await adopt(ctx);
  const agent = await api('get agent', async () => d.get(await resolveAgentRef(d, ref)));
  const started = await startAgentForRuntime(d, agent);

  ctx.output.result(
    recordJsonRecord(started, `${dashboardBase(ctx)}/agents/${started.id}`),
    `starting ${shortId(started.id)} (${started.state})`,
  );
}

// ---------------------------------------------------------------------------
// set — mutate one field on an existing agent
// ---------------------------------------------------------------------------

async function cmdSet(ctx: CommandContext, args: string[]): Promise<void> {
  const [field, ...rest] = args;
  if (!field || field === '--help' || field === '-h') return printHelp();
  if (field !== 'runtime') {
    throw new UsageError(`unknown agents set field '${field}' (expected: runtime)`);
  }
  const parsed = parseCommandArgs(rest, {
    'reset-image': { type: 'boolean', default: false },
  });
  if (parsed.help) return printHelp();
  if (parsed.positionals.length < 2) throw new UsageError('missing agent id or runtime');
  if (parsed.positionals.length > 2) {
    throw new UsageError(`unexpected extra arguments: ${parsed.positionals.slice(2).join(' ')}`);
  }
  const [ref, runtime] = parsed.positionals;
  if (!MANAGED_RUNTIMES.has(runtime as ManagedAgentRuntime)) {
    throw new UsageError(
      `unknown runtime '${runtime}' (expected one of: ${[...MANAGED_RUNTIMES].join(', ')})`,
    );
  }
  const resetImage = parsed.values['reset-image'] === true;
  const { d } = await adopt(ctx);
  const id = await resolveAgentRef(d, ref);
  const updated = await api('update agent', () =>
    d.update(id, { runtime: runtime as ManagedAgentRuntime, ...(resetImage ? { resetImage: true } : {}) }));
  ctx.output.result(
    recordJsonRecord(updated, `${dashboardBase(ctx)}/agents/${updated.id}`),
    `updated ${shortId(id)} runtime=${updated.runtime}${resetImage ? ' (image reset to default; applies on next start)' : ''}`,
  );
}

// ---------------------------------------------------------------------------
// stop / delete / archive / restore
// ---------------------------------------------------------------------------

async function cmdStop(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, { yes: { type: 'boolean', short: 'y', default: false } });
  if (parsed.help) return printHelp();
  const ref = onePositional(parsed, 'agent id');
  const { d } = await adopt(ctx);
  const id = await resolveAgentRef(d, ref);
  if (needsConfirmation(ctx, parsed.values.yes === true)) {
    if (!(await confirm(`Stop agent ${shortId(id)}? [y/N] `))) {
      ctx.output.info('aborted');
      return;
    }
  }
  const stopped = await api('stop agent', () => d.stop(id));
  ctx.output.result(
    recordJsonRecord(stopped, `${dashboardBase(ctx)}/agents/${stopped.id}`),
    stopped.state.toUpperCase() === 'STOPPED'
      ? `stopped ${shortId(id)}`
      : `stopping ${shortId(id)} (${stopped.state}); cleanup may still be in progress`,
  );
}

async function cmdDelete(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, { yes: { type: 'boolean', short: 'y', default: false } });
  if (parsed.help) return printHelp();
  const ref = onePositional(parsed, 'agent id');
  const { d } = await adopt(ctx);
  const id = await resolveAgentRef(d, ref);
  if (needsConfirmation(ctx, parsed.values.yes === true)) {
    if (!(await confirm(`Permanently delete agent ${shortId(id)}? [y/N] `))) {
      ctx.output.info('aborted');
      return;
    }
  }
  await api('delete agent', () => d.delete(id));
  ctx.output.result({ deleted: id }, `deleted ${shortId(id)}`);
}

async function cmdArchiveRestore(
  ctx: CommandContext,
  args: string[],
  verb: 'archive' | 'restore',
): Promise<void> {
  const parsed = parseCommandArgs(args);
  if (parsed.help) return printHelp();
  const ref = onePositional(parsed, 'agent id');
  const { d } = await adopt(ctx);
  const id = await resolveAgentRef(d, ref);
  const agent = await api(`${verb} agent`, () => (verb === 'archive' ? d.archive(id) : d.restore(id)));
  ctx.output.result(
    recordJsonRecord(agent, `${dashboardBase(ctx)}/agents/${agent.id}`),
    `${verb === 'archive' ? 'archiving' : 'restoring'} ${shortId(id)} (${agent.state})`,
  );
}

// ---------------------------------------------------------------------------
// exec
// ---------------------------------------------------------------------------

async function cmdExec(ctx: CommandContext, args: string[]): Promise<number> {
  const parsed = parseCommandArgs(args, { timeout: { type: 'string' } });
  if (parsed.help) {
    printHelp();
    return 0;
  }
  const [ref, ...command] = parsed.positionals;
  if (!ref) throw new UsageError('missing agent id');
  const timeoutRaw = str(parsed, 'timeout');
  let timeout = 30;
  if (timeoutRaw !== undefined) {
    timeout = Number(timeoutRaw);
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 300) {
      throw new UsageError('--timeout must be an integer from 1 through 300');
    }
  }
  if (command.length === 0) {
    throw new UsageError(`usage: hyper agents exec <id> [--] CMD [ARGS...]`);
  }

  const { d } = await adopt(ctx);
  const id = await resolveAgentRef(d, ref);
  const result = await api('exec', () => d.exec(id, command, { timeout }));

  if (ctx.format === 'json') {
    ctx.output.result(result);
  } else {
    if (result.stdout) ctx.output.result({}, result.stdout.replace(/\n$/, ''));
    if (result.stderr) ctx.output.info(result.stderr.replace(/\n$/, ''));
  }
  return result.exitCode;
}

// ---------------------------------------------------------------------------
// shell — raw-mode passthrough over the SDK shell WebSocket (no node-pty)
// ---------------------------------------------------------------------------

async function cmdShell(ctx: CommandContext, args: string[]): Promise<number> {
  const parsed = parseCommandArgs(args, { shell: { type: 'string' } });
  if (parsed.help) {
    printHelp();
    return 0;
  }
  const ref = onePositional(parsed, 'agent id');
  // No half-broken TTY: without a real terminal we refuse, pointing at exec.
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    throw new UsageError(
      'agents shell needs an interactive TTY; use hyper agents exec <id> -- CMD for non-interactive runs',
    );
  }

  const { d } = await adopt(ctx);
  const id = await resolveAgentRef(d, ref);
  ctx.output.info(`connecting to shell on ${shortId(id)} (Ctrl+] to disconnect)`);
  const ws = await api('open shell', () => d.shellConnect(id, str(parsed, 'shell')));

  return await new Promise<number>((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let settled = false;

    const sendResize = () => {
      try {
        ws.send(`\x1b[8;${stdout.rows ?? 24};${stdout.columns ?? 80}t`);
      } catch {
        // A socket already closing needs no resize.
      }
    };
    const finish = (error?: Error, code = 0) => {
      if (settled) return;
      settled = true;
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.removeListener('SIGWINCH', sendResize);
      try {
        ws.close();
      } catch {
        // Peer already closed the socket.
      }
      if (error) reject(error);
      else resolve(code);
    };
    const onData = (chunk: Buffer) => {
      if (chunk.includes(0x1d)) {
        finish();
        return;
      }
      try {
        ws.send(chunk.toString('utf8'));
      } catch {
        finish();
      }
    };

    ws.onmessage = (event: MessageEvent) => {
      const data = event.data as unknown;
      if (typeof data === 'string') stdout.write(data);
      else if (data instanceof ArrayBuffer) stdout.write(Buffer.from(data));
      else if (ArrayBuffer.isView(data)) stdout.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    };
    ws.onclose = () => {
      ctx.output.info('disconnected');
      finish();
    };
    ws.onerror = () => finish(new CliError('shell connection failed'));

    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
    process.on('SIGWINCH', sendResize);
    sendResize();
  });
}

// ---------------------------------------------------------------------------
// logs
// ---------------------------------------------------------------------------

async function cmdLogs(ctx: CommandContext, args: string[]): Promise<number | void> {
  const parsed = parseCommandArgs(args, {
    follow: { type: 'boolean', short: 'f', default: false },
    lines: { type: 'string', short: 'n' },
    container: { type: 'string' },
  });
  if (parsed.help) {
    printHelp();
    return 0;
  }
  const ref = onePositional(parsed, 'agent id');
  const follow = parsed.values.follow === true;
  const linesRaw = str(parsed, 'lines');
  let tailLines = 100;
  if (linesRaw !== undefined) {
    tailLines = Number(linesRaw);
    if (!Number.isInteger(tailLines) || tailLines < 0) {
      throw new UsageError('--lines must be a non-negative integer');
    }
  }

  const { d } = await adopt(ctx);
  const id = await resolveAgentRef(d, ref);
  const container = str(parsed, 'container');

  if (!follow) {
    // One-shot: history only, promise resolves at history_end.
    const lines: string[] = [];
    await api('read logs', () =>
      d.subscribeLogs(id, (line) => { lines.push(line); }, {
        follow: false,
        tailLines,
        ...(container ? { container } : {}),
      }));
    ctx.output.result(lines, lines.length ? lines.join('\n') : '(no logs)');
    return 0;
  }

  // Follow: stream lines verbatim; reconnect OFF (SDK default). SIGINT aborts
  // and exits 130.
  const controller = new AbortController();
  let interrupted = false;
  const onSigint = () => {
    interrupted = true;
    controller.abort();
  };
  process.once('SIGINT', onSigint);
  try {
    await api('stream logs', () =>
      d.subscribeLogs(
        id,
        (line) => {
          process.stdout.write(`${line}\n`);
        },
        {
          follow: true,
          tailLines,
          signal: controller.signal,
          ...(container ? { container } : {}),
        },
      ));
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
  return interrupted ? 130 : 0;
}

// ---------------------------------------------------------------------------
// cp
// ---------------------------------------------------------------------------

function parseCpTarget(value: string): { agentRef?: string; path: string } {
  // A Windows drive path ("C:\dir\file") is never a remote target.
  if (/^[A-Za-z]:[\\/]/.test(value)) return { path: value };
  const colon = value.indexOf(':');
  if (colon < 0) return { path: value };
  const head = value.slice(0, colon);
  // A path separator before the colon means it was a local relative path.
  if (head.includes('/') || head.includes('\\')) return { path: value };
  const remotePath = value.slice(colon + 1);
  if (!head || !remotePath) {
    throw new UsageError(`remote targets must use <id>:<path> (got '${value}')`);
  }
  return { agentRef: head, path: remotePath };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}

async function cmdCp(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args);
  if (parsed.help) return printHelp();
  if (parsed.positionals.length !== 2) {
    throw new UsageError('usage: hyper agents cp <src> <dst> (exactly one side must be <id>:<path>)');
  }
  const src = parseCpTarget(parsed.positionals[0]);
  const dst = parseCpTarget(parsed.positionals[1]);
  if ((src.agentRef === undefined) === (dst.agentRef === undefined)) {
    throw new UsageError('exactly one side of cp must be remote (<id>:<path>)');
  }

  const { d } = await adopt(ctx);
  if (dst.agentRef) {
    const id = await resolveAgentRef(d, dst.agentRef);
    await api('copy up', () => d.cpTo(id, src.path, dst.path));
    let bytes = 0;
    try {
      bytes = statSync(src.path).size;
    } catch {
      bytes = 0;
    }
    ctx.output.info(`copied ${formatBytes(bytes)} up to ${shortId(id)}:${dst.path}`);
    ctx.output.result(
      { direction: 'up', agent_id: id, local: src.path, remote: dst.path, bytes },
      `copied ${src.path} -> ${shortId(id)}:${dst.path}`,
    );
    return;
  }

  const id = await resolveAgentRef(d, src.agentRef as string);
  const destination = await api('copy down', () => d.cpFrom(id, src.path, dst.path));
  let bytes = 0;
  try {
    bytes = statSync(destination).size;
  } catch {
    bytes = 0;
  }
  ctx.output.info(`copied ${formatBytes(bytes)} down from ${shortId(id)}:${src.path}`);
  ctx.output.result(
    { direction: 'down', agent_id: id, remote: src.path, local: destination, bytes },
    `copied ${shortId(id)}:${src.path} -> ${destination}`,
  );
}

// ---------------------------------------------------------------------------
// activate
// ---------------------------------------------------------------------------

async function cmdActivate(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, {
    'extend-existing': { type: 'boolean', default: false },
  });
  if (parsed.help) return printHelp();
  const code = onePositional(parsed, 'code');
  const { client } = await adopt(ctx);
  const result = await api('redeem code', () =>
    client.agent.redeemGrantCode(code, {
      extendExisting: parsed.values['extend-existing'] === true,
    }));
  printActivation(ctx, result);
}

function printActivation(ctx: CommandContext, result: HyperAgentGrantRedemptionResponse): void {
  const { grant, entitlement } = result;
  const rows: Array<[string, string]> = [
    ['code', grant.code ?? ''],
    ['plan', entitlement.planName || entitlement.planId || grant.planId],
    ['plan_id', entitlement.planId || grant.planId],
    ['starts_at', iso(entitlement.startsAt) ?? ''],
    ['expires_at', iso(entitlement.expiresAt) ?? ''],
    ['tags', (entitlement.tags.length ? entitlement.tags : grant.tags).join(', ')],
    ['entitlement', entitlement.id],
  ];
  ctx.output.result(result, ['Code activated', recordLabelValue(rows.filter(([, v]) => v !== ''))].join('\n'));
}

// ---------------------------------------------------------------------------
// routines
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

function routineSchedule(routine: Routine): string {
  if (routine.cron) return `cron: ${routine.cron}`;
  if (routine.runAt) return `once: ${routine.runAt}`;
  return '';
}

async function cmdRoutines(ctx: CommandContext, args: string[]): Promise<void> {
  const [verb = 'list', ...rest] = args;

  switch (verb) {
    case 'list': {
      const parsed = parseCommandArgs(rest, { agent: { type: 'string' } });
      if (parsed.help) return printHelp();
      const { client } = await adopt(ctx);
      const agentFilter = str(parsed, 'agent');
      const routines = await api('list routines', () =>
        client.routines.list(agentFilter ? { agentId: agentFilter } : {}));
      ctx.output.info(`total ${routines.length}`);
      ctx.output.result(
        routines.map(routineJson),
        routines.length === 0
          ? 'No routines found.'
          : {
              columns: ['NAME', 'SCHEDULE', 'ENABLED', 'ID'],
              rows: routines.map((r) => [
                r.name ?? '',
                routineSchedule(r),
                r.enabled ? 'yes' : 'no',
                r.id,
              ]),
            },
      );
      return;
    }

    case 'create': {
      const parsed = parseCommandArgs(rest, {
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
      const agentRef = str(parsed, 'agent');

      const { client, d } = await adopt(ctx);
      const body = {
        ...(agentRef ? { agentId: await resolveAgentRef(d, agentRef) } : {}),
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
          ['schedule', routineSchedule(routine)],
          ['agent', routine.agentId],
          ['next_run_at', routine.nextRunAt ?? ''],
        ]),
      );
      return;
    }

    case 'delete': {
      const parsed = parseCommandArgs(rest, { yes: { type: 'boolean', short: 'y', default: false } });
      if (parsed.help) return printHelp();
      const routineId = onePositional(parsed, 'routine id');
      if (needsConfirmation(ctx, parsed.values.yes === true)) {
        if (!(await confirm(`Delete routine ${routineId}? [y/N] `))) {
          ctx.output.info('aborted');
          return;
        }
      }
      const { client } = await adopt(ctx);
      await api('delete routine', () => client.routines.delete(routineId));
      ctx.output.result({ deleted: routineId }, `deleted ${routineId}`);
      return;
    }

    // Hidden: works, stays out of the help listing.
    case 'update': {
      const parsed = parseCommandArgs(rest, {
        name: { type: 'string' },
        cron: { type: 'string' },
        'run-at': { type: 'string' },
        prompt: { type: 'string' },
        enable: { type: 'boolean', default: false },
        disable: { type: 'boolean', default: false },
        agent: { type: 'string' },
        session: { type: 'string' },
      });
      if (parsed.help) return printHelp();
      const routineId = onePositional(parsed, 'routine id');
      const body: RoutineUpdateOptions = {};
      if (parsed.values.enable === true && parsed.values.disable === true) {
        throw new UsageError('pass only one of --enable or --disable');
      }
      if (parsed.values.enable === true) body.enabled = true;
      if (parsed.values.disable === true) body.enabled = false;
      if (str(parsed, 'name') !== undefined) body.name = str(parsed, 'name');
      if (str(parsed, 'cron') !== undefined) body.cron = str(parsed, 'cron');
      if (str(parsed, 'run-at') !== undefined) body.runAt = str(parsed, 'run-at');
      if (str(parsed, 'prompt') !== undefined) body.prompt = str(parsed, 'prompt');
      const session = str(parsed, 'session');
      if (session !== undefined) body.sessionId = session === 'null' ? '' : session;
      if (Object.keys(body).length === 0) {
        throw new UsageError('nothing to update; pass --name, --cron, --run-at, --prompt, --session, --enable or --disable');
      }
      const { client } = await adopt(ctx);
      const routine = await api('update routine', () => client.routines.update(routineId, body));
      ctx.output.result(routineJson(routine), `updated ${routine.id}`);
      return;
    }

    default:
      throw new UsageError(`unknown routines command '${verb}' (expected: list, create, delete)`);
  }
}

// ---------------------------------------------------------------------------
// token (hidden)
// ---------------------------------------------------------------------------

async function cmdToken(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, { scope: { type: 'string', multiple: true } });
  if (parsed.help) return printHelp();
  const ref = onePositional(parsed, 'agent id');
  const scopes = strList(parsed, 'scope');
  if (scopes.some((scope) => !scope.trim())) throw new UsageError('--scope must not be empty');

  const { d } = await adopt(ctx);
  const id = await resolveAgentRef(d, ref);
  // The SDK signs the request body with an optional key name only; repeated
  // scopes are carried as that name until createScopedKey grows a scopes field.
  const record = await api('create token', () =>
    d.createScopedKey(id, scopes.length > 0 ? scopes.join(',') : undefined));

  const key = ['key', 'api_key', 'apiKey', 'token']
    .map((field) => record[field])
    .find((value): value is string => typeof value === 'string' && value.length > 0);

  ctx.output.info('this key is shown once and is not stored; save it now');

  if (ctx.format !== 'json') {
    // Table mode: the key is the single line on stdout — once, never embedded
    // in a record table.
    if (!key) throw new CliError('create token failed: the response carried no key value');
    ctx.output.result({ id, agent_id: id }, key);
    return;
  }
  ctx.output.result({ ...record, agent_id: record.agent_id ?? id });
}

// ---------------------------------------------------------------------------
// config (hidden) / models (hidden, openclaw-only)
// ---------------------------------------------------------------------------

function requireOpenClaw(agent: Agent, what: string): OpenClawAgent {
  const runtime = agent.runtime ?? 'unknown';
  if (!OPENCLAW_RUNTIMES.has(runtime.toLowerCase())) {
    throw new CliError(`${what} is only supported on openclaw agents (this is ${runtime})`);
  }
  return agent as OpenClawAgent;
}

async function cmdConfig(ctx: CommandContext, args: string[]): Promise<void> {
  const [verb, ...rest] = args;
  if (verb === 'set') {
    throw new UsageError(
      'hyper agents config is read-only: it dumps the launch config applied at agent start. '
      + 'Mutate it with hyper agents routes add|remove or the deployments env API.',
    );
  }
  const parsed = parseCommandArgs(verb === 'get' ? rest : args);
  if (parsed.help) return printHelp();
  const ref = onePositional(parsed, 'agent id');
  const { d } = await adopt(ctx);
  const agent = await api('get agent', async () => d.get(await resolveAgentRef(d, ref)));
  // launch_config IS the agent config: the complete contract applied once at
  // launch. It arrives with secrets already stripped; redact defense-in-depth.
  const config = redactLaunchConfig(
    (agent.launchConfig && typeof agent.launchConfig === 'object'
      ? agent.launchConfig
      : {}) as Record<string, unknown>,
  );
  ctx.output.result(config, JSON.stringify(config, null, 2));
}

async function cmdModels(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args);
  if (parsed.help) return printHelp();
  const ref = onePositional(parsed, 'agent id');
  const { d } = await adopt(ctx);
  const agent = await api('get agent', async () => d.get(await resolveAgentRef(d, ref)));
  const openclaw = requireOpenClaw(agent, 'models');
  const models = await api('list models', () => openclaw.modelsList());

  const rows: unknown[][] = [];
  let tabular = models.length > 0;
  for (const entry of models) {
    const record = entry as Record<string, unknown>;
    const provider = typeof record.provider === 'string' ? record.provider : null;
    const nameField = typeof record.name === 'string' ? record.name : null;
    if (!provider || !nameField) {
      tabular = false;
      break;
    }
    rows.push([provider, nameField, record.contextWindow ?? record.context_length ?? '']);
  }
  ctx.output.result(
    models,
    models.length === 0
      ? 'No models configured.'
      : tabular
        ? { columns: ['PROVIDER', 'NAME', 'CONTEXT'], rows }
        : JSON.stringify(models, null, 2),
  );
}

// ---------------------------------------------------------------------------
// chat — the canonical one-shot prompt round trip, validated per runtime in CI
//
// CI contract: zero TTY, no prompts, no stdin reads. Exit 0 exactly when an
// assistant reply is produced. Every failure is a CliError naming its stage:
//   chat: <start|wait|connect|pair|prompt> stage failed: ...
// Progress (started agent, pairing state, session opened) goes to stderr via
// ctx.output.info; stdout carries only the reply text (or the --json bag).
//
// Runtime families (record.runtime string gating — the records stay plain
// hydrated Agent objects; no instanceof):
//   openclaw/openclaw-pro — OpenClawAgent.connectSession() over the gateway;
//     the ONLY family that pairs. autoApprovePairing stays on (SDK default,
//     agents.ts gatewayOptions) and onPairing surfaces state on stderr.
//     Pairing artifacts (device identity + per-agent device token) persist in
//     ~/.hypercli/auth.json via core/auth-store.ts, so repeat chats re-use the
//     already-paired device instead of re-pairing.
//   hermes-agent          — HermesAgent.connect(); server-key auth, no
//     pairing.
//   coding agents (opencode, goose, codex, claude-code, kimi-code,
//   buzz-agent)           — CodingAgent.acpConnect() over the backend /ws
//     bridge, no pairing. The reply is folded from agent_message_chunk
//     notifications; prompt() resolving is the terminal condition.
//
// Sessions: NO session flag means a brand-new session every invocation on
// every family (there is no carried-over default session). -s/--session NAME
// is reuse-or-create: ACP resumes via session/load (the NAME is the ACP
// session id); hermes and openclaw reuse a session whose key (or label) is
// NAME, creating it when absent.
// ---------------------------------------------------------------------------

type ChatStage = 'start' | 'wait' | 'connect' | 'pair' | 'prompt';

type ChatFamily = 'openclaw' | 'hermes' | 'acp';

function chatFamily(runtime: string): ChatFamily {
  const key = runtime.toLowerCase();
  if (OPENCLAW_RUNTIMES.has(key)) return 'openclaw';
  if (HERMES_RUNTIMES.has(key)) return 'hermes';
  if (ACP_RUNTIMES.has(key)) return 'acp';
  throw new CliError(
    `chat is not supported on runtime '${runtime || 'unknown'}' `
    + `(supported: ${[...OPENCLAW_RUNTIMES, ...HERMES_RUNTIMES, ...ACP_RUNTIMES].join(', ')})`,
  );
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

/** Open (or resume) the ACP session; part of the connect stage. */
async function acpOpenSession(client: CodingAgentAcpClient, name: string | undefined): Promise<string> {
  if (name !== undefined) {
    await client.loadSession(name);
    return name;
  }
  const created = await client.newSession();
  return created.sessionId;
}

/** Resolve the chat session key on the canonical session surface: reuse-or-create. */
async function canonicalSessionKey(
  session: AgentSessionClient,
  name: string | undefined,
): Promise<string> {
  if (name !== undefined) {
    const existing = await session.sessionsList();
    const found = existing.find((s) => s.key === name || s.label === name);
    if (found) return found.key;
    return (await session.sessionsCreate({ key: name })).key;
  }
  return (await session.sessionsCreate({})).key;
}

async function cmdChat(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, {
    session: { type: 'string', short: 's' },
    timeout: { type: 'string' },
    stream: { type: 'boolean', default: false },
  });
  if (parsed.help) return printHelp();
  const [ref, ...promptParts] = parsed.positionals;
  if (!ref) throw new UsageError('missing agent id');
  const promptText = promptParts.join(' ').trim();
  if (!promptText) throw new UsageError('missing prompt: hyper agents chat <id> <prompt...>');
  const sessionName = str(parsed, 'session');
  if (sessionName !== undefined && !sessionName.trim()) throw new UsageError('--session must not be empty');
  const stream = parsed.values.stream === true;
  const timeoutMs = secondsFlag(parsed, 'timeout', 120);

  const { d } = await adopt(ctx);
  const resolved = await api('get agent', async () => d.get(await resolveAgentRef(d, ref)));
  const family = chatFamily(resolved.runtime ?? '');

  let stage: ChatStage = 'start';
  let timedOut = false;
  // The SDK's prompt path takes no AbortSignal; on timeout we close the live
  // connection instead, which rejects the in-flight turn.
  let closeActive: (() => void) | undefined;
  const controller = new AbortController();
  const startedAt = Date.now();
  const remainingMs = () => Math.max(1, timeoutMs - (Date.now() - startedAt));
  const guard = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      closeActive?.();
      reject(new Error('chat timeout'));
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  });

  const atStage = async <T>(name: ChatStage, fn: () => Promise<T>): Promise<T> => {
    stage = name;
    try {
      return await fn();
    } catch (err) {
      // Pairing callbacks retag the stage while a connect awaits approval.
      throw new CliError(`chat: ${stage} stage failed: ${describeFailure(err)}`);
    }
  };

  const runAll = async (): Promise<void> => {
    let agent = resolved;
    if (agent.state.toUpperCase() !== 'RUNNING') {
      const started = await atStage('start', () => startAgentForRuntime(d, agent));
      ctx.output.info(`started agent ${shortId(agent.id)} (${started.state})`);
      // waitRunning resolves with the RUNNING hydration or throws (timeout /
      // terminal state), so the state needs no recheck here.
      agent = await atStage('wait', () => d.waitRunning(agent.id, remainingMs(), 5_000));
    }

    const runtime = agent.runtime ?? resolved.runtime ?? '';
    let reply = '';
    let streamedText = '';
    let sessionId = '';
    // --stream deltas go to stdout in table mode; under --json stdout belongs
    // to the result bag, so deltas ride stderr there instead.
    const emitDelta = (text: string) => {
      streamedText += text;
      if (!stream) return;
      if (ctx.format === 'json') process.stderr.write(text);
      else process.stdout.write(text);
    };

    if (family === 'acp') {
      const acp = await atStage('connect', () =>
        (agent as unknown as CodingAgent).acpConnect({
          signal: controller.signal,
          clientInfo: { name: 'hypercli-cli' },
          onUpdate: (notification) => {
            const update = notification.update as unknown as {
              sessionUpdate?: string;
              content?: unknown;
            };
            if (update.sessionUpdate !== 'agent_message_chunk') return;
            const text = acpContentText(update.content);
            if (!text) return;
            reply += text;
            emitDelta(text);
          },
        }));
      try {
        closeActive = () => acp.close();
        sessionId = await atStage('connect', () => acpOpenSession(acp, sessionName));
        ctx.output.info(`session opened ${sessionId}`);
        await atStage('prompt', () => acp.prompt(sessionId, promptText));
        if (!reply) throw new Error('the turn ended without an assistant reply');
      } finally {
        closeActive = undefined;
        acp.close();
      }
    } else {
      if (family === 'openclaw') {
        // Persist pairing artifacts (device identity + issued device token)
        // to ~/.hypercli/auth.json so repeat chats don't re-pair. Bridge is
        // idempotent and file-backed, never in-memory. HOME-less environments
        // (CI sandboxes) make homedir() unusable — skip persistence rather
        // than crash the chat; pairing still works for this process.
        try {
          installOpenClawAuthBridge();
        } catch (err) {
          ctx.output.info(`chat: pairing persistence disabled: ${describeFailure(err)}`);
        }
      }
      const session: AgentSessionClient = await atStage('connect', (): Promise<AgentSessionClient> =>
        family === 'hermes'
          ? (agent as unknown as HermesAgent).connect({ signal: controller.signal })
          : (agent as unknown as OpenClawAgent).connectSession({
              autoApprovePairing: true,
              timeout: remainingMs(),
              onPairing: (pairing) => {
                if (!pairing) return;
                if (pairing.status === 'pending') {
                  stage = 'pair';
                  ctx.output.info(
                    `pairing pending (request ${pairing.requestId}); auto-approving via trusted agent exec`,
                  );
                } else if (pairing.status === 'approving') {
                  stage = 'pair';
                  ctx.output.info('approving pairing request via trusted agent exec');
                } else if (pairing.status === 'approved') {
                  stage = 'connect';
                  ctx.output.info('paired device');
                } else if (pairing.status === 'failed') {
                  ctx.output.info(`pairing failed: ${pairing.error ?? 'unknown error'}`);
                }
              },
            }));
      try {
        closeActive = () => session.close();
        sessionId = await atStage('connect', () => canonicalSessionKey(session, sessionName));
        ctx.output.info(`session opened ${sessionId}`);
        let sawDone = false;
        await atStage('prompt', async () => {
          for await (const event of session.chatSend(promptText, sessionId)) {
            if (event.type === 'content') {
              const text = event.text ?? '';
              if (event.replace === true) reply = text;
              else {
                reply += text;
                emitDelta(text);
              }
            } else if (event.type === 'done') {
              sawDone = true;
            } else if (event.type === 'error') {
              throw new Error(event.text ?? 'the runtime reported an error');
            }
          }
        });
        if (!sawDone && !reply) throw new Error('the turn ended without an assistant reply');
      } finally {
        closeActive = undefined;
        session.close();
      }
    }

    const payload = { reply, session_id: sessionId, runtime, agent_id: agent.id };
    if (ctx.format === 'json') {
      ctx.output.result(payload);
      return;
    }
    if (stream && streamedText) {
      if (!streamedText.endsWith('\n')) process.stdout.write('\n');
      // The deltas already showed the reply; reprint only when replace events
      // made the final text differ from what was streamed.
      ctx.output.result(payload, reply === streamedText ? '' : reply);
      return;
    }
    ctx.output.result(payload, reply);
  };

  const work = runAll();
  // The timeout guard can win the race while work is still in flight — mark
  // that rejection handled so it never surfaces as an unhandled rejection.
  work.catch(() => {});
  try {
    await Promise.race([work, guard]);
  } catch (err) {
    if (timedOut) {
      throw new CliError(`chat: ${stage} stage failed: timed out after ${timeoutMs / 1000}s`);
    }
    if (err instanceof CliError) throw err;
    throw new CliError(`chat: ${stage} stage failed: ${describeFailure(err)}`);
  }
}

// ---------------------------------------------------------------------------
// routes (hidden)
// ---------------------------------------------------------------------------

function routesTable(state: {
  agentId: string;
  routes: Record<string, AgentRouteConfig>;
  routeStatuses: Record<string, Record<string, unknown>>;
}): string | { columns: string[]; rows: unknown[][] } {
  const entries = Object.entries(state.routes);
  if (entries.length === 0) return `No routes on ${state.agentId}.`;
  return {
    columns: ['NAME', 'PORT', 'PREFIX', 'AUTH', 'DNS'],
    rows: entries.map(([routeName, route]) => [
      routeName,
      String(route.port),
      route.prefix ?? '',
      route.auth === undefined ? '' : route.auth ? 'yes' : 'no',
      String(state.routeStatuses[routeName]?.dns_state ?? ''),
    ]),
  };
}

function routesJson(state: {
  agentId: string;
  routes: Record<string, AgentRouteConfig>;
  cors: unknown;
  routeStatuses: Record<string, Record<string, unknown>>;
}): Record<string, unknown> {
  return {
    agent_id: state.agentId,
    routes: state.routes,
    cors: state.cors,
    route_statuses: state.routeStatuses,
  };
}

async function cmdRoutes(ctx: CommandContext, args: string[]): Promise<void> {
  const [verb, ...rest] = args;

  switch (verb) {
    case 'list': {
      const parsed = parseCommandArgs(rest);
      if (parsed.help) return printHelp();
      const ref = onePositional(parsed, 'agent id');
      const { d } = await adopt(ctx);
      const id = ref.trim().toLowerCase() === 'self' ? 'self' : await resolveAgentRef(d, ref);
      const state = await api('list routes', () => d.getRoutes(id));
      ctx.output.result(routesJson(state), routesTable(state));
      return;
    }
    case 'add': {
      const parsed = parseCommandArgs(rest, {
        port: { type: 'string' },
        prefix: { type: 'string' },
        auth: { type: 'boolean', default: false },
        'no-auth': { type: 'boolean', default: false },
      });
      if (parsed.help) return printHelp();
      const [ref, routeName] = parsed.positionals;
      if (!ref || !routeName || parsed.positionals.length > 2) {
        throw new UsageError('usage: hyper agents routes add <id> <name> --port N [--prefix P] [--no-auth]');
      }
      const portRaw = str(parsed, 'port');
      if (!portRaw) throw new UsageError('--port is required');
      const port = Number(portRaw);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new UsageError(`--port must be an integer from 1 through 65535 (got '${portRaw}')`);
      }
      if (parsed.values.auth === true && parsed.values['no-auth'] === true) {
        throw new UsageError('pass only one of --auth or --no-auth');
      }
      const route: AgentRouteConfig = { port };
      const prefix = str(parsed, 'prefix');
      if (prefix !== undefined) route.prefix = prefix;
      if (parsed.values.auth === true) route.auth = true;
      if (parsed.values['no-auth'] === true) route.auth = false;

      const { d } = await adopt(ctx);
      const id = ref.trim().toLowerCase() === 'self' ? 'self' : await resolveAgentRef(d, ref);
      const state = await api('add route', () => d.setRoute(id, routeName, route));
      ctx.output.result(routesJson(state), routesTable(state));
      return;
    }
    case 'remove': {
      const parsed = parseCommandArgs(rest);
      if (parsed.help) return printHelp();
      const [ref, routeName] = parsed.positionals;
      if (!ref || !routeName || parsed.positionals.length > 2) {
        throw new UsageError('usage: hyper agents routes remove <id> <name>');
      }
      const { d } = await adopt(ctx);
      const id = ref.trim().toLowerCase() === 'self' ? 'self' : await resolveAgentRef(d, ref);
      const state = await api('remove route', () => d.removeRoute(id, routeName));
      ctx.output.result(routesJson(state), routesTable(state));
      return;
    }
    default:
      throw new UsageError(`unknown routes command '${verb ?? ''}' (expected: list, add, remove)`);
  }
}

// ---------------------------------------------------------------------------
// help + dispatch
// ---------------------------------------------------------------------------

function printHelp(): void {
  process.stdout.write(`${renderGroupHelp({ name, summary, usage, run })}\n`);
}

export async function run(ctx: CommandContext, args: string[]): Promise<number | void> {
  const [subcommand, ...rest] = args;

  if (!subcommand) {
    printHelp();
    return;
  }
  if (subcommand === '--help' || subcommand === '-h') {
    printHelp();
    return;
  }
  if (subcommand.startsWith('-')) {
    // e.g. bare `hyper agents --json` with no command
    const parsed = parseCommandArgs(args);
    if (parsed.help) {
      printHelp();
      return;
    }
    throw new UsageError('missing command. See hyper agents --help.');
  }
  if (!KNOWN_COMMANDS.has(subcommand)) {
    throw new UsageError(
      `unknown agents command '${subcommand}'. See hyper agents --help.`,
    );
  }

  switch (subcommand) {
    case 'ls':
    case 'list':
      return cmdLs(ctx, rest);
    case 'status':
      return cmdStatus(ctx, rest);
    case 'wait':
      return cmdWait(ctx, rest);
    case 'create':
      return cmdCreate(ctx, rest);
    case 'start':
      return cmdStart(ctx, rest);
    case 'set':
      return cmdSet(ctx, rest);
    case 'chat':
      return cmdChat(ctx, rest);
    case 'stop':
      return cmdStop(ctx, rest);
    case 'delete':
      return cmdDelete(ctx, rest);
    case 'archive':
      return cmdArchiveRestore(ctx, rest, 'archive');
    case 'restore':
      return cmdArchiveRestore(ctx, rest, 'restore');
    case 'exec':
      return cmdExec(ctx, rest);
    case 'shell':
      return cmdShell(ctx, rest);
    case 'logs':
      return cmdLogs(ctx, rest);
    case 'cp':
      return cmdCp(ctx, rest);
    case 'activate':
      return cmdActivate(ctx, rest);
    case 'routines':
      return cmdRoutines(ctx, rest);
    case 'token':
      return cmdToken(ctx, rest);
    case 'config':
      return cmdConfig(ctx, rest);
    case 'models':
      return cmdModels(ctx, rest);
    case 'routes':
      return cmdRoutes(ctx, rest);
    default:
      throw new UsageError(`unknown agents command '${subcommand}'. See hyper agents --help.`);
  }
}
