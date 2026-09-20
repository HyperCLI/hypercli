import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { authStorePath } from '../src/core/auth-store.js';
import { cliConfigDir, cliConfigFile, loadCliConfigFile } from '../src/core/config-file.js';

describe('HYPER_HOME paths', () => {
  const originalHyperHome = process.env.HYPER_HOME;
  const tempDirs: string[] = [];

  afterEach(() => {
    if (originalHyperHome === undefined) delete process.env.HYPER_HOME;
    else process.env.HYPER_HOME = originalHyperHome;
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'hypercli-cli-'));
    tempDirs.push(dir);
    return dir;
  }

  it('uses HYPER_HOME as the HyperCLI data directory', () => {
    const hyperHome = tempDir();
    process.env.HYPER_HOME = hyperHome;
    writeFileSync(join(hyperHome, 'config'), 'HYPER_API_KEY=hyper_api_home\n');

    expect(cliConfigDir()).toBe(hyperHome);
    expect(cliConfigFile()).toBe(join(hyperHome, 'config'));
    expect(loadCliConfigFile().HYPER_API_KEY).toBe('hyper_api_home');
    expect(authStorePath()).toBe(join(hyperHome, 'auth.json'));
  });

  it('treats empty HYPER_HOME as unset', () => {
    process.env.HYPER_HOME = '   ';

    expect(cliConfigDir()).toContain('.hypercli');
    expect(cliConfigFile()).toContain(join('.hypercli', 'config'));
  });
});
