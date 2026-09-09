/**
 * Root and group help rendering, driven by the registry.
 */

import { formatTable } from './table.js';
import type { CommandGroup } from './types.js';

const UNIVERSAL_HELP = `\
Universal flags:
  --json            machine output: single JSON value on stdout
  --output, -o FMT  'table' (default) or 'json'
  --dev             use the dev API base
  --help, -h        show help`;

export function renderRootHelp(groups: readonly CommandGroup[]): string {
  const lines = [
    'hyper — HyperCLI command line',
    '',
    'Usage:',
    '  hyper <group> <command> [flags]',
    '  hyper <command> [flags]',
    '',
    'Commands:',
    formatTable(
      ['GROUP', 'DESCRIPTION'],
      groups.map((g) => [g.name, g.summary]),
    ),
    '',
    UNIVERSAL_HELP,
    '',
    "Run 'hyper <group> --help' for command-level help.",
  ];
  return lines.join('\n');
}

export function renderGroupHelp(group: CommandGroup): string {
  const lines = [
    `hyper ${group.name} — ${group.summary}`,
    '',
    'Usage:',
    ...group.usage.map((u) => `  ${u}`),
    '',
    UNIVERSAL_HELP,
  ];
  return lines.join('\n');
}

/**
 * Closest match for an unknown group name: shortest candidate that starts
 * with the input, else the shortest candidate containing it. Anything else
 * gets no suggestion — with only a handful of groups, fuzzy edit-distance
 * guesses are more misleading than helpful.
 */
export function closestMatch(input: string, candidates: readonly string[]): string | undefined {
  const query = input.toLowerCase();
  if (!query) return undefined;
  const byLength = (a: string, b: string) => a.length - b.length;
  const prefix = candidates.filter((c) => c.toLowerCase().startsWith(query)).sort(byLength);
  if (prefix.length > 0) return prefix[0];
  const containing = candidates.filter((c) => c.toLowerCase().includes(query)).sort(byLength);
  return containing[0];
}
