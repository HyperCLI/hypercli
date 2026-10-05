import { APIError } from '@hypercli.com/sdk';
import { parseCommandArgs } from '../core/argv.js';
import { UsageError } from '../core/errors.js';
import { renderGroupHelp } from '../core/help.js';
import type { CommandContext } from '../core/types.js';

export const name = 'memory';
export const summary = 'Search session memory, fetch summaries and history, or rebuild a summary (once per 24h).';
export const usage = [
  'hyper memory search <query...> [-s|--session-id ID] [-a|--agent-id ID] [--cursor CURSOR] [--limit N] [--json]',
  'hyper memory summary <ID> [--json]',
  'hyper memory chunks <ID> [--cursor CURSOR] [--limit N] [--json]',
  'hyper memory tail <ID> [--n N] [--json]',
  'hyper memory rebuild <ID> [--json]',
];

function positiveInteger(value: unknown, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(number) || number < 1 || number > 100) {
    throw new UsageError(`${flag} must be an integer from 1 to 100`);
  }
  return number;
}

const FULL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ARG_SPEC = {
  'session-id': { type: 'string', short: 's' },
  'agent-id': { type: 'string', short: 'a' },
  limit: { type: 'string' },
  cursor: { type: 'string' },
  n: { type: 'string' },
} as const;

export async function run(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, ARG_SPEC);
  if (parsed.help || parsed.positionals.length === 0) {
    process.stdout.write(`${renderGroupHelp({ name, summary, usage, run })}\n`);
    return;
  }
  const [command, ...rest] = parsed.positionals;
  const allowed: Record<string, string[]> = {
    search: ['session-id', 'agent-id', 'cursor', 'limit'], summary: [], chunks: ['cursor', 'limit'], tail: ['n'], rebuild: [],
  };
  if (!Object.hasOwn(allowed, command)) throw new UsageError(`unknown memory command '${command}'`);
  for (const flag of Object.keys(ARG_SPEC)) {
    if (parsed.values[flag] !== undefined && !allowed[command].includes(flag)) {
      throw new UsageError(`--${flag} is not supported by memory ${command}`);
    }
  }
  if (command === 'search' ? !rest.join(' ').trim() : rest.length !== 1 || !rest[0].trim()) {
    throw new UsageError(command === 'search' ? 'memory search requires a query' : `memory ${command} requires one session ID`);
  }
  const limit = positiveInteger(parsed.values.limit, '--limit');
  const n = positiveInteger(parsed.values.n, '--n');
  const sessionId = parsed.values['session-id'] as string | undefined;
  if (sessionId !== undefined && !sessionId.trim()) throw new UsageError('--session-id must not be empty');
  const agentId = parsed.values['agent-id'] as string | undefined;
  if (agentId !== undefined && !FULL_UUID.test(agentId.trim())) throw new UsageError('--agent-id must be a UUID');
  const api = (await ctx.client()).memory;
  switch (command) {
    case 'search': {
      const result = await api.search(rest.join(' '), { sessionId, agentId, cursor: parsed.values.cursor as string | undefined, limit });
      ctx.output.result(result, result.items.length ? {
        columns: ['SESSION', 'CHUNK', 'SCORE', 'TEXT'],
        rows: result.items.map((row) => [row.sessionId, row.id, row.score, row.text]),
      } : 'No results.');
      if (ctx.format !== 'json' && result.hasMore && result.nextCursor !== null) {
        ctx.output.info(`Next cursor: ${result.nextCursor}`);
      }
      return;
    }
    case 'summary': {
      const result = await api.getSummary(rest[0]);
      ctx.output.result(result, result.summaryText ?? (result.pending ? 'Summary pending.' : 'No summary yet.'));
      return;
    }
    case 'rebuild': {
      try {
        const result = await api.rebuild(rest[0]);
        ctx.output.result(result, `Summary rebuild ${result.status}: ${result.sessionId}`);
      } catch (error) {
        if (error instanceof APIError && error.retryAfterSeconds !== undefined) {
          throw new APIError(error.statusCode, `${error.detail} (retry after ${error.retryAfterSeconds}s)`, error.method, error.url, error.responseText, error.retryAfterSeconds);
        }
        throw error;
      }
      return;
    }
    case 'chunks': {
      const result = await api.getChunks(rest[0], { cursor: parsed.values.cursor as string | undefined, limit });
      ctx.output.result(result, result.items.length ? {
        columns: ['ID', 'START', 'END', 'TEXT'],
        rows: result.items.map((row) => [row.id, row.seqStart, row.seqEnd, row.text]),
      } : 'No chunks.');
      if (ctx.format !== 'json' && result.hasMore && result.nextCursor !== null) {
        ctx.output.info(`Next cursor: ${result.nextCursor}`);
      }
      return;
    }
    case 'tail': {
      const result = await api.getTail(rest[0], n ?? 20);
      ctx.output.result(result, result.items.length ? {
        columns: ['START', 'END', 'ROLE', 'TEXT'],
        rows: result.items.map((row) => [row.seqStart, row.seqEnd, row.role, row.text]),
      } : 'No messages.');
    }
  }
}
