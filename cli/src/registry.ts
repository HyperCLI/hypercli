/**
 * Command registry. To add a group: one import + one entry in GROUPS.
 *
 * Each module under src/commands/ exports { name, summary, usage, run } —
 * run(ctx, args) is the entry point (see core/types.ts for the ctx contract).
 */

import * as agents from './commands/agents.js';
import * as configure from './commands/configure.js';
import * as files from './commands/files.js';
import * as flow from './commands/flow.js';
import * as jobs from './commands/jobs.js';
import * as me from './commands/me.js';
import * as skills from './commands/skills.js';
import * as voice from './commands/voice.js';
import * as websearch from './commands/websearch.js';
import type { CommandGroup } from './core/types.js';

export const GROUPS: readonly CommandGroup[] = [
  me,
  configure,
  skills,
  agents,
  jobs,
  flow,
  files,
  voice,
  websearch,
];

export const REGISTRY: ReadonlyMap<string, CommandGroup> = new Map(
  GROUPS.map((g) => [g.name, g]),
);

export function findGroup(name: string): CommandGroup | undefined {
  return REGISTRY.get(name);
}
