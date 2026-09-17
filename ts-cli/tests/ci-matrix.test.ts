/**
 * CI matrix drift guard: tests/ci-matrix.json is the single source of truth
 * for the .github/workflows/cli.yml smoke matrix. This test makes drift
 * between the manifest and the code a build failure:
 *
 *   1. Manifest groups are exactly the registry groups (src/registry.ts) plus
 *      the synthetic root-level 'core' group.
 *   2. Public parity: the subcommands spelled out in each group's `usage`
 *      lines (its help listing) are exactly the manifest's non-hidden,
 *      non-alias smokes.
 *   3. Hidden parity: top-level hidden commands (HIDDEN / HIDDEN_COMMANDS
 *      arrays in src/commands/<group>.ts) are covered by hidden smokes, and
 *      no non-public chain is left unmarked.
 *   4. Behavior: every smoke argv is dispatched through group.run() with an
 *      offline ctx and resolves with exit-equivalent 0 — a smoke that needs
 *      the network (an SDK client) fails loudly here.
 *
 * Rule of thumb: adding a subcommand means adding a usage line (public) or a
 * HIDDEN entry (hidden) plus one smoke line in ci-matrix.json — CI updates
 * itself from the manifest.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOutput } from '../src/core/output.js';
import type { CommandContext } from '../src/core/types.js';
import { GROUPS } from '../src/registry.js';

const CLI_DIR = fileURLToPath(new URL('..', import.meta.url));

interface Smoke {
  argv: string[];
  hidden?: boolean;
  alias?: boolean;
}

interface GroupSpec {
  tests: string[];
  windows: boolean;
  smokes: Smoke[];
}

interface Manifest {
  version: number;
  groups: Record<string, GroupSpec>;
}

const manifest = JSON.parse(
  readFileSync(join(CLI_DIR, 'tests', 'ci-matrix.json'), 'utf8'),
) as Manifest;

// ---------------------------------------------------------------------------
// capture: help paths print via process.stdout/stderr — swallow like the
// other test files do (see tests/agents.test.ts).
// ---------------------------------------------------------------------------

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let stdoutChunks: string[];

const stdout = () => stdoutChunks.join('');

beforeEach(() => {
  stdoutChunks = [];
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdoutChunks.push(String(chunk));
    return true;
  }) as typeof stdoutSpy;
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true) as typeof stderrSpy;
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
});

/** Offline ctx: any smoke that constructs the SDK client fails the run. */
function offlineCtx(label: string): CommandContext {
  return {
    client: () => {
      throw new Error(`${label}: --help must not construct the SDK client (offline smoke)`);
    },
    output: createOutput('table'),
    format: 'table',
    dev: false,
  };
}

// ---------------------------------------------------------------------------
// manifest structure
// ---------------------------------------------------------------------------

const TOKEN = /^[a-z][a-z0-9-]*$/;

/** argv minus a trailing --help; the plain-token command chain. */
function chainOf(smoke: Smoke): string[] {
  const argv = [...smoke.argv];
  if (argv[argv.length - 1] === '--help') argv.pop();
  return argv;
}

const chainName = (smoke: Smoke) => chainOf(smoke).join(' ');

const isBareGroupHelp = (smoke: Smoke) =>
  smoke.argv.length === 1 && smoke.argv[0] === '--help';

describe('ci-matrix.json structure', () => {
  it('covers exactly the registry groups plus core', () => {
    const expected = [...GROUPS.map((g) => g.name), 'core'].sort();
    expect(Object.keys(manifest.groups).sort()).toEqual(expected);
  });

  it('declares only existing vitest files and a windows boolean per group', () => {
    for (const [group, spec] of Object.entries(manifest.groups)) {
      expect(typeof spec.windows, `${group}.windows must be a boolean`).toBe('boolean');
      expect(Array.isArray(spec.tests), `${group}.tests must be an array`).toBe(true);
      for (const testBase of spec.tests) {
        const file = join(CLI_DIR, 'tests', `${testBase}.test.ts`);
        expect(existsSync(file), `${group}.tests references missing tests/${testBase}.test.ts`).toBe(true);
      }
    }
  });

  it('gives every non-core group exactly one bare --help and well-formed smokes', () => {
    for (const [group, spec] of Object.entries(manifest.groups)) {
      if (group === 'core') continue;
      expect(spec.smokes.length, `${group} has no smokes`).toBeGreaterThan(0);
      const bare = spec.smokes.filter(isBareGroupHelp);
      expect(bare.length, `${group}: exactly one bare ['--help'] smoke expected`).toBe(1);
      const chains = new Set<string>();
      for (const smoke of spec.smokes) {
        if (isBareGroupHelp(smoke)) continue;
        const chain = chainOf(smoke);
        expect(chain.length, `${group} smoke ${JSON.stringify(smoke.argv)}: needs <tokens...> --help`).toBeGreaterThan(0);
        expect(smoke.argv[smoke.argv.length - 1], `${group} smoke must end in --help`).toBe('--help');
        for (const token of chain) {
          expect(TOKEN.test(token), `${group}: '${token}' is not a plain subcommand token`).toBe(true);
        }
        const name = chain.join(' ');
        expect(chains.has(name), `${group}: duplicate smoke '${name}'`).toBe(false);
        chains.add(name);
      }
    }
  });

  it('keeps core root-level: flag-only argv, no hidden/alias flags', () => {
    const core = manifest.groups.core;
    for (const smoke of core.smokes) {
      for (const token of smoke.argv) {
        expect(token.startsWith('-'), `core smoke argv token '${token}' must be a flag`).toBe(true);
      }
      expect(smoke.hidden).toBeUndefined();
      expect(smoke.alias).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// public subcommand parity (usage lines <-> manifest)
// ---------------------------------------------------------------------------

/**
 * Parse a group's usage lines into public command chains:
 *   'hyper agents routines create (--cron ...)' -> 'routines create'
 *   'hyper skills ls|list [--json]'             -> 'ls' + 'list'
 * Scanning stops at the first placeholder/flag token ('<id>', '[--json]').
 */
function publicChains(groupName: string, usage: readonly string[]): Set<string> {
  const head = new RegExp(`^hyper\\s+${groupName}(?:\\s+(.+))?$`);
  const chains = new Set<string>();
  for (const line of usage) {
    const match = line.trim().match(head);
    const body = match?.[1];
    if (!body) continue;
    const chain: string[] = [];
    for (const raw of body.split(/\s+/)) {
      if (!/^[a-z][a-z0-9-]*(?:\|[a-z][a-z0-9-]*)*$/.test(raw)) break;
      if (raw.includes('|')) {
        // Alternation ('ls|list'): fork into one chain per alternative; the
        // alternation is always the terminal syntax token ('ls|list [--json]').
        for (const alt of raw.split('|')) chains.add([...chain, alt].join(' '));
        break;
      }
      chain.push(raw);
    }
    if (chain.length > 2) {
      throw new Error(`${groupName}: usage line '${line.trim()}' parses to a >2-deep chain; review the manifest rules`);
    }
    if (chain.length > 0) chains.add(chain.join(' '));
  }
  return chains;
}

/** Top-level hidden command names from the source, e.g. agents' HIDDEN array. */
function hiddenCommands(groupName: string): Set<string> {
  const src = readFileSync(join(CLI_DIR, 'src', 'commands', `${groupName}.ts`), 'utf8');
  const match = src.match(/const\s+HIDDEN(?:_COMMANDS)?\s*=\s*\[([^\]]*)\]/);
  if (!match) return new Set();
  return new Set([...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
}

describe('ci-matrix.json vs registry', () => {
  for (const group of GROUPS) {
    const spec = manifest.groups[group.name];

    it(`${group.name}: public usage chains match the manifest exactly`, () => {
      const expected = publicChains(group.name, group.usage);
      const actual = new Set(
        spec.smokes
          .filter((s) => !isBareGroupHelp(s) && s.hidden !== true && s.alias !== true)
          .map(chainName),
      );
      const missing = [...expected].filter((c) => !actual.has(c));
      const extra = [...actual].filter((c) => !expected.has(c));
      expect(missing, `add smokes for new public subcommands: ${missing.join(', ')}`).toEqual([]);
      expect(extra, `not in ${group.name} usage lines (mark hidden/alias or remove): ${extra.join(', ')}`).toEqual([]);
    });

    it(`${group.name}: hidden smokes cover the HIDDEN source list and only genuine gaps`, () => {
      const hidden = hiddenCommands(group.name);
      const publicSet = publicChains(group.name, group.usage);
      // First tokens of public chains, e.g. 'routines' for 'routines list' —
      // nested hidden verbs (routines update) live under these.
      const publicRoots = new Set([...publicSet].map((c) => c.split(' ')[0]));
      const hiddenSmokes = spec.smokes.filter((s) => s.hidden === true && !isBareGroupHelp(s));

      for (const token of hidden) {
        expect(
          hiddenSmokes.some((s) => chainOf(s)[0] === token),
          `hidden command '${token}' (${group.name}) has no hidden smoke in the manifest`,
        ).toBe(true);
      }
      for (const smoke of hiddenSmokes) {
        const chain = chainName(smoke);
        const top = chainOf(smoke)[0];
        if (hidden.has(top)) continue;
        expect(
          publicRoots.has(top) && !publicSet.has(chain),
          `'${chain}' is marked hidden but is neither under a HIDDEN command nor a nested verb of a public one`,
        ).toBe(true);
      }
      const visible = spec.smokes.filter((s) => s.hidden !== true && !isBareGroupHelp(s));
      for (const smoke of visible) {
        const top = chainOf(smoke)[0];
        expect(
          hidden.has(top),
          `smoke '${chainName(smoke)}' starts with hidden command '${top}' but is not marked hidden`,
        ).toBe(false);
      }
    });

    it(`${group.name}: alias smokes are real alternates, not public listings`, () => {
      const publicSet = publicChains(group.name, group.usage);
      const aliases = spec.smokes.filter((s) => s.alias === true);
      for (const smoke of aliases) {
        expect(smoke.hidden, `alias '${chainName(smoke)}' must not also be hidden`).toBeUndefined();
        expect(
          publicSet.has(chainName(smoke)),
          `alias '${chainName(smoke)}' is listed in usage lines — drop the alias flag`,
        ).toBe(false);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// behavioral dispatch — every smoke must resolve offline
// ---------------------------------------------------------------------------

describe('ci-matrix.json smokes dispatch offline', () => {
  for (const group of GROUPS) {
    const spec = manifest.groups[group.name];
    for (const smoke of spec.smokes) {
      const label = `${group.name} ${smoke.argv.join(' ')}`;
      it(`hyper ${label}: resolves without the SDK client`, async () => {
        const result = await group.run(offlineCtx(label), smoke.argv);
        expect(
          result === undefined || result === 0,
          `${label}: expected exit-equivalent 0, got ${String(result)}`,
        ).toBe(true);
        if (smoke.argv[smoke.argv.length - 1] === '--help') {
          expect(stdout(), `${label}: --help printed nothing`).toContain('hyper');
        }
      });
    }
  }
});
