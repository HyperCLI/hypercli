#!/usr/bin/env node
/**
 * hyper — HyperCLI command line. Entrypoint and dispatcher.
 *
 *   hyper <group> <command> [flags]   e.g. hyper agents ls
 *   hyper <command> [flags]           e.g. hyper me, hyper skills
 *
 * Dispatch: the first positional token names a registered group; everything
 * after it is handed to that group's run(ctx, args) verbatim.
 */

import { APP_VERSION } from './version.js';
import { lazyClient } from './core/client.js';
import { parseUniversal } from './core/argv.js';
import { applyCliConfigFile } from './core/config-file.js';
import { exitCodeFor, printError } from './core/errors.js';
import { closestMatch, renderRootHelp } from './core/help.js';
import { createOutput } from './core/output.js';
import type { CommandContext } from './core/types.js';
import { findGroup, GROUPS, REGISTRY } from './registry.js';

function buildContext(format: 'table' | 'json'): CommandContext {
  return {
    client: lazyClient(),
    output: createOutput(format),
    format,
  };
}

async function main(): Promise<number> {
  process.on('SIGINT', () => {
    process.stderr.write('\n');
    process.exit(130);
  });

  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (nodeMajor < 22) {
    process.stderr.write(`error: hyper requires Node.js >= 22 (found ${process.versions.node})\n`);
    return 2;
  }

  applyCliConfigFile();

  const argv = process.argv.slice(2);
  const top = parseUniversal(argv);

  if (argv[0] === '--version' || argv[0] === '-v') {
    process.stdout.write(`hyper ${APP_VERSION}\n`);
    return 0;
  }

  const [groupName] = top.positionals;

  if (!groupName || (top.help && groupName === undefined)) {
    process.stdout.write(`${renderRootHelp(GROUPS)}\n`);
    return 0;
  }

  const group = findGroup(groupName);
  if (!group) {
    const hint = closestMatch(groupName, [...REGISTRY.keys()]);
    process.stderr.write(`error: unknown command '${groupName}'${hint ? ` — did you mean '${hint}'?` : ''}\n`);
    process.stderr.write("Run 'hyper --help' for available commands.\n");
    return 2;
  }

  // Everything typed after the group name belongs to the group. Splice at the
  // first positional token index, not indexOf(groupName) — a global flag value
  // could duplicate the word.
  const groupArgs = [...argv];
  groupArgs.splice(top.firstPositionalIndex, 1);

  const ctx = buildContext(top.format);
  const code = await group.run(ctx, groupArgs);
  return typeof code === 'number' ? code : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    printError(err);
    process.exitCode = exitCodeFor(err);
  },
);
