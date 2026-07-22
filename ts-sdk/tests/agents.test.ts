import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Agent,
  agentConfigHasDesktop,
  buildAgentConfig,
  buildBrowserDesktopUrl,
  Deployments,
  flattenLaunchConfig,
  launchConfigHasDesktop,
  OpenClawAgent,
  attachSlackRelayAgent,
  getSlackInstallStatus,
  listSlackDirectoryConversations,
  listSlackDirectoryUsers,
  startSlackOAuth,
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
      }),
    } as unknown as HTTPClient;

    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');

    await expect(deployments.waitRunning('agent-123', 100, 0)).rejects.toThrow('SYNC_FAILED');
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
    });
    const post = vi.fn(async () => ({
      id: '11111111-1111-4111-8111-111111111111',
      user_id: 'user-456',
      pod_id: 'pod-789',
      pod_name: 'clear-window-works',
      name: 'clear-window-works',
      state: 'STARTING',
    }));
    const http = { get, post } as unknown as HTTPClient;
    const deployments = new Deployments(http, 'hyper_api_test', 'https://api.test.hypercli.com/agents');

    const result = await deployments.start('clear-window-works');

    expect(result.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(post).toHaveBeenCalledWith(
      '/deployments/11111111-1111-4111-8111-111111111111/start',
      expect.objectContaining({
        env: expect.objectContaining({
          OPENCLAW_GATEWAY_TOKEN: expect.any(String),
        }),
      }),
    );
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
    const http = { apiKey: 'hyper_api_test', get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } as unknown as HTTPClient;
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
    expect(legacy.isLaunchable).toBe(false);
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
