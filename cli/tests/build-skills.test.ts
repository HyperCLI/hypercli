import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without type declarations
import { buildAll, buildSkill, parseFrontmatter, scrapeCommands, SKILLS } from '../scripts/build-skills.mjs';

const FIXTURE = `---
name: hypercli-demo
description: >
  Operate demo things with the hyper CLI. Use as
  the router for demo operations and testing.
---

# Demo

Start with \`hyper demo ls\` and \`hyper demo show <id> --json\`.

- list: \`hyper demo ls\`
- nested: \`hyper demo sub run --flag value\`
`;

describe('parseFrontmatter', () => {
  it('extracts name and folded description, leaving the body', () => {
    const { data, body } = parseFrontmatter(FIXTURE);
    expect(data.name).toBe('hypercli-demo');
    expect(data.description).toBe(
      'Operate demo things with the hyper CLI. Use as the router for demo operations and testing.',
    );
    expect(body.startsWith('# Demo')).toBe(true);
  });

  it('handles inline (non-block) descriptions', () => {
    const { data } = parseFrontmatter('---\nname: x\ndescription: inline desc\n---\nbody\n');
    expect(data.description).toBe('inline desc');
  });

  it('returns the original text when there is no frontmatter', () => {
    const { data, body } = parseFrontmatter('# just markdown\n');
    expect(data).toEqual({});
    expect(body).toBe('# just markdown\n');
  });
});

describe('scrapeCommands', () => {
  it('scrapes backticked hyper commands, deduped in order', () => {
    expect(scrapeCommands(FIXTURE)).toEqual([
      'hyper demo ls',
      'hyper demo show <id> --json',
      'hyper demo sub run --flag value',
    ]);
  });
});

describe('buildSkill', () => {
  it('produces the bundled skill record shape', () => {
    const skill = buildSkill(FIXTURE);
    expect(Object.keys(skill).sort()).toEqual(['commands', 'description', 'markdown', 'name']);
    expect(skill.name).toBe('hypercli-demo');
    expect(typeof skill.markdown).toBe('string');
    expect(Array.isArray(skill.commands)).toBe(true);
  });

  it('throws without a name', () => {
    expect(() => buildSkill('---\ndescription: no name\n---\n')).toThrow(/missing name/);
  });
});

describe('SKILLS allowlist', () => {
  it('is exactly the seven v1 skills in display order', () => {
    expect(SKILLS).toEqual([
      'hypercli',
      'hypercli-account',
      'hypercli-agents',
      'hypercli-auth',
      'hypercli-compute',
      'hypercli-flows',
      'hypercli-voice',
    ]);
  });
});

describe('buildAll', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('writes <name>.json per allowlisted skill plus an index.json with commands', () => {
    const root = mkdtempSync(join(tmpdir(), 'hyper-build-skills-'));
    roots.push(root);
    const src = join(root, 'src');
    const out = join(root, 'out');
    mkdirSync(join(src, 'hypercli-demo'), { recursive: true });
    writeFileSync(join(src, 'hypercli-demo', 'SKILL.md'), FIXTURE);

    const index = buildAll(src, out, ['hypercli-demo']);
    expect(index).toEqual([
      {
        name: 'hypercli-demo',
        description: 'Operate demo things with the hyper CLI. Use as the router for demo operations and testing.',
        commands: [
          'hyper demo ls',
          'hyper demo show <id> --json',
          'hyper demo sub run --flag value',
        ],
      },
    ]);

    const record = JSON.parse(readFileSync(join(out, 'hypercli-demo.json'), 'utf8'));
    expect(record.name).toBe('hypercli-demo');
    expect(record.commands).toContain('hyper demo ls');

    const indexFile = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'));
    expect(indexFile).toEqual({ skills: index });
  });

  it('does not bundle source skills outside the allowlist', () => {
    const root = mkdtempSync(join(tmpdir(), 'hyper-build-skills-'));
    roots.push(root);
    const src = join(root, 'src');
    const out = join(root, 'out');
    mkdirSync(join(src, 'hypercli-demo'), { recursive: true });
    mkdirSync(join(src, 'hypercli-skip'), { recursive: true });
    writeFileSync(join(src, 'hypercli-demo', 'SKILL.md'), FIXTURE);
    writeFileSync(join(src, 'hypercli-skip', 'SKILL.md'), FIXTURE.replace('hypercli-demo', 'hypercli-skip'));

    const index = buildAll(src, out, ['hypercli-demo']);
    expect(index.map((entry: { name: string }) => entry.name)).toEqual(['hypercli-demo']);
    expect(existsSync(join(out, 'hypercli-skip.json'))).toBe(false);
  });

  it('removes stale skill outputs that left the allowlist', () => {
    const root = mkdtempSync(join(tmpdir(), 'hyper-build-skills-'));
    roots.push(root);
    const src = join(root, 'src');
    const out = join(root, 'out');
    mkdirSync(join(src, 'hypercli-demo'), { recursive: true });
    mkdirSync(out, { recursive: true });
    writeFileSync(join(src, 'hypercli-demo', 'SKILL.md'), FIXTURE);
    writeFileSync(join(out, 'hypercli-stale.json'), '{"name":"hypercli-stale"}');

    buildAll(src, out, ['hypercli-demo']);
    expect(existsSync(join(out, 'hypercli-stale.json'))).toBe(false);
    expect(existsSync(join(out, 'hypercli-demo.json'))).toBe(true);
  });
});
