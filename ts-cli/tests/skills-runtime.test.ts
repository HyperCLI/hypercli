import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { getSkill, listSkills, resolveSkillName } from '../src/core/skills-runtime.js';
import { CliError } from '../src/core/errors.js';

/** Writes an index.json plus one <name>.json per skill, like the build does. */
function makeSkillDir(...names: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'hyper-skills-'));
  const index = names.map((name) => ({
    name,
    description: `desc ${name}`,
    commands: [`hyper ${name} ls`],
  }));
  writeFileSync(join(dir, 'index.json'), JSON.stringify({ skills: index }));
  for (const name of names) {
    writeFileSync(
      join(dir, `${name}.json`),
      JSON.stringify({
        name,
        description: `desc ${name}`,
        markdown: `# ${name}`,
        commands: [`hyper ${name} ls`],
      }),
    );
  }
  return dir;
}

const dirs: string[] = [];
function tracked(...names: string[]): string {
  const dir = makeSkillDir(...names);
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('listSkills', () => {
  it('reads index.json in display order and ignores unindexed files', () => {
    const dir = tracked('beta', 'alpha');
    writeFileSync(
      join(dir, 'zzz.json'),
      JSON.stringify({ name: 'zzz', description: 'stray', markdown: '# zzz', commands: [] }),
    );
    expect(listSkills(dir).map((s) => s.name)).toEqual(['beta', 'alpha']);
    expect(listSkills(dir)[0].commands).toEqual(['hyper beta ls']);
  });

  it('returns empty for a missing directory', () => {
    expect(listSkills(join(tmpdir(), 'definitely-not-here-xyz'))).toEqual([]);
  });

  it('returns empty for a corrupt or shapeless index', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hyper-skills-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'index.json'), '{"notSkills":true}');
    expect(listSkills(dir)).toEqual([]);
  });
});

describe('resolveSkillName', () => {
  const names = ['hypercli', 'hypercli-agents', 'hypercli-voice'];

  it('resolves exact names', () => {
    expect(resolveSkillName('hypercli-voice', names)).toBe('hypercli-voice');
  });

  it('resolves unambiguous prefixes', () => {
    expect(resolveSkillName('hypercli-vo', names)).toBe('hypercli-voice');
  });

  it('prefers an exact match even when it prefixes other names', () => {
    expect(resolveSkillName('hypercli', names)).toBe('hypercli');
  });

  it('rejects ambiguous prefixes listing matches', () => {
    expect(() => resolveSkillName('hypercli-', names)).toThrow(CliError);
    expect(() => resolveSkillName('hypercli-', names)).toThrow(/ambiguous.*hypercli-agents.*hypercli-voice/);
  });

  it('rejects unknown names listing candidates', () => {
    expect(() => resolveSkillName('nope', names)).toThrow(/unknown skill 'nope'.*hypercli, hypercli-agents, hypercli-voice/);
  });
});

describe('getSkill', () => {
  it('returns the full record via prefix, loading markdown from <name>.json', () => {
    const dir = tracked('demo');
    const skill = getSkill('de', dir);
    expect(skill.name).toBe('demo');
    expect(skill.markdown).toBe('# demo');
    expect(skill.commands).toEqual(['hyper demo ls']);
  });

  it('throws when the indexed skill has no readable data file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hyper-skills-'));
    dirs.push(dir);
    writeFileSync(
      join(dir, 'index.json'),
      JSON.stringify({ skills: [{ name: 'ghost', description: 'gone', commands: [] }] }),
    );
    expect(() => getSkill('ghost', dir)).toThrow(CliError);
    expect(() => getSkill('ghost', dir)).toThrow(/missing or corrupt/);
  });
});
