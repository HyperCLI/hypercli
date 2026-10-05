import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run as runMe } from '../src/commands/me.js';
import { parseUniversal } from '../src/core/argv.js';
import { lazyClient } from '../src/core/client.js';
import { applyCliConfigFile } from '../src/core/config-file.js';
import { createOutput } from '../src/core/output.js';

const staleKeys = [
  'HYPER_AGENTS_API_BASE', 'HYPER_WORKSPACES_API_BASE',
  'HYPER_ROUTINES_API_BASE', 'HYPER_RUNNERS_API_BASE', 'HYPER_INTEGRATIONS_API_BASE',
];
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'hyper-routing-'));
  vi.stubEnv('HYPER_HOME', home);
  vi.stubEnv('HYPER_AGENTS_API_KEY', 'managed-fallback');
  for (const key of staleKeys) vi.stubEnv(key, 'https://stale-env.example/wrong');
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  // Only the transport is mocked: use real CLI construction, commands and SDK methods.
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('unexpected live fetch'); }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

describe('CLI single-base request routing', () => {
  it.each([
    { envBase: 'https://api.dev.hypercli.com', fileBase: '', envKey: 'canonical-env', fileKey: '', base: 'https://api.dev.hypercli.com', key: 'canonical-env' },
    { envBase: '', fileBase: 'https://api.dev.hypercli.com', envKey: '', fileKey: 'canonical-file', base: 'https://api.dev.hypercli.com', key: 'canonical-file' },
    { envBase: 'https://env.example/prefix', fileBase: 'https://file.example/prefix', envKey: 'canonical-env', fileKey: 'canonical-file', base: 'https://env.example/prefix', key: 'canonical-env' },
    { envBase: '', fileBase: 'https://file.example/prefix', envKey: '', fileKey: 'canonical-file', base: 'https://file.example/prefix', key: 'canonical-file' },
    { envBase: '', fileBase: '', envKey: '', fileKey: '', base: 'https://api.hypercli.com', key: 'managed-fallback' },
    { envBase: 'https://customer.example', fileBase: '', envKey: '', fileKey: '', base: 'https://customer.example', key: 'managed-fallback' },
  ])('env=$envBase file=$fileBase sends all namespaces to $base with $key', async (testCase) => {
    vi.stubEnv('HYPER_API_BASE', testCase.envBase);
    vi.stubEnv('HYPER_API_KEY', testCase.envKey);
    writeFileSync(join(home, 'config'), [
      `export HYPER_API_KEY='${testCase.fileKey}'`,
      `export HYPER_API_BASE="${testCase.fileBase}"`,
      ...staleKeys.map((key) => `${key}=https://stale-file.example/wrong`),
    ].join('\n'));
    applyCliConfigFile();

    const responses: Record<string, unknown> = {
      '/api/auth/me': { user_id: 'synthetic-user', capabilities: [], tags: [] },
      '/agents/subscriptions/summary': {},
      '/agents/deployments/auth/me': {},
      '/api/jobs': [],
      '/api/renders': [],
      '/api/files/synthetic-file': { file_id: 'synthetic-file' },
      '/workspaces': [],
      '/routines': [],
      '/agents/runners': [],
      '/integrations/providers': { providers: [] },
    };
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push(url);
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${testCase.key}`);
      const path = url.slice(testCase.base.length);
      expect(url.startsWith(testCase.base)).toBe(true);
      if (path === '/agents/voice/tts') {
        return new Response(new Uint8Array([1, 2]), { headers: { 'Content-Type': 'audio/mpeg' } });
      }
      if (!(path in responses)) throw new Error(`unexpected request: ${url}`);
      return new Response(JSON.stringify(responses[path]), { headers: { 'Content-Type': 'application/json' } });
    }));

    const args = ['me', '--json'];
    const top = parseUniversal(args);
    const ctx = { format: top.format, output: createOutput(top.format), client: lazyClient() };
    await runMe(ctx, args.slice(1));
    const client = await ctx.client();
    await client.jobs.list();
    await client.renders.list();
    await client.files.get('synthetic-file');
    await client.workspaces.list();
    await client.routines.list();
    await client.runners.list();
    await client.integrations.listProviders();
    await client.voice.tts({ text: 'offline routing test' });

    expect(requests).toEqual([
      ...Object.keys(responses), '/agents/voice/tts',
    ].map((path) => `${testCase.base}${path}`));
  });

  it.each([
    ['--dev', 'me'], ['me', '--dev'], ['me', '--prod'],
    ['agents', 'ls', '--dev'], ['flow', 'create', 'text-to-image', '--prod'],
    ['voice', 'tts', 'hello', '--dev'], ['--prod'], ['--help', '--dev'],
    ['--version', '--prod'],
  ])('rejects public environment flags before any request: %j', (...args) => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../dist/index.js', import.meta.url)), ...args], {
      env: { ...process.env, HYPER_HOME: home, HYPER_API_KEY: '', HYPER_AGENTS_API_KEY: '' },
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('HYPER_API_BASE');
    expect(result.stdout).toBe('');
  });

  it('does not advertise environment flags in public help', () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../dist/index.js', import.meta.url)), '--help'], {
      env: { ...process.env, HYPER_HOME: home }, encoding: 'utf8', timeout: 10000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toMatch(/--(?:dev|prod)\b/);
  });
});
