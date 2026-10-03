import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { cliConfigDir, cliConfigFile, loadCliConfigFile, saveCliConfig } from '../src/core/config-file.js';

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
  });

  it('treats empty HYPER_HOME as unset', () => {
    process.env.HYPER_HOME = '   ';

    expect(cliConfigDir()).toContain('.hypercli');
    expect(cliConfigFile()).toContain(join('.hypercli', 'config'));
  });

  it('keeps non-leading tildes in HYPER_HOME literal', () => {
    process.env.HYPER_HOME = '/data/~team';

    expect(cliConfigDir()).toBe('/data/~team');
    expect(cliConfigFile()).toBe(join('/data/~team', 'config'));
  });
});

describe('saveCliConfig legacy scrub', () => {
  const originalHyperHome = process.env.HYPER_HOME;
  const tempDirs: string[] = [];

  afterEach(() => {
    if (originalHyperHome === undefined) delete process.env.HYPER_HOME;
    else process.env.HYPER_HOME = originalHyperHome;
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('drops retired legacy override keys from the persisted file', () => {
    const hyperHome = mkdtempSync(join(tmpdir(), 'hypercli-cli-'));
    tempDirs.push(hyperHome);
    process.env.HYPER_HOME = hyperHome;
    writeFileSync(
      join(hyperHome, 'config'),
      [
        'HYPER_API_KEY=hyper_api_old',
        'HYPER_API_BASE=https://kept.example',
        'HYPERCLI_API_KEY=legacy-key',
        'HYPERCLI_API_URL=https://legacy.example',
        'AGENTS_API_BASE_URL=https://legacy.example/agents',
        'AGENTS_WS_URL=wss://legacy.example/ws',
      ].join('\n') + '\n',
    );

    saveCliConfig('hyper_api_new');

    const raw = readFileSync(join(hyperHome, 'config'), 'utf8');
    const saved = loadCliConfigFile();
    expect(saved.HYPER_API_KEY).toBe('hyper_api_new');
    expect(saved.HYPER_API_BASE).toBe('https://kept.example');
    expect('HYPERCLI_API_KEY' in saved).toBe(false);
    expect('HYPERCLI_API_URL' in saved).toBe(false);
    expect('AGENTS_API_BASE_URL' in saved).toBe(false);
    expect('AGENTS_WS_URL' in saved).toBe(false);
    expect(raw).not.toContain('HYPERCLI_API_URL');
    expect(raw).not.toContain('AGENTS_API_BASE_URL');
    expect(raw).not.toContain('AGENTS_WS_URL');
  });
});
