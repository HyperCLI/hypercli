import { createInterface } from 'node:readline/promises';
import {
  APIError,
  isUuid,
  type AvailableGPU,
  type CreateJobOptions,
  type Job,
  type Jobs,
} from '@hypercli.com/sdk';
import { parseCommandArgs, parseUniversal } from '../core/argv.js';
import { CliError, UsageError } from '../core/errors.js';
import { closestMatch, renderGroupHelp } from '../core/help.js';
import type { CommandContext } from '../core/types.js';

export const name = 'jobs';
export const summary = 'Run and manage GPU jobs.';
export const usage = [
  'hyper jobs gpus [--json]',
  'hyper jobs create --image IMG [--runtime SEC] [--gpu T] [--region R] [--count N] [--name N] [--env K=V ...] [--dry-run] -- CMD...',
  'hyper jobs list [--state S] [--json]',
  'hyper jobs get <id> [--json]',
  'hyper jobs logs <id> [-f|--follow] [--tail N]',
  'hyper jobs cancel <id> [--yes] [--json]',
];

const HIDDEN_COMMANDS = ['extend', 'exec'];
const COMMANDS = ['gpus', 'create', 'list', 'get', 'logs', 'cancel', ...HIDDEN_COMMANDS];

function printHelp(): void {
  process.stdout.write(`${renderGroupHelp({ name, summary, usage, run })}\n`);
}

function describeError(err: unknown): string {
  if (err instanceof APIError) return `${err.statusCode}: ${err.detail}`;
  return err instanceof Error ? err.message : String(err);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function positiveInt(value: unknown, flag: string): number {
  const n = Number(value);
  if (typeof value !== 'string' || !Number.isInteger(n) || n < 1) {
    throw new UsageError(`--${flag} expects a positive integer, got '${String(value)}'`);
  }
  return n;
}

function iso(epochSeconds: number | null): string {
  if (epochSeconds === null || !Number.isFinite(epochSeconds)) return '';
  return new Date(epochSeconds * 1000).toISOString();
}

function jobName(job: Job): string {
  for (const tag of job.tags ?? []) {
    if (tag.startsWith('name=')) return tag.slice('name='.length);
  }
  return '';
}

async function resolveJobId(jobs: Pick<Jobs, 'list'>, prefix: string): Promise<string> {
  if (isUuid(prefix)) return prefix;
  const listed = await jobs.list();
  const matches = listed.map((j) => j.jobId).filter((id) => id.startsWith(prefix));
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    throw new CliError(`no job in 'hyper jobs list' has an id starting with '${prefix}' — try the full id`);
  }
  throw new CliError(
    `ambiguous id prefix '${prefix}' — ${matches.length} matches:\n  ${matches.slice(0, 8).join('\n  ')}`,
  );
}

function splitCommand(args: string[]): { flags: string[]; command: string[] | null } {
  const idx = args.indexOf('--');
  if (idx === -1) return { flags: args, command: null };
  return { flags: args.slice(0, idx), command: args.slice(idx + 1) };
}

function parseEnv(entries: unknown): Record<string, string> | undefined {
  if (!Array.isArray(entries) || entries.length === 0) return undefined;
  const env: Record<string, string> = {};
  for (const entry of entries) {
    const eq = String(entry).indexOf('=');
    if (eq <= 0) throw new UsageError(`invalid --env '${String(entry)}' (expected KEY=VALUE)`);
    env[String(entry).slice(0, eq)] = String(entry).slice(eq + 1);
  }
  return env;
}

function rowsBlock(rows: ReadonlyArray<readonly [string, string]>): string {
  const width = Math.max(0, ...rows.map(([key]) => key.length));
  return rows.map(([key, value]) => `  ${key.padEnd(width)}  ${value}`.trimEnd()).join('\n');
}

function detailBlock(job: Job): string {
  return rowsBlock([
    ['id', job.jobId],
    ['name', jobName(job)],
    ['state', job.state],
    ['image', job.dockerImage],
    ['gpu', `${job.gpuType} x${job.gpuCount}`],
    ['region', job.region],
    ['interruptible', job.interruptible ? 'yes' : 'no'],
    ['price_per_hour', job.pricePerHour ? `$${job.pricePerHour.toFixed(2)}` : ''],
    ['runtime_s', String(job.runtime)],
    ['elapsed_s', String(job.elapsed)],
    ['time_left_s', String(job.timeLeft)],
    ['hostname', job.hostname ?? ''],
    ['created_at', iso(job.createdAt)],
    ['started_at', iso(job.startedAt)],
    ['completed_at', iso(job.completedAt)],
    ['tags', (job.tags ?? []).join(', ')],
  ]);
}

async function gpus(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, {
    gpu: { type: 'string', short: 'g' },
    region: { type: 'string', short: 'r' },
  });
  if (parsed.help) return printHelp();
  if (parsed.positionals.length > 0) throw new UsageError('usage: hyper jobs gpus [--json]');

  const gpu = str(parsed.values.gpu);
  const region = str(parsed.values.region);
  const client = await ctx.client();

  let available: AvailableGPU[];
  try {
    available = await client.instances.listAvailable(gpu, region);
  } catch (err) {
    throw new CliError(`failed to list GPU catalog: ${describeError(err)}`);
  }

  let idle: Record<string, Record<string, number>> = {};
  try {
    const capacity: unknown = await client.instances.capacity(gpu);
    if (capacity && typeof capacity === 'object') {
      const raw = (capacity as Record<string, unknown>).idle;
      if (raw && typeof raw === 'object') idle = raw as Record<string, Record<string, number>>;
    }
  } catch {
    idle = {};
  }

  const rows = [...available].sort(
    (a, b) =>
      a.gpuType.localeCompare(b.gpuType) || a.gpuCount - b.gpuCount || a.region.localeCompare(b.region),
  );

  ctx.output.info(`${rows.length} GPU configuration${rows.length === 1 ? '' : 's'}`);
  ctx.output.result(available, {
    columns: ['GPU_TYPE', 'REGION', 'MEM_GB', 'PRICE/HR', 'AVAILABLE'],
    rows: rows.map((g) => {
      const price = g.priceSpot ?? g.priceOnDemand;
      return [
        g.gpuCount > 1 ? `${g.gpuType} x${g.gpuCount}` : g.gpuType,
        g.region,
        g.memoryGb,
        price === null ? '' : `$${price.toFixed(2)}`,
        idle[g.gpuType]?.[g.region] ?? '',
      ];
    }),
  });
}

async function create(ctx: CommandContext, args: string[]): Promise<void> {
  const { flags, command } = splitCommand(args);
  const parsed = parseCommandArgs(flags, {
    image: { type: 'string' },
    runtime: { type: 'string' },
    gpu: { type: 'string', short: 'g' },
    region: { type: 'string', short: 'r' },
    count: { type: 'string', short: 'n' },
    name: { type: 'string' },
    env: { type: 'string', short: 'e', multiple: true },
    'dry-run': { type: 'boolean', default: false },
  });
  if (parsed.help) return printHelp();
  if (parsed.positionals.length > 0) {
    throw new UsageError(
      `unexpected argument '${parsed.positionals[0]}' — put the command after '--'`,
    );
  }
  if (command === null) {
    throw new UsageError(
      "missing '-- CMD...'\nexample: hyper jobs create --image nvidia/cuda:12.6.3-base-ubuntu22.04 -- nvidia-smi",
    );
  }
  const image = str(parsed.values.image);
  if (!image) throw new UsageError('create requires --image IMG');

  const options: CreateJobOptions = { image };
  if (command.length > 0) options.command = command.join(' ');
  const gpu = str(parsed.values.gpu);
  if (gpu) options.gpuType = gpu;
  if (parsed.values.count !== undefined) options.gpuCount = positiveInt(parsed.values.count, 'count');
  const region = str(parsed.values.region);
  if (region) options.region = region;
  if (parsed.values.runtime !== undefined) options.runtime = positiveInt(parsed.values.runtime, 'runtime');
  const env = parseEnv(parsed.values.env);
  if (env) options.env = env;
  const jobTag = str(parsed.values.name);
  if (jobTag) options.tags = { name: jobTag };

  if (parsed.values['dry-run'] === true) {
    ctx.output.result(options, JSON.stringify(options, null, 2));
    return;
  }

  const client = await ctx.client();
  let job: Job;
  try {
    job = await client.jobs.create(options);
  } catch (err) {
    throw new CliError(`failed to create job: ${describeError(err)}`);
  }
  ctx.output.info(`created ${job.jobId} (${job.state})`);
  ctx.output.result(job, detailBlock(job));
}

async function list(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, {
    state: { type: 'string', short: 's' },
  });
  if (parsed.help) return printHelp();
  if (parsed.positionals.length > 0) throw new UsageError('usage: hyper jobs list [--state S] [--json]');

  const state = str(parsed.values.state);
  const client = await ctx.client();
  let jobs: Job[];
  try {
    jobs = await client.jobs.list(state ? { state } : {});
  } catch (err) {
    throw new CliError(`failed to list jobs: ${describeError(err)}`);
  }

  const counts = new Map<string, number>();
  for (const job of jobs) counts.set(job.state, (counts.get(job.state) ?? 0) + 1);
  const summary =
    jobs.length === 0
      ? 'no jobs found'
      : `${jobs.length} job${jobs.length === 1 ? '' : 's'}: ${[...counts.entries()]
          .map(([s, n]) => `${s}=${n}`)
          .join(' ')}`;
  ctx.output.info(summary);

  ctx.output.result(jobs, {
    columns: ['ID', 'NAME', 'IMAGE', 'GPU', 'STATE', 'CREATED'],
    rows: jobs.map((job) => [
      job.jobId,
      jobName(job),
      job.dockerImage,
      `${job.gpuType} x${job.gpuCount}`,
      job.state,
      iso(job.createdAt),
    ]),
  });
}

async function get(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args);
  if (parsed.help) return printHelp();
  const [id, ...rest] = parsed.positionals;
  if (!id || rest.length > 0) throw new UsageError('usage: hyper jobs get <id> [--json]');

  const client = await ctx.client();
  const jobId = await resolveJobId(client.jobs, id);
  let job: Job;
  try {
    job = await client.jobs.get(jobId);
  } catch (err) {
    throw new CliError(`failed to get job ${jobId}: ${describeError(err)}`);
  }
  ctx.output.result(job, detailBlock(job));
}

function lastLines(text: string, n: number): string {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  return lines.slice(-n).join('\n');
}

function trimFinalNewline(text: string): string {
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const POLL_BASE_MS = 2000;
const POLL_CAP_MS = 5000;

async function followLogs(
  ctx: CommandContext,
  jobs: Pick<Jobs, 'logs'>,
  jobId: string,
  tail: number | undefined,
): Promise<number | void> {
  let seen = await jobs.logs(jobId);
  const initial = tail !== undefined ? lastLines(seen, tail) : trimFinalNewline(seen);
  if (initial) ctx.output.result(initial, initial);
  let byteOffset = Buffer.byteLength(seen);
  let delay = POLL_BASE_MS;
  let interrupted = false;
  const onSigint = (): void => {
    interrupted = true;
  };
  process.on('SIGINT', onSigint);
  try {
    while (!interrupted) {
      await sleep(delay);
      if (interrupted) break;
      const text = await jobs.logs(jobId);
      const delta = text.length > seen.length ? (text.startsWith(seen) ? text.slice(seen.length) : text) : '';
      if (delta.length === 0) {
        seen = text;
        delay = Math.min(delay * 2, POLL_CAP_MS);
        continue;
      }
      byteOffset += Buffer.byteLength(delta);
      seen = text;
      delay = POLL_BASE_MS;
      ctx.output.result(delta, delta);
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
  if (interrupted) {
    ctx.output.info(`stopped following ${jobId} (${byteOffset} bytes printed)`);
    return 130;
  }
  return undefined;
}

async function logs(ctx: CommandContext, args: string[]): Promise<number | void> {
  const parsed = parseCommandArgs(args, {
    follow: { type: 'boolean', short: 'f', default: false },
    tail: { type: 'string', short: 'n' },
  });
  if (parsed.help) return printHelp();
  const [id, ...rest] = parsed.positionals;
  if (!id || rest.length > 0) {
    throw new UsageError('usage: hyper jobs logs <id> [-f|--follow] [--tail N]');
  }
  const tail = parsed.values.tail !== undefined ? positiveInt(parsed.values.tail, 'tail') : undefined;

  const client = await ctx.client();
  const jobId = await resolveJobId(client.jobs, id);

  if (parsed.values.follow === true) {
    return followLogs(ctx, client.jobs, jobId, tail);
  }

  let text: string;
  try {
    text = await client.jobs.logs(jobId);
  } catch (err) {
    throw new CliError(`failed to fetch logs for ${jobId}: ${describeError(err)}`);
  }
  const out = tail !== undefined ? lastLines(text, tail) : trimFinalNewline(text);
  if (!out) ctx.output.info('(no logs)');
  ctx.output.result(out, out);
  return undefined;
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

async function cancel(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, {
    yes: { type: 'boolean', short: 'y', default: false },
  });
  if (parsed.help) return printHelp();
  const [id, ...rest] = parsed.positionals;
  if (!id || rest.length > 0) throw new UsageError('usage: hyper jobs cancel <id> [--yes] [--json]');

  const skipPrompt = parsed.values.yes === true || parsed.format === 'json';
  if (!skipPrompt) {
    if (!process.stdin.isTTY) {
      throw new CliError(`refusing to cancel ${id} without confirmation: pass --yes (or --json)`);
    }
    if (!(await confirm(`Cancel job ${id}? [y/N] `))) {
      ctx.output.info(`aborted; job ${id} not canceled`);
      return;
    }
  }

  const client = await ctx.client();
  const jobId = await resolveJobId(client.jobs, id);
  try {
    await client.jobs.cancel(jobId);
  } catch (err) {
    throw new CliError(`failed to cancel job ${jobId}: ${describeError(err)}`);
  }
  ctx.output.info(`canceled ${jobId}`);
  ctx.output.result({ id: jobId, canceled: true }, `Canceled ${jobId}`);
}

async function extend(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, {
    seconds: { type: 'string' },
  });
  if (parsed.help) return printHelp();
  const [id, ...rest] = parsed.positionals;
  if (!id || rest.length > 0) throw new UsageError('usage: hyper jobs extend <id> --seconds N');
  if (parsed.values.seconds === undefined) throw new UsageError('extend requires --seconds N');
  const seconds = positiveInt(parsed.values.seconds, 'seconds');

  const client = await ctx.client();
  const jobId = await resolveJobId(client.jobs, id);
  let job: Job;
  try {
    job = await client.jobs.extend(jobId, seconds);
  } catch (err) {
    throw new CliError(`failed to extend job ${jobId}: ${describeError(err)}`);
  }
  ctx.output.info(`extended ${jobId}: runtime ${job.runtime}s`);
  ctx.output.result(job, detailBlock(job));
}

async function exec(ctx: CommandContext, args: string[]): Promise<number | void> {
  const { flags, command } = splitCommand(args);
  const parsed = parseCommandArgs(flags, {
    timeout: { type: 'string', short: 't' },
  });
  if (parsed.help) return printHelp();
  const [id, ...rest] = parsed.positionals;
  if (!id || rest.length > 0 || !command || command.length === 0) {
    throw new UsageError(
      'usage: hyper jobs exec <id> [--timeout SEC] -- CMD...\nexample: hyper jobs exec abc123 -- nvidia-smi',
    );
  }
  let timeout = 30;
  if (parsed.values.timeout !== undefined) {
    timeout = positiveInt(parsed.values.timeout, 'timeout');
    if (timeout > 300) throw new UsageError('--timeout must be between 1 and 300 seconds');
  }

  const client = await ctx.client();
  const jobId = await resolveJobId(client.jobs, id);
  let result;
  try {
    result = await client.jobs.exec(jobId, command, timeout);
  } catch (err) {
    throw new CliError(`exec on ${jobId} failed: ${describeError(err)}`);
  }
  if (result.stderr) ctx.output.info(result.stderr);
  ctx.output.result(
    { jobId: result.jobId, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode },
    result.stdout || `(exit ${result.exitCode})`,
  );
  if (result.exitCode !== 0) {
    return result.exitCode >= 1 && result.exitCode <= 255 ? result.exitCode : 1;
  }
  return undefined;
}

export async function run(ctx: CommandContext, args: string[]): Promise<number | void> {
  const pre = parseUniversal(args);
  if (pre.help || pre.positionals.length === 0) {
    printHelp();
    return;
  }
  const [sub] = pre.positionals;
  const subArgs = [...args];
  subArgs.splice(args.indexOf(sub), 1);
  switch (sub) {
    case 'gpus':
      return gpus(ctx, subArgs);
    case 'create':
      return create(ctx, subArgs);
    case 'list':
    case 'ls':
      return list(ctx, subArgs);
    case 'get':
      return get(ctx, subArgs);
    case 'logs':
      return logs(ctx, subArgs);
    case 'cancel':
      return cancel(ctx, subArgs);
    case 'extend':
      return extend(ctx, subArgs);
    case 'exec':
      return exec(ctx, subArgs);
    default: {
      const hint = closestMatch(sub, COMMANDS);
      throw new UsageError(
        `unknown jobs command '${sub}'${hint ? ` — did you mean '${hint}'?` : ''}\nusage: ${usage.join('\n       ')}`,
      );
    }
  }
}
