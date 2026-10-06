import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { APP_VERSION } from '../src/version.js';

it('CLI release identity agrees with its standalone manifest', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(APP_VERSION).toBe(pkg.version);
  const home = mkdtempSync(join(tmpdir(), 'hyper-version-'));
  try {
    const output = execFileSync(process.execPath, ['--import', 'tsx', 'src/index.ts', '--version'], {
      cwd: new URL('..', import.meta.url),
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: home, HYPER_HOME: home },
      encoding: 'utf8',
    });
    expect(output.trim()).toBe(`hyper ${pkg.version}`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
