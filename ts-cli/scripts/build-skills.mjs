#!/usr/bin/env node
/**
 * Build bundled skills: read each allowlisted ../skills/<dir>/SKILL.md and
 * emit cli/skills/<name>.json plus cli/skills/index.json.
 *
 * Only names in SKILLS are compiled, in SKILLS (display) order. Stale *.json
 * outputs from skills that left the allowlist are removed.
 *
 * index.json is the runtime's single source of truth for listing and name
 * resolution: { skills: [{ name, description, commands }] } in display
 * order. Full markdown bodies live in the per-skill <name>.json files.
 *
 * Frontmatter shape (tolerant parser, no yaml dep):
 *
 *   ---
 *   name: hypercli
 *   description: >
 *     Folded block text...
 *     ...joined with single spaces.
 *   ---
 *
 * - `description: >` / `description: |` starts a folded/literal block whose
 *   lines are the following more-indented lines.
 * - `description: plain text` is taken inline.
 * - markdown = original SKILL.md, including frontmatter.
 * - commands = backticked `hyper ...` mentions in the body, deduped in
 *   first-appearance order.
 *
 * Exported functions are unit-tested; run directly to write output.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CLI_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKILLS_SRC = join(CLI_ROOT, '..', 'skills');
const SKILLS_OUT = join(CLI_ROOT, 'skills');

/**
 * The v1 bundle allowlist, in display order. Skills not listed here are
 * never compiled into cli/skills/.
 */
export const SKILLS = [
  'hypercli',
  'hypercli-account',
  'hypercli-agents',
  'hypercli-auth',
  'hypercli-compute',
  'hypercli-flows',
  'hypercli-knowledge',
  'hypercli-voice',
];

/**
 * Parse YAML-ish frontmatter. Returns { data: Record<string,string>, body }.
 * Only scalar 'key: value' lines and '>' / '|' block scalars are understood.
 */
export function parseFrontmatter(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const data = {};
  if (lines[0]?.trim() !== '---') return { data, body: text };

  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '---') {
      i++;
      break;
    }
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (rawValue === '>' || rawValue === '|') {
      const block = [];
      while (i + 1 < lines.length) {
        const next = lines[i + 1];
        if (next.trim() === '') {
          const after = i + 2 < lines.length ? lines[i + 2] : '';
          if (/^\s+\S/.test(after) && after.trim() !== '---') {
            i++;
            block.push('');
            continue;
          }
          break;
        }
        if (/^\s+\S/.test(next) && next.trim() !== '---') {
          i++;
          block.push(next.trim());
          continue;
        }
        break;
      }
      data[key] = (rawValue === '>' ? block.filter(Boolean).join(' ') : block.join('\n')).trim();
    } else {
      data[key] = rawValue.trim();
    }
  }
  return { data, body: lines.slice(i).join('\n').replace(/^\n+/, '') };
}

/** Backticked `hyper ...` mentions in the body, deduped, first-seen order. */
export function scrapeCommands(markdown) {
  const seen = new Set();
  const commands = [];
  for (const match of markdown.matchAll(/`(hyper(?:\s[^`\n]+)?)`/g)) {
    const command = match[1].trim().replace(/\s+/g, ' ');
    if (!seen.has(command)) {
      seen.add(command);
      commands.push(command);
    }
  }
  return commands;
}

/** Turn a SKILL.md source string into the bundled skill record. */
export function buildSkill(source) {
  const { data, body } = parseFrontmatter(source);
  const name = data.name || '';
  if (!name) throw new Error('SKILL.md frontmatter missing name');
  return {
    name,
    description: data.description || '',
    markdown: source.replace(/\r\n/g, '\n').trimEnd(),
    commands: scrapeCommands(body),
  };
}

// Test workers concurrently rebuild the bundle while others read it
// (skills.test.ts and skills.install.test.ts both buildAll in beforeAll), so
// writes must never expose a truncated file: tmp file in the same dir, then rename.
function writeJsonAtomic(path, value) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

export function buildAll(srcDir = SKILLS_SRC, outDir = SKILLS_OUT, names = SKILLS) {
  mkdirSync(outDir, { recursive: true });
  const index = [];
  if (!existsSync(srcDir)) return index;
  const missing = [];
  for (const name of names) {
    const skillPath = join(srcDir, name, 'SKILL.md');
    if (!existsSync(skillPath)) {
      missing.push(name);
      continue;
    }
    const skill = buildSkill(readFileSync(skillPath, 'utf8'));
    writeJsonAtomic(join(outDir, `${skill.name}.json`), skill);
    index.push({ name: skill.name, description: skill.description, commands: skill.commands });
  }
  // Allowlist-driven bundling: remove outputs of skills that left the
  // allowlist so the runtime (which consumes index.json) never sees them.
  const emitted = new Set(index.map((entry) => entry.name));
  for (const file of readdirSync(outDir)) {
    if (!file.endsWith('.json') || file === 'index.json') continue;
    if (!emitted.has(file.slice(0, -'.json'.length))) rmSync(join(outDir, file), { force: true });
  }
  writeJsonAtomic(join(outDir, 'index.json'), { skills: index });
  for (const name of missing) {
    process.stderr.write(`build-skills: skipping '${name}' (no SKILL.md found)\n`);
  }
  return index;
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  const index = buildAll();
  process.stdout.write(`built ${index.length} skill(s) into ${SKILLS_OUT}\n`);
  if (existsSync(SKILLS_SRC)) {
    const excluded = readdirSync(SKILLS_SRC, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !SKILLS.includes(entry.name))
      .map((entry) => entry.name)
      .sort();
    if (excluded.length > 0) {
      process.stdout.write(`excluded by SKILLS allowlist: ${excluded.join(', ')}\n`);
    }
  }
}
