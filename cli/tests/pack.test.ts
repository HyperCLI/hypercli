/**
 * Pack gate: what actually ships in the npm tarball.
 *
 * Requires a prebuilt dist/ (run `npm run build` first). Deliberately does
 * NOT build here: the test stays fast and CI runs build before vitest.
 *
 * Asserts:
 *   - every skills/*.json on disk is present in the tarball
 *   - dist/index.js (the bin) is present
 *   - dist/index.js has UNIX line endings with first line exactly
 *     '#!/usr/bin/env node' — CRLF breaks the POSIX shebang
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PKG_DIR = fileURLToPath(new URL('..', import.meta.url));
const SHEBANG = '#!/usr/bin/env node';

interface PackEntry {
  files: { path: string }[];
}

function packedPaths(): Set<string> {
  // execSync (shell) rather than execFileSync: on Windows spawning npm.cmd
  // directly without a shell fails with EINVAL.
  const out = execSync('npm pack --dry-run --json', {
    cwd: PKG_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const entries = JSON.parse(out) as PackEntry[];
  return new Set(entries.flatMap((e) => e.files.map((f) => f.path.replace(/\\/g, '/'))));
}

describe('npm pack --dry-run (pack gate)', () => {
  it('requires a prebuilt dist/ — run `npm run build` first', () => {
    expect(existsSync(join(PKG_DIR, 'dist', 'index.js'))).toBe(true);
  });

  it('ships every skills/*.json and the bin entrypoint', { timeout: 120_000 }, () => {
    const paths = packedPaths();

    const skillsDir = join(PKG_DIR, 'skills');
    const skillFiles = readdirSync(skillsDir).filter((f) => f.endsWith('.json'));
    expect(skillFiles.length).toBeGreaterThan(0);
    for (const file of skillFiles) {
      expect(paths.has(`skills/${file}`), `missing skills/${file} from tarball`).toBe(true);
    }

    expect(paths.has('dist/index.js'), 'missing dist/index.js from tarball').toBe(true);
  });

  it('dist/index.js has a POSIX-clean shebang (LF endings)', () => {
    const bytes = readFileSync(join(PKG_DIR, 'dist', 'index.js'), 'utf8');
    expect(bytes.includes('\r'), 'dist/index.js contains CR characters').toBe(false);
    expect(bytes.split('\n')[0]).toBe(SHEBANG);
  });
});
