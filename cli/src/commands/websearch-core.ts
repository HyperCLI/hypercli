/**
 * Core for `hyper websearch`: Brave web search through the agents API proxy
 * (Deployments.webSearch, py-cli parity).
 *
 * The group module parses argv, makes the call, and renders output here; the
 * only caller-provided piece is which help listing --help prints, passed in
 * as onHelp.
 */

import { APIError } from '@hypercli.com/sdk';
import { parseCommandArgs, type ParsedCommand } from '../core/argv.js';
import { CliError, UsageError } from '../core/errors.js';
import type { CommandContext } from '../core/types.js';

function str(parsed: ParsedCommand, key: string): string | undefined {
  const value = parsed.values[key];
  return typeof value === 'string' ? value : undefined;
}

function describeFailure(err: unknown): string {
  if (err instanceof APIError) return `HTTP ${err.statusCode}: ${err.detail}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function runWebSearch(
  ctx: CommandContext,
  args: string[],
  onHelp: () => void,
): Promise<void> {
  const parsed = parseCommandArgs(args, { count: { type: 'string', short: 'n' } });
  if (parsed.help) {
    onHelp();
    return;
  }
  if (parsed.positionals.length === 0) throw new UsageError('missing query');
  const query = parsed.positionals.join(' ');

  const countRaw = str(parsed, 'count');
  let count = 5;
  if (countRaw !== undefined) {
    count = Number(countRaw);
    if (!Number.isInteger(count) || count < 1 || count > 20) {
      throw new UsageError(`--count must be an integer between 1 and 20 (got '${countRaw}')`);
    }
  }

  const { deployments } = await ctx.client();
  let payload;
  try {
    payload = await deployments.webSearch(query, { count });
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw new CliError(`web search failed: ${describeFailure(err)}`);
  }

  const results = Array.isArray(payload.web?.results) ? payload.web.results : [];
  const rows = results
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object')
    .map((item) => [String(item.title ?? ''), String(item.url ?? '')]);
  ctx.output.result(
    payload,
    rows.length === 0 ? 'No results.' : { columns: ['TITLE', 'URL'], rows },
  );
}
