import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
      'HYPER_AGENTS_API_BASE', 'HYPER_WORKSPACES_API_BASE',
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
