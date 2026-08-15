import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_RUNTIME_INACTIVE_STATES,
  AGENT_TRANSITIONAL_STATES,
  Agent,
  CANONICAL_AGENT_STATES,
  agentConfigHasDesktop,
  buildAgentConfig,
  buildBrowserDesktopUrl,
  type DeploymentEvent,
  Deployments,
  flattenLaunchConfig,
  launchConfigHasDesktop,
  OpenClawAgent,
  OpenClawGatewayConnectionManager,
  OpenClawProAgent,
  attachSlackRelayAgent,
  getSlackInstallStatus,
  isAgentRuntimeInactiveState,
  isAgentTransitionalState,
  listSlackDirectoryConversations,
  listSlackDirectoryUsers,
  startSlackOAuth,
} from '../src/agents.js';
import { HyperCLI } from '../src/client.js';
import { APIError } from '../src/errors.js';
import { HTTPClient } from '../src/http.js';

describe('Agents SDK', () => {
  const installReadySubscription = (deployments: Deployments) => {
    vi.spyOn(deployments, 'subscribe').mockImplementation(async (_handler, options = {}) => {
      await options.onReady?.();
      if (options.signal?.aborted) return;
      await new Promise<void>((resolve) => {
        options.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
    });
  };

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('parses requested size and rejects unknown wire sizes', () => {
    expect(Agent.fromDict({ id: 'agent-1', state: 'RUNNING', requested_size: 'large' }).requestedSize)
      .toBe('large');
    expect(() => Agent.fromDict({ id: 'agent-1', state: 'RUNNING', requested_size: 'huge' }))
      .toThrow('small, medium, large');
  });

  it('keeps generic launch environment and secrets application-name blind', () => {
    const { config } = buildAgentConfig({}, {
      env: { OPENCLAW_GATEWAY_TOKEN: 'opaque-env' },
      secrets: { API_SERVER_KEY: 'opaque-secret' },
    });
    expect(config.env).toEqual({ OPENCLAW_GATEWAY_TOKEN: 'opaque-env' });
    expect(config.secrets).toEqual({ API_SERVER_KEY: 'opaque-secret' });
  });

  it('does not generate application secrets and rejects env/Secret collisions', () => {
    const { config } = buildAgentConfig();
    expect(config.secrets).toEqual({});
    expect(() => buildAgentConfig({}, {
      env: { TOKEN: 'plain' },
      secrets: { TOKEN: 'secret' },
    })).toThrow(/both env and secrets/);
  });

  it('preserves an explicit false restart setting and defaults an unspecified one to false', () => {
    const omitted = buildAgentConfig().config;
    const disabled = buildAgentConfig({}, {
      restart: false,
    }).config;

    expect(omitted.restart).toBe(false);
    expect(disabled.restart).toBe(false);
  });

  it('preserves sync root and mutually exclusive sync policy fields', () => {
    const omitted = buildAgentConfig().config;
    const includeAll = buildAgentConfig({}, {
      syncInclude: null,
    }).config;
    const excludeAll = buildAgentConfig({}, {
      syncExclude: null,
    }).config;
    const syncNothing = buildAgentConfig({}, {
      syncInclude: [],
    }).config;
    const includeWins = buildAgentConfig({}, {
      syncRoot: '/workspace',
      syncInclude: ['src'],
      syncExclude: ['tmp'],
    }).config;

    expect(omitted).not.toHaveProperty('sync_include');
    expect(omitted).not.toHaveProperty('sync_exclude');
    expect(omitted).not.toHaveProperty('sync_enabled');
    expect(includeAll.sync_include).toBeNull();
    expect(excludeAll.sync_exclude).toBeNull();
    expect(syncNothing.sync_include).toEqual([]);
    expect(includeWins.sync_root).toBe('/workspace');
    expect(includeWins.sync_include).toEqual(['src']);
    expect(includeWins).not.toHaveProperty('sync_exclude');
  });

  it('serializes runtime scopes as a top-level launch field', () => {
    const { config } = buildAgentConfig({}, {
      runtimeScopes: ['models:*', 'workspaces:*'],
    });

    expect(config.runtime_scopes).toEqual(['models:*', 'workspaces:*']);
  });

  it('requires exact registry username/password credentials', () => {
    expect(buildAgentConfig({}, {
      registryAuth: { username: ' user ', password: 'secret' },
    }).config.registry_auth).toEqual({ username: 'user', password: 'secret' });
    expect(() => buildAgentConfig({}, {
      registryAuth: { username: '', password: 'secret' },
    })).toThrow(/username must be non-empty/);
    expect(() => buildAgentConfig({}, {
      registryAuth: { username: 'user', password: '', token: 'legacy' } as any,
    })).toThrow(/exactly username and password/);
  });

  it('rejects partial START configs and preserves explicit empty env and secrets', async () => {
    const post = vi.fn().mockResolvedValue({ id: 'agent-123', state: 'STARTING' });
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );
    await expect(deployments.start('agent-123', {
      launchConfig: {} as any,
    })).rejects.toThrow(/launchConfig is incomplete/);

    const launchConfig = buildAgentConfig().config;
    await deployments.start('agent-123', { launchConfig });
    expect(post).toHaveBeenCalledWith(
      '/deployments/agent-123/start',
      { launch_config: expect.objectContaining({ env: {}, secrets: {} }) },
      { retries: 1 },
    );
  });

  it('hydrates tags on agent responses', async () => {
    const http = {
      get: vi.fn().mockResolvedValue({
        id: 'agent-123',
        user_id: 'user-456',
        state: 'running',
        tags: ['team=dev'],
      }),
    } as unknown as HTTPClient;

    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');
    const agent = await deployments.get('agent-123');

    expect(agent.tags).toEqual(['team=dev']);
    expect(agent.managed).toBeNull();
  });

  it('hydrates the public launch epoch and future public states', async () => {
    const http = {
      get: vi.fn().mockResolvedValue({
        id: 'agent-123',
        state: 'FUTURE_STATE',
        launch_epoch: 3,
        cluster_id: 'cluster-current',
        archived_at: '2026-08-09T12:00:00Z',
      }),
    } as unknown as HTTPClient;
    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');

    const agent = await deployments.get('agent-123');

    expect(agent.state).toBe('FUTURE_STATE');
    expect(agent.launchEpoch).toBe(3);
    expect(agent.clusterId).toBe('cluster-current');
    expect(agent.archivedAt?.toISOString()).toBe('2026-08-09T12:00:00.000Z');
  });

  it('authenticates before the REST snapshot and delivers persisted transitions', async () => {
    const get = vi.fn().mockResolvedValue({ items: [] });
    const post = vi.fn().mockResolvedValue({
      token: 'event-token',
      ws_url: 'wss://events.test/ws/deployments',
    });
    const http = { get, post } as unknown as HTTPClient;
    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');
    const controller = new AbortController();
    const received: DeploymentEvent[] = [];

    class FakeWebSocket extends EventTarget {
      static OPEN = 1;
      readyState = FakeWebSocket.OPEN;
      constructor(public readonly url: string) {
        super();
        queueMicrotask(() => this.dispatchEvent(new Event('open')));
      }
      send(payload: string) {
        expect(JSON.parse(payload)).toEqual({ type: 'auth', token: 'event-token' });
        for (const frame of [
          { type: 'ready' },
          {
            type: 'deployment.transition',
            agent_id: 'agent-123',
            state: 'ARCHIVING',
            reason: 'archive_request',
            error: null,
            message: 'Agent archive is being finalized',
          },
        ]) {
          queueMicrotask(() => {
            const event = new Event('message');
            Object.defineProperty(event, 'data', { value: JSON.stringify(frame) });
            this.dispatchEvent(event);
          });
        }
      }
      close() {
        this.dispatchEvent(new Event('close'));
      }
    }
    vi.stubGlobal('WebSocket', FakeWebSocket);

    await deployments.subscribe((event) => {
      received.push(event);
      if (event.type === 'deployment.transition') controller.abort();
    }, {
      signal: controller.signal,
      onReady: () => deployments.list({ signal: controller.signal }),
    });

    expect(get).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      '/deployments/events/token',
      undefined,
      { signal: controller.signal },
    );
    expect(received.map((event) => event.type)).toEqual(['deployment.transition']);
    expect(received[0]).toMatchObject({
      agent_id: 'agent-123',
      state: 'ARCHIVING',
      reason: 'archive_request',
      error: null,
      message: 'Agent archive is being finalized',
    });
  });

  it('passes cancellation through event-token admission', async () => {
    const controller = new AbortController();
    const post = vi.fn((_path: string, _body: unknown, requestOptions: { signal: AbortSignal }) => (
      new Promise((_resolve, reject) => {
        requestOptions.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      })
    ));
    const http = { post } as unknown as HTTPClient;
    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');

    const subscription = deployments.subscribe(() => undefined, { signal: controller.signal });
    await Promise.resolve();
    controller.abort();

    await expect(subscription).resolves.toBeUndefined();
    expect(post.mock.calls[0]?.[2]?.signal).toBe(controller.signal);
  });

  it.each([401, 403])('treats deployment event token HTTP %i as terminal', async (statusCode) => {
    const get = vi.fn().mockResolvedValue({ items: [] });
    const failure = new APIError(statusCode, 'Deployment event access denied');
    const post = vi.fn().mockRejectedValue(failure);
    const deployments = new Deployments(
      { get, post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    await expect(deployments.subscribe(() => undefined)).rejects.toBe(failure);

    expect(get).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      '/deployments/events/token',
      undefined,
      { signal: undefined },
    );
  });

  it('backs off an unexpected clean close before reconnecting and resyncing', async () => {
    vi.useFakeTimers();
    const get = vi.fn().mockResolvedValue({ items: [] });
    const post = vi.fn().mockResolvedValue({
      token: 'event-token',
      ws_url: 'wss://events.test/ws/deployments',
    });
    const deployments = new Deployments(
      { get, post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );
    const controller = new AbortController();
    let sockets = 0;
    let resyncs = 0;

    class ClosingWebSocket extends EventTarget {
      static OPEN = 1;
      readyState = ClosingWebSocket.OPEN;
      readonly ordinal = ++sockets;
      private closed = false;
      constructor(public readonly url: string) {
        super();
        queueMicrotask(() => this.dispatchEvent(new Event('open')));
      }
      send() {
        queueMicrotask(() => {
          const event = new Event('message');
          Object.defineProperty(event, 'data', {
            value: JSON.stringify({ type: 'ready' }),
          });
          this.dispatchEvent(event);
        });
        if (this.ordinal === 1) queueMicrotask(() => this.close());
      }
      close() {
        if (this.closed) return;
        this.closed = true;
        this.dispatchEvent(new Event('close'));
      }
    }
    vi.stubGlobal('WebSocket', ClosingWebSocket);

    const subscription = deployments.subscribe(() => undefined, {
      signal: controller.signal,
      onReady: async () => {
        await deployments.list({ signal: controller.signal });
        resyncs += 1;
        if (resyncs === 2) controller.abort();
      },
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(post).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(249);
    expect(post).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await subscription;

    expect(post).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledTimes(2);
    expect(resyncs).toBe(2);
  });

  it('retains exponential backoff across repeated ready-close event streams', async () => {
    vi.useFakeTimers();
    const post = vi.fn().mockResolvedValue({
      token: 'event-token',
      ws_url: 'wss://events.test/ws/deployments',
    });
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );
    const controller = new AbortController();
    let readyCount = 0;

    class ReadyClosingWebSocket extends EventTarget {
      static OPEN = 1;
      readyState = ReadyClosingWebSocket.OPEN;
      private closed = false;
      constructor(public readonly url: string) {
        super();
        queueMicrotask(() => this.dispatchEvent(new Event('open')));
      }
      send() {
        queueMicrotask(() => {
          const event = new Event('message');
          Object.defineProperty(event, 'data', { value: JSON.stringify({ type: 'ready' }) });
          this.dispatchEvent(event);
          queueMicrotask(() => this.close());
        });
      }
      close() {
        if (this.closed) return;
        this.closed = true;
        this.dispatchEvent(new Event('close'));
      }
    }
    vi.stubGlobal('WebSocket', ReadyClosingWebSocket);

    const subscription = deployments.subscribe(() => undefined, {
      signal: controller.signal,
      onReady: () => {
        readyCount += 1;
        if (readyCount === 4) controller.abort();
      },
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(post).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(249);
    expect(post).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(post).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(499);
    expect(post).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(post).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(999);
    expect(post).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    await subscription;

    expect(post).toHaveBeenCalledTimes(4);
    expect(readyCount).toBe(4);
  });

  it('resets deployment event backoff only after a stable ready stream', async () => {
    vi.useFakeTimers();
    const post = vi.fn().mockResolvedValue({
      token: 'event-token',
      ws_url: 'wss://events.test/ws/deployments',
    });
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );
    const controller = new AbortController();
    let sockets = 0;

    class StabilizingWebSocket extends EventTarget {
      static OPEN = 1;
      readyState = StabilizingWebSocket.OPEN;
      readonly ordinal = ++sockets;
      private closed = false;
      constructor(public readonly url: string) {
        super();
        queueMicrotask(() => this.dispatchEvent(new Event('open')));
      }
      send() {
        queueMicrotask(() => {
          const event = new Event('message');
          Object.defineProperty(event, 'data', { value: JSON.stringify({ type: 'ready' }) });
          this.dispatchEvent(event);
          if (this.ordinal <= 2) queueMicrotask(() => this.close());
          else if (this.ordinal === 3) setTimeout(() => this.close(), 10_000);
        });
      }
      close() {
        if (this.closed) return;
        this.closed = true;
        this.dispatchEvent(new Event('close'));
      }
    }
    vi.stubGlobal('WebSocket', StabilizingWebSocket);

    const subscription = deployments.subscribe(() => undefined, {
      signal: controller.signal,
      onReady: () => {
        if (sockets === 4) controller.abort();
      },
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(500);
    expect(post).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(post).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(249);
    expect(post).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    await subscription;

    expect(post).toHaveBeenCalledTimes(4);
  });

  it('passes typed list filters to deployments list', async () => {
    const http = {
      get: vi.fn().mockResolvedValue({ items: [] }),
    } as unknown as HTTPClient;

    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');
    await deployments.list({
      state: 'RUNNING',
      handle: 'coder',
      name: 'coder-agent',
      query: 'code',
      includeDeleted: true,
    });

    expect(http.get).toHaveBeenCalledWith('/deployments', {
      state: 'RUNNING',
      handle: 'coder',
      name: 'coder-agent',
      q: 'code',
      include_deleted: 'true',
    }, undefined);
  });

  it('preserves the deployment capacity envelope', async () => {
    const http = {
      get: vi.fn().mockResolvedValue({
        items: [{ id: 'agent-123', state: 'RUNNING' }],
        total_agents: 1,
        max_agents_per_account: 10,
        running_agents: 1,
        slots: { large: { granted: 3, used: 1, available: 2 } },
        agent_slots: [{
          id: 'slot-1',
          entitlement_id: 'ent-1',
          plan_id: 'pro',
          size: 'large',
          agent_id: 'agent-123',
          occupied: true,
          expires_at: '2026-09-01T00:00:00Z',
        }],
        pooled_tpd: 100_000_000,
      }),
    } as unknown as HTTPClient;

    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');
    const capacity = await deployments.listWithCapacity();

    expect(capacity.items[0]?.id).toBe('agent-123');
    expect(capacity.maxAgentsPerAccount).toBe(10);
    expect(capacity.runningAgents).toBe(1);
    expect(capacity.slots.large?.available).toBe(2);
    expect(capacity.agentSlots[0]?.planId).toBe('pro');
    expect(capacity.agentSlots[0]?.expiresAt?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(capacity.pooledTpd).toBe(100_000_000);
  });

  it('excludes archive and delete states from the capacity fallback', async () => {
    const http = {
      get: vi.fn().mockResolvedValue({
        items: [
          { id: 'running', state: 'RUNNING' },
          { id: 'archiving', state: 'ARCHIVING' },
          { id: 'archived', state: 'ARCHIVED' },
          { id: 'deleted', state: 'DELETED' },
        ],
      }),
    } as unknown as HTTPClient;
    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');

    const capacity = await deployments.listWithCapacity();

    expect(capacity.runningAgents).toBe(1);
  });

  it('preserves the transitional stopping state returned by stop', async () => {
    const http = {
      get: vi.fn().mockResolvedValue({
        id: 'agent-123',
        user_id: 'user-456',
        state: 'running',
      }),
      post: vi.fn().mockResolvedValue({
        id: 'agent-123',
        user_id: 'user-456',
        state: 'stopping',
      }),
    } as unknown as HTTPClient;

    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');
    const agent = await deployments.stop('agent-123');

    expect(agent.state).toBe('stopping');
    expect(http.post).toHaveBeenCalledWith(
      '/deployments/agent-123/stop',
      undefined,
      { retries: 1 },
    );
  });

  it('posts a bodyless restore and preserves RESTORING', async () => {
    const post = vi.fn().mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      user_id: 'user-456',
      state: 'RESTORING',
    });
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    const restored = await deployments.restore('11111111-1111-4111-8111-111111111111');

    expect(restored.state).toBe('RESTORING');
    expect(post).toHaveBeenCalledWith(
      '/deployments/11111111-1111-4111-8111-111111111111/restore',
      undefined,
      { retries: 1 },
    );
  });

  it('sets and deletes one URL-encoded launch env key without replacing the env map', async () => {
    const setResult = { agent_id: 'agent-123', key: 'OPENCLAW/ORIGIN', present: true, launch_epoch: 7 };
    const deleteResult = { ...setResult, present: false };
    const patch = vi.fn().mockResolvedValue(setResult);
    const deleteRequest = vi.fn().mockResolvedValue(deleteResult);
    const deployments = new Deployments(
      { patch, delete: deleteRequest } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    await expect(deployments.setEnv('agent-123', 'OPENCLAW/ORIGIN', 'https://agents.hypercli.com'))
      .resolves.toEqual(setResult);
    await expect(deployments.deleteEnv('agent-123', 'OPENCLAW/ORIGIN'))
      .resolves.toEqual(deleteResult);

    expect(patch).toHaveBeenCalledWith(
      '/deployments/agent-123/env/OPENCLAW%2FORIGIN',
      { value: 'https://agents.hypercli.com' },
    );
    expect(patch.mock.calls[0]?.[1]).toEqual({ value: 'https://agents.hypercli.com' });
    expect(deleteRequest).toHaveBeenCalledWith('/deployments/agent-123/env/OPENCLAW%2FORIGIN');
  });

  it('exposes one-key env mutation helpers on bound agents', async () => {
    const result = { agent_id: 'agent-123', key: 'KEY', present: true, launch_epoch: 8 };
    const patch = vi.fn().mockResolvedValue(result);
    const deleteRequest = vi.fn().mockResolvedValue({ ...result, present: false });
    const deployments = new Deployments(
      {
        get: vi.fn().mockResolvedValue({
          id: 'agent-123',
          user_id: 'user-456',
          state: 'STOPPED',
        }),
        patch,
        delete: deleteRequest,
      } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );
    const agent = await deployments.get('agent-123');

    await agent.setEnv('KEY', 'value');
    await agent.deleteEnv('KEY');

    expect(patch).toHaveBeenCalledWith('/deployments/agent-123/env/KEY', { value: 'value' });
    expect(deleteRequest).toHaveBeenCalledWith('/deployments/agent-123/env/KEY');
  });

  it('sets and deletes one URL-encoded secret without returning its value', async () => {
    const result = { agent_id: 'agent-123', key: 'OPENCLAW/TOKEN', present: true, launch_epoch: 9 };
    const patch = vi.fn().mockResolvedValue(result);
    const deleteRequest = vi.fn().mockResolvedValue({ ...result, present: false });
    const deployments = new Deployments(
      { patch, delete: deleteRequest } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    const setResult = await deployments.setSecret('agent-123', 'OPENCLAW/TOKEN', 'top-secret');
    const deleteResult = await deployments.deleteSecret('agent-123', 'OPENCLAW/TOKEN');

    expect(patch).toHaveBeenCalledWith(
      '/deployments/agent-123/secrets/OPENCLAW%2FTOKEN',
      { value: 'top-secret' },
    );
    expect(deleteRequest).toHaveBeenCalledWith('/deployments/agent-123/secrets/OPENCLAW%2FTOKEN');
    expect(setResult).toEqual(result);
    expect(setResult).not.toHaveProperty('value');
    expect(deleteResult).not.toHaveProperty('value');
  });

  it('exposes one-key secret mutation helpers on bound agents', async () => {
    const result = { agent_id: 'agent-123', key: 'KEY', present: true, launch_epoch: 9 };
    const patch = vi.fn().mockResolvedValue(result);
    const deleteRequest = vi.fn().mockResolvedValue({ ...result, present: false });
    const deployments = new Deployments(
      {
        get: vi.fn().mockResolvedValue({
          id: 'agent-123',
          user_id: 'user-456',
          state: 'STOPPED',
        }),
        patch,
        delete: deleteRequest,
      } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );
    const agent = await deployments.get('agent-123');

    await agent.setSecret('KEY', 'secret-value');
    await agent.deleteSecret('KEY');

    expect(patch).toHaveBeenCalledWith('/deployments/agent-123/secrets/KEY', { value: 'secret-value' });
    expect(deleteRequest).toHaveBeenCalledWith('/deployments/agent-123/secrets/KEY');
  });

  it('keeps create, start, stop, archive, and restore as distinct lifecycle commands', async () => {
    const agentId = '11111111-1111-4111-8111-111111111111';
    const post = vi.fn()
      .mockResolvedValueOnce({ id: agentId, user_id: 'user-456', state: 'CREATING' })
      .mockResolvedValueOnce({ id: agentId, user_id: 'user-456', state: 'STARTING' })
      .mockResolvedValueOnce({ id: agentId, user_id: 'user-456', state: 'STOPPING' })
      .mockResolvedValueOnce({ id: agentId, user_id: 'user-456', state: 'ARCHIVING' })
      .mockResolvedValueOnce({ id: agentId, user_id: 'user-456', state: 'RESTORING' });
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    await expect(deployments.create({ name: 'matrix-agent' })).resolves.toMatchObject({ state: 'CREATING' });
    const launchConfig = buildAgentConfig().config;
    await expect(deployments.start(agentId, { launchConfig })).resolves.toMatchObject({ state: 'STARTING' });
    await expect(deployments.stop(agentId)).resolves.toMatchObject({ state: 'STOPPING' });
    await expect(deployments.archive(agentId)).resolves.toMatchObject({ state: 'ARCHIVING' });
    await expect(deployments.restore(agentId)).resolves.toMatchObject({ state: 'RESTORING' });
    expect(post.mock.calls[0]?.[0]).toBe('/deployments');
    expect(post.mock.calls[0]?.[1]).toMatchObject({ name: 'matrix-agent' });
    expect(post.mock.calls[0]?.[1]).not.toHaveProperty('start');
    expect(post.mock.calls.slice(1)).toEqual([
      [`/deployments/${agentId}/start`, { launch_config: launchConfig }, { retries: 1 }],
      [`/deployments/${agentId}/stop`, undefined, { retries: 1 }],
      [`/deployments/${agentId}/archive`, undefined, { retries: 1 }],
      [`/deployments/${agentId}/restore`, undefined, { retries: 1 }],
    ]);
  });

  it('exposes ARCHIVE on hydrated agents and accepts its transitional projection', async () => {
    const post = vi.fn().mockResolvedValue({
      id: 'agent-123',
      user_id: 'user-456',
      runtime: 'openclaw',
      state: 'ARCHIVING',
    });
    const agent = OpenClawAgent.fromDict({
      id: 'agent-123',
      user_id: 'user-456',
      runtime: 'openclaw',
      state: 'STOPPED',
    });
    agent._deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    await expect(agent.archive()).resolves.toMatchObject({
      id: 'agent-123',
      state: 'ARCHIVING',
    });
    expect(post).toHaveBeenCalledWith(
      '/deployments/agent-123/archive',
      undefined,
      { retries: 1 },
    );
  });

  it('treats DELETE 200 as accepted soft-delete, not completed cleanup', async () => {
    const accepted = {
      id: '11111111-1111-4111-8111-111111111111',
      state: 'STOPPED',
      deleted_at: '2026-08-14T12:00:00Z',
    };
    const deleteRequest = vi.fn().mockResolvedValue(accepted);
    const deployments = new Deployments(
      { delete: deleteRequest } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    await expect(deployments.delete(accepted.id)).resolves.toEqual(accepted);
    expect(deleteRequest).toHaveBeenCalledWith(`/deployments/${accepted.id}`);
  });

  it('does not replay a stop whose admission request times out before a response', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal as AbortSignal;
      const rejectOnAbort = () => {
        const error = new Error('signal is aborted without reason');
        error.name = 'AbortError';
        reject(error);
      };
      if (signal.aborted) rejectOnAbort();
      else signal.addEventListener('abort', rejectOnAbort, { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const http = new HTTPClient('https://api.test.hypercli.com/agents', 'hyper_api_test', 10);
    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');

    try {
      await expect(
        deployments.stop('11111111-1111-4111-8111-111111111111'),
      ).rejects.toMatchObject({
        name: 'TimeoutError',
        message: 'Request timed out after 10ms',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });

  it('resolves self before START and keeps direct self status, STOP, and routes', async () => {
    const agentId = '11111111-1111-4111-8111-111111111111';
    const agentResponse = {
      id: agentId,
      user_id: 'user-456',
      state: 'running',
    };
    const routesResponse = {
      agent_id: agentId,
      routes: { web: { port: 3000, auth: true, prefix: 'app' } },
      route_statuses: { web: { url: 'https://app-agent.hypercli.app' } },
    };
    const http = {
      get: vi.fn().mockImplementation(async (path: string) => (
        path.endsWith('/routes') ? routesResponse : agentResponse
      )),
      post: vi.fn().mockResolvedValue(agentResponse),
      put: vi.fn().mockResolvedValue(routesResponse),
      delete: vi.fn().mockResolvedValue(routesResponse),
    } as unknown as HTTPClient;
    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');

    expect((await deployments.get('self')).id).toBe(agentId);
    const launchConfig = buildAgentConfig().config;
    await deployments.start('self', { launchConfig, dryRun: true });
    await deployments.stop('self');
    const routes = await deployments.getRoutes('self');
    await deployments.setRoutes('self', routes.routes);
    await deployments.setRoute('self', 'web app', { port: 3000, auth: false, prefix: '' });
    await deployments.removeRoute('self', 'web app');

    expect(http.get).toHaveBeenCalledWith('/deployments/self');
    expect(http.post).toHaveBeenCalledWith(
      `/deployments/${agentId}/start`,
      { launch_config: launchConfig, dry_run: true },
      { retries: 1 },
    );
    expect(http.post).toHaveBeenCalledWith(
      '/deployments/self/stop',
      undefined,
      { retries: 1 },
    );
    expect(http.get).toHaveBeenCalledWith('/deployments/self/routes');
    expect(http.put).toHaveBeenCalledWith('/deployments/self/routes', {
      routes: routesResponse.routes,
    });
    expect(http.put).toHaveBeenCalledWith('/deployments/self/routes/web%20app', {
      port: 3000,
      auth: false,
      prefix: '',
    });
    expect(http.delete).toHaveBeenCalledWith(
      '/deployments/self/routes/web%20app',
    );
    expect(routes).toEqual({
      agentId,
      routes: routesResponse.routes,
      routeStatuses: routesResponse.route_statuses,
    });

    await expect(deployments.startOpenClaw('self', { launchConfig })).resolves.toBeInstanceOf(Agent);
  });

  it('rejects self for destructive operations outside the approved surface', async () => {
    const deployments = new Deployments({} as HTTPClient, 'hyper_api_test', 'https://api.test.hypercli.com/agents');

    await expect(deployments.delete('self')).rejects.toThrow('self is only supported');
    await expect(deployments.createScopedKey('self')).rejects.toThrow('self is only supported');
  });

  it('sends frontend-owned bootstrap prompts and response schemas to the JWT inference route', async () => {
    const post = vi.fn().mockResolvedValue({
      model: 'kimi-k2.6',
      content: '{"files":[]}',
      finish_reason: 'stop',
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'browser-jwt',
      'https://api.test.hypercli.com/agents',
    );
    const responseFormat = {
      type: 'json_schema' as const,
      json_schema: {
        name: 'openclaw_bootstrap_pack',
        strict: true,
        schema: {
          type: 'object',
          properties: { files: { type: 'array' } },
        },
      },
    };

    const result = await deployments.bootstrapInference(
      [{ role: 'user', content: 'Generate the pack.' }],
      responseFormat,
      { timeout: 100_000, retries: 0 },
    );

    expect(post).toHaveBeenCalledWith(
      '/bootstrap',
      {
        messages: [{ role: 'user', content: 'Generate the pack.' }],
        response_format: responseFormat,
      },
      { timeout: 100_000, retries: 0 },
    );
    expect(result.model).toBe('kimi-k2.6');
    expect(result.usage.total_tokens).toBe(30);
  });

  it('keeps request overrides on deployments list', async () => {
    const http = {
      get: vi.fn().mockResolvedValue({ items: [] }),
    } as unknown as HTTPClient;

    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');
    await deployments.list({ timeout: 1234, retryStatuses: [502] });

    expect(http.get).toHaveBeenCalledWith('/deployments', undefined, {
      timeout: 1234,
      retryStatuses: [502],
    });
  });

  it('propagates client-level request timeout to deployments HTTP calls', () => {
    const rootHttp = new HTTPClient('https://api.test.hypercli.com', 'hyper_api_test', 4321);
    const directDeployments = new Deployments(rootHttp, undefined, 'https://api.test.hypercli.com/agents');
    expect((directDeployments as any).agentHttp.timeout).toBe(4321);

    const client = new HyperCLI({
      apiKey: 'hyper_api_test',
      apiUrl: 'https://api.test.hypercli.com',
      agentsApiBaseUrl: 'https://api.test.hypercli.com/agents',
      timeout: 9876,
    });
    expect((client.deployments as any).agentHttp.timeout).toBe(9876);
  });

  it('exposes OpenClaw channel lifecycle wrappers', async () => {
    const agent = OpenClawAgent.fromDict({
      id: 'agent-123',
      user_id: 'user-456',
      state: 'RUNNING',
      hostname: 'agent.hypercli.app',
      gateway_token: 'gw-token',
    });
    agent.gatewayToken = 'gw-token';
    const gateway = {
      channelsStatus: vi.fn(async () => ({ ok: true })),
      channelsStart: vi.fn(async () => ({ started: true })),
      channelsStop: vi.fn(async () => ({ stopped: true })),
      close: vi.fn(),
    };
    const release = vi.fn();
    vi.spyOn(agent, 'acquireConnectedGateway').mockResolvedValue({ client: gateway, release } as any);

    await expect(agent.channelsStatus({ probe: true, timeoutMs: 123, channel: 'slack' })).resolves.toEqual({ ok: true });
    await expect(agent.channelsStart('slack', 'work')).resolves.toEqual({ started: true });
    await expect(agent.channelsStop('slack', 'work')).resolves.toEqual({ stopped: true });

    expect(gateway.channelsStatus).toHaveBeenCalledWith(true, 123, 'slack');
    expect(gateway.channelsStart).toHaveBeenCalledWith('slack', 'work');
    expect(gateway.channelsStop).toHaveBeenCalledWith('slack', 'work');
    expect(release).toHaveBeenCalledTimes(3);
    expect(gateway.close).not.toHaveBeenCalled();
  });

  it('exposes OpenClaw cron mutation wrappers', async () => {
    const agent = OpenClawAgent.fromDict({
      id: 'agent-123',
      user_id: 'user-456',
      state: 'RUNNING',
      hostname: 'agent.hypercli.app',
      gateway_token: 'gw-token',
    });
    agent.gatewayToken = 'gw-token';
    const gateway = {
      cronAdd: vi.fn(async () => ({ id: 'job-1' })),
      cronRemove: vi.fn(async () => undefined),
      cronRun: vi.fn(async () => ({ ran: true })),
      close: vi.fn(),
    };
    const release = vi.fn();
    vi.spyOn(agent, 'acquireConnectedGateway').mockResolvedValue({ client: gateway, release } as any);

    const job = { id: 'job-1', every: '1h', prompt: 'ping' };
    await expect(agent.cronAdd(job)).resolves.toEqual({ id: 'job-1' });
    await expect(agent.cronRemove('job-1')).resolves.toBeUndefined();
    await expect(agent.cronRun('job-1')).resolves.toEqual({ ran: true });

    expect(gateway.cronAdd).toHaveBeenCalledWith(job);
    expect(gateway.cronRemove).toHaveBeenCalledWith('job-1');
    expect(gateway.cronRun).toHaveBeenCalledWith('job-1');
    expect(release).toHaveBeenCalledTimes(3);
    expect(gateway.close).not.toHaveBeenCalled();
  });

  it('leases managed gateways for readiness and one-shot chat without closing the transport', async () => {
    const agent = OpenClawAgent.fromDict({
      id: 'agent-123',
      user_id: 'user-456',
      state: 'RUNNING',
      hostname: 'agent.hypercli.app',
    });
    const gateway = {
      waitReady: vi.fn(async () => ({ ready: true })),
      sendChat: vi.fn(async () => ({ runId: 'run-1' })),
      close: vi.fn(),
    };
    const release = vi.fn();
    const acquire = vi.spyOn(agent, 'acquireConnectedGateway')
      .mockResolvedValue({ client: gateway, release } as any);

    await expect(agent.waitReady(45_000, {
      probe: 'config',
      retryIntervalMs: 500,
      timeout: 2_000,
    })).resolves.toEqual({ ready: true });
    await expect(agent.chatSendMessage('hello', {
      sessionKey: 'main',
      agentId: 'main',
    })).resolves.toEqual({ runId: 'run-1' });

    expect(gateway.waitReady).toHaveBeenCalledWith(45_000, {
      retryIntervalMs: 500,
      probe: 'config',
    });
    expect(gateway.sendChat).toHaveBeenCalledWith('hello', 'main', 'main', undefined);
    expect(acquire).toHaveBeenNthCalledWith(1, expect.objectContaining({ timeout: 2_000 }), { timeoutMs: 2_000 });
    expect(release).toHaveBeenCalledTimes(2);
    expect(gateway.close).not.toHaveBeenCalled();
  });

  it('holds the managed gateway lease for the full streaming chat lifetime', async () => {
    const agent = OpenClawAgent.fromDict({
      id: 'agent-123',
      state: 'RUNNING',
      hostname: 'agent.hypercli.app',
    });
    const release = vi.fn();
    const gateway = {
      chatSend: vi.fn(async function* () {
        yield { type: 'delta', content: 'hello' };
        yield { type: 'done', content: 'hello' };
      }),
      close: vi.fn(),
    };
    vi.spyOn(agent, 'acquireConnectedGateway').mockResolvedValue({ client: gateway, release } as any);

    const stream = agent.chatSend('hello', 'main');
    await expect(stream.next()).resolves.toMatchObject({ done: false });
    expect(release).not.toHaveBeenCalled();
    await stream.return(undefined);

    expect(release).toHaveBeenCalledOnce();
    expect(gateway.close).not.toHaveBeenCalled();
  });

  it('captures OpenClaw operations concurrently over one gateway connection', async () => {
    vi.useFakeTimers();
    const capturedAt = new Date('2026-08-03T12:00:00Z').valueOf();
    vi.setSystemTime(capturedAt);
    const agent = OpenClawAgent.fromDict({
      id: 'agent-123',
      user_id: 'user-456',
      state: 'RUNNING',
      hostname: 'agent.hypercli.app',
      gateway_token: 'gw-token',
    });
    agent.gatewayToken = 'gw-token';
    const sessions = {
      sessions: [{ key: 'main', label: 'Main' }],
      defaults: { model: 'test-model' },
    };
    const cronJobs = [{ id: 'job-1', name: 'Daily summary' }];
    let resolveSessions!: (value: typeof sessions) => void;
    const pendingSessions = new Promise<typeof sessions>((resolve) => {
      resolveSessions = resolve;
    });
    const gateway = {
      sessionsListResult: vi.fn(() => pendingSessions),
      cronList: vi.fn(async () => cronJobs),
      close: vi.fn(),
    };
    const release = vi.fn();
    const gatewayFactory = vi.spyOn(agent, 'acquireConnectedGateway').mockResolvedValue({
      client: gateway,
      release,
    } as any);

    const snapshotPromise = agent.operationsSnapshot({ timeout: 1234 });
    await Promise.resolve();

    expect(gateway.sessionsListResult).toHaveBeenCalledOnce();
    expect(gateway.cronList).toHaveBeenCalledOnce();
    resolveSessions(sessions);
    await expect(snapshotPromise).resolves.toEqual({
      sessions,
      cronJobs,
      failures: {},
      capturedAt,
    });
    expect(gatewayFactory).toHaveBeenCalledOnce();
    expect(gatewayFactory).toHaveBeenCalledWith({ timeout: 1234 }, { timeoutMs: 1234 });
    expect(release).toHaveBeenCalledOnce();
    expect(gateway.close).not.toHaveBeenCalled();
  });

  it('preserves successful OpenClaw operations when one RPC fails', async () => {
    const agent = OpenClawAgent.fromDict({
      id: 'agent-123',
      user_id: 'user-456',
      state: 'RUNNING',
      hostname: 'agent.hypercli.app',
      gateway_token: 'gw-token',
    });
    agent.gatewayToken = 'gw-token';
    const sessions = { sessions: [{ key: 'main' }] };
    const gateway = {
      sessionsListResult: vi.fn(async () => sessions),
      cronList: vi.fn().mockRejectedValue(new Error('cron unavailable')),
      close: vi.fn(),
    };
    const release = vi.fn();
    vi.spyOn(agent, 'acquireConnectedGateway').mockResolvedValue({ client: gateway, release } as any);

    await expect(agent.operationsSnapshot()).resolves.toMatchObject({
      sessions,
      cronJobs: null,
      failures: { cron: 'cron unavailable' },
      capturedAt: expect.any(Number),
    });
    expect(release).toHaveBeenCalledOnce();
    expect(gateway.close).not.toHaveBeenCalled();
  });

  it('does not run OpenClaw operations when managed connection acquisition fails', async () => {
    const agent = OpenClawAgent.fromDict({
      id: 'agent-123',
      user_id: 'user-456',
      state: 'RUNNING',
      hostname: 'agent.hypercli.app',
      gateway_token: 'gw-token',
    });
    agent.gatewayToken = 'gw-token';
    const gatewayUnavailable = new Error('gateway unavailable');
    const acquire = vi.spyOn(agent, 'acquireConnectedGateway').mockRejectedValue(gatewayUnavailable);

    await expect(agent.operationsSnapshot()).rejects.toBe(gatewayUnavailable);
    expect(acquire).toHaveBeenCalledOnce();
  });

  it.each([
    'CREATING',
    'STARTING',
    'RESTORING',
    'RUNNING',
    'STOPPING',
    'STOPPED',
    'ARCHIVING',
    'ARCHIVED',
    'DELETED',
    'FAILED',
  ] as const)('hydrates canonical lifecycle state %s', async (state) => {
    const http = {
      get: vi.fn().mockResolvedValue({
        id: 'agent-123',
        user_id: 'user-456',
        state,
      }),
    } as unknown as HTTPClient;

    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');
    const agent = await deployments.get('agent-123');

    expect(agent.state).toBe(state);
  });

  it('classifies archive and deletion states without closing AgentState', () => {
    expect(CANONICAL_AGENT_STATES).toEqual([
      'CREATING',
      'STARTING',
      'RESTORING',
      'RUNNING',
      'STOPPING',
      'STOPPED',
      'ARCHIVING',
      'ARCHIVED',
      'FAILED',
      'DELETED',
    ]);
    expect([...AGENT_TRANSITIONAL_STATES]).toEqual([
      'CREATING',
      'STARTING',
      'RESTORING',
      'STOPPING',
      'ARCHIVING',
    ]);
    expect([...AGENT_RUNTIME_INACTIVE_STATES]).toEqual([
      'STOPPED',
      'ARCHIVING',
      'ARCHIVED',
      'FAILED',
      'DELETED',
    ]);
    expect(isAgentTransitionalState('archiving')).toBe(true);
    expect(isAgentRuntimeInactiveState('archived')).toBe(true);
    expect(isAgentTransitionalState('FUTURE_SERVER_STATE')).toBe(false);
  });

  it.each([
    ['ARCHIVING', true, false, false],
    ['ARCHIVED', false, true, false],
    ['DELETED', false, false, true],
  ] as const)('exposes public lifecycle semantics for %s', async (state, transitioning, archived, deleted) => {
    const http = {
      get: vi.fn().mockResolvedValue({ id: 'agent-123', user_id: 'user-456', state }),
    } as unknown as HTTPClient;
    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');

    const agent = await deployments.get('agent-123');

    expect(agent.isTransitioning).toBe(transitioning);
    expect(agent.isArchived).toBe(archived);
    expect(agent.isDeleted).toBe(deleted);
  });

  it.each(['CREATING', 'STARTING', 'RESTORING', 'STOPPING', 'ARCHIVING'] as const)(
    'waitForState treats transitional state %s as a valid intermediate observation',
    async (state) => {
      const http = {
        get: vi.fn().mockResolvedValue({ id: 'agent-123', user_id: 'user-456', state }),
      } as unknown as HTTPClient;
      const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');
      installReadySubscription(deployments);

      await expect(deployments.waitForState('agent-123', [state], 100)).resolves.toMatchObject({ state });
    },
  );

  it('hydrates canonical starting state', async () => {
    const http = {
      get: vi.fn().mockResolvedValue({
        id: 'agent-123',
        user_id: 'user-456',
        state: 'STARTING',
      }),
    } as unknown as HTTPClient;

    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');
    const agent = await deployments.get('agent-123');

    expect(agent.state).toBe('STARTING');
  });

  it.each(['STOPPED', 'ARCHIVED', 'DELETED', 'FAILED'] as const)(
    'fails waitRunning promptly on terminal state %s',
    async (state) => {
      const http = {
        get: vi.fn().mockResolvedValue({
          id: 'agent-123',
          user_id: 'user-456',
          state,
        }),
      } as unknown as HTTPClient;

      const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');
      installReadySubscription(deployments);

      await expect(deployments.waitRunning('agent-123', 100, 0)).rejects.toThrow(
        `Agent entered ${state} while waiting for RUNNING`,
      );
    },
  );

  it('ignores an archived snapshot from an older accepted launch epoch', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({
        id: 'agent-123',
        state: 'ARCHIVED',
        launch_epoch: 9,
      })
      .mockResolvedValueOnce({
        id: 'agent-123',
        state: 'RUNNING',
        launch_epoch: 10,
      });
    const deployments = new Deployments(
      { get } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );
    vi.spyOn(deployments, 'subscribe').mockImplementation(async (handler, options = {}) => {
      await options.onReady?.();
      await handler({
        type: 'deployment.transition',
        agent_id: 'agent-123',
        state: 'RUNNING',
        launch_epoch: 10,
      });
      if (!options.signal?.aborted) {
        await new Promise<void>((resolve) => {
          options.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
      }
    });

    const agent = await deployments.waitRunning('agent-123', 1_000, 0, 10);

    expect(agent.state).toBe('RUNNING');
    expect(agent.launchEpoch).toBe(10);
  });

  it('reconciles authoritative state when a transition event is missed', async () => {
    vi.useFakeTimers();
    const get = vi.fn()
      .mockResolvedValueOnce({ id: 'agent-123', state: 'STARTING', launch_epoch: 10 })
      .mockResolvedValueOnce({ id: 'agent-123', state: 'RUNNING', launch_epoch: 10 });
    const deployments = new Deployments(
      { get } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );
    installReadySubscription(deployments);

    const waiting = deployments.waitRunning('agent-123', 1_000, 100, 10);
    await vi.advanceTimersByTimeAsync(100);

    await expect(waiting).resolves.toMatchObject({ state: 'RUNNING', launchEpoch: 10 });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('polls authoritative state before the deployment event subscription is ready', async () => {
    vi.useFakeTimers();
    const get = vi.fn()
      .mockResolvedValueOnce({ id: 'agent-123', state: 'STARTING', launch_epoch: 10 })
      .mockResolvedValueOnce({ id: 'agent-123', state: 'RUNNING', launch_epoch: 10 });
    const deployments = new Deployments(
      { get } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );
    vi.spyOn(deployments, 'subscribe').mockImplementation(async (_handler, options = {}) => {
      if (options.signal?.aborted) return;
      await new Promise<void>((resolve) => {
        options.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
    });

    const waiting = deployments.waitRunning('agent-123', 1_000, 100, 10);
    await vi.advanceTimersByTimeAsync(100);

    await expect(waiting).resolves.toMatchObject({ state: 'RUNNING', launchEpoch: 10 });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('keeps polling when the deployment event subscription fails', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({ id: 'agent-123', state: 'STARTING', launch_epoch: 10 })
      .mockResolvedValueOnce({ id: 'agent-123', state: 'RUNNING', launch_epoch: 10 });
    const deployments = new Deployments(
      { get } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );
    vi.spyOn(deployments, 'subscribe').mockRejectedValue(new Error('Deployment events unavailable'));

    await expect(deployments.waitRunning('agent-123', 1_000, 1, 10)).resolves.toMatchObject({
      state: 'RUNNING',
      launchEpoch: 10,
    });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('performs a final authoritative read at the timeout boundary', async () => {
    vi.useFakeTimers();
    const get = vi.fn()
      .mockResolvedValueOnce({ id: 'agent-123', state: 'STARTING', launch_epoch: 10 })
      .mockResolvedValueOnce({ id: 'agent-123', state: 'RUNNING', launch_epoch: 10 });
    const deployments = new Deployments(
      { get } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );
    installReadySubscription(deployments);

    const waiting = deployments.waitRunning('agent-123', 100, 1_000, 10);
    await vi.advanceTimersByTimeAsync(100);

    await expect(waiting).resolves.toMatchObject({ state: 'RUNNING', launchEpoch: 10 });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('includes only the latest REST state when waitRunning times out', async () => {
    vi.useFakeTimers();
    const http = {
      get: vi.fn().mockResolvedValue({
        id: 'agent-123',
        user_id: 'user-456',
        state: 'RESTORING',
      }),
    } as unknown as HTTPClient;

    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');
    installReadySubscription(deployments);

    const assertion = expect(deployments.waitRunning('agent-123', 1_000, 100)).rejects.toThrow(
      'Timed out waiting for agent agent-123 to reach RUNNING (last=RESTORING)',
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });

  it('hydrates only meta.ui on agent responses', async () => {
    const http = {
      get: vi.fn().mockResolvedValue({
        id: 'agent-123',
        user_id: 'user-456',
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

  it('reads env, Secret names, and one exact Secret through generic Agent APIs', async () => {
    const get = vi.fn(async (path: string) => {
      if (path.endsWith('/env')) {
        return { agent_id: 'agent-123', env: { PLAIN: 'value' }, launch_epoch: 4 };
      }
      if (path.endsWith('/secrets')) {
        return { agent_id: 'agent-123', names: ['TOKEN'], launch_epoch: 4 };
      }
      if (path.endsWith('/secrets/TOKEN')) {
        return { agent_id: 'agent-123', key: 'TOKEN', value: 'secret-value', launch_epoch: 4 };
      }
      throw new Error(`unexpected GET ${path}`);
    });
    const deployments = new Deployments(
      { get } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );
    const agent = Agent.fromDict({ id: 'agent-123', state: 'RUNNING', launch_epoch: 4 });
    agent._deployments = deployments;

    await expect(agent.env()).resolves.toEqual({ PLAIN: 'value' });
    await expect(agent.secretNames()).resolves.toEqual(['TOKEN']);
    await expect(agent.secret('TOKEN')).resolves.toBe('secret-value');
    expect(get.mock.calls.map(([path]) => path)).toEqual([
      '/deployments/agent-123/env',
      '/deployments/agent-123/secrets',
      '/deployments/agent-123/secrets/TOKEN',
    ]);
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

  it('resolves unique agent names before lifecycle calls', async () => {
    const get = vi.fn(async (path: string) => {
      if (path === '/deployments') {
        return {
          items: [{
            id: '11111111-1111-4111-8111-111111111111',
            user_id: 'user-456',
            name: 'clear-window-works',
            handle: 'coder',
            state: 'STOPPED',
          }],
        };
      }
      if (path === '/deployments/11111111-1111-4111-8111-111111111111') {
        return {
          id: '11111111-1111-4111-8111-111111111111',
          user_id: 'user-456',
          name: 'clear-window-works',
          handle: 'coder',
          state: 'STOPPED',
        };
      }
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.fn(async () => ({
      id: '11111111-1111-4111-8111-111111111111',
      user_id: 'user-456',
      name: 'clear-window-works',
      handle: 'coder',
      state: 'STARTING',
    }));
    const http = { get, post } as unknown as HTTPClient;
    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');

    const launchConfig = buildAgentConfig({}, {
      restart: false,
      runtimeScopes: ['models:*'],
    }).config;
    const result = await deployments.start('clear-window-works', { launchConfig });

    expect(result.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(post).toHaveBeenCalledWith(
      '/deployments/11111111-1111-4111-8111-111111111111/start',
      { launch_config: launchConfig },
      { retries: 1 },
    );

    const handleResult = await deployments.get('coder');

    expect(handleResult.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(get).not.toHaveBeenCalledWith('/deployments/coder');
  });

  it('starts OpenClaw Pro with complete replacement contracts', async () => {
    const post = vi.fn().mockResolvedValue({
      id: 'agent-pro',
      user_id: 'user-456',
      state: 'STARTING',
      runtime: 'openclaw-pro',
    });
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    const agentId = '11111111-1111-4111-8111-111111111111';
    const first = buildAgentConfig().config;
    const second = buildAgentConfig({}, { runtimeScopes: ['models:*'] }).config;
    await deployments.startOpenClawPro(agentId, { launchConfig: first });
    await deployments.startOpenClawPro(agentId, { launchConfig: second });

    expect(post.mock.calls[0][1]).toEqual({ launch_config: first });
    expect(post.mock.calls[1][1]).toEqual({ launch_config: second });
  });

  it('uses the sync root without an independent full-sync knob', async () => {
    const post = vi.fn().mockResolvedValue({
      id: 'agent-sync-all',
      user_id: 'user-456',
      state: 'STARTING',
      runtime: 'openclaw',
    });
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    const launchConfig = buildAgentConfig({}, {
      syncInclude: ['src'],
      syncExclude: ['tmp'],
    }).config;
    await deployments.startOpenClaw(
      '11111111-1111-4111-8111-111111111111',
      { launchConfig },
    );

    expect(post.mock.calls[0][1].launch_config.sync_include).toEqual(['src']);
    expect(post.mock.calls[0][1].launch_config).not.toHaveProperty('sync_enabled');
    expect(post.mock.calls[0][1].launch_config).not.toHaveProperty('sync_exclude');
  });

  it('distinguishes omitted and explicit null sync fields when starting', async () => {
    const post = vi.fn().mockResolvedValue({
      id: 'agent-sync-presence',
      user_id: 'user-456',
      state: 'STARTING',
    });
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );
    const agentId = '11111111-1111-4111-8111-111111111111';

    const configs = [
      buildAgentConfig().config,
      buildAgentConfig({}, { syncInclude: null }).config,
      buildAgentConfig({}, { syncExclude: null }).config,
      buildAgentConfig({}, { syncInclude: [] }).config,
    ];
    for (const launchConfig of configs) await deployments.start(agentId, { launchConfig });

    expect(post.mock.calls[0][1].launch_config).not.toHaveProperty('sync_include');
    expect(post.mock.calls[0][1].launch_config).not.toHaveProperty('sync_exclude');
    expect(post.mock.calls[1][1].launch_config).toHaveProperty('sync_include', null);
    expect(post.mock.calls[1][1].launch_config).not.toHaveProperty('sync_exclude');
    expect(post.mock.calls[2][1].launch_config).toHaveProperty('sync_exclude', null);
    expect(post.mock.calls[2][1].launch_config).not.toHaveProperty('sync_include');
    expect(post.mock.calls[3][1].launch_config).toHaveProperty('sync_include', []);
  });

  it('retains the backend-hydrated launch config after start', async () => {
    const persistedLaunchConfig = {
      image: 'ghcr.io/hypercli/hypercli-buzz-opencode:latest',
      command: ['/usr/local/bin/buzz-acp'],
      env: { BUZZ_RELAY_URL: 'wss://buzz.example.test' },
      restart: false,
    };
    const post = vi.fn().mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      user_id: 'user-456',
      state: 'STARTING',
      runtime: 'opencode',
      launch_config: persistedLaunchConfig,
    });
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    const result = await deployments.start(
      '11111111-1111-4111-8111-111111111111',
      { launchConfig: buildAgentConfig({}, { restart: false }).config },
    );

    expect(result.launchConfig).toEqual(persistedLaunchConfig);
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
        state: 'stopped',
        cpu: 4,
        memory: 4,
      }),
    } as unknown as HTTPClient;

    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');
    const agent = await deployments.update('agent-123', {
      name: 'Marketing',
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
        name: 'Marketing',
        size: 'large',
        launch_config: {
          image: 'ghcr.io/hypercli/hypercli-openclaw:custom',
          env: { FOO: 'bar' },
        },
        refresh_from_lagoon: true,
      },
    ]);
    expect((http.patch as any).mock.calls[0][1]).not.toHaveProperty('display_name');
  });

  it('uploads profile images through the deployments API', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({
        id: 'agent-123',
        avatar_url: 'https://cdn.example.test/prod/user-456/agent-123.png',
        s3_key: 'prod/user-456/agent-123.png',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const http = new HTTPClient('https://api.test.hypercli.com/agents', 'hyper_api_test');
    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');
    const file = new Blob(['png'], { type: 'image/png' });

    const result = await deployments.uploadProfileImage('agent-123', file);

    expect(result).toEqual({
      id: 'agent-123',
      avatar_url: 'https://cdn.example.test/prod/user-456/agent-123.png',
      s3_key: 'prod/user-456/agent-123.png',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test.hypercli.com/agents/deployments/agent-123/profile-image',
      expect.objectContaining({
        method: 'POST',
        body: file,
      }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer hyper_api_test');
    expect(headers.get('Content-Type')).toBe('image/png');
  });

  it('deletes profile images through the deployments API', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({
        id: 'agent-123',
        avatar_url: null,
        s3_key: null,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const http = new HTTPClient('https://api.test.hypercli.com/agents', 'hyper_api_test');
    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');

    await expect(deployments.deleteProfileImage('agent-123')).resolves.toEqual({
      id: 'agent-123',
      avatar_url: null,
      s3_key: null,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test.hypercli.com/agents/deployments/agent-123/profile-image',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('gets, uploads, and deletes external-agent profile images through dedicated routes', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(
      JSON.stringify(init?.method === 'GET' ? {
        id: 'external-123',
        user_id: 'user-456',
        state: 'active',
        name: 'external-agent',
        managed: false,
        runtime: 'openclaw',
      } : {
        id: 'external-123',
        avatar_url: init?.method === 'DELETE'
          ? null
          : 'https://cdn.example.test/prod/user-456/external-123.png',
        s3_key: init?.method === 'DELETE'
          ? null
          : 'prod/user-456/external-123.png',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const http = new HTTPClient('https://api.test.hypercli.com/agents', 'hyper_api_test');
    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');
    const file = new Blob(['png'], { type: 'image/png' });

    const external = await deployments.getExternalAgent('external-123');
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.test.hypercli.com/agents/external-agents/external-123',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(external.managed).toBe(false);

    await expect(deployments.uploadExternalAgentProfileImage('external-123', file)).resolves.toEqual({
      id: 'external-123',
      avatar_url: 'https://cdn.example.test/prod/user-456/external-123.png',
      s3_key: 'prod/user-456/external-123.png',
    });
    await expect(deployments.deleteExternalAgentProfileImage('external-123')).resolves.toEqual({
      id: 'external-123',
      avatar_url: null,
      s3_key: null,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.test.hypercli.com/agents/external-agents/external-123/profile-image',
      expect.objectContaining({ method: 'POST', body: file }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://api.test.hypercli.com/agents/external-agents/external-123/profile-image',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('starts Slack OAuth through the relay REST endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({
        authorize_url: 'https://slack.com/oauth/v2/authorize?state=abc',
        expires_at: '2026-07-19T13:30:00+00:00',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const result = await startSlackOAuth({
      relayBaseUrl: 'https://api.agents.dev.hypercli.com/',
      token: 'app-jwt',
    });

    expect(result).toEqual({
      authorizeUrl: 'https://slack.com/oauth/v2/authorize?state=abc',
      expiresAt: '2026-07-19T13:30:00+00:00',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.dev.hypercli.com/slack/oauth/start',
      expect.objectContaining({
        method: 'GET',
        headers: {
          Authorization: 'Bearer app-jwt',
        },
      }),
    );
  });

  it('reads Slack install status through the relay REST endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({
        connected: true,
        team_id: 'T123',
        team_name: 'Test Workspace',
        bot_user_id: 'U123',
        installer_user_id: 'UINSTALLER',
        updated_at: '2026-07-19T13:30:00+00:00',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getSlackInstallStatus({
      relayBaseUrl: 'https://api.agents.dev.hypercli.com/',
      token: 'app-jwt',
    });

    expect(result).toEqual({
      connected: true,
      teamId: 'T123',
      teamName: 'Test Workspace',
      botUserId: 'U123',
      installerUserId: 'UINSTALLER',
      updatedAt: '2026-07-19T13:30:00+00:00',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.dev.hypercli.com/slack/install',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer app-jwt' },
      }),
    );
  });

  it('attaches an agent to hosted Slack relay through the relay REST endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({
        connected: true,
        agent_id: 'agent-123',
        gateway_id: 'agent:agent-123',
        config: { enabled: true, mode: 'relay' },
        restart_required: true,
        team_id: 'T123',
        team_name: 'Test Workspace',
        bot_user_id: 'U123',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const result = await attachSlackRelayAgent({
      relayBaseUrl: 'https://api.agents.dev.hypercli.com/',
      token: 'app-jwt',
      agentId: 'agent-123',
    });

    expect(result).toEqual({
      connected: true,
      agentId: 'agent-123',
      gatewayId: 'agent:agent-123',
      config: { enabled: true, mode: 'relay' },
      restartRequired: true,
      teamId: 'T123',
      teamName: 'Test Workspace',
      botUserId: 'U123',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.dev.hypercli.com/slack/agents/agent-123/relay',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer app-jwt' },
      }),
    );
  });

  it('lists Slack directory conversations and users through the relay REST endpoints', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('https://api.dev.hypercli.com/slack/directory/conversations')) {
        return new Response(
          JSON.stringify({
            conversations: [{
              id: 'C0123456789',
              name: 'product-pps',
              is_channel: true,
              is_member: true,
              is_private: false,
              topic: { value: 'not surfaced' },
            }],
            next_cursor: 'next-conv',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.startsWith('https://api.dev.hypercli.com/slack/directory/users')) {
        return new Response(
          JSON.stringify({
            users: [{
              id: 'U0123456789',
              name: 'dmitry',
              real_name: 'Dmitry Nedospasov',
              team_id: 'T123',
              is_bot: false,
              deleted: false,
              profile: { email: 'not-surfaced@example.test' },
            }],
            next_cursor: 'next-user',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(listSlackDirectoryConversations({
      relayBaseUrl: 'https://api.agents.dev.hypercli.com/',
      token: 'app-jwt',
      cursor: 'cursor-a',
      limit: 25,
      types: 'public_channel,private_channel',
    })).resolves.toEqual({
      conversations: [{
        id: 'C0123456789',
        name: 'product-pps',
        isChannel: true,
        isGroup: null,
        isIm: null,
        isMpim: null,
        isMember: true,
        isPrivate: false,
      }],
      nextCursor: 'next-conv',
    });
    await expect(listSlackDirectoryUsers({
      relayBaseUrl: 'https://api.agents.dev.hypercli.com/',
      token: 'app-jwt',
      limit: 10,
    })).resolves.toEqual({
      users: [{
        id: 'U0123456789',
        name: 'dmitry',
        realName: 'Dmitry Nedospasov',
        teamId: 'T123',
        isBot: false,
        deleted: false,
      }],
      nextCursor: 'next-user',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(1,
      'https://api.dev.hypercli.com/slack/directory/conversations?cursor=cursor-a&limit=25&types=public_channel%2Cprivate_channel',
      expect.objectContaining({ method: 'GET', headers: { Authorization: 'Bearer app-jwt' } }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2,
      'https://api.dev.hypercli.com/slack/directory/users?limit=10',
      expect.objectContaining({ method: 'GET', headers: { Authorization: 'Bearer app-jwt' } }),
    );
  });

  it('attaches hosted Slack relay through a deployment client using agent names', async () => {
    const http = {
      get: vi.fn(async (path: string) => {
        if (path === '/deployments') {
          return {
            items: [{
              id: '11111111-1111-4111-8111-111111111111',
              user_id: 'user-456',
              name: 'clear-window-works',
              state: 'STOPPED',
            }],
          };
        }
        if (path === '/deployments/11111111-1111-4111-8111-111111111111') {
          return {
            id: '11111111-1111-4111-8111-111111111111',
            user_id: 'user-456',
            name: 'clear-window-works',
            state: 'STOPPED',
          };
        }
        throw new Error(`unexpected GET ${path}`);
      }),
    } as unknown as HTTPClient;
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({
        connected: true,
        agent_id: '11111111-1111-4111-8111-111111111111',
        gateway_id: 'agent:11111111-1111-4111-8111-111111111111',
        config: { enabled: true, mode: 'relay' },
        restart_required: true,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');
    const result = await deployments.attachSlackRelayAgent('clear-window-works', {
      relayBaseUrl: 'https://api.agents.hypercli.com',
    });

    expect(result.agentId).toBe('11111111-1111-4111-8111-111111111111');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.hypercli.com/slack/agents/11111111-1111-4111-8111-111111111111/relay',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer hyper_api_test' },
      }),
    );
  });

  it('detects desktop from explicit launch config and hydrated routes only', () => {
    expect(launchConfigHasDesktop({ env: { OPENCLAW_DESKTOP_ENABLED: '1' } })).toBe(true);
    expect(launchConfigHasDesktop({
      env: { OPENCLAW_DESKTOP_ENABLED: '0' },
      routes: { desktop: { port: 3000, auth: true, prefix: 'screen' } },
    })).toBe(false);
    expect(launchConfigHasDesktop({ routes: { desktop: { port: 3000, auth: true, prefix: 'screen' } } })).toBe(true);
    expect(launchConfigHasDesktop({ routes: { browser: { port: 3000, auth: true, prefix: 'desktop' } } })).toBe(true);
    expect(launchConfigHasDesktop({ image: 'ghcr.io/hypercli/hypercli-openclaw:pro-prod' })).toBe(false);
    expect(agentConfigHasDesktop({ routes: { desktop: { port: 3000, auth: true, prefix: 'desktop' } } })).toBe(true);
    expect(agentConfigHasDesktop({
      launchConfig: { env: { OPENCLAW_DESKTOP_ENABLED: 'false' } },
      routes: { desktop: { port: 3000, auth: true, prefix: 'desktop' } },
    })).toBe(false);
  });

  it('flattens launch config and exposes desktop capability on agents', () => {
    const launchConfig = {
      env: { OPENCLAW_DESKTOP_ENABLED: '0' },
      routes: { openclaw: { port: 18789, prefix: '' } },
    };

    expect(flattenLaunchConfig(launchConfig)).toMatchObject({
      'env.OPENCLAW_DESKTOP_ENABLED': '0',
      'routes.openclaw.port': 18789,
    });

    const agent = Agent.fromDict({
      id: 'agent-123',
      user_id: 'user-456',
      state: 'running',
      hostname: 'agent.hypercli.com',
      routes: { desktop: { port: 3000, auth: true, prefix: 'screen' } },
    });

    expect(agent.hasDesktop).toBe(true);
    expect(agent.desktopUrl).toBe('https://screen-agent.hypercli.com');
  });

  it('builds browser desktop auth URLs with scaled noVNC redirects', () => {
    const url = buildBrowserDesktopUrl('https://desktop-agent.hypercli.com', ' jwt-123 ');

    expect(url).toBe('https://desktop-agent.hypercli.com/_jwt_auth?jwt=jwt-123&redirect=vnc.html%3Fresize%3Dscale');
  });

  it('hydrates new API agent fields without image_url fallback', () => {
    const agent = Agent.fromDict({
      id: 'agent-123',
      user_id: 'user-456',
      state: 'external_ready',
      name: 'Legacy name',
      handle: 'claw',
      display_name: 'HyperClaw',
      avatar_url: 'https://cdn.example/avatar.png',
      display_identity: {
        display_name: 'HyperClaw Coder',
        avatar_url: 'https://cdn.example/coder.png',
        channel_overrides: {},
      },
      image_url: 'https://cdn.example/legacy.png',
      runtime: 'openclaw',
      managed: true,
      is_launchable: false,
      launch_config: { image: 'ghcr.io/hypercli/hypercli-openclaw:prod' },
      gateway_id: 'gateway-123',
      runtime_key_alias: 'key-123',
      relay_key: { api_key: 'hyper_api_secret', key_id: 'key-123' },
    } as any);

    expect(agent.handle).toBe('claw');
    expect(agent.displayName).toBe('HyperClaw');
    expect(agent.avatarUrl).toBe('https://cdn.example/avatar.png');
    expect(agent.displayIdentity).toEqual({
      display_name: 'HyperClaw Coder',
      avatar_url: 'https://cdn.example/coder.png',
      channel_overrides: {},
    });
    expect(agent.runtime).toBe('openclaw');
    expect(agent.managed).toBe(true);
    expect(agent.isLaunchable).toBe(false);
    expect(agent.launchConfig).toEqual({ image: 'ghcr.io/hypercli/hypercli-openclaw:prod' });
    expect(agent.gatewayId).toBe('gateway-123');
    expect(agent.runtimeKeyAlias).toBe('key-123');
    expect(agent.relayKey).toEqual({ api_key: 'hyper_api_secret', key_id: 'key-123' });

    const legacy = Agent.fromDict({
      id: 'agent-456',
      user_id: 'user-456',
      state: 'external_ready',
      image_url: 'https://cdn.example/legacy.png',
      managed: false,
    } as any);
    expect(legacy.avatarUrl).toBeNull();
    expect(legacy.managed).toBe(false);
    expect(legacy.isLaunchable).toBe(false);
  });

  it('updates external agents by exact id with nullable camel-case fields', async () => {
    const http = {
      patch: vi.fn().mockResolvedValue({
        id: 'backend-external-id',
        user_id: 'user-456',
        state: 'inactive',
        name: 'external-agent-renamed',
        display_name: null,
        managed: false,
        runtime: 'openclaw',
      }),
    } as unknown as HTTPClient;
    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');

    const agent = await deployments.updateExternalAgent('backend-external-id', {
      name: 'external-agent-renamed',
      displayName: null,
      handle: null,
      runtime: 'openclaw',
      status: 'inactive',
      meta: null,
    });

    expect(http.patch).toHaveBeenCalledWith('/external-agents/backend-external-id', {
      name: 'external-agent-renamed',
      display_name: null,
      handle: null,
      runtime: 'openclaw',
      status: 'inactive',
      meta: null,
    });
    expect(agent.id).toBe('backend-external-id');
    expect(agent.managed).toBe(false);
  });

  it('creates and rotates external agent relay keys through dedicated routes', async () => {
    const http = {
      post: vi
        .fn()
        .mockResolvedValueOnce({
          id: 'external-123',
          user_id: 'user-456',
          state: 'active',
          managed: false,
          runtime: 'openclaw',
          runtime_key_alias: 'key-123',
          relay_key: { api_key: 'hyper_api_secret', key_id: 'key-123' },
        })
        .mockResolvedValueOnce({ relay_key: { api_key: 'hyper_api_next', key_id: 'key-456' } }),
    } as unknown as HTTPClient;
    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');

    const agent = await deployments.createExternalAgent({
      name: 'external-agent',
      displayName: 'External',
      handle: 'external',
    });
    const rotated = await deployments.rotateExternalAgentKey('external-123');

    expect(http.post).toHaveBeenNthCalledWith(1, '/external-agents', {
      name: 'external-agent',
      runtime: 'openclaw',
      status: 'active',
      display_name: 'External',
      handle: 'external',
    });
    expect(agent.isLaunchable).toBe(false);
    expect(agent.relayKey).toEqual({ api_key: 'hyper_api_secret', key_id: 'key-123' });
    expect(http.post).toHaveBeenNthCalledWith(2, '/external-agents/external-123/keys/rotate');
    expect(rotated).toEqual({ relay_key: { api_key: 'hyper_api_next', key_id: 'key-456' } });
  });

  it('configures Slack relay through the gateway helper', async () => {
    const agent = OpenClawAgent.fromDict({
      id: '11111111-1111-1111-1111-111111111111',
      user_id: 'user-456',
      state: 'running',
      routes: { openclaw: { port: 18789 } },
      gateway_id: 'agent:11111111-1111-1111-1111-111111111111',
      gateway_token: 'gw-token',
    } as any);
    const client = { configureSlackRelay: vi.fn(async () => undefined), close: vi.fn() };
    const release = vi.fn();
    vi.spyOn(agent, 'acquireConnectedGateway').mockResolvedValue({ client, release } as any);

    await agent.configureSlackRelay({ url: 'wss://api.dev.hypercli.com/slack/ws' });

    expect(client.configureSlackRelay).toHaveBeenCalledWith({
      url: 'wss://api.dev.hypercli.com/slack/ws',
      gatewayId: 'agent:11111111-1111-1111-1111-111111111111',
    });
    expect(release).toHaveBeenCalledOnce();
    expect(client.close).not.toHaveBeenCalled();
  });

  it('configures channel integrations through connected gateway helpers', async () => {
    const agent = OpenClawAgent.fromDict({
      id: 'agent-123',
      user_id: 'user-456',
      state: 'running',
      routes: { openclaw: { port: 18789 } },
      gateway_token: 'gw-token',
    } as any);
    const client = {
      configureSlackSocket: vi.fn(async () => undefined),
      configureTelegram: vi.fn(async () => undefined),
      configureWhatsapp: vi.fn(async () => undefined),
      close: vi.fn(),
    };
    const release = vi.fn();
    vi.spyOn(agent, 'acquireConnectedGateway').mockResolvedValue({ client, release } as any);

    await agent.configureSlackSocket({ botToken: 'xoxb-token', appToken: 'xapp-token' }, { accountId: 'work' });
    await agent.configureTelegram({ enabled: true, dmPolicy: 'allowlist', allowFrom: ['123'] });
    await agent.configureWhatsapp({ enabled: true }, { accountId: 'default' });

    expect(client.configureSlackSocket).toHaveBeenCalledWith({ botToken: 'xoxb-token', appToken: 'xapp-token' }, 'work');
    expect(client.configureTelegram).toHaveBeenCalledWith({ enabled: true, dmPolicy: 'allowlist', allowFrom: ['123'] }, undefined);
    expect(client.configureWhatsapp).toHaveBeenCalledWith({ enabled: true }, 'default');
    expect(release).toHaveBeenCalledTimes(3);
    expect(client.close).not.toHaveBeenCalled();
  });

  it('builds browser desktop auth URLs with query-preserving redirects', () => {
    const url = buildBrowserDesktopUrl('https://desktop-agent.hypercli.com/', 'jwt-123', {
      redirect: 'vnc.html?autoconnect=1&resize=remote',
    });

    expect(url).toBe('https://desktop-agent.hypercli.com/_jwt_auth?jwt=jwt-123&redirect=vnc.html%3Fautoconnect%3D1%26resize%3Dscale');
  });

  it('exposes browser desktop auth URL construction on agents', () => {
    const agent = Agent.fromDict({
      id: 'agent-123',
      user_id: 'user-456',
      state: 'running',
      hostname: 'agent.hypercli.com',
    });

    expect(agent.browserDesktopUrl('jwt-123')).toBe('https://desktop-agent.hypercli.com/_jwt_auth?jwt=jwt-123&redirect=vnc.html%3Fresize%3Dscale');
  });

  it('supports bound resize on hydrated agents', async () => {
    const http = {
      get: vi.fn().mockResolvedValue({
        id: 'agent-123',
        user_id: 'user-456',
        state: 'stopped',
        cpu: 2,
        memory: 2,
      }),
      patch: vi.fn().mockResolvedValue({
        id: 'agent-123',
        user_id: 'user-456',
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

  it('returns file response MIME metadata and forwards preview cancellation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'Content-Type': 'image/png' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const deployments = new Deployments({ apiKey: 'hyper_api_test' } as unknown as HTTPClient, 'hyper_api_test', 'https://api.test.hypercli.com/agents');
    const abortController = new AbortController();

    const result = await deployments.fileReadBytesWithMetadata(
      'agent-123',
      '.openclaw/workspace/preview.png',
      { maxBytes: 16, signal: abortController.signal },
    );

    expect(result.content).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.mimeType).toBe('image/png');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ signal: abortController.signal });
  });

  it('stops a chunked file read when it crosses the requested byte limit', async () => {
    const response = new Response(new globalThis.ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
        controller.close();
      },
    }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const deployments = new Deployments({ apiKey: 'hyper_api_test' } as unknown as HTTPClient, 'hyper_api_test', 'https://api.test.hypercli.com/agents');

    await expect(deployments.fileReadBytes(
      'agent-123',
      '.openclaw/workspace/large.txt',
      { maxBytes: 4 },
    )).rejects.toThrow(/exceeds the .* read limit/i);
  });

  it('hydrates gateway urls without hydrating gateway Secrets', () => {
    const agent = OpenClawAgent.fromDict({
      id: 'agent-123',
      user_id: 'user-456',
      state: 'running',
      hostname: 'openclaw-test.hypercli.com',
      gateway_token: 'must-not-hydrate',
    });
    const proAgent = OpenClawProAgent.fromDict({
      id: 'agent-pro',
      user_id: 'user-456',
      state: 'running',
      hostname: 'openclaw-pro.hypercli.com',
      gateway_token: 'must-not-hydrate',
    });

    expect(agent.gatewayUrl).toBe('wss://openclaw-test.hypercli.com');
    expect(agent.gatewayToken).toBeNull();
    expect(proAgent.gatewayUrl).toBe('wss://openclaw-pro.hypercli.com');
    expect(proAgent.gatewayToken).toBeNull();
  });

  it('moves pooled lifecycle callbacks to the current gateway lease', () => {
    const close = vi.fn();
    const setGatewayToken = vi.fn();
    let clientOptions: any;
    const manager = new OpenClawGatewayConnectionManager({
      clientFactory: (options) => {
        clientOptions = options;
        return { close, setGatewayToken } as any;
      },
    });
    const firstGap = vi.fn();
    const secondGap = vi.fn();
    const request = (onGap: () => void, gatewayToken: string) => ({
      deploymentId: 'agent-123',
      launchEpoch: 3,
      generation: manager.generation('agent-123'),
      options: {
        url: 'wss://openclaw-test.hypercli.com',
        gatewayToken,
        clientId: 'openclaw-control-ui',
        clientMode: 'webchat',
        onGap,
      },
    });

    const firstLease = manager.acquire(request(firstGap, 'gw-old'));
    firstLease.release();
    const secondLease = manager.acquireExisting(request(secondGap, 'gw-new'));

    expect(secondLease?.client).toBe(firstLease.client);
    expect(setGatewayToken).toHaveBeenLastCalledWith('gw-new');
    clientOptions.onGap({ expected: 2, received: 4 });
    expect(firstGap).not.toHaveBeenCalled();
    expect(secondGap).toHaveBeenCalledTimes(1);

    secondLease?.release();
    manager.dispose();
  });

  it('evicts the oldest idle gateway above the configured connection bound', async () => {
    vi.useFakeTimers();
    const clients: Array<{ close: ReturnType<typeof vi.fn>; setGatewayToken: ReturnType<typeof vi.fn> }> = [];
    const manager = new OpenClawGatewayConnectionManager({
      maxConnections: 2,
      idleTimeoutMs: 100,
      clientFactory: () => {
        const client = { close: vi.fn(), setGatewayToken: vi.fn() };
        clients.push(client);
        return client as any;
      },
    });
    const acquire = (deploymentId: string) => manager.acquire({
      deploymentId,
      launchEpoch: 1,
      generation: manager.generation(deploymentId),
      options: { url: `wss://${deploymentId}.example.test` },
    });

    acquire('agent-a').release();
    await vi.advanceTimersByTimeAsync(1);
    acquire('agent-b').release();
    await vi.advanceTimersByTimeAsync(1);
    const current = acquire('agent-c');

    expect(manager.size).toBe(2);
    expect(clients[0].close).toHaveBeenCalledTimes(1);
    expect(clients[1].close).not.toHaveBeenCalled();
    expect(clients[2].close).not.toHaveBeenCalled();

    current.release();
    await vi.advanceTimersByTimeAsync(100);
    expect(manager.size).toBe(0);
  });

  it('replaces a pooled gateway when the deployment launch context changes', () => {
    const clients: Array<{ close: ReturnType<typeof vi.fn>; setGatewayToken: ReturnType<typeof vi.fn> }> = [];
    const manager = new OpenClawGatewayConnectionManager({
      clientFactory: () => {
        const client = { close: vi.fn(), setGatewayToken: vi.fn() };
        clients.push(client);
        return client as any;
      },
    });
    const first = manager.acquire({
      deploymentId: 'agent-123',
      launchEpoch: 1,
      generation: manager.generation('agent-123'),
      options: { url: 'wss://launch-1.example.test' },
    });
    first.release();

    const second = manager.acquire({
      deploymentId: 'agent-123',
      launchEpoch: 2,
      generation: manager.generation('agent-123'),
      options: { url: 'wss://launch-2.example.test' },
    });

    expect(second.client).not.toBe(first.client);
    expect(clients[0].close).toHaveBeenCalledTimes(1);
    second.release();
    manager.dispose();
  });

  it('rejects an older gateway context after a newer launch epoch is pooled', () => {
    const manager = new OpenClawGatewayConnectionManager({
      clientFactory: () => ({ close: vi.fn(), setGatewayToken: vi.fn() }) as any,
    });
    const generation = manager.generation('agent-123');
    const current = manager.acquire({
      deploymentId: 'agent-123',
      launchEpoch: 4,
      generation,
      options: { url: 'wss://launch-4.example.test' },
    });

    expect(() => manager.acquire({
      deploymentId: 'agent-123',
      launchEpoch: 3,
      generation,
      options: { url: 'wss://launch-3.example.test' },
    })).toThrow(/stale.*launch epoch 3 < 4/i);
    expect(manager.size).toBe(1);

    current.release();
    manager.dispose();
  });

  it('rejects acquisitions invalidated while gateway context is resolving', () => {
    const manager = new OpenClawGatewayConnectionManager({
      clientFactory: () => ({ close: vi.fn(), setGatewayToken: vi.fn() }) as any,
    });
    const generation = manager.generation('agent-123');

    manager.invalidate('agent-123');

    expect(() => manager.acquire({
      deploymentId: 'agent-123',
      launchEpoch: 3,
      generation,
      options: { url: 'wss://launch-3.example.test' },
    })).toThrow(/acquisition.*invalidated/i);
    manager.dispose();
  });

  it('does not repopulate a disposed gateway manager', () => {
    const manager = new OpenClawGatewayConnectionManager({
      clientFactory: () => ({ close: vi.fn(), setGatewayToken: vi.fn() }) as any,
    });
    const generation = manager.generation('agent-123');

    manager.dispose();

    expect(() => manager.acquire({
      deploymentId: 'agent-123',
      launchEpoch: 3,
      generation,
      options: { url: 'wss://launch-3.example.test' },
    })).toThrow(/manager is disposed/i);
  });

  it('allows active leases above the warm connection cap and trims them as they release', () => {
    const clients: Array<{ close: ReturnType<typeof vi.fn>; setGatewayToken: ReturnType<typeof vi.fn> }> = [];
    const manager = new OpenClawGatewayConnectionManager({
      maxConnections: 6,
      clientFactory: () => {
        const client = { close: vi.fn(), setGatewayToken: vi.fn() };
        clients.push(client);
        return client as any;
      },
    });
    const leases = Array.from({ length: 7 }, (_, index) => {
      const deploymentId = `agent-${index}`;
      return manager.acquire({
        deploymentId,
        launchEpoch: 1,
        generation: manager.generation(deploymentId),
        options: { url: `wss://${deploymentId}.example.test` },
      });
    });

    expect(manager.size).toBe(7);
    expect(clients.every((client) => client.close.mock.calls.length === 0)).toBe(true);

    leases[0].release();
    expect(manager.size).toBe(6);
    expect(clients[0].close).toHaveBeenCalledTimes(1);

    for (const lease of leases.slice(1)) lease.release();
    manager.dispose();
  });

  it('retires a non-reusable gateway only after its final active lease releases', () => {
    const close = vi.fn();
    const manager = new OpenClawGatewayConnectionManager({
      clientFactory: () => ({ close, setGatewayToken: vi.fn() }) as any,
    });
    const request = {
      deploymentId: 'agent-123',
      launchEpoch: 1,
      generation: manager.generation('agent-123'),
      options: { url: 'wss://agent-123.example.test' },
    };
    const first = manager.acquire(request);
    const second = manager.acquireExisting(request);

    first.release({ retain: false });
    expect(close).not.toHaveBeenCalled();
    expect(manager.size).toBe(1);

    expect(manager.acquireExisting(request)).toBeNull();
    const replacement = manager.acquire(request);
    expect(replacement.client).not.toBe(first.client);
    expect(manager.size).toBe(2);

    second?.release();
    expect(close).toHaveBeenCalledTimes(1);
    expect(manager.size).toBe(1);

    replacement.release();
    manager.dispose();
  });
});
