import { describe, expect, it } from 'vitest';
import { HyperCLI } from '../src/client.js';
import {
  defaultAcpProxyWsUrl,
  defaultAgentsWsUrl,
  defaultHyperAcpWsUrl,
  DEFAULT_AGENTS_API_BASE_URL,
  normalizeAgentsWsUrl,
  resolveAgentsApiBase,
} from '../src/agent-urls.js';

describe('explicit transport URLs', () => {
  it.each([
    'wss://transport.example/custom/bridge',
    'wss://transport.example/custom/bridge?token=synthetic&route=worker',
    'ws://127.0.0.1:8787/custom/socket/',
  ])('preserves %s verbatim', (agentsWsUrl) => {
    const client = new HyperCLI({
      apiKey: 'synthetic-key', apiUrl: 'https://inference.example',
      agentsApiBaseUrl: 'https://control.example/agents', agentsWsUrl,
    });
    expect((client.deployments as unknown as { agentsWsUrl: string }).agentsWsUrl).toBe(agentsWsUrl);
  });
});

// 21-case parity matrix against py-sdk `_normalize_agents_api_base`
// (hypercli/config.py); expected values were captured from the py reference
// implementation and must not drift.
describe('resolveAgentsApiBase parity with py-sdk', () => {
  it.each([
    // empty / blank input falls back to the prod default
    ['', 'https://api.hypercli.com/agents'],
    ['   ', 'https://api.hypercli.com/agents'],
    // a trailing /agents path is kept verbatim (with slashes collapsed)
    ['https://api.hypercli.com/agents', 'https://api.hypercli.com/agents'],
    ['https://api.hypercli.com/agents/', 'https://api.hypercli.com/agents'],
    ['https://custom.example.com/agents', 'https://custom.example.com/agents'],
    // a trailing /api path is rewritten to /agents, with agents alias hosts pinned
    ['https://api.agents.hypercli.com/api', 'https://api.hypercli.com/agents'],
    ['https://api.agents.dev.hypercli.com/api', 'https://api.dev.hypercli.com/agents'],
    ['https://tenant.example.com/api', 'https://tenant.example.com/agents'],
    ['https://tenant.example.com/api/', 'https://tenant.example.com/agents'],
    // bare prod alias hosts map to the prod default
    ['https://api.hypercli.com', 'https://api.hypercli.com/agents'],
    ['https://api.hyperclaw.app', 'https://api.hypercli.com/agents'],
    ['https://api.agents.hypercli.com', 'https://api.hypercli.com/agents'],
    // bare dev alias hosts map to the dev default
    ['https://api.dev.hypercli.com', 'https://api.dev.hypercli.com/agents'],
    ['https://api.agents.dev.hypercli.com', 'https://api.dev.hypercli.com/agents'],
    ['https://api.dev.hyperclaw.app', 'https://api.dev.hypercli.com/agents'],
    ['https://dev-api.hyperclaw.app', 'https://api.dev.hypercli.com/agents'],
    // unknown subdomains of known zones stay custom
    ['https://gateway.hypercli.com', 'https://gateway.hypercli.com/agents'],
    // custom hosts get /agents appended; prefix paths are preserved
    ['http://127.0.0.1:8787', 'http://127.0.0.1:8787/agents'],
    ['http://127.0.0.1:8787/', 'http://127.0.0.1:8787/agents'],
    ['https://staging.internal/v2', 'https://staging.internal/v2/agents'],
    // scheme-less input parses under an implied https://; known hosts still map,
    // custom hosts echo scheme-less like py
    ['api.hypercli.com', 'https://api.hypercli.com/agents'],
  ])('%j -> %s', (input, expected) => {
    expect(resolveAgentsApiBase(input)).toBe(expected);
  });
});

// The two cases the shared normalize hardens beyond the py matrix.
describe('resolveAgentsApiBase shared-normalize hardening', () => {
  it('lowercases the host and strips default ports', () => {
    expect(resolveAgentsApiBase('HTTPS://API.HYPERCLI.COM:443')).toBe(DEFAULT_AGENTS_API_BASE_URL);
    expect(resolveAgentsApiBase('https://api.hypercli.com:443')).toBe(DEFAULT_AGENTS_API_BASE_URL);
    expect(resolveAgentsApiBase('HTTP://Tenant.Example.COM:80/base/')).toBe('http://tenant.example.com/base/agents');
    expect(defaultAgentsWsUrl('HTTP://Tenant.Example.COM:80/base/')).toBe('ws://tenant.example.com/base/ws');
  });

  it('tolerates runs of trailing slashes', () => {
    expect(resolveAgentsApiBase('https://api.hypercli.com//')).toBe(DEFAULT_AGENTS_API_BASE_URL);
    expect(resolveAgentsApiBase('https://api.hypercli.com/agents//')).toBe(DEFAULT_AGENTS_API_BASE_URL);
    expect(resolveAgentsApiBase('http://127.0.0.1:8787//')).toBe('http://127.0.0.1:8787/agents');
    expect(resolveAgentsApiBase('https://custom.example.com/agents//')).toBe('https://custom.example.com/agents');
  });
});

describe('defaultAgentsWsUrl parity with py-sdk', () => {
  it.each([
    ['', 'wss://api.agents.hypercli.com/ws'],
    ['https://api.hypercli.com', 'wss://api.agents.hypercli.com/ws'],
    ['https://api.hyperclaw.app', 'wss://api.agents.hypercli.com/ws'],
    ['https://custom.example.com/agents', 'wss://custom.example.com/ws'],
    ['https://api.dev.hypercli.com', 'wss://api.agents.dev.hypercli.com/ws'],
    ['https://dev-api.hyperclaw.app', 'wss://api.agents.dev.hypercli.com/ws'],
    ['http://127.0.0.1:8787', 'ws://127.0.0.1:8787/ws'],
    ['https://staging.internal/v2', 'wss://staging.internal/v2/ws'],
  ])('%j -> %s', (input, expected) => {
    expect(defaultAgentsWsUrl(input)).toBe(expected);
  });
});

describe('agents ACP ws urls parity with py-sdk', () => {
  it('maps alias hosts to the fixed ACP endpoints', () => {
    expect(defaultHyperAcpWsUrl('https://api.hypercli.com')).toBe('wss://api.agents.hypercli.com/ws');
    expect(defaultHyperAcpWsUrl('https://api.dev.hypercli.com')).toBe('wss://api.agents.dev.hypercli.com/ws');
    expect(defaultAcpProxyWsUrl('https://api.hypercli.com')).toBe('wss://api.agents.hypercli.com/ws/acp');
    expect(defaultAcpProxyWsUrl('https://api.dev.hypercli.com')).toBe('wss://api.agents.dev.hypercli.com/ws/acp');
  });

  it('derives custom tunnels next to the agents prefix', () => {
    expect(defaultHyperAcpWsUrl('http://127.0.0.1:18080/agents')).toBe('ws://127.0.0.1:18080/ws');
    expect(defaultAcpProxyWsUrl('http://127.0.0.1:18080/agents')).toBe('ws://127.0.0.1:18080/ws/acp');
    expect(defaultAcpProxyWsUrl('https://staging.internal/v2')).toBe('wss://staging.internal/v2/ws/acp');
  });

  it('keeps the proxy URL beside the hyper-acp tunnel on custom hosts', () => {
    const tunnel = defaultHyperAcpWsUrl('http://127.0.0.1:8787');
    expect(tunnel.endsWith('/ws')).toBe(true);
    expect(defaultAcpProxyWsUrl('http://127.0.0.1:8787')).toBe(`${tunnel.slice(0, -'/ws'.length)}/ws/acp`);
  });
});

describe('normalizeAgentsWsUrl', () => {
  it('swaps schemes and appends /ws exactly once', () => {
    expect(normalizeAgentsWsUrl('https://example.com/agents')).toBe('wss://example.com/agents/ws');
    expect(normalizeAgentsWsUrl('http://example.com')).toBe('ws://example.com/ws');
    expect(normalizeAgentsWsUrl('wss://example.com/ws')).toBe('wss://example.com/ws');
    expect(normalizeAgentsWsUrl('')).toBe('');
  });
});
