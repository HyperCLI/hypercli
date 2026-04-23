import { describe, expect, it, vi } from 'vitest';
import { Deployments, OpenClawAgent } from '../src/agents.js';
import type { HTTPClient } from '../src/http.js';

describe('Agents SDK', () => {
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
    const agent = await deployments.update('agent-123', { size: 'large', refreshFromLagoon: true });

    expect(agent.id).toBe('agent-123');
    expect((http.patch as any).mock.calls[0]).toEqual([
      '/deployments/agent-123',
      { size: 'large', refresh_from_lagoon: true },
    ]);
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
