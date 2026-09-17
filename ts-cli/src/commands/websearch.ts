/**
 * `hyper websearch` — top-level Brave web search through the agents API proxy.
 *
 *   hyper websearch <query...> [-n|--count N] [--json]
 *
 * The only web search surface; the implementation lives in
 * src/commands/websearch-core.ts.
 */

import { renderGroupHelp } from '../core/help.js';
import type { CommandContext } from '../core/types.js';
import { runWebSearch } from './websearch-core.js';

export const name = 'websearch';
export const summary = 'Web search through the agents API proxy.';
export const usage = ['hyper websearch <query...> [-n|--count N] [--json]'];

function printHelp(): void {
  process.stdout.write(`${renderGroupHelp({ name, summary, usage, run })}\n`);
}

export async function run(ctx: CommandContext, args: string[]): Promise<void> {
  return runWebSearch(ctx, args, printHelp);
}
