/**
 * `hyper agents login` — first-class login flows for hosted agent pods,
 * driven entirely through the existing exec/cp machinery; no TTY needed.
 *
 * Flow registry (LOGIN_FLOWS) is keyed by runtime so new runtimes (opencode,
 * openclaw, ...) slot in by adding an entry — each flow is an async fn over
 * the shared exec/poll primitives.
 *
 * Choreographies (verified live in pods):
 *   codex device-auth — detached `codex login --device-auth` writes a URL +
 *     one-time code to /tmp/devauth.log; user completes it in a browser; the
 *     log then reports success. Codes expire in 15 min.
 *   claude-code paste-back — `claude auth login` reads stdin from a fifo held
 *     open by a detached sleep; the OAuth URL lands in /tmp/clin.log; the
 *     user pastes back the `code#state` string, which is piped into the fifo.
 *     OAuth codes are single-use and bound to that login process's state, so
 *     the URL is always re-extracted fresh from the log.
 *   claude-code host-creds — copies local ~/.claude/.credentials.json into the
 *     pod. Only ever via the explicit --from-host-creds flag.
 *
 * Detached-process discipline: exec calls are kept short; pod-side setsid
 * processes survive client-side exec timeouts ('operation timed out'), so
 * every launch tolerates the timeout and the poll loop discovers state.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import {
  APIError,
  type AgentExecResult,
  type Deployments,
} from '@hypercli.com/sdk';
import { parseCommandArgs, type ParsedCommand } from '../core/argv.js';
import { CliError, UsageError } from '../core/errors.js';
import type { CommandContext } from '../core/types.js';
import { resolveAgentRef } from './agents.js';

const CODEX_LOG = '/tmp/devauth.log';
const CLAUDE_LOG = '/tmp/clin.log';
const CLAUDE_FIFO = '/tmp/clinf';

/** Short exec timeouts: ws round trips only; detached pod processes survive. */
const EXEC_TIMEOUT_SEC = 25;

// ---------------------------------------------------------------------------
// log text helpers (unit-tested against realistic sample lines)
// ---------------------------------------------------------------------------

/** CSI/OSC/charset ANSI escapes and lone ESC sequences. */
const ANSI_SEQUENCE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[()][0-2A-B]|\x1b[@-Z\\-_]/g;

/** Strip ANSI escapes from pod log output before any regex extraction. */
export function stripAnsi(input: string): string {
  return input.replace(ANSI_SEQUENCE, '');
}

const CODEX_URL_RE = /https:\/\/auth\.openai\.com\/codex\/device[^\s"')\]]*/;
const CODEX_CODE_RE = /\b([A-Z0-9]{4,6}-[A-Z0-9]{4,6})\b/;
const CLAUDE_URL_RE = /https:\/\/claude\.com\/cai\/oauth\/authorize[^\s"'|\\)\]]*/i;

/** Pull the device-auth URL + one-time code out of codex's log. */
export function extractCodexDeviceAuth(log: string): { url?: string; code?: string } {
  const clean = stripAnsi(log);
  return {
    url: CODEX_URL_RE.exec(clean)?.[0],
    code: CODEX_CODE_RE.exec(clean)?.[1],
  };
}

export function codexDeviceAuthOutcome(log: string): 'success' | 'failed' | undefined {
  const clean = stripAnsi(log);
  if (/successfully logged in/i.test(clean)) return 'success';
  if (/\b(failed|expired|denied)\b/i.test(clean)) return 'failed';
  return undefined;
}

/** Pull the OAuth authorize URL out of `claude auth login` output. */
export function extractClaudeOAuthUrl(log: string): string | undefined {
  return CLAUDE_URL_RE.exec(stripAnsi(log))?.[0];
}

export function claudePasteOutcome(log: string): 'success' | 'failed' | undefined {
  const clean = stripAnsi(log);
  if (/login successful/i.test(clean)) return 'success';
  if (/login (failed|error)|authentication failed/i.test(clean)) return 'failed';
  return undefined;
}

/** `claude auth status` prints JSON; tolerate it embedded in noisier output. */
export function claudeStatusLoggedIn(text: string): boolean {
  const clean = stripAnsi(text).trim();
  try {
    const parsed = JSON.parse(clean) as Record<string, unknown>;
    if (parsed.loggedIn === true) return true;
  } catch {
    // Not single-document JSON; fall through to the regex.
  }
  return /"loggedIn"\s*:\s*true/.test(clean);
}

/** POSIX single-quote an argv fragment (the pasted code rides through sh). */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// ---------------------------------------------------------------------------
// polling util — exec `cat <logfile>`, jittered 3-5s interval, deadline
// ---------------------------------------------------------------------------

export interface PollLogOptions<T> {
  /** Return the current log text, or null when not yet readable. */
  read: () => Promise<string | null>;
  /** Extract the awaited value from (ANSI-stripped) text; undefined = keep polling. */
  extract: (text: string) => T | undefined;
  /** Terminal-abort check on the text; returning a message throws CliError. */
  fail?: (text: string) => string | undefined;
  deadlineAtMs: number;
  waitingFor: string;
  minIntervalMs?: number;
  maxIntervalMs?: number;
  /** Test seams: deterministic time/sleep/jitter. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

const MAX_CONSECUTIVE_READ_ERRORS = 5;

function describeError(err: unknown): string {
  if (err instanceof APIError) return `HTTP ${err.statusCode}: ${err.detail}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function pollLog<T>(opts: PollLogOptions<T>): Promise<T> {
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = opts.random ?? Math.random;
  const minMs = opts.minIntervalMs ?? 3_000;
  const maxMs = Math.max(minMs, opts.maxIntervalMs ?? 5_000);
  let consecutiveErrors = 0;

  for (;;) {
    if (now() >= opts.deadlineAtMs) {
      throw new CliError(`login: timed out waiting for ${opts.waitingFor}`);
    }
    let text: string | null = null;
    try {
      text = await opts.read();
      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors += 1;
      if (consecutiveErrors >= MAX_CONSECUTIVE_READ_ERRORS) {
        throw new CliError(`login: log poll failed repeatedly: ${describeError(err)}`);
      }
    }
    if (text !== null) {
      const abort = opts.fail?.(text);
      if (abort !== undefined) {
        throw new CliError(`login: aborted waiting for ${opts.waitingFor}: ${abort}`);
      }
      const hit = opts.extract(text);
      if (hit !== undefined) return hit;
    }
    const remaining = opts.deadlineAtMs - now();
    if (remaining <= 0) {
      throw new CliError(`login: timed out waiting for ${opts.waitingFor}`);
    }
    await sleep(Math.min(minMs + random() * (maxMs - minMs), remaining));
  }
}

// ---------------------------------------------------------------------------
// flow plumbing
// ---------------------------------------------------------------------------

interface LoginIO {
  /** Machine mode: JSON lines on stdout, code read from stdin. */
  readonly machine: boolean;
  info(message: string): void;
  announce(url: string, code?: string): void;
  readInput(prompt: string): Promise<string>;
  finish(outcome: LoginOutcome, provider?: string): void;
}

export interface LoginOutcome {
  loggedIn: boolean;
  flow: string;
  runtime: string;
  agentId: string;
  detail?: string;
}

export interface LoginFlowContext {
  d: Deployments;
  agentId: string;
  deadlineAtMs: number;
  io: LoginIO;
  provider?: string;
}

export interface LoginFlow {
  readonly name: string;
  readonly runtime: string;
  /** Does an external wallet/user step have to feed input back into the CLI? */
  readonly requiresWalletUserInput: { readonly type: 'code-paste' | 'none' };
  readonly summary: string;
  run(fx: LoginFlowContext): Promise<LoginOutcome>;
}

async function execPod(d: Deployments, id: string, argv: string[]): Promise<AgentExecResult> {
  return d.exec(id, argv, { timeout: EXEC_TIMEOUT_SEC });
}

function isExecTimeout(err: unknown): boolean {
  return err instanceof Error && /timed?\s*out/i.test(err.message);
}

/** exec that must succeed: throws CliError on transport failure or nonzero exit. */
async function execChecked(fx: LoginFlowContext, argv: string[], what: string): Promise<AgentExecResult> {
  let res: AgentExecResult;
  try {
    res = await execPod(fx.d, fx.agentId, argv);
  } catch (err) {
    throw new CliError(`login: could not ${what}: ${describeError(err)}`);
  }
  if (res.exitCode !== 0) {
    const stderr = stripAnsi(res.stderr).trim().slice(0, 200);
    throw new CliError(`login: could not ${what}: exit ${res.exitCode}${stderr ? `: ${stderr}` : ''}`);
  }
  return res;
}

/**
 * Fire-and-forget launch of a detached pod command. A client-side exec
 * timeout is NOT a failure: the setsid process keeps running and the poll
 * loop picks up its log output.
 */
async function launchDetached(fx: LoginFlowContext, argv: string[], what: string): Promise<void> {
  try {
    const res = await execPod(fx.d, fx.agentId, argv);
    if (res.exitCode !== 0) {
      fx.io.info(`login: ${what} launcher exited ${res.exitCode}; polling for evidence anyway`);
    }
  } catch (err) {
    if (isExecTimeout(err)) {
      fx.io.info(`login: ${what} launch exec timed out client-side; the detached process survives — polling`);
      return;
    }
    throw new CliError(`login: could not launch ${what}: ${describeError(err)}`);
  }
}

/** `cat <path>` reader for pollLog: missing/short-timeout reads -> null (keep polling). */
function logReader(d: Deployments, id: string, path: string): () => Promise<string | null> {
  return async () => {
    try {
      const res = await execPod(d, id, ['cat', path]);
      return res.exitCode === 0 ? stripAnsi(res.stdout) : null;
    } catch (err) {
      if (isExecTimeout(err)) return null;
      throw err;
    }
  };
}

const LAUNCH_FAILURE_RE = /command not found|no such file or directory|permission denied/i;

function launchFailureFromLog(text: string): string | undefined {
  return LAUNCH_FAILURE_RE.test(text)
    ? 'the login process failed to start (is the runtime CLI installed in the pod?)'
    : undefined;
}

// ---------------------------------------------------------------------------
// flow: codex device-auth
// ---------------------------------------------------------------------------

async function runCodexDeviceAuth(fx: LoginFlowContext): Promise<LoginOutcome> {
  await launchDetached(
    fx,
    ['sh', '-c', `rm -f ${CODEX_LOG}; setsid nohup codex login --device-auth > ${CODEX_LOG} 2>&1 & echo $!`],
    'codex login --device-auth',
  );
  fx.io.info('waiting for the codex device-auth code...');
  const pair = await pollLog({
    read: logReader(fx.d, fx.agentId, CODEX_LOG),
    extract: (text) => {
      const { url, code } = extractCodexDeviceAuth(text);
      return url && code ? { url, code } : undefined;
    },
    fail: launchFailureFromLog,
    deadlineAtMs: fx.deadlineAtMs,
    waitingFor: 'the codex device-auth URL and code',
  });
  fx.io.announce(pair.url, pair.code);
  fx.io.info('waiting for the login to complete (codes expire after 15 minutes)...');

  const outcome = await pollLog({
    read: logReader(fx.d, fx.agentId, CODEX_LOG),
    extract: codexDeviceAuthOutcome,
    deadlineAtMs: fx.deadlineAtMs,
    waitingFor: 'codex to confirm the login',
  });
  if (outcome !== 'success') {
    throw new CliError('login: codex device-auth failed or the code expired; run again for a fresh code');
  }

  fx.io.info('verifying with codex login status...');
  const status = await execChecked(fx, ['codex', 'login', 'status'], 'verify the codex login');
  if (!/logged in/i.test(stripAnsi(status.stdout))) {
    throw new CliError(`login: 'codex login status' does not report a login: ${stripAnsi(status.stdout).trim().slice(0, 200)}`);
  }
  return {
    loggedIn: true,
    flow: 'device-auth',
    runtime: 'codex',
    agentId: fx.agentId,
    detail: stripAnsi(status.stdout).trim().slice(0, 200),
  };
}

// ---------------------------------------------------------------------------
// flow: claude-code paste-back
// ---------------------------------------------------------------------------

async function runClaudePasteBack(fx: LoginFlowContext): Promise<LoginOutcome> {
  const { d, agentId, io } = fx;
  await launchDetached(
    fx,
    ['sh', '-c', `mkfifo ${CLAUDE_FIFO}; (setsid nohup claude auth login < ${CLAUDE_FIFO} > ${CLAUDE_LOG} 2>&1 &); (setsid nohup sleep 600 > ${CLAUDE_FIFO} &)`],
    'claude auth login',
  );
  try {
    io.info('waiting for the Claude OAuth URL...');
    const url = await pollLog({
      read: logReader(d, agentId, CLAUDE_LOG),
      extract: extractClaudeOAuthUrl,
      fail: launchFailureFromLog,
      deadlineAtMs: fx.deadlineAtMs,
      waitingFor: 'the Claude OAuth URL',
    });
    io.announce(url);

    const code = await io.readInput('Paste the code#state string from the callback page: ');
    await execChecked(fx, ['sh', '-c', `printf '%s\\n' ${shQuote(code)} > ${CLAUDE_FIFO}`], 'pass the code to claude');
    io.info('code delivered; waiting for the login to complete...');

    const outcome = await pollLog({
      read: logReader(d, agentId, CLAUDE_LOG),
      extract: claudePasteOutcome,
      deadlineAtMs: fx.deadlineAtMs,
      waitingFor: 'claude to confirm the login',
    });
    if (outcome !== 'success') {
      throw new CliError('login: claude reported the login failed (OAuth codes are single-use — run again for a fresh URL)');
    }

    io.info('verifying with claude auth status...');
    const status = await execChecked(fx, ['claude', 'auth', 'status'], 'verify the claude login');
    if (!claudeStatusLoggedIn(status.stdout)) {
      throw new CliError(`login: 'claude auth status' does not report loggedIn:true: ${stripAnsi(status.stdout).trim().slice(0, 200)}`);
    }
    return {
      loggedIn: true,
      flow: 'paste-back',
      runtime: 'claude-code',
      agentId,
      detail: 'claude auth status: loggedIn:true',
    };
  } finally {
    try {
      await execPod(d, agentId, [
        'sh', '-c',
        `pkill -f "claude auth login" >/dev/null 2>&1; pkill -f "^sleep 600\$" >/dev/null 2>&1; rm -f ${CLAUDE_FIFO} ${CLAUDE_LOG}`,
      ]);
    } catch (err) {
      io.info(`login: cleanup warning: ${describeError(err)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// flow: claude-code host-creds seed
// ---------------------------------------------------------------------------

const POD_CLAUDE_CREDS = '/home/node/.claude/.credentials.json';

async function runClaudeHostCreds(fx: LoginFlowContext): Promise<LoginOutcome> {
  const local = join(homedir(), '.claude', '.credentials.json');
  if (!existsSync(local)) {
    throw new CliError(`login: no local Claude credentials at ${local}; run 'claude auth login' locally first (or use --flow paste-back)`);
  }
  fx.io.info(`seeding ${local} into the pod`);
  try {
    // cp dst is sync-root-relative; an absolute-path fix is landing separately,
    // so land the file at the sync root and move it into place.
    await fx.d.cpTo(fx.agentId, local, '.credentials.json');
  } catch (err) {
    throw new CliError(`login: could not copy credentials into the pod: ${describeError(err)}`);
  }
  await execChecked(fx, [
    'sh', '-c',
    `mkdir -p /home/node/.claude && mv /home/node/.credentials.json ${POD_CLAUDE_CREDS} && chmod 600 ${POD_CLAUDE_CREDS}`,
  ], 'install the credentials file');

  fx.io.info('verifying with claude auth status...');
  const status = await execChecked(fx, ['claude', 'auth', 'status'], 'verify the claude login');
  if (!claudeStatusLoggedIn(status.stdout)) {
    throw new CliError(`login: credentials seeded but 'claude auth status' does not report loggedIn:true`);
  }
  return {
    loggedIn: true,
    flow: 'host-creds',
    runtime: 'claude-code',
    agentId: fx.agentId,
    detail: 'claude auth status: loggedIn:true',
  };
}

// ---------------------------------------------------------------------------
// flow: env advisories (no exec)
// ---------------------------------------------------------------------------

const CLAUDE_ENV_ADVISORY = 'claude-code pods read CLAUDE_CODE_OAUTH_TOKEN (or ANTHROPIC_AUTH_TOKEN) from the pod environment at launch; set it at create time: hyper agents create <name> --runtime claude-code --env CLAUDE_CODE_OAUTH_TOKEN=<token>';
const CODEX_ENV_ADVISORY = 'codex pods read OPENAI_API_KEY from the pod environment at launch; set it at create time: hyper agents create <name> --runtime codex --env OPENAI_API_KEY=<key> (or use --flow device-auth)';

function envAdvisoryFlow(runtime: string, advisory: string): LoginFlow {
  return {
    name: 'env',
    runtime,
    requiresWalletUserInput: { type: 'none' },
    summary: 'print the at-launch env-injection advisory (no exec)',
    run: async (fx) => {
      fx.io.info(advisory);
      return { loggedIn: false, flow: 'env', runtime, agentId: fx.agentId, detail: advisory };
    },
  };
}

// ---------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------

export const LOGIN_FLOWS: ReadonlyMap<string, readonly LoginFlow[]> = new Map<string, readonly LoginFlow[]>([
  ['codex', [
    {
      name: 'device-auth',
      runtime: 'codex',
      requiresWalletUserInput: { type: 'none' },
      summary: 'codex login --device-auth in the pod; user completes the URL+code in a browser',
      run: runCodexDeviceAuth,
    },
    envAdvisoryFlow('codex', CODEX_ENV_ADVISORY),
  ]],
  ['claude-code', [
    {
      name: 'paste-back',
      runtime: 'claude-code',
      requiresWalletUserInput: { type: 'code-paste' },
      summary: 'claude auth login over a fifo; user pastes back the code#state from the callback page',
      run: runClaudePasteBack,
    },
    {
      name: 'host-creds',
      runtime: 'claude-code',
      requiresWalletUserInput: { type: 'none' },
      summary: 'seed local ~/.claude/.credentials.json into the pod (requires --from-host-creds)',
      run: runClaudeHostCreds,
    },
    envAdvisoryFlow('claude-code', CLAUDE_ENV_ADVISORY),
  ]],
]);

const DEFAULT_FLOW: ReadonlyMap<string, string> = new Map([
  ['codex', 'device-auth'],
  ['claude-code', 'paste-back'],
]);

/** Native-path hints for runtimes with no flow (point users at the real path). */
const NATIVE_LOGIN_HINTS: Readonly<Record<string, string>> = {
  opencode: 'opencode authenticates in-pod: hyper agents exec <id> -- opencode auth login -p openai -m "ChatGPT Pro/Plus (headless)"',
  goose: 'goose reads provider credentials from the pod environment at launch: hyper agents create <name> --runtime goose --env ...',
  'kimi-code': 'kimi-code reads provider credentials from the pod environment at launch: hyper agents create <name> --runtime kimi-code --env ...',
  'buzz-agent': 'buzz-agent is configured at launch via env; there is no interactive pod login',
  openclaw: 'openclaw uses the gateway-token pairing ceremony, managed automatically by hyper agents start',
  'openclaw-pro': 'openclaw uses the gateway-token pairing ceremony, managed automatically by hyper agents start',
  hermes: 'hermes authenticates with its server key; there is no pod login flow',
  'hermes-agent': 'hermes authenticates with its server key; there is no pod login flow',
};

// ---------------------------------------------------------------------------
// command
// ---------------------------------------------------------------------------

const LOGIN_USAGE = [
  'hyper agents login <id> [--flow F] [--provider X] [--session SECS] [--key-stdin] [--from-host-creds] [--json]',
  '',
  'flows by runtime:',
  '  codex        device-auth (default), env',
  '  claude-code  paste-back (default), host-creds (requires --from-host-creds), env',
  '',
  '--session SECS  overall deadline for the interactive window (default 900)',
  '--json          machine output: {"url":..., "code"?} then a final {"loggedIn": true, ...};',
  '                paste-back reads the code#state back as one line on stdin',
].join('\n');

function positiveSeconds(parsed: ParsedCommand, key: string, fallback: number): number {
  const raw = parsed.values[key];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new UsageError(`--${key} must be a positive number of seconds (got '${String(raw)}')`);
  }
  return Math.round(value);
}

function makeIO(
  ctx: CommandContext,
  hooks: { readInput?: (prompt: string) => Promise<string> },
): LoginIO {
  const machine = ctx.format === 'json' || process.stdout.isTTY !== true;
  return {
    machine,
    info: (message) => ctx.output.info(message),
    announce(url, code) {
      if (machine) {
        process.stdout.write(`${JSON.stringify({ url, ...(code ? { code } : {}) })}\n`);
        return;
      }
      ctx.output.result(
        { url, ...(code ? { code } : {}) },
        [`Open this URL to authenticate:`, `  ${url}`, ...(code ? ['', `Enter code: ${code}`] : [])].join('\n'),
      );
    },
    async readInput(prompt) {
      if (hooks.readInput) {
        const injected = (await hooks.readInput(prompt)).trim();
        if (!injected) throw new CliError('login: empty code received');
        return injected;
      }
      if (machine) this.info('reading the code#state as one line on stdin...');
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      try {
        const answer = (await rl.question(machine ? '' : prompt)).trim();
        if (!answer) throw new CliError('login: no code received on stdin');
        return answer;
      } finally {
        rl.close();
      }
    },
    finish(outcome, provider) {
      ctx.output.result(
        {
          loggedIn: outcome.loggedIn,
          flow: outcome.flow,
          runtime: outcome.runtime,
          agent_id: outcome.agentId,
          ...(provider !== undefined ? { provider } : {}),
          ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
        },
        outcome.loggedIn
          ? `logged in (runtime ${outcome.runtime}, flow ${outcome.flow})${outcome.detail ? `\n${outcome.detail}` : ''}`
          : outcome.detail ?? 'login flow finished without a login',
      );
    },
  };
}

/** Exported for `hyper agents login` wiring in agents.ts. */
export async function cmdAgentsLogin(
  ctx: CommandContext,
  args: string[],
  hooks: { readInput?: (prompt: string) => Promise<string>; now?: () => number } = {},
): Promise<void> {
  const parsed = parseCommandArgs(args, {
    flow: { type: 'string' },
    provider: { type: 'string' },
    session: { type: 'string' },
    'key-stdin': { type: 'boolean', default: false },
    'from-host-creds': { type: 'boolean', default: false },
  });
  if (parsed.help) {
    process.stdout.write(`${LOGIN_USAGE}\n`);
    return;
  }
  if (parsed.positionals.length !== 1) {
    throw new UsageError('usage: hyper agents login <id> [--flow F] [--provider X] [--session SECS] [--key-stdin] [--from-host-creds] [--json]');
  }
  const ref = parsed.positionals[0];
  let flowName = typeof parsed.values.flow === 'string' ? parsed.values.flow : undefined;
  const provider = typeof parsed.values.provider === 'string' ? parsed.values.provider : undefined;
  const keyStdin = parsed.values['key-stdin'] === true;
  const fromHostCreds = parsed.values['from-host-creds'] === true;
  const sessionSec = positiveSeconds(parsed, 'session', 900);

  const io = makeIO(ctx, hooks);
  const client = await ctx.client();
  const d = client.deployments;
  const id = await resolveAgentRef(d, ref);
  let agent;
  try {
    agent = await d.get(id);
  } catch (err) {
    throw new CliError(`login: get agent failed: ${describeError(err)}`);
  }
  const runtime = (agent.runtime ?? '').toLowerCase();
  if (!runtime) throw new CliError('login: the agent record carries no runtime');

  if (fromHostCreds) {
    if (runtime !== 'claude-code') {
      throw new UsageError('--from-host-creds is only valid for claude-code agents');
    }
    if (flowName !== undefined && flowName !== 'host-creds') {
      throw new UsageError('--from-host-creds only pairs with --flow host-creds');
    }
    flowName = 'host-creds';
  }
  if (flowName === 'host-creds' && !fromHostCreds) {
    throw new UsageError('the host-creds flow copies your local Claude credentials into the pod; pass --from-host-creds to allow this explicitly');
  }

  // --key-stdin never runs exec stdin today (exec-stdin support lands
  // separately): refuse clearly, except on claude-code where the answer is
  // the at-launch env advisory.
  if (keyStdin) {
    if (runtime === 'claude-code') {
      const flow = envAdvisoryFlow('claude-code', CLAUDE_ENV_ADVISORY);
      io.finish(await flow.run({ d, agentId: id, deadlineAtMs: 0, io, provider }), provider);
      return;
    }
    throw new CliError(
      'login: --key-stdin is not yet supported: agents exec has no stdin channel yet '
      + '(pod-side exec-stdin support is landing separately). '
      + `Use ${runtime === 'codex' ? '--flow device-auth' : 'the available login flows'} or \`hyper agents login ${ref} --help\`.`,
    );
  }

  const flows = LOGIN_FLOWS.get(runtime);
  if (!flows || flows.length === 0) {
    const hint = NATIVE_LOGIN_HINTS[runtime];
    throw new CliError(`login: runtime '${runtime}' has no login flow.${hint ? `\n${hint}` : ''}`);
  }

  const chosenName = flowName ?? DEFAULT_FLOW.get(runtime) ?? flows[0].name;
  const flow = flows.find((entry) => entry.name === chosenName);
  if (!flow) {
    throw new UsageError(
      `unknown --flow '${chosenName}' for runtime '${runtime}' (available: ${flows.map((entry) => entry.name).join(', ')})`,
    );
  }
  if (flowName === undefined && runtime === 'claude-code') {
    io.info('hint: to seed your local Claude credentials instead, run with --flow host-creds --from-host-creds');
  }

  const now = hooks.now ?? (() => Date.now());
  const fx: LoginFlowContext = {
    d,
    agentId: id,
    deadlineAtMs: now() + sessionSec * 1000,
    io,
    ...(provider !== undefined ? { provider } : {}),
  };
  io.finish(await flow.run(fx), provider);
}
