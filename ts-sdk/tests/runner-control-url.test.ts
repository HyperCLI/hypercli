import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_RUNNER_CONTROL_URL, defaultRunnerControlUrl, getAgentsApiBaseUrl } from '../src/index.js';
import * as browser from '../src/browser.js';

afterEach(() => vi.unstubAllEnvs());

it('composes with configured agents-base discovery without overriding the selected endpoint', () => {
  vi.stubEnv('HYPER_AGENTS_API_BASE', 'http://127.0.0.1:8765/prefix/agents');
  vi.stubEnv('HYPER_API_BASE', 'https://ignored.test');
  expect(defaultRunnerControlUrl(getAgentsApiBaseUrl())).toBe('ws://127.0.0.1:8765/prefix/ws/runners');
});

it('exports the same production and explicit runner control routes for Node and browsers', () => {
  expect(DEFAULT_RUNNER_CONTROL_URL).toBe('wss://api.agents.hypercli.com/ws/runners');
  expect(browser.DEFAULT_RUNNER_CONTROL_URL).toBe(DEFAULT_RUNNER_CONTROL_URL);
  for (const [base, expected] of [
    ['https://api.hypercli.com/agents', DEFAULT_RUNNER_CONTROL_URL],
    ['https://api.dev.hypercli.com/agents', 'wss://api.agents.dev.hypercli.com/ws/runners'],
    ['https://api.agents.hypercli.com/agents', DEFAULT_RUNNER_CONTROL_URL],
    ['http://127.0.0.1:8765/prefix/agents/', 'ws://127.0.0.1:8765/prefix/ws/runners'],
    ['https://custom.test/api', 'wss://custom.test/ws/runners'],
  ]) {
    expect(defaultRunnerControlUrl(base)).toBe(expected);
    expect(browser.defaultRunnerControlUrl(base)).toBe(expected);
  }
});
