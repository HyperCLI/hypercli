import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getApiKey,
  getAgentApiKey,
  getApiUrl,
  getAgentsApiBaseUrl,
  getAgentsApiBaseUrlFromProductBase,
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
  });

  afterEach(() => {
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

  it('should derive WebSocket URL from API URL', () => {
    const wsUrl = getWsUrl();
    expect(wsUrl).toBeDefined();
    expect(wsUrl).toMatch(/^wss?:\/\//);
  });

  it('should return default agents URLs', () => {
    expect(getAgentsApiBaseUrl()).toBe(DEFAULT_AGENTS_API_BASE_URL);
    expect(getAgentsWsUrl()).toBe(DEFAULT_AGENTS_WS_URL);
    expect(getAgentsApiBaseUrl(true)).toBe('https://api.dev.hypercli.com/agents');
    expect(getAgentsWsUrl(true)).toBe('wss://api.agents.dev.hypercli.com/ws');
  });

  it('should respect agents env overrides', () => {
    process.env.AGENTS_API_BASE_URL = 'https://api.dev.hypercli.com/agents';
    process.env.AGENTS_WS_URL = 'wss://api.agents.dev.hypercli.com/ws';

    expect(getAgentsApiBaseUrl()).toBe('https://api.dev.hypercli.com/agents');
    expect(getAgentsWsUrl()).toBe('wss://api.agents.dev.hypercli.com/ws');
  });

  it('should derive agents endpoints from product base when direct base is unset', () => {
    process.env.HYPER_API_BASE = 'https://api.dev.hypercli.com';

    expect(getAgentsApiBaseUrl()).toBe('https://api.dev.hypercli.com/agents');
    expect(getAgentsWsUrl()).toBe('wss://api.agents.dev.hypercli.com/ws');
  });

  it('should derive agents endpoints from an explicit product base', () => {
    expect(getAgentsApiBaseUrlFromProductBase('https://api.dev.hypercli.com')).toBe('https://api.dev.hypercli.com/agents');
    expect(getAgentsWsUrlFromProductBase('https://api.dev.hypercli.com')).toBe('wss://api.agents.dev.hypercli.com/ws');
  });
});
