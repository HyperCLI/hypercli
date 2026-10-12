import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_RUNNER_CONTROL_URL, defaultRunnerControlUrl, getAgentsApiBaseUrl } from '../src/index.js';
import * as browser from '../src/browser.js';
import { readFileSync } from 'node:fs';
import { getAgentsWsUrl, getAgentsWsUrlFromProductBase } from '../src/config.js';

const urlVectors: [string, string][] = JSON.parse(readFileSync(
  new URL('../../rs-sdk/tests/fixtures/runner_control_urls.json', import.meta.url), 'utf8',
));

afterEach(() => vi.unstubAllEnvs());

it('composes with configured agents-base discovery without overriding the selected endpoint', () => {
  vi.stubEnv('HYPER_AGENTS_API_BASE', 'http://127.0.0.1:8765/prefix/agents');
  vi.stubEnv('HYPER_API_BASE', 'https://ignored.test');
  expect(defaultRunnerControlUrl(getAgentsApiBaseUrl())).toBe('ws://127.0.0.1:8765/prefix/ws/runners');
});

it.each(urlVectors)('exports matching Node, browser and Agents routes for %s', (base, expected) => {
  expect(DEFAULT_RUNNER_CONTROL_URL).toBe('wss://api.agents.hypercli.com/ws/runners');
  expect(browser.DEFAULT_RUNNER_CONTROL_URL).toBe(DEFAULT_RUNNER_CONTROL_URL);
  expect(defaultRunnerControlUrl(base)).toBe(expected);
  expect(browser.defaultRunnerControlUrl(base)).toBe(expected);
  const wsUrl = expected.replace(/\/runners$/, '');
  expect(getAgentsWsUrlFromProductBase(base)).toBe(wsUrl);
  vi.stubEnv('HYPER_AGENTS_API_BASE', base);
  expect(getAgentsWsUrl()).toBe(wsUrl);
});
