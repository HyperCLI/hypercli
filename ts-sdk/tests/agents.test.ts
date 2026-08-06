import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Agent,
  agentConfigHasDesktop,
  buildAgentConfig,
  buildBrowserDesktopUrl,
  DEFAULT_AGENT_RUNTIME_SCOPES,
  Deployments,
  flattenLaunchConfig,
  launchConfigHasDesktop,
  OpenClawAgent,
  OpenClawProAgent,
  attachSlackRelayAgent,
  getSlackInstallStatus,
  listSlackDirectoryConversations,
  listSlackDirectoryUsers,
  startSlackOAuth,
} from '../src/agents.js';
import { HyperCLI } from '../src/client.js';
import { APIError } from '../src/errors.js';
import { HTTPClient } from '../src/http.js';

describe('Agents SDK', () => {
  afterEach(() => {
    vi.useRealTimers();
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

  it('preserves an explicit false restart setting and omits an unspecified one', () => {
    const omitted = buildAgentConfig({}, { injectGatewayToken: false }).config;
    const disabled = buildAgentConfig({}, {
      injectGatewayToken: false,
      restart: false,
    }).config;

    expect(omitted).not.toHaveProperty('restart');
    expect(disabled.restart).toBe(false);
  });

  it('preserves omitted, null, and empty sync policy fields', () => {
    const omitted = buildAgentConfig({}, { injectGatewayToken: false }).config;
    const includeAll = buildAgentConfig({}, {
      injectGatewayToken: false,
      syncInclude: null,
    }).config;
    const excludeAll = buildAgentConfig({}, {
      injectGatewayToken: false,
      syncExclude: null,
    }).config;
    const syncNothing = buildAgentConfig({}, {
      injectGatewayToken: false,
      syncInclude: [],
    }).config;

    expect(omitted).not.toHaveProperty('sync_include');
    expect(omitted).not.toHaveProperty('sync_exclude');
    expect(includeAll).toEqual({ sync_include: null });
    expect(excludeAll).toEqual({ sync_exclude: null });
    expect(syncNothing).toEqual({ sync_include: [] });
  });

  it('serializes runtime scopes as a top-level launch field', () => {
    const { config } = buildAgentConfig({}, {
      injectGatewayToken: false,
      runtimeScopes: ['models:*', 'workspaces:*'],
    });

    expect(config.runtime_scopes).toEqual(['models:*', 'workspaces:*']);
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
    expect(agent.managed).toBeNull();
  });

  it('hydrates transition epochs and future public states', async () => {
    const http = {
      get: vi.fn().mockResolvedValue({
        id: 'agent-123',
        state: 'FUTURE_STATE',
        placement_epoch: 8,
        runtime_generation: 3,
        finalize_epoch: 2,
        restore_state: 'FUTURE_RESTORE',
      }),
    } as unknown as HTTPClient;
    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');

    const agent = await deployments.get('agent-123');

    expect(agent.state).toBe('FUTURE_STATE');
    expect(agent.placementEpoch).toBe(8);
    expect(agent.runtimeGeneration).toBe(3);
    expect(agent.finalizeEpoch).toBe(2);
    expect(agent.restoreState).toBe('FUTURE_RESTORE');
  });

  it('hydrates REST before subscribing and resyncs after ready', async () => {
    const get = vi.fn().mockResolvedValue({ items: [] });
    const post = vi.fn().mockResolvedValue({
      version: 1,
      token: 'event-token',
      ws_url: 'wss://events.test/ws/deployments',
    });
    const http = { get, post } as unknown as HTTPClient;
    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');
    const controller = new AbortController();
    const received: string[] = [];

    class FakeWebSocket extends EventTarget {
      static OPEN = 1;
      readyState = FakeWebSocket.OPEN;
      constructor(public readonly url: string) {
        super();
        queueMicrotask(() => this.dispatchEvent(new Event('open')));
      }
      send(payload: string) {
        expect(JSON.parse(payload)).toEqual({ version: 1, type: 'auth', token: 'event-token' });
        for (const frame of [
          { version: 1, type: 'ready' },
          {
            version: 1,
            type: 'deployment.transition',
            deployment_id: 'agent-123',
            state: 'RUNNING',
            placement_epoch: 8,
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
      received.push(event.type);
      if (event.type === 'deployment.transition') controller.abort();
    }, { signal: controller.signal });

    expect(get).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenCalledWith(
      '/deployments/events/token',
      undefined,
      { signal: controller.signal },
    );
    expect(received).toEqual(['deployments.changed', 'deployment.transition']);
  });

  it('passes cancellation through initial REST hydration', async () => {
    const controller = new AbortController();
    const get = vi.fn((_path: string, _params: unknown, requestOptions: { signal: AbortSignal }) => (
      new Promise((_resolve, reject) => {
        requestOptions.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      })
    ));
    const http = { get } as unknown as HTTPClient;
    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');

    const subscription = deployments.subscribe(() => undefined, { signal: controller.signal });
    controller.abort();

    await expect(subscription).rejects.toThrow('aborted');
    expect(get.mock.calls[0]?.[2]?.signal).toBe(controller.signal);
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

    expect(get).toHaveBeenCalledTimes(1);
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
      version: 1,
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
            value: JSON.stringify({ version: 1, type: 'ready' }),
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

    const subscription = deployments.subscribe(() => {
      resyncs += 1;
      if (resyncs === 2) controller.abort();
    }, { signal: controller.signal });

    await vi.advanceTimersByTimeAsync(0);
    expect(post).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(249);
    expect(post).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await subscription;

    expect(post).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledTimes(3);
    expect(resyncs).toBe(2);
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

  it('preserves the transitional stopping state returned by stop', async () => {
    const http = {
      get: vi.fn().mockResolvedValue({
        id: 'agent-123',
        user_id: 'user-456',
        pod_id: 'pod-789',
        pod_name: 'pod-789',
        state: 'running',
      }),
      post: vi.fn().mockResolvedValue({
        id: 'agent-123',
        user_id: 'user-456',
        pod_id: 'pod-789',
        pod_name: 'pod-789',
        state: 'stopping',
      }),
    } as unknown as HTTPClient;

    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');
    const agent = await deployments.stop('agent-123');

    expect(agent.state).toBe('stopping');
    expect(http.post).toHaveBeenCalledWith('/deployments/agent-123/stop');
  });

  it('passes self directly for status, lifecycle, and route operations', async () => {
    const agentResponse = {
      id: 'agent-123',
      user_id: 'user-456',
      pod_id: 'pod-789',
      pod_name: 'pod-789',
      state: 'running',
    };
    const routesResponse = {
      agent_id: 'agent-123',
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

    expect((await deployments.get('self')).id).toBe('agent-123');
    await deployments.start('self');
    await deployments.stop('self');
    const routes = await deployments.getRoutes('self');
    await deployments.setRoutes('self', routes.routes);
    await deployments.setRoute('self', 'web app', { port: 3000, auth: false, prefix: '' });
    await deployments.removeRoute('self', 'web app');

    expect(http.get).toHaveBeenCalledWith('/deployments/self');
    expect(http.post).toHaveBeenCalledWith('/deployments/self/start', {});
    expect(http.post).toHaveBeenCalledWith('/deployments/self/stop');
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
      agentId: 'agent-123',
      routes: routesResponse.routes,
      routeStatuses: routesResponse.route_statuses,
    });

    await expect(
      deployments.start('self', { image: 'ghcr.io/example/override:latest' }),
    ).rejects.toThrow('backend-stored launch configuration');
    await expect(
      deployments.start('self', { syncInclude: null }),
    ).rejects.toThrow('syncInclude');
    await expect(deployments.startOpenClaw('self')).rejects.toThrow(
      'backend-stored launch configuration',
    );
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
      pod_id: 'pod-789',
      pod_name: 'pod-789',
      state: 'RUNNING',
      hostname: 'agent.hypercli.app',
      gateway_token: 'gw-token',
    });
    const gateway = {
      channelsStatus: vi.fn(async () => ({ ok: true })),
      channelsStart: vi.fn(async () => ({ started: true })),
      channelsStop: vi.fn(async () => ({ stopped: true })),
      close: vi.fn(),
    };
    vi.spyOn(agent, 'connect').mockResolvedValue(gateway as any);

    await expect(agent.channelsStatus({ probe: true, timeoutMs: 123, channel: 'slack' })).resolves.toEqual({ ok: true });
    await expect(agent.channelsStart('slack', 'work')).resolves.toEqual({ started: true });
    await expect(agent.channelsStop('slack', 'work')).resolves.toEqual({ stopped: true });

    expect(gateway.channelsStatus).toHaveBeenCalledWith(true, 123, 'slack');
    expect(gateway.channelsStart).toHaveBeenCalledWith('slack', 'work');
    expect(gateway.channelsStop).toHaveBeenCalledWith('slack', 'work');
    expect(gateway.close).toHaveBeenCalledTimes(3);
  });

  it('exposes OpenClaw cron mutation wrappers', async () => {
    const agent = OpenClawAgent.fromDict({
      id: 'agent-123',
      user_id: 'user-456',
      pod_id: 'pod-789',
      pod_name: 'pod-789',
      state: 'RUNNING',
      hostname: 'agent.hypercli.app',
      gateway_token: 'gw-token',
    });
    const gateway = {
      cronAdd: vi.fn(async () => ({ id: 'job-1' })),
      cronRemove: vi.fn(async () => undefined),
      cronRun: vi.fn(async () => ({ ran: true })),
      close: vi.fn(),
    };
    vi.spyOn(agent, 'connect').mockResolvedValue(gateway as any);

    const job = { id: 'job-1', every: '1h', prompt: 'ping' };
    await expect(agent.cronAdd(job)).resolves.toEqual({ id: 'job-1' });
    await expect(agent.cronRemove('job-1')).resolves.toBeUndefined();
    await expect(agent.cronRun('job-1')).resolves.toEqual({ ran: true });

    expect(gateway.cronAdd).toHaveBeenCalledWith(job);
    expect(gateway.cronRemove).toHaveBeenCalledWith('job-1');
    expect(gateway.cronRun).toHaveBeenCalledWith('job-1');
    expect(gateway.close).toHaveBeenCalledTimes(3);
  });

  it('captures OpenClaw operations concurrently over one gateway connection', async () => {
    vi.useFakeTimers();
    const capturedAt = new Date('2026-08-03T12:00:00Z').valueOf();
    vi.setSystemTime(capturedAt);
    const agent = OpenClawAgent.fromDict({
      id: 'agent-123',
      user_id: 'user-456',
      pod_id: 'pod-789',
      pod_name: 'pod-789',
      state: 'RUNNING',
      hostname: 'agent.hypercli.app',
      gateway_token: 'gw-token',
    });
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
      connect: vi.fn(async () => undefined),
      sessionsListResult: vi.fn(() => pendingSessions),
      cronList: vi.fn(async () => cronJobs),
      close: vi.fn(),
    };
    const gatewayFactory = vi.spyOn(agent, 'gateway').mockReturnValue(gateway as any);

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
    expect(gatewayFactory).toHaveBeenCalledWith({ timeout: 1234 });
    expect(gateway.connect).toHaveBeenCalledOnce();
    expect(gateway.close).toHaveBeenCalledOnce();
  });

  it('preserves successful OpenClaw operations when one RPC fails', async () => {
    const agent = OpenClawAgent.fromDict({
      id: 'agent-123',
      user_id: 'user-456',
      pod_id: 'pod-789',
      pod_name: 'pod-789',
      state: 'RUNNING',
      hostname: 'agent.hypercli.app',
      gateway_token: 'gw-token',
    });
    const sessions = { sessions: [{ key: 'main' }] };
    const gateway = {
      connect: vi.fn(async () => undefined),
      sessionsListResult: vi.fn(async () => sessions),
      cronList: vi.fn().mockRejectedValue(new Error('cron unavailable')),
      close: vi.fn(),
    };
    vi.spyOn(agent, 'gateway').mockReturnValue(gateway as any);

    await expect(agent.operationsSnapshot()).resolves.toMatchObject({
      sessions,
      cronJobs: null,
      failures: { cron: 'cron unavailable' },
      capturedAt: expect.any(Number),
    });
    expect(gateway.close).toHaveBeenCalledOnce();
  });

  it('closes the OpenClaw operations gateway when connection fails', async () => {
    const agent = OpenClawAgent.fromDict({
      id: 'agent-123',
      user_id: 'user-456',
      pod_id: 'pod-789',
      pod_name: 'pod-789',
      state: 'RUNNING',
      hostname: 'agent.hypercli.app',
      gateway_token: 'gw-token',
    });
    const gateway = {
      connect: vi.fn().mockRejectedValue(new Error('gateway unavailable')),
      sessionsListResult: vi.fn(),
      cronList: vi.fn(),
      close: vi.fn(),
    };
    vi.spyOn(agent, 'gateway').mockReturnValue(gateway as any);

    await expect(agent.operationsSnapshot()).rejects.toThrow('gateway unavailable');
    expect(gateway.sessionsListResult).not.toHaveBeenCalled();
    expect(gateway.cronList).not.toHaveBeenCalled();
    expect(gateway.close).toHaveBeenCalledOnce();
  });

  it('hydrates granular restore and workspace sync states', async () => {
    const http = {
      get: vi.fn().mockResolvedValue({
        id: 'agent-123',
        user_id: 'user-456',
        pod_id: 'pod-789',
        pod_name: 'pod-789',
        state: 'SYNCING',
      }),
    } as unknown as HTTPClient;

    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');
    const agent = await deployments.get('agent-123');

    expect(agent.state).toBe('SYNCING');
  });

  it('fails waitRunning on granular init failure states', async () => {
    const http = {
      get: vi.fn().mockResolvedValue({
        id: 'agent-123',
        user_id: 'user-456',
        pod_id: 'pod-789',
        pod_name: 'pod-789',
        state: 'SYNC_FAILED',
        last_error: 'workspace sync failed',
        updated_at: '2026-07-27T12:00:00Z',
      }),
    } as unknown as HTTPClient;

    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');

    await expect(deployments.waitRunning('agent-123', 100, 0)).rejects.toThrow(
      'Agent entered SYNC_FAILED while waiting for RUNNING, lastError="workspace sync failed", updatedAt=2026-07-27T12:00:00.000Z',
    );
  });

  it('includes the latest lifecycle diagnostics when waitRunning times out', async () => {
    vi.useFakeTimers();
    const http = {
      get: vi.fn().mockResolvedValue({
        id: 'agent-123',
        user_id: 'user-456',
        pod_id: 'pod-789',
        pod_name: 'pod-789',
        state: 'RESTORING',
        last_error: 'restore init container is still waiting',
        updated_at: '2026-07-27T12:00:00Z',
      }),
    } as unknown as HTTPClient;

    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');

    const assertion = expect(deployments.waitRunning('agent-123', 1_000, 100)).rejects.toThrow(
      'Timed out waiting for agent agent-123 to reach RUNNING (last=RESTORING, lastError="restore init container is still waiting", updatedAt=2026-07-27T12:00:00.000Z)',
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
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

  it('resolves unique agent names before lifecycle calls', async () => {
    const get = vi.fn(async (path: string) => {
      if (path === '/deployments') {
        return {
          items: [{
            id: '11111111-1111-4111-8111-111111111111',
            user_id: 'user-456',
            pod_id: 'pod-789',
            pod_name: 'clear-window-works',
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
          pod_id: 'pod-789',
          pod_name: 'clear-window-works',
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
      pod_id: 'pod-789',
      pod_name: 'clear-window-works',
      name: 'clear-window-works',
      handle: 'coder',
      state: 'STARTING',
    }));
    const http = { get, post } as unknown as HTTPClient;
    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');

    const result = await deployments.start('clear-window-works', {
      restart: false,
      runtimeScopes: ['models:*'],
    });

    expect(result.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(post).toHaveBeenCalledWith(
      '/deployments/11111111-1111-4111-8111-111111111111/start',
      expect.objectContaining({
        restart: false,
        runtime_scopes: ['models:*'],
        env: expect.objectContaining({
          OPENCLAW_GATEWAY_TOKEN: expect.any(String),
        }),
      }),
    );

    const handleResult = await deployments.get('coder');

    expect(handleResult.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(get).not.toHaveBeenCalledWith('/deployments/coder');
  });

  it('starts OpenClaw Pro with default runtime scopes and honors overrides', async () => {
    const post = vi.fn().mockResolvedValue({
      id: 'agent-pro',
      user_id: 'user-456',
      pod_id: 'pod-pro',
      pod_name: 'pro',
      state: 'STARTING',
      runtime: 'openclaw-pro',
    });
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    const agentId = '11111111-1111-4111-8111-111111111111';
    await deployments.startOpenClawPro(agentId);
    await deployments.startOpenClawPro(agentId, { runtimeScopes: ['models:*'] });

    expect(post.mock.calls[0][1].runtime_scopes).toEqual(DEFAULT_AGENT_RUNTIME_SCOPES);
    expect(post.mock.calls[1][1].runtime_scopes).toEqual(['models:*']);
  });

  it('clears a saved selective-sync policy when OpenClaw starts with syncAll', async () => {
    const post = vi.fn().mockResolvedValue({
      id: 'agent-sync-all',
      user_id: 'user-456',
      pod_id: 'pod-sync-all',
      pod_name: 'sync-all',
      state: 'STARTING',
      runtime: 'openclaw',
    });
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    await deployments.startOpenClaw(
      '11111111-1111-4111-8111-111111111111',
      { syncAll: true },
    );

    expect(post.mock.calls[0][1]).toMatchObject({
      sync_include: null,
      sync_exclude: null,
    });
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

    await deployments.start(agentId);
    await deployments.start(agentId, { syncInclude: null });
    await deployments.start(agentId, { syncExclude: null });
    await deployments.start(agentId, { syncInclude: [] });

    expect(post.mock.calls[0][1]).not.toHaveProperty('sync_include');
    expect(post.mock.calls[0][1]).not.toHaveProperty('sync_exclude');
    expect(post.mock.calls[1][1]).toHaveProperty('sync_include', null);
    expect(post.mock.calls[1][1]).not.toHaveProperty('sync_exclude');
    expect(post.mock.calls[2][1]).toHaveProperty('sync_exclude', null);
    expect(post.mock.calls[2][1]).not.toHaveProperty('sync_include');
    expect(post.mock.calls[3][1]).toHaveProperty('sync_include', []);
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
      pod_id: 'pod-789',
      pod_name: 'buzz-agent',
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
      { restart: false },
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
        pod_id: null,
        pod_name: null,
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
              pod_id: 'pod-789',
              pod_name: 'clear-window-works',
              name: 'clear-window-works',
              state: 'STOPPED',
            }],
          };
        }
        if (path === '/deployments/11111111-1111-4111-8111-111111111111') {
          return {
            id: '11111111-1111-4111-8111-111111111111',
            user_id: 'user-456',
            pod_id: 'pod-789',
            pod_name: 'clear-window-works',
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

  it('builds browser desktop auth URLs with scaled noVNC redirects', () => {
    const url = buildBrowserDesktopUrl('https://desktop-agent.hypercli.com', ' jwt-123 ');

    expect(url).toBe('https://desktop-agent.hypercli.com/_jwt_auth?jwt=jwt-123&redirect=vnc.html%3Fresize%3Dscale');
  });

  it('hydrates new API agent fields without image_url fallback', () => {
    const agent = Agent.fromDict({
      id: 'agent-123',
      user_id: 'user-456',
      pod_id: 'pod-789',
      pod_name: 'pod-789',
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
      pod_id: 'pod-789',
      pod_name: 'pod-789',
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
      pod_id: 'pod-789',
      pod_name: 'pod-789',
      state: 'running',
      routes: { openclaw: { port: 18789 } },
      gateway_id: 'agent:11111111-1111-1111-1111-111111111111',
      gateway_token: 'gw-token',
    } as any);
    const client = { configureSlackRelay: vi.fn(async () => undefined), close: vi.fn() };
    vi.spyOn(agent, 'connect').mockResolvedValue(client as any);

    await agent.configureSlackRelay({ url: 'wss://api.dev.hypercli.com/slack/ws' });

    expect(client.configureSlackRelay).toHaveBeenCalledWith({
      url: 'wss://api.dev.hypercli.com/slack/ws',
      gatewayId: 'agent:11111111-1111-1111-1111-111111111111',
    });
    expect(client.close).toHaveBeenCalled();
  });

  it('configures channel integrations through connected gateway helpers', async () => {
    const agent = OpenClawAgent.fromDict({
      id: 'agent-123',
      user_id: 'user-456',
      pod_id: 'pod-789',
      pod_name: 'pod-789',
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
    vi.spyOn(agent, 'connect').mockResolvedValue(client as any);

    await agent.configureSlackSocket({ botToken: 'xoxb-token', appToken: 'xapp-token' }, { accountId: 'work' });
    await agent.configureTelegram({ enabled: true, dmPolicy: 'allowlist', allowFrom: ['123'] });
    await agent.configureWhatsapp({ enabled: true }, { accountId: 'default' });

    expect(client.configureSlackSocket).toHaveBeenCalledWith({ botToken: 'xoxb-token', appToken: 'xapp-token' }, 'work');
    expect(client.configureTelegram).toHaveBeenCalledWith({ enabled: true, dmPolicy: 'allowlist', allowFrom: ['123'] }, undefined);
    expect(client.configureWhatsapp).toHaveBeenCalledWith({ enabled: true }, 'default');
    expect(client.close).toHaveBeenCalledTimes(3);
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
      pod_id: 'pod-789',
      pod_name: 'pod-789',
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
      'pod',
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
      'pod',
      { maxBytes: 4 },
    )).rejects.toThrow(/exceeds the .* read limit/i);
  });

  it('hydrates gateway urls and skips context calls when url and token are complete', async () => {
    const deployments = {
      get: vi.fn(),
      env: vi.fn(),
    } as unknown as Deployments;
    const agent = OpenClawAgent.fromDict({
      id: 'agent-123',
      user_id: 'user-456',
      pod_id: 'pod-789',
      pod_name: 'pod-789',
      state: 'running',
      hostname: 'openclaw-test.hypercli.com',
      gateway_token: 'gw-inline',
    });
    const proAgent = OpenClawProAgent.fromDict({
      id: 'agent-pro',
      user_id: 'user-456',
      pod_id: 'pod-pro',
      pod_name: 'pod-pro',
      state: 'running',
      hostname: 'openclaw-pro.hypercli.com',
      gateway_token: 'gw-pro',
    });
    agent._deployments = deployments;

    const context = await agent.waitForGatewayContext();

    expect(agent.gatewayUrl).toBe('wss://openclaw-test.hypercli.com');
    expect(proAgent.gatewayUrl).toBe('wss://openclaw-pro.hypercli.com');
    expect(context).toEqual({
      agent_id: 'agent-123',
      hostname: 'openclaw-test.hypercli.com',
      gateway_token: 'gw-inline',
    });
    expect(deployments.get).not.toHaveBeenCalled();
    expect(deployments.env).not.toHaveBeenCalled();
  });

  it('fetches only env when the hydrated hostname already provides the gateway url', async () => {
    const deployments = {
      get: vi.fn(),
      env: vi.fn().mockResolvedValue({
        agent_id: 'agent-123',
        env: { OPENCLAW_GATEWAY_TOKEN: 'gw-fetched' },
      }),
    } as unknown as Deployments;
    const agent = OpenClawAgent.fromDict({
      id: 'agent-123',
      user_id: 'user-456',
      pod_id: 'pod-789',
      pod_name: 'pod-789',
      state: 'running',
      hostname: 'openclaw-test.hypercli.com',
    });
    agent._deployments = deployments;

    const context = await agent.waitForGatewayContext();

    expect(context.gateway_token).toBe('gw-fetched');
    expect(agent.gatewayUrl).toBe('wss://openclaw-test.hypercli.com');
    expect(deployments.get).not.toHaveBeenCalled();
    expect(deployments.env).toHaveBeenCalledOnce();
  });

  it('fetches only the deployment when the gateway token is already known', async () => {
    const deployments = {
      get: vi
        .fn()
        .mockResolvedValue(OpenClawAgent.fromDict({
          id: 'agent-123',
          user_id: 'user-456',
          pod_id: 'pod-789',
          pod_name: 'pod-789',
          state: 'running',
          hostname: 'openclaw-test.hypercli.com',
        })),
      env: vi.fn(),
    } as unknown as Deployments;
    const agent = OpenClawAgent.fromDict({
      id: 'agent-123',
      user_id: 'user-456',
      pod_id: 'pod-789',
      pod_name: 'pod-789',
      state: 'running',
      gateway_token: 'gw-inline',
    });
    agent._deployments = deployments;

    const context = await agent.waitForGatewayContext();

    expect(context.gateway_token).toBe('gw-inline');
    expect(agent.gatewayUrl).toBe('wss://openclaw-test.hypercli.com');
    expect(agent.gatewayToken).toBe('gw-inline');
    expect(deployments.get).toHaveBeenCalledOnce();
    expect(deployments.env).not.toHaveBeenCalled();
  });

  it('fetches deployment and env concurrently when both are missing', async () => {
    let resolveDeployment!: (agent: OpenClawAgent) => void;
    const deploymentResponse = new Promise<OpenClawAgent>((resolve) => {
      resolveDeployment = resolve;
    });
    const deployments = {
      get: vi.fn().mockReturnValue(deploymentResponse),
      env: vi.fn().mockResolvedValue({
        agent_id: 'agent-123',
        env: { OPENCLAW_GATEWAY_TOKEN: 'gw-fetched' },
      }),
    } as unknown as Deployments;
    const agent = OpenClawAgent.fromDict({
      id: 'agent-123',
      user_id: 'user-456',
      pod_id: 'pod-789',
      pod_name: 'pod-789',
      state: 'running',
    });
    agent._deployments = deployments;

    const contextPromise = agent.waitForGatewayContext();

    expect(deployments.get).toHaveBeenCalledOnce();
    expect(deployments.env).toHaveBeenCalledOnce();
    resolveDeployment(OpenClawAgent.fromDict({
      id: 'agent-123',
      user_id: 'user-456',
      pod_id: 'pod-789',
      pod_name: 'pod-789',
      state: 'running',
      hostname: 'openclaw-test.hypercli.com',
    }));
    await expect(contextPromise).resolves.toMatchObject({
      hostname: 'openclaw-test.hypercli.com',
      gateway_token: 'gw-fetched',
    });
  });

  it('waitForGatewayContext retries only the context that remains missing', async () => {
    const deployments = {
      get: vi
        .fn()
        .mockResolvedValueOnce(OpenClawAgent.fromDict({
          id: 'agent-123',
          user_id: 'user-456',
          pod_id: 'pod-789',
          pod_name: 'pod-789',
          state: 'running',
          hostname: null,
        }))
        .mockResolvedValueOnce(OpenClawAgent.fromDict({
          id: 'agent-123',
          user_id: 'user-456',
          pod_id: 'pod-789',
          pod_name: 'pod-789',
          state: 'running',
          hostname: 'openclaw-test.hypercli.com',
        })),
      env: vi.fn().mockResolvedValue({
        agent_id: 'agent-123',
        env: { OPENCLAW_GATEWAY_TOKEN: 'gw-fetched' },
      }),
    } as unknown as Deployments;
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
    expect(deployments.get).toHaveBeenCalledTimes(2);
    expect(deployments.env).toHaveBeenCalledOnce();
  });

  it('times out an in-flight gateway context attempt and aborts its requests', async () => {
    vi.useFakeTimers();
    const pending = new Promise<never>(() => undefined);
    const deployments = {
      get: vi.fn().mockReturnValue(pending),
      env: vi.fn().mockReturnValue(pending),
    } as unknown as Deployments;
    const agent = OpenClawAgent.fromDict({
      id: 'agent-123',
      user_id: 'user-456',
      pod_id: 'pod-789',
      pod_name: 'pod-789',
      state: 'running',
    });
    agent._deployments = deployments;

    const contextPromise = agent.waitForGatewayContext({ timeoutMs: 100 });
    const rejection = expect(contextPromise).rejects.toThrow('Timed out waiting for OpenClaw gateway context');

    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect((deployments.get.mock.calls[0]?.[1] as { signal: AbortSignal }).signal.aborted).toBe(true);
    expect((deployments.env.mock.calls[0]?.[1] as { signal: AbortSignal }).signal.aborted).toBe(true);
  });

  it('aborts an in-flight gateway context attempt from the caller signal', async () => {
    const pending = new Promise<never>(() => undefined);
    const deployments = {
      get: vi.fn().mockReturnValue(pending),
      env: vi.fn().mockReturnValue(pending),
    } as unknown as Deployments;
    const agent = OpenClawAgent.fromDict({
      id: 'agent-123',
      user_id: 'user-456',
      pod_id: 'pod-789',
      pod_name: 'pod-789',
      state: 'running',
    });
    agent._deployments = deployments;
    const controller = new AbortController();

    const contextPromise = agent.waitForGatewayContext({ signal: controller.signal });
    controller.abort();

    await expect(contextPromise).rejects.toMatchObject({ name: 'AbortError' });
    expect((deployments.get.mock.calls[0]?.[1] as { signal: AbortSignal }).signal.aborted).toBe(true);
    expect((deployments.env.mock.calls[0]?.[1] as { signal: AbortSignal }).signal.aborted).toBe(true);
  });
});
