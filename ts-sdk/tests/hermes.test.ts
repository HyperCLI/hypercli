import { describe, expect, it, vi } from 'vitest';
import { APIError } from '../src/errors.js';
import {
  DEFAULT_AGENT_RUNTIME_SCOPES,
  DEFAULT_HERMES_AGENT_IMAGE,
  HermesAgent,
  Deployments,
  buildAgentConfig,
} from '../src/agents.js';
import { HermesApiClient } from '../src/hermes/gateway.js';
import type { HTTPClient } from '../src/http.js';

function deployment(runtime = 'hermes-agent') {
  return {
    id: 'agent-hermes',
    user_id: 'user-1',
    state: 'STARTING',
    runtime,
    hostname: 'hermes-agent.example.test',
    routes: { hermes: { port: 8642, auth: false, prefix: '' } },
  };
}

describe('Hermes deployment lifecycle', () => {
  it('creates a first-class Hermes agent with isolated launch defaults', async () => {
    const post = vi.fn().mockResolvedValue(deployment());
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    const agent = await deployments.createHermesAgent({ name: 'Hermes' });
    const body = post.mock.calls[0][1] as {
      runtime: string;
      image: string;
      sync_root: string;
      sync_exclude: string[];
      sync_uid: number;
      sync_gid: number;
      routes: Record<string, Record<string, unknown>>;
      runtime_scopes: string[];
      env?: Record<string, string>;
      secrets: Record<string, string>;
    };

    expect(post.mock.calls[0][0]).toBe('/deployments');
    expect(body.runtime).toBe('hermes-agent');
    expect(body.image).toBe(DEFAULT_HERMES_AGENT_IMAGE);
    expect(body.sync_root).toBe('/home/hermes');
    expect(body.sync_exclude).toEqual(['shared/**']);
    expect(body).not.toHaveProperty('sync_enabled');
    expect(body.sync_uid).toBe(10000);
    expect(body.sync_gid).toBe(10000);
    expect(body.routes).toEqual({ hermes: { port: 8642, auth: false, prefix: '' } });
    expect(body.runtime_scopes).toEqual(DEFAULT_AGENT_RUNTIME_SCOPES);
    expect(body.env).toBeUndefined();
    expect(body.secrets.API_SERVER_KEY).toMatch(/^[0-9a-f]{64}$/);
    expect(agent).toBeInstanceOf(HermesAgent);
    expect(agent.apiServerKey).toBe(body.secrets.API_SERVER_KEY);
    expect(agent.launchConfig).toBeNull();
    expect(agent.apiUrl).toBe('https://hermes-agent.example.test');
    expect(agent.openaiBaseUrl).toBe('https://hermes-agent.example.test/v1');
    expect(agent.api).toBeInstanceOf(HermesApiClient);
  });

  it('maps corsOrigins onto API_SERVER_CORS_ORIGINS env, merging any env value', async () => {
    const post = vi.fn().mockResolvedValue(deployment());
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    await deployments.createHermesAgent({
      name: 'Hermes',
      env: { API_SERVER_CORS_ORIGINS: 'https://claw.hypercli.com' },
      corsOrigins: ['http://127.0.0.1:4003', 'https://claw.hypercli.com'],
    });

    const body = post.mock.calls[0][1] as { env: Record<string, string>; cors: { allowed_origins: string[] } };
    expect(body.env.API_SERVER_CORS_ORIGINS).toBe('https://claw.hypercli.com,http://127.0.0.1:4003');
    expect(body.cors.allowed_origins).toEqual(['https://claw.hypercli.com', 'http://127.0.0.1:4003']);
  });

  it('does not rotate the application gateway key on start', async () => {
    const post = vi.fn().mockResolvedValue(deployment());
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );
    const id = '11111111-1111-4111-8111-111111111111';

    const launchConfig = buildAgentConfig({}, {
      routes: { hermes: { port: 8642, auth: false, prefix: 'hermes-api' } },
    }).config;
    const started = await deployments.startHermesAgent(id, { launchConfig });

    expect(started.apiServerKey).toBeNull();
    expect(post.mock.calls[0][1]).toEqual({ launch_config: launchConfig });
  });

  it('treats explicit server-key length as opaque application policy', async () => {
    const post = vi.fn().mockResolvedValue(deployment());
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );
    const explicit = 'short';

    const agent = await deployments.createHermesAgent({ apiServerKey: explicit });

    expect(post.mock.calls[0][1]).not.toHaveProperty('env');
    expect(post.mock.calls[0][1].secrets.API_SERVER_KEY).toBe(explicit);
    expect(agent.apiServerKey).toBe(explicit);
  });

  it('moves a legacy public server key to secrets and rejects conflicting inputs', async () => {
    const post = vi.fn().mockResolvedValue(deployment());
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );
    const legacy = 'legacy-hermes-api-key-32-characters-minimum';

    const agent = await deployments.createHermesAgent({
      env: { API_SERVER_KEY: legacy },
      secrets: { CUSTOM_TOKEN: 'secret' },
    });

    expect(post.mock.calls[0][1]).not.toHaveProperty('env');
    expect(post.mock.calls[0][1].secrets).toEqual({ API_SERVER_KEY: legacy, CUSTOM_TOKEN: 'secret' });
    expect(agent.apiServerKey).toBe(legacy);
    await expect(deployments.createHermesAgent({
      env: { API_SERVER_KEY: 'e'.repeat(43) },
      secrets: { API_SERVER_KEY: 's'.repeat(43) },
    })).rejects.toThrow('Hermes API_SERVER_KEY conflicts between inputs');
  });

  it('hydrates Hermes as its class without recovering a stored server key', async () => {
    const get = vi.fn().mockResolvedValue({
      ...deployment(),
      launch_config: { env: { API_SERVER_KEY: 'must-not-be-recovered' } },
    });
    const deployments = new Deployments(
      { get } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    const agent = await deployments.get('agent-hermes');

    expect(agent).toBeInstanceOf(HermesAgent);
    expect((agent as HermesAgent).apiServerKey).toBeNull();
    expect((agent as HermesAgent).launchConfig?.env).not.toHaveProperty('API_SERVER_KEY');
    expect((agent as HermesAgent).api).toBeNull();
  });

  it('retains the one-time server key across waitRunning hydration', async () => {
    const starting = HermesAgent.fromDict(deployment());
    starting.apiServerKey = 'retained-hermes-server-key-32-characters';
    const ready = HermesAgent.fromDict({ ...deployment(), state: 'RUNNING' });
    starting._deployments = {
      waitRunning: vi.fn().mockResolvedValue(ready),
    } as unknown as Deployments;

    const result = await starting.waitRunning();

    expect(result).toBe(ready);
    expect(result.apiServerKey).toBe(starting.apiServerKey);
    expect(result.api).toBeInstanceOf(HermesApiClient);
  });

  it('connects with the retained key and returns the canonical session client', async () => {
    const agent = HermesAgent.fromDict({ ...deployment(), state: 'RUNNING' });
    agent.apiServerKey = 'retained-key';
    agent._deployments = {} as unknown as Deployments;
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok', platform: 'hermes-agent', version: '0.20.0' }), { status: 200 });
      }
      return new Response(JSON.stringify({ platform: 'hermes-agent', model: 'kimi-k2.6', auth: { type: 'bearer', required: true }, features: {}, endpoints: {} }), { status: 200 });
    });

    const session = await agent.connect({ fetch: fetchMock as typeof fetch });

    expect(session.runtimeKind).toBe('hermes');
    expect(session.connected).toBe(true);
    expect(urls).toEqual([
      'https://hermes-agent.example.test/health',
      'https://hermes-agent.example.test/v1/capabilities',
    ]);
  });

  it('rehydrates API_SERVER_KEY from the deployment secret when the instance lacks it', async () => {
    const agent = HermesAgent.fromDict({ ...deployment(), state: 'RUNNING' });
    const secret = vi.fn().mockResolvedValue({
      agent_id: 'agent-hermes',
      key: 'API_SERVER_KEY',
      value: 'secret-server-key',
      launch_epoch: 3,
    });
    agent._deployments = { secret } as unknown as Deployments;
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ status: 'ok', platform: 'hermes-agent', version: '0.20.0' }),
      { status: 200 },
    ));
    // capabilities needs a richer payload; reuse ok payload for both calls.
    const session = await agent.connect({ fetch: fetchMock as typeof fetch });

    expect(secret).toHaveBeenCalledWith('agent-hermes', 'API_SERVER_KEY');
    expect(agent.apiServerKey).toBe('secret-server-key');
    expect(session.connected).toBe(true);
  });
});

describe('Hermes API client', () => {
  it('maps session and run operations and authenticates with the server key', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ run_id: 'run_1', status: 'started' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const client = new HermesApiClient('https://hermes.example.test/', {
      apiKey: 'server-secret',
      fetch: fetchMock as typeof fetch,
    });

    await client.createRun({ input: 'hello' });

    expect(client.openaiBaseUrl).toBe('https://hermes.example.test/v1');
    expect(calls[0].url).toBe('https://hermes.example.test/v1/runs');
    expect(new Headers(calls[0].init?.headers).get('Authorization')).toBe('Bearer server-secret');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ input: 'hello' });
  });

  it('preserves unknown SSE event names and non-JSON payloads', async () => {
    const fetchMock = vi.fn(async () => new Response(
      'event: future.tool.state\nid: evt-1\ndata: {"extra":true}\n\nevent: vendor.raw\ndata: opaque\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ));
    const client = new HermesApiClient('https://hermes.example.test', {
      fetch: fetchMock as typeof fetch,
    });

    const events = [];
    for await (const event of client.runEvents('run/unsafe')) events.push(event);

    expect(events).toEqual([
      { event: 'future.tool.state', id: 'evt-1', data: { extra: true }, rawData: '{"extra":true}' },
      { event: 'vendor.raw', data: 'opaque', rawData: 'opaque' },
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe('https://hermes.example.test/v1/runs/run%2Funsafe/events');
  });

  it('normalizes OpenAI error envelopes into APIError', async () => {
    const client = new HermesApiClient('https://hermes.example.test', {
      fetch: vi.fn(async () => new Response(JSON.stringify({
        error: { message: 'Session not found', type: 'invalid_request_error', code: 'session_not_found' },
      }), { status: 404, headers: { 'Content-Type': 'application/json' } })) as typeof fetch,
    });

    const request = client.getSession('missing');
    await expect(request).rejects.toBeInstanceOf(APIError);
    await expect(request).rejects.toMatchObject({ statusCode: 404, detail: 'Session not found' });
  });
});
