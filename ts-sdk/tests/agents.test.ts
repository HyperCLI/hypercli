import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Agent,
  agentConfigHasDesktop,
  buildAgentConfig,
  Deployments,
  flattenLaunchConfig,
  launchConfigHasDesktop,
  OpenClawAgent,
} from '../src/agents.js';
import { HTTPClient } from '../src/http.js';

describe('Agents SDK', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adds the current browser origin to OpenClaw launch env by default', () => {
    vi.stubGlobal('location', { origin: 'https://agents.hypercli.com' });

    const { config } = buildAgentConfig({}, { gatewayToken: 'gw-test' });

    expect(config.env).toEqual({
      OPENCLAW_GATEWAY_TOKEN: 'gw-test',
      OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN: 'https://agents.hypercli.com',
    });
  });

  it('can disable the automatic browser control UI origin lock', () => {
    vi.stubGlobal('location', { origin: 'https://agents.hypercli.com' });

    const { config } = buildAgentConfig({}, { gatewayToken: 'gw-test', controlUiOriginLock: false });

    expect(config.env).toEqual({
      OPENCLAW_GATEWAY_TOKEN: 'gw-test',
    });
  });

  it('preserves explicit control UI origins when the automatic lock is disabled', () => {
    vi.stubGlobal('location', { origin: 'https://agents.hypercli.com' });

    const { config } = buildAgentConfig({}, {
      gatewayToken: 'gw-test',
      controlUiOriginLock: false,
      env: {
        OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN: 'https://console.hypercli.com',
      },
    });

    expect(config.env).toEqual({
      OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN: 'https://console.hypercli.com',
      OPENCLAW_GATEWAY_TOKEN: 'gw-test',
    });
  });

  it('hydrates tags on agent responses', async () => {
    const http = {
      get: vi.fn().mockResolvedValue({
        id: 'agent-123',
        user_id: 'user-456',
        pod_id: 'pod-789',
        pod_name: 'pod-789',
        state: 'running',
        tags: ['team=dev'],
      }),
    } as unknown as HTTPClient;

    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');
    const agent = await deployments.get('agent-123');

    expect(agent.tags).toEqual(['team=dev']);
  });

  it('hydrates only meta.ui on agent responses', async () => {
    const http = {
      get: vi.fn().mockResolvedValue({
        id: 'agent-123',
        user_id: 'user-456',
        pod_id: 'pod-789',
        pod_name: 'pod-789',
        state: 'running',
        meta: {
          ui: {
            avatar: {
              image: 'data:image/png;base64,abc',
              icon_index: 3,
            },
          },
          internal: {
            ignored: true,
          },
        },
      }),
    } as unknown as HTTPClient;

    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');
    const agent = await deployments.get('agent-123');

    expect(agent.meta).toEqual({
      ui: {
        avatar: {
          image: 'data:image/png;base64,abc',
          icon_index: 3,
        },
      },
    });
  });

  it('creates exact-agent scoped child keys', async () => {
    const http = {
      post: vi.fn().mockResolvedValue({
        key_id: 'key-123',
        api_key: 'hyper_api_scoped',
        tags: ['agent:agent-123'],
      }),
    } as unknown as HTTPClient;

    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');
    const result = await deployments.createScopedKey('agent-123', 'agent-client');

    expect(result.api_key).toBe('hyper_api_scoped');
    expect((http.post as any).mock.calls[0]).toEqual([
      '/deployments/agent-123/keys',
      { name: 'agent-client' },
    ]);
  });

  it('searches the web through the Brave proxy', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ web: { results: [{ title: 'HyperCLI', url: 'https://hypercli.com' }] } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const deployments = new Deployments(
      new HTTPClient('https://api.test.hypercli.com', 'hyper_api_test'),
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );
    const result = await deployments.webSearch('hypercli', { count: 1 });

    expect(result.web?.results?.[0]?.title).toBe('HyperCLI');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test.hypercli.com/agents/brave/res/v1/web/search?q=hypercli&count=1',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Subscription-Token': 'hyper_api_test' }),
        method: 'GET',
      }),
    );
    vi.unstubAllGlobals();
  });

  it('updates agents through the public patch surface', async () => {
    const http = {
      patch: vi.fn().mockResolvedValue({
        id: 'agent-123',
        user_id: 'user-456',
        pod_id: null,
        pod_name: null,
        state: 'stopped',
        cpu: 4,
        memory: 4,
      }),
    } as unknown as HTTPClient;

    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');
    const agent = await deployments.update('agent-123', {
      size: 'large',
      launchConfig: {
        image: 'ghcr.io/hypercli/hypercli-openclaw:custom',
        env: { FOO: 'bar' },
      },
      refreshFromLagoon: true,
    });

    expect(agent.id).toBe('agent-123');
    expect((http.patch as any).mock.calls[0]).toEqual([
      '/deployments/agent-123',
      {
        size: 'large',
        launch_config: {
          image: 'ghcr.io/hypercli/hypercli-openclaw:custom',
          env: { FOO: 'bar' },
        },
        refresh_from_lagoon: true,
      },
    ]);
  });

  it('detects desktop from explicit launch config and hydrated routes only', () => {
    expect(launchConfigHasDesktop({ env: { OPENCLAW_DESKTOP_ENABLED: '1' } })).toBe(true);
    expect(launchConfigHasDesktop({ routes: { desktop: { port: 3000, auth: true, prefix: 'screen' } } })).toBe(true);
    expect(launchConfigHasDesktop({ routes: { browser: { port: 3000, auth: true, prefix: 'desktop' } } })).toBe(true);
    expect(launchConfigHasDesktop({ ports: [{ port: 3000, auth: true }] })).toBe(true);
    expect(launchConfigHasDesktop({ image: 'ghcr.io/hypercli/hypercli-openclaw:pro-prod' })).toBe(false);
    expect(agentConfigHasDesktop({ routes: { desktop: { port: 3000, auth: true, prefix: 'desktop' } } })).toBe(true);
  });

  it('flattens launch config and exposes desktop capability on agents', () => {
    const launchConfig = {
      env: { OPENCLAW_DESKTOP_ENABLED: '0' },
      routes: { openclaw: { port: 18789, prefix: '' } },
      ports: [{ port: 3000, auth: true }],
    };

    expect(flattenLaunchConfig(launchConfig)).toMatchObject({
      'env.OPENCLAW_DESKTOP_ENABLED': '0',
      'routes.openclaw.port': 18789,
      'ports[0].port': 3000,
    });

    const agent = Agent.fromDict({
      id: 'agent-123',
      user_id: 'user-456',
      pod_id: 'pod-789',
      pod_name: 'pod-789',
      state: 'running',
      hostname: 'agent.hypercli.com',
      routes: { desktop: { port: 3000, auth: true, prefix: 'screen' } },
    });

    expect(agent.hasDesktop).toBe(true);
    expect(agent.desktopUrl).toBe('https://screen-agent.hypercli.com');
  });

  it('supports bound resize on hydrated agents', async () => {
    const http = {
      get: vi.fn().mockResolvedValue({
        id: 'agent-123',
        user_id: 'user-456',
        pod_id: null,
        pod_name: null,
        state: 'stopped',
        cpu: 2,
        memory: 2,
      }),
      patch: vi.fn().mockResolvedValue({
        id: 'agent-123',
        user_id: 'user-456',
        pod_id: null,
        pod_name: null,
        state: 'stopped',
        cpu: 4,
        memory: 4,
      }),
    } as unknown as HTTPClient;

    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');
    const agent = await deployments.get('agent-123');
    const resized = await agent.resize({ size: 'large' });

    expect(resized.cpu).toBe(4);
    expect((http.patch as any).mock.calls[0]).toEqual([
      '/deployments/agent-123',
      { size: 'large' },
    ]);
  });

  it('resolves missing gateway tokens through inferenceToken', async () => {
    const http = {
      get: vi
        .fn()
        .mockResolvedValueOnce({
          id: 'agent-123',
          user_id: 'user-456',
          pod_id: 'pod-789',
          pod_name: 'pod-789',
          state: 'running',
          hostname: 'openclaw-test.hypercli.com',
        })
        .mockResolvedValueOnce({
          agent_id: 'agent-123',
          env: {
            OPENCLAW_GATEWAY_TOKEN: 'gw-fetched',
          },
        }),
    } as unknown as HTTPClient;

    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');
    const agent = OpenClawAgent.fromDict({
      id: 'agent-123',
      user_id: 'user-456',
      pod_id: 'pod-789',
      pod_name: 'pod-789',
      state: 'running',
    });
    agent._deployments = deployments;

    const gatewayToken = await agent.resolveGatewayToken();

    expect(gatewayToken).toBe('gw-fetched');
    expect(agent.gatewayToken).toBe('gw-fetched');
    expect(agent.gatewayUrl).toBe('wss://openclaw-test.hypercli.com');
  });

  it('resolveGatewayToken backfills missing gateway url through hostname and env', async () => {
    const http = {
      get: vi
        .fn()
        .mockResolvedValueOnce({
          id: 'agent-123',
          user_id: 'user-456',
          pod_id: 'pod-789',
          pod_name: 'pod-789',
          state: 'running',
          hostname: 'openclaw-test.hypercli.com',
        })
        .mockResolvedValueOnce({
          agent_id: 'agent-123',
          env: {
            OPENCLAW_GATEWAY_TOKEN: 'gw-fetched',
          },
        }),
    } as unknown as HTTPClient;

    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');
    const agent = OpenClawAgent.fromDict({
      id: 'agent-123',
      user_id: 'user-456',
      pod_id: 'pod-789',
      pod_name: 'pod-789',
      state: 'running',
      gateway_token: 'gw-inline',
    });
    agent._deployments = deployments;

    const gatewayToken = await agent.resolveGatewayToken();

    expect(gatewayToken).toBe('gw-fetched');
    expect(agent.gatewayUrl).toBe('wss://openclaw-test.hypercli.com');
    expect(agent.gatewayToken).toBe('gw-fetched');
  });

  it('waitForGatewayContext retries until both gateway url and token are ready', async () => {
    const http = {
      get: vi
        .fn()
        .mockResolvedValueOnce({
          id: 'agent-123',
          user_id: 'user-456',
          pod_id: 'pod-789',
          pod_name: 'pod-789',
          state: 'running',
          hostname: null,
        })
        .mockResolvedValueOnce({
          agent_id: 'agent-123',
          env: {
            OPENCLAW_GATEWAY_TOKEN: 'gw-fetched',
          },
        })
        .mockResolvedValueOnce({
          id: 'agent-123',
          user_id: 'user-456',
          pod_id: 'pod-789',
          pod_name: 'pod-789',
          state: 'running',
          hostname: 'openclaw-test.hypercli.com',
        })
        .mockResolvedValueOnce({
          agent_id: 'agent-123',
          env: {
            OPENCLAW_GATEWAY_TOKEN: 'gw-fetched',
          },
        }),
    } as unknown as HTTPClient;

    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');
    const agent = OpenClawAgent.fromDict({
      id: 'agent-123',
      user_id: 'user-456',
      pod_id: 'pod-789',
      pod_name: 'pod-789',
      state: 'running',
    });
    agent._deployments = deployments;

    const context = await agent.waitForGatewayContext({ timeoutMs: 100, retryIntervalMs: 0 });

    expect(context.gateway_token).toBe('gw-fetched');
    expect(context.hostname).toBe('openclaw-test.hypercli.com');
    expect(agent.gatewayUrl).toBe('wss://openclaw-test.hypercli.com');
    expect(http.get).toHaveBeenCalledTimes(4);
  });
});
