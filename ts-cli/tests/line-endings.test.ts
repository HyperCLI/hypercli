import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(cliRoot, '..');

const KNOWN_OFFENDERS = new Set<string>([]);

const walk = (dir: string, match: (p: string) => boolean, out: string[] = []): string[] => {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      walk(p, match, out);
      continue;
    }
    if (match(p)) out.push(p);
  }
  return out;
};

const listFiles = (): string[] => {
  const files: string[] = [];
  walk(join(cliRoot, 'src'), () => true, files);
  walk(join(cliRoot, 'tests'), () => true, files);
  walk(join(cliRoot, 'scripts'), (p) => p.endsWith('.mjs'), files);
  walk(join(cliRoot, 'dist'), (p) => p.endsWith('.js'), files);
  walk(join(cliRoot, 'skills'), (p) => p.endsWith('.json'), files);
  for (const f of ['package.json', 'tsconfig.json']) {
    const p = join(cliRoot, f);
    if (existsSync(p)) files.push(p);
  }
  const skillsDir = join(repoRoot, 'skills');
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir)) {
      if (!statSync(join(skillsDir, entry)).isDirectory()) continue;
      const p = join(skillsDir, entry, 'SKILL.md');
      if (existsSync(p)) files.push(p);
    }
  }
  return files;
};

const toRel = (abs: string) => relative(repoRoot, abs).split(sep).join('/');
const hasCr = (abs: string) => readFileSync(abs).includes(13);

describe('line endings (LF-only house rule)', () => {
  it('cli source trees, skills sources, generated bundle, and dist contain zero CR bytes', () => {
    const files = listFiles();
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter(hasCr).map(toRel).filter((rel) => !KNOWN_OFFENDERS.has(rel));
    expect(offenders).toEqual([]);
  });

  it('known offenders are still offending (remove the exemption once converted)', () => {
    const stale = [...KNOWN_OFFENDERS].filter((rel) => {
      const abs = join(repoRoot, ...rel.split('/'));
      return !existsSync(abs) || !hasCr(abs);
    });
    expect(stale).toEqual([]);
  });
});
