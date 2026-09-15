/**
 * Bundled-skills runtime.
 *
 * scripts/build-skills.mjs compiles the allowlisted skills into
 * <pkg>/skills/: one <name>.json per skill (full record, markdown
 * included) and an index.json with { skills: [{ name, description,
 * commands }] } in display order.
 *
 * index.json is the single source of truth for listSkills() and name
 * resolution — the skills directory is never scanned, so the build-time
 * allowlist fully controls what `hyper skills` can see. getSkill()
 * resolves an exact name or an unambiguous case-insensitive prefix against
 * the index, then loads <name>.json for the full markdown record; failures
 * list candidate skill names on the error.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliError } from './errors.js';

export interface SkillIndexEntry {
  name: string;
  description: string;
  commands: string[];
}

export interface BundledSkill extends SkillIndexEntry {
  markdown: string;
}

/** <pkg>/skills — works from both dist/core/ and src/core/ (tsx dev). */
export function skillsDir(): string {
  return fileURLToPath(new URL('../../skills/', import.meta.url));
}

function isIndexEntry(value: unknown): value is SkillIndexEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === 'string' &&
    typeof v.description === 'string' &&
    Array.isArray(v.commands)
  );
}

function isBundledSkill(value: unknown): value is BundledSkill {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === 'string' &&
    typeof v.description === 'string' &&
    typeof v.markdown === 'string' &&
    Array.isArray(v.commands)
  );
}

/**
 * Index entries in display order. Empty when the dir or index is missing
 * or corrupt.
 */
export function listSkills(dir: string = skillsDir()): SkillIndexEntry[] {
  const indexPath = join(dir, 'index.json');
  if (!existsSync(indexPath)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(indexPath, 'utf8'));
    const skills = (parsed as { skills?: unknown } | null)?.skills;
    if (!Array.isArray(skills)) return [];
    return skills.filter(isIndexEntry);
  } catch {
    // Treat an unreadable/corrupt index as "no skills built".
    return [];
  }
}

/**
 * Resolve a name or unambiguous prefix against candidate names.
 * Returns the matched name, or throws CliError listing candidates.
 */
export function resolveSkillName(nameOrPrefix: string, names: readonly string[]): string {
  const query = nameOrPrefix.toLowerCase();
  if (!query) {
    throw new CliError(`skill name required. Available skills: ${names.join(', ') || '(none built)'}`);
  }
  const exact = names.find((n) => n.toLowerCase() === query);
  if (exact) return exact;
  const matches = names.filter((n) => n.toLowerCase().startsWith(query));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new CliError(
      `ambiguous skill prefix '${nameOrPrefix}' — matches: ${matches.join(', ')}`,
    );
  }
  throw new CliError(
    `unknown skill '${nameOrPrefix}'. Available skills: ${names.join(', ') || '(none built)'}`,
  );
}

/** Load one skill by exact name or unambiguous prefix. */
export function getSkill(nameOrPrefix: string, dir: string = skillsDir()): BundledSkill {
  const entries = listSkills(dir);
  const name = resolveSkillName(
    nameOrPrefix,
    entries.map((e) => e.name),
  );
  const skillPath = join(dir, `${name}.json`);
  if (existsSync(skillPath)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(skillPath, 'utf8'));
      if (isBundledSkill(parsed)) return parsed;
    } catch {
      // Fall through to the error below.
    }
  }
  throw new CliError(
    `skill '${name}' is listed in the skills index but its data file is missing or corrupt — rebuild with scripts/build-skills.mjs`,
  );
}
