import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveWorkspacesApiBase, WorkspacesAPI } from '../src/workspaces.js';
import { deriveRoutinesApiBase, RoutinesAPI } from '../src/routines.js';
import { deriveRunnersApiBase, RunnersAPI } from '../src/runners.js';
import { deriveIntegrationsApiBase, IntegrationsAPI } from '../src/integrations.js';
import {
  getApiKey,
  getAgentApiKey,
  getApiUrl,
  getAgentsApiBaseUrl,
  getAgentsApiBaseUrlFromProductBase,
  getAgentsAdminApiBaseUrlFromProductBase,
  getAgentsWsUrl,
  getAgentsWsUrlFromProductBase,
  getWsUrl,
  DEFAULT_API_URL,
  DEFAULT_AGENTS_API_BASE_URL,
  DEFAULT_AGENTS_WS_URL,
} from '../src/config.js';

describe('clean source consumer configuration', () => {
  it('imports SDK source through external tsx config without dist or SDK tsconfig', () => {
    const sdkRoot = fileURLToPath(new URL('../', import.meta.url));
    const fixture = mkdtempSync(join(tmpdir(), 'hypercli-source-consumer-'));
    try {
      const sdk = join(fixture, 'hypercli/ts-sdk');
      const consumer = join(fixture, 'agents/slack-relay-v2');
      mkdirSync(sdk, { recursive: true });
      mkdirSync(consumer, { recursive: true });
      for (const name of ['package.json', 'src', 'runtime']) {
        cpSync(join(sdkRoot, name), join(sdk, name), { recursive: true });
      }
      symlinkSync(join(sdkRoot, 'node_modules'), join(sdk, 'node_modules'), 'dir');
      writeFileSync(join(consumer, 'package.json'), '{"type":"module"}');
      // Match the relay's external runtime config and source aliases, not the
      // SDK's NodeNext/rootDir/outDir settings (which can mask dist resolution).
      writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
          target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler',
          noEmit: true, esModuleInterop: true,
          paths: {
            '@hypercli.com/sdk': ['../../hypercli/ts-sdk/src/index.ts'],
            '@hypercli.com/sdk/*': ['../../hypercli/ts-sdk/src/*.ts'],
          },
        },
      }));
      writeFileSync(join(consumer, 'tsconfig.runtime.json'), '{"extends":"./tsconfig.json"}');
      writeFileSync(join(fixture, 'config'), 'HYPER_API_KEY=synthetic-source-key\nHYPER_API_BASE=https://source.example\nHYPER_AGENTS_API_BASE=https://api.agents.dev.hypercli.com\n');
      writeFileSync(join(consumer, 'consumer.ts'), `
        import assert from 'node:assert/strict';
        import { HyperCLI } from '@hypercli.com/sdk';
        import { getApiKey, configure } from '../../hypercli/ts-sdk/src/config.ts';
        import { CodingAgentAcpClient } from '../../hypercli/ts-sdk/src/acp.ts';
        assert.equal(typeof CodingAgentAcpClient, 'function');
        assert.equal(getApiKey(), 'synthetic-source-key');
        const client = new HyperCLI();
        assert.equal(client.apiKey, 'synthetic-source-key');
        assert.equal(client.apiUrl, 'https://source.example');
        assert.equal(client.deployments.agentApiBase, 'https://api.agents.dev.hypercli.com/agents');
        assert.equal(client.deployments.agentsWsUrl, 'wss://api.agents.dev.hypercli.com/ws');
        configure('synthetic-updated-source-key');
        assert.equal(getApiKey(), 'synthetic-updated-source-key');
      `);
      expect(existsSync(join(sdk, 'dist'))).toBe(false);
      expect(existsSync(join(sdk, 'tsconfig.json'))).toBe(false);
      const result = spawnSync(process.execPath, [
        createRequire(import.meta.url).resolve('tsx/cli'),
        '--tsconfig', 'tsconfig.runtime.json', 'consumer.ts',
      ], {
        cwd: consumer, encoding: 'utf8', timeout: 30_000,
        env: { HOME: fixture, USERPROFILE: fixture, HYPER_HOME: fixture },
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(existsSync(join(sdk, 'dist'))).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});

describe('native ESM configuration', () => {
  const sdkRoot = fileURLToPath(new URL('../', import.meta.url));
  let packedFiles: string[];

  beforeAll(() => {
    // Always compile current sources: a stale dist could hide this regression.
    execFileSync(process.execPath, ['node_modules/typescript/bin/tsc'], { cwd: sdkRoot });
    const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
      cwd: sdkRoot, encoding: 'utf8',
    }));
    packedFiles = pack.files.map((file: { path: string }) => file.path);
    expect(packedFiles).toEqual(expect.arrayContaining([
      'runtime/config-require.node.js', 'runtime/config-require.browser.js', 'runtime/config-require.d.ts',
    ]));
  }, 180_000);

  it.each([false, true])('loads saved config (getBuiltinModule removed: %s)', (removeBuiltinModule) => {
    const home = mkdtempSync(join(tmpdir(), 'hypercli-native-esm-'));
    try {
      // Run only the publishable files, with no source tree or tsx loader.
      const installedSdk = join(home, 'sdk');
      for (const path of packedFiles) {
        const target = join(installedSdk, path);
        mkdirSync(dirname(target), { recursive: true });
        cpSync(join(sdkRoot, path), target);
      }
      symlinkSync(join(sdkRoot, 'node_modules'), join(installedSdk, 'node_modules'), 'dir');
      const hyperHome = join(home, 'selected');
      mkdirSync(hyperHome);
      writeFileSync(join(hyperHome, 'config'), [
        'export HYPER_API_KEY="synthetic=saved-key"',
        'export HYPER_API_BASE="https://saved.example/prefix"',
        'export HYPER_AGENTS_API_BASE="https://control.example/tenant/api///"',
      ].join('\n'));
      const result = spawnSync(process.env.HYPERCLI_TEST_NODE || process.execPath, [
        '--input-type=module', '--eval', `
          import assert from 'node:assert/strict';
          import { unlinkSync } from 'node:fs';
          assert.equal(typeof require, 'undefined');
          if (${removeBuiltinModule}) {
            delete process.getBuiltinModule;
            assert.equal(process.getBuiltinModule, undefined);
          }
          const config = await import('./dist/config.js');
          const { HyperCLI } = await import('@hypercli.com/sdk');
          assert.equal(config.getApiKey(), 'synthetic=saved-key');
          assert.equal(config.getAgentApiKey(), 'synthetic=saved-key');
          assert.equal(config.getApiUrl(), 'https://saved.example/prefix');
          assert.equal(config.getAgentsApiBaseUrl(), 'https://control.example/tenant/agents');
          const saved = new HyperCLI();
          assert.equal(saved.apiKey, 'synthetic=saved-key');
          assert.equal(saved.deployments.agentApiKey, 'synthetic=saved-key');
          assert.equal(saved.deployments.agentApiBase, 'https://control.example/tenant/agents');
          assert.equal(saved.deployments.agentsWsUrl, 'wss://control.example/tenant/ws');
          assert.equal(saved.agent.baseUrl, 'https://saved.example/prefix/v1');

          process.env.HYPER_API_KEY = 'synthetic-env-key';
          process.env.HYPER_API_BASE = 'https://env.example';
          assert.equal(config.getAgentApiKey(), 'synthetic-env-key');
          assert.equal(config.getApiUrl(), 'https://env.example');
          const explicit = new HyperCLI({
            apiKey: 'synthetic-explicit-key', agentApiKey: 'synthetic-explicit-agent',
            apiUrl: 'https://explicit.example', agentsApiBaseUrl: 'https://explicit-agent.example/agents',
          });
          assert.equal(explicit.apiKey, 'synthetic-explicit-key');
          assert.equal(explicit.deployments.agentApiKey, 'synthetic-explicit-agent');
          assert.equal(explicit.apiUrl, 'https://explicit.example');
          assert.equal(explicit.deployments.agentApiBase, 'https://explicit-agent.example/agents');
          delete process.env.HYPER_API_KEY;
          delete process.env.HYPER_API_BASE;

          config.configure('synthetic-updated-key');
          assert.equal(config.getAgentApiKey(), 'synthetic-updated-key');
          assert.equal(config.getApiUrl(), 'https://saved.example/prefix');
          config.configure('synthetic-updated-key', 'https://updated.example');
          assert.equal(config.getApiUrl(), 'https://updated.example');
          assert.equal(config.getAgentsApiBaseUrl(), 'https://control.example/tenant/agents');
          unlinkSync(process.env.HYPER_HOME + '/config');
          assert.equal(config.getApiKey(), undefined);
          assert.equal(config.getAgentApiKey(), 'synthetic-runtime-key');
          assert.equal(config.getApiUrl(), config.DEFAULT_API_URL);
        `,
      ], {
        cwd: installedSdk,
        encoding: 'utf8',
        timeout: 30_000,
        // Do not inherit credentials, loader flags, or the user's config directory.
        env: { HOME: home, USERPROFILE: home, HYPER_HOME: hyperHome, HYPER_AGENTS_API_KEY: 'synthetic-runtime-key' },
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr || result.stdout).toBe(0);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('Config', () => {
  const originalHyperApiKey = process.env.HYPER_API_KEY;
  const originalHyperApiBase = process.env.HYPER_API_BASE;
  const originalApiUrl = process.env.HYPERCLI_API_URL;
  const originalAgentsApiKey = process.env.HYPER_AGENTS_API_KEY;
  const originalWsUrl = process.env.HYPERCLI_WS_URL;
  const originalAgentsApiBaseUrl = process.env.AGENTS_API_BASE_URL;
  const originalAgentsWsUrl = process.env.AGENTS_WS_URL;
  const originalHyperHome = process.env.HYPER_HOME;
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const tempDirs: string[] = [];

  beforeEach(() => {
    process.env.HYPER_API_KEY = 'hyper_api_test_key';
    delete process.env.HYPER_API_BASE;
    delete process.env.HYPERCLI_API_URL;
    delete process.env.HYPER_AGENTS_API_KEY;
    delete process.env.HYPERCLI_WS_URL;
    delete process.env.AGENTS_API_BASE_URL;
    delete process.env.AGENTS_WS_URL;
    delete process.env.HYPER_HOME;
    const fakeHome = mkdtempSync(join(tmpdir(), 'hypercli-config-home-'));
    tempDirs.push(fakeHome);
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    if (originalHyperApiKey === undefined) delete process.env.HYPER_API_KEY;
    else process.env.HYPER_API_KEY = originalHyperApiKey;

    if (originalHyperApiBase === undefined) delete process.env.HYPER_API_BASE;
    else process.env.HYPER_API_BASE = originalHyperApiBase;

    if (originalApiUrl === undefined) delete process.env.HYPERCLI_API_URL;
    else process.env.HYPERCLI_API_URL = originalApiUrl;

    if (originalAgentsApiKey === undefined) delete process.env.HYPER_AGENTS_API_KEY;
    else process.env.HYPER_AGENTS_API_KEY = originalAgentsApiKey;

    if (originalWsUrl === undefined) delete process.env.HYPERCLI_WS_URL;
    else process.env.HYPERCLI_WS_URL = originalWsUrl;

    if (originalAgentsApiBaseUrl === undefined) delete process.env.AGENTS_API_BASE_URL;
    else process.env.AGENTS_API_BASE_URL = originalAgentsApiBaseUrl;

    if (originalAgentsWsUrl === undefined) delete process.env.AGENTS_WS_URL;
    else process.env.AGENTS_WS_URL = originalAgentsWsUrl;

    if (originalHyperHome === undefined) delete process.env.HYPER_HOME;
    else process.env.HYPER_HOME = originalHyperHome;

    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;

    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;

    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'hypercli-config-'));
    tempDirs.push(dir);
    return dir;
  }

  it('should return API key from env', () => {
    const key = getApiKey();
    expect(key).toBeDefined();
    expect(typeof key).toBe('string');
    expect(key).toMatch(/^hyper_api_/);
  });

  it('should prefer the product key before the managed agent fallback', () => {
    process.env.HYPER_AGENTS_API_KEY = 'hyper_api_agent';
    expect(getAgentApiKey()).toBe('hyper_api_test_key');
    expect(getApiKey()).toBe('hyper_api_test_key');
  });

  it('should use the managed agent key when no product key is selected', () => {
    delete process.env.HYPER_API_KEY;
    process.env.HYPER_AGENTS_API_KEY = 'hyper_api_agent';
    expect(getAgentApiKey()).toBe('hyper_api_agent');
  });

  it('uses HYPER_HOME as the data directory for config', () => {
    delete process.env.HYPER_API_KEY;
    const hyperHome = tempDir();
    writeFileSync(join(hyperHome, 'config'), 'HYPER_API_KEY=hyper_api_home\n');
    process.env.HYPER_HOME = hyperHome;

    expect(getApiKey()).toBe('hyper_api_home');
  });

  it('does not read default home config when HYPER_HOME is set and missing config', () => {
    delete process.env.HYPER_API_KEY;
    const fakeHome = tempDir();
    const hyperHome = tempDir();
    mkdirSync(join(fakeHome, '.hypercli'));
    writeFileSync(join(fakeHome, '.hypercli', 'config'), 'HYPER_API_KEY=hyper_api_default_home\n');
    const originalHome = process.env.HOME;
    process.env.HOME = fakeHome;
    process.env.HYPER_HOME = hyperHome;
    try {
      expect(getApiKey()).toBeUndefined();
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });

  it('prefers configured product key before managed agent env fallback', () => {
    delete process.env.HYPER_API_KEY;
    const hyperHome = tempDir();
    writeFileSync(join(hyperHome, 'config'), 'HYPER_API_KEY=hyper_api_config\n');
    process.env.HYPER_HOME = hyperHome;
    process.env.HYPER_AGENTS_API_KEY = 'hyper_api_agent';

    expect(getAgentApiKey()).toBe('hyper_api_config');
  });

  it('should return default API URL', () => {
    const url = getApiUrl();
    expect(url).toBe(DEFAULT_API_URL);
  });

  it.each(['', '"', "'"])('parses exported and quoted config values (%s) without changing key precedence', (quote) => {
    const hyperHome = tempDir();
    process.env.HYPER_HOME = hyperHome;
    writeFileSync(join(hyperHome, 'config'), [
      '# shared CLI/SDK config',
      ` export HYPER_API_KEY = ${quote}canonical=key${quote} `,
      ` export HYPER_API_BASE = ${quote}https://file.example/prefix${quote} `,
    ].join('\n'));
    process.env.HYPER_AGENTS_API_KEY = 'managed-fallback';
    expect(getAgentApiKey()).toBe('hyper_api_test_key');
    process.env.HYPER_API_BASE = 'https://env.example';
    expect(getApiUrl()).toBe('https://env.example');
    delete process.env.HYPER_API_KEY;
    delete process.env.HYPER_API_BASE;
    expect(getApiKey()).toBe('canonical=key');
    expect(getAgentApiKey()).toBe('canonical=key');
    expect(getApiUrl()).toBe('https://file.example/prefix');
    expect(getAgentsApiBaseUrl()).toBe('https://file.example/prefix/agents');
    writeFileSync(join(hyperHome, 'config'), 'export HYPER_API_KEY=""\n');
    expect(getAgentApiKey()).toBe('managed-fallback');
  });

  it.each(['env', 'file'])('ignores stale namespace bases in %s and derives only from the canonical base', (source) => {
    const hyperHome = tempDir();
    process.env.HYPER_HOME = hyperHome;
    const staleKeys = [
      'HYPER_WORKSPACES_API_BASE',
      'HYPER_ROUTINES_API_BASE', 'HYPER_RUNNERS_API_BASE', 'HYPER_INTEGRATIONS_API_BASE',
    ];
    const staleConfig = staleKeys.map((key) => `${key}=https://stale.example/wrong`).join('\n');
    for (const key of staleKeys) vi.stubEnv(key, source === 'env' ? 'https://stale.example/wrong' : '');
    writeFileSync(join(hyperHome, 'config'), source === 'file' ? staleConfig : '');
    expect(getApiUrl()).toBe(DEFAULT_API_URL);
    expect(getAgentsApiBaseUrl()).toBe(DEFAULT_AGENTS_API_BASE_URL);
    expect(getAgentsWsUrl()).toBe(DEFAULT_AGENTS_WS_URL);
    for (const [derive, suffix] of [
      [deriveWorkspacesApiBase, '/workspaces'],
      [deriveRoutinesApiBase, '/routines'],
      [deriveRunnersApiBase, '/agents/runners'],
      [deriveIntegrationsApiBase, '/integrations'],
    ] as const) {
      expect(derive()).toBe(`https://api.hypercli.com${suffix}`);
      expect(derive('https://explicit.example/prefix/agents')).toBe(`https://explicit.example/prefix${suffix}`);
    }
    writeFileSync(join(hyperHome, 'config'), `${source === 'file' ? staleConfig : ''}\nHYPER_API_BASE=https://file.example/prefix\n`);
    expect(getAgentsApiBaseUrl()).toBe('https://file.example/prefix/agents');
    expect(deriveWorkspacesApiBase()).toBe('https://file.example/prefix/workspaces');
    expect(deriveRoutinesApiBase()).toBe('https://file.example/prefix/routines');
    expect(deriveRunnersApiBase()).toBe('https://file.example/prefix/agents/runners');
    expect(deriveIntegrationsApiBase()).toBe('https://file.example/prefix/integrations');
    process.env.HYPER_API_BASE = 'https://env.example';
    expect(getApiUrl()).toBe('https://env.example');
    expect(getAgentsApiBaseUrl()).toBe('https://env.example/agents');
    expect(deriveWorkspacesApiBase()).toBe('https://env.example/workspaces');
    expect(deriveRoutinesApiBase()).toBe('https://env.example/routines');
    expect(deriveRunnersApiBase()).toBe('https://env.example/agents/runners');
    expect(deriveIntegrationsApiBase()).toBe('https://env.example/integrations');
  });

  it('should derive WebSocket URL from API URL', () => {
    const wsUrl = getWsUrl();
    expect(wsUrl).toBeDefined();
    expect(wsUrl).toMatch(/^wss?:\/\//);
  });

  it.each(['env', 'file', 'constructor'])('preserves explicit control origins and sibling tunnels via %s', async (source) => {
    const { HyperCLI } = await import('../src/client.js');
    const home = tempDir();
    vi.stubEnv('HYPER_HOME', home);
    vi.stubEnv('HYPER_API_BASE', 'https://inference.example');
    for (const [input, rest, ws] of [
      ['https://api.agents.dev.hypercli.com', 'https://api.agents.dev.hypercli.com/agents', 'wss://api.agents.dev.hypercli.com/ws'],
      ['https://api.agents.hypercli.com/api/', 'https://api.agents.hypercli.com/agents', 'wss://api.agents.hypercli.com/ws'],
      ['http://control.example:8787/prefix/agents///', 'http://control.example:8787/prefix/agents', 'ws://control.example:8787/prefix/ws'],
      ['https://api.agents.dev.hypercli.com/prefix/api/', 'https://api.agents.dev.hypercli.com/prefix/agents', 'wss://api.agents.dev.hypercli.com/prefix/ws'],
    ]) {
      vi.stubEnv('HYPER_AGENTS_API_BASE', source === 'env' ? input : '');
      writeFileSync(join(home, 'config'), source === 'file' ? `HYPER_AGENTS_API_BASE=${input}\n` : '');
      const client = new HyperCLI({ apiKey: 'synthetic-key', ...(source === 'constructor' ? { agentsApiBaseUrl: input } : {}) });
      expect(client.deployments.agentApiBase).toBe(rest);
      expect((client.deployments as any).agentsWsUrl).toBe(ws);
      expect(client.agent.baseUrl).toBe('https://inference.example/v1');
      const fetchMock = vi.fn(async () => new Response('[]', { headers: { 'Content-Type': 'application/json' } }));
      vi.stubGlobal('fetch', fetchMock);
      await client.jobs.list();
      await client.agent.plans();
      await client.runners.list();
      expect(fetchMock.mock.calls.map((call: any) => String(call[0]))).toEqual([
        'https://inference.example/api/jobs', `${rest}/plans`, `${rest}/runners`,
      ]);
    }
  });

  it.each(['env', 'file'])('keeps divergent product and Agents bases from %s independent', async (source) => {
    const { HyperCLI } = await import('../src/client.js');
    const home = tempDir();
    vi.stubEnv('HYPER_HOME', home);
    vi.stubEnv('HYPER_API_BASE', 'https://inference.example/prefix');
    vi.stubEnv('HYPER_AGENTS_API_BASE', source === 'env' ? 'https://api.dev.hypercli.com/agents///' : '');
    writeFileSync(join(home, 'config'), 'HYPER_AGENTS_API_BASE=https://api.dev.hypercli.com/agents///\n');
    const client = new HyperCLI();
    expect(client.apiUrl).toBe('https://inference.example/prefix');
    expect(client.agent.baseUrl).toBe('https://inference.example/prefix/v1');
    expect(client.deployments.agentApiBase).toBe('https://api.dev.hypercli.com/agents');
    expect((client.deployments as any).agentsWsUrl).toBe('wss://api.agents.dev.hypercli.com/ws');
    expect(client.agent.controlBaseUrl).toBe(client.deployments.agentApiBase);
    const explicit = new HyperCLI({ apiUrl: 'https://explicit-product.example', agentsApiBaseUrl: 'http://explicit-control.example/prefix/api///' });
    expect(explicit.apiUrl).toBe('https://explicit-product.example');
    expect(explicit.deployments.agentApiBase).toBe('http://explicit-control.example/prefix/agents');
    expect((explicit.deployments as any).agentsWsUrl).toBe('ws://explicit-control.example/prefix/ws');
    const transport = new HyperCLI({ agentsWsUrl: 'wss://transport.example/custom/ws' });
    expect((transport.deployments as any).agentsWsUrl).toBe('wss://transport.example/custom/ws');
    // An explicit product constructor is a derivation fallback, not an Agents override.
    expect(new HyperCLI({ apiUrl: 'https://external.example' }).deployments.agentApiBase).toBe(client.deployments.agentApiBase);
    vi.stubEnv('HYPER_AGENTS_API_BASE', 'https://env-control.example/prefix/');
    expect(getAgentsApiBaseUrl()).toBe('https://env-control.example/prefix/agents');
    vi.stubEnv('HYPER_API_BASE', '');
    expect(getApiUrl()).toBe(DEFAULT_API_URL);
  });

  it('preserves explicit namespace constructor bases despite stale env overrides', async () => {
    for (const key of ['HYPER_AGENTS_API_BASE', 'HYPER_WORKSPACES_API_BASE', 'HYPER_ROUTINES_API_BASE', 'HYPER_RUNNERS_API_BASE', 'HYPER_INTEGRATIONS_API_BASE']) {
      vi.stubEnv(key, 'https://stale.example/wrong');
    }
    const fetchMock = vi.fn(async (_url: string | URL | Request) => new Response('[]', { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const options = { apiBase: 'https://explicit.example/custom' };
    await new WorkspacesAPI('synthetic-key', options).list();
    await new RoutinesAPI('synthetic-key', options).list();
    await new RunnersAPI('synthetic-key', options).list();
    await new IntegrationsAPI('synthetic-key', options).listProviders();
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      options.apiBase, options.apiBase, options.apiBase, `${options.apiBase}/providers`,
    ]);
  });

  it('should return default agents URLs', () => {
    expect(getAgentsApiBaseUrl()).toBe(DEFAULT_AGENTS_API_BASE_URL);
    expect(getAgentsWsUrl()).toBe(DEFAULT_AGENTS_WS_URL);
    expect(getAgentsApiBaseUrl(true)).toBe('https://api.dev.hypercli.com/agents');
    expect(getAgentsWsUrl(true)).toBe('wss://api.agents.dev.hypercli.com/ws');
  });

  it('ignores legacy override envs; only HYPER_API_BASE steers resolution', () => {
    process.env.AGENTS_API_BASE_URL = 'https://api.dev.hypercli.com/agents';
    process.env.AGENTS_WS_URL = 'wss://api.agents.dev.hypercli.com/ws';
    process.env.HYPERCLI_API_URL = 'https://api.dev.hypercli.com';
    process.env.HYPERCLI_WS_URL = 'wss://api.dev.hypercli.com';

    expect(getApiUrl()).toBe(DEFAULT_API_URL);
    expect(getWsUrl()).toBe('wss://api.hypercli.com');
    expect(getAgentsApiBaseUrl()).toBe(DEFAULT_AGENTS_API_BASE_URL);
    expect(getAgentsWsUrl()).toBe(DEFAULT_AGENTS_WS_URL);
  });

  it('should derive agents endpoints from product base', () => {
    process.env.HYPER_API_BASE = 'https://api.dev.hypercli.com';

    expect(getAgentsApiBaseUrl()).toBe('https://api.dev.hypercli.com/agents');
    expect(getAgentsWsUrl()).toBe('wss://api.agents.dev.hypercli.com/ws');
  });

  it('normalizes product bases with lowercase host and no default port', () => {
    process.env.HYPER_API_BASE = 'HTTPS://API.HYPERCLI.COM:443';

    expect(getApiUrl()).toBe('HTTPS://API.HYPERCLI.COM:443');
    expect(getAgentsApiBaseUrl()).toBe(DEFAULT_AGENTS_API_BASE_URL);
    expect(getAgentsWsUrl()).toBe(DEFAULT_AGENTS_WS_URL);
  });

  it('should derive agents endpoints from an explicit product base', () => {
    expect(getAgentsApiBaseUrlFromProductBase('https://api.dev.hypercli.com')).toBe('https://api.dev.hypercli.com/agents');
    expect(getAgentsWsUrlFromProductBase('https://api.dev.hypercli.com')).toBe('wss://api.agents.dev.hypercli.com/ws');
  });

  it('should derive the agents admin base from an explicit product base', () => {
    expect(getAgentsAdminApiBaseUrlFromProductBase('')).toBe('https://api.agents.hypercli.com');
    expect(getAgentsAdminApiBaseUrlFromProductBase('https://api.hypercli.com')).toBe('https://api.agents.hypercli.com');
    expect(getAgentsAdminApiBaseUrlFromProductBase('https://api.hypercli.com/api')).toBe('https://api.agents.hypercli.com');
    expect(getAgentsAdminApiBaseUrlFromProductBase('https://api.dev.hypercli.com')).toBe('https://api.agents.dev.hypercli.com');
    expect(getAgentsAdminApiBaseUrlFromProductBase('https://api.dev.hypercli.com/agents')).toBe('https://api.agents.dev.hypercli.com');
    expect(getAgentsAdminApiBaseUrlFromProductBase('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
    expect(getAgentsAdminApiBaseUrlFromProductBase('http://127.0.0.1:8787/api')).toBe('http://127.0.0.1:8787');
  });
});
