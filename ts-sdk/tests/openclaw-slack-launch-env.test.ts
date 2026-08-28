import { describe, expect, it, vi } from 'vitest';

import { Agent, Deployments } from '../src/agents.js';
import {
  HostedSlackLaunchEnv,
} from '../src/channels.js';

const RELAY_BASE = 'https://api.agents.dev.hypercli.com';
const RELAY_WS = 'wss://api.dev.hypercli.com/slack/ws';
const RELAY_API = 'https://api.dev.hypercli.com/slack/api/';
const AGENT_ID = '6aed7114-0000-4000-8000-000000000001';

function createdAgentPayload(overrides: Record<string, any> = {}) {
  return {
    id: AGENT_ID,
    user_id: 'user-1',
    state: 'CREATING',
    launch_config: {
      image: 'ghcr.io/hypercli/hypercli-openclaw:latest',
      env: { HYPER_WORKSPACES_BOOT_SYNC: '1' },
      config: {},
    },
    ...overrides,
  };
}

function completeLaunchConfig(env: Record<string, string>): any {
  return {
    image: 'ghcr.io/hypercli/hypercli-openclaw:latest',
    env,
    secrets: {},
    config: {},
    routes: { openclaw: { port: 18789, auth: false, prefix: '' } },
    command: [],
    entrypoint: [],
    restart: true,
    sync_root: '/home/node',
    sync_uid: null,
    sync_gid: null,
    registry_url: null,
    registry_auth: null,
    runtime_scopes: [],
  };
}

function deploymentsWith(handlers: {
  post?: ReturnType<typeof vi.fn>;
  patch?: ReturnType<typeof vi.fn>;
  get?: ReturnType<typeof vi.fn>;
}) {
  const http = {
    post: handlers.post ?? vi.fn(),
    patch: handlers.patch ?? vi.fn(),
    get: handlers.get ?? vi.fn(),
    delete: vi.fn(),
    apiKey: 'hyper_api_test',
  } as any;
  return new Deployments(http, 'sk-hyper-test', 'https://api.dev.hypercli.com');
}

describe('hosted Slack launch env', () => {
  it('builds the complete four-key set the entrypoint requires', () => {
    expect(HostedSlackLaunchEnv.build({ relayBaseUrl: RELAY_BASE, agentId: AGENT_ID })).toEqual({
      HYPER_SLACK_APP_ENABLED: '1',
      HYPER_SLACK_RELAY_URL: RELAY_WS,
      HYPER_SLACK_API_URL: RELAY_API,
      HYPER_SLACK_GATEWAY_ID: `agent:${AGENT_ID}`,
    });
  });

  it('derives the gateway id the Backend derives', () => {
    expect(HostedSlackLaunchEnv.gatewayIdForAgent(AGENT_ID)).toBe(`agent:${AGENT_ID}`);
    expect(HostedSlackLaunchEnv.gatewayIdForAgent(`agent:${AGENT_ID}`)).toBe(`agent:${AGENT_ID}`);
    expect(() => HostedSlackLaunchEnv.gatewayIdForAgent('  ')).toThrow('requires an agent id');
  });

  it('reports every missing companion at once', () => {
    expect(() => HostedSlackLaunchEnv.assertComplete({ HYPER_SLACK_APP_ENABLED: '1' }))
      .toThrow(/HYPER_SLACK_RELAY_URL, HYPER_SLACK_API_URL, HYPER_SLACK_GATEWAY_ID/);
    expect(() => HostedSlackLaunchEnv.assertComplete({
      HYPER_SLACK_APP_ENABLED: 'true',
      HYPER_SLACK_RELAY_URL: RELAY_WS,
      HYPER_SLACK_API_URL: RELAY_API,
    })).toThrow(/HYPER_SLACK_GATEWAY_ID/);
    expect(() => HostedSlackLaunchEnv.assertComplete({
      HYPER_SLACK_APP_ENABLED: '0',
      HYPER_SLACK_RELAY_URL: RELAY_WS,
    })).not.toThrow();
  });

  it('repairs legacy enabled env with the gateway id for the Agent', () => {
    const env = {
      HYPER_SLACK_APP_ENABLED: '1',
      HYPER_SLACK_RELAY_URL: RELAY_WS,
      HYPER_SLACK_API_URL: RELAY_API,
    };

    expect(HostedSlackLaunchEnv.repairForAgent(env, { agentId: AGENT_ID })).toMatchObject({
      HYPER_SLACK_GATEWAY_ID: `agent:${AGENT_ID}`,
    });
    expect(() => HostedSlackLaunchEnv.assertComplete(env)).not.toThrow();
  });

  it('createOpenClaw completes the Slack env after the Agent id exists', async () => {
    const post = vi.fn().mockResolvedValue(createdAgentPayload());
    const patch = vi.fn().mockImplementation(async (_path: string, body: any) => ({
      ...createdAgentPayload({ state: 'STOPPED' }),
      launch_config: body.launch_config,
    }));
    const deployments = deploymentsWith({ post, patch });
    vi.spyOn(deployments, 'waitForState').mockResolvedValue(
      Agent.fromDict(createdAgentPayload({ state: 'STOPPED' })),
    );

    const agent = await deployments.createOpenClaw({
      name: 'vivid-nebula-bridge',
      slack: { relayBaseUrl: RELAY_BASE },
    });

    // Nothing Slack-shaped is POSTed: the gateway id is unknowable before the
    // Backend assigns the Agent id, and a partial set is what kills the pod.
    const postedEnv = post.mock.calls[0]?.[1]?.env ?? {};
    for (const key of Object.keys(postedEnv)) expect(key.startsWith('HYPER_SLACK_')).toBe(false);

    expect(patch).toHaveBeenCalledTimes(1);
    const patchedEnv = patch.mock.calls[0]?.[1]?.launch_config?.env;
    expect(patchedEnv).toMatchObject({
      HYPER_SLACK_APP_ENABLED: '1',
      HYPER_SLACK_RELAY_URL: RELAY_WS,
      HYPER_SLACK_API_URL: RELAY_API,
      HYPER_SLACK_GATEWAY_ID: `agent:${AGENT_ID}`,
    });
    expect(patchedEnv.HYPER_WORKSPACES_BOOT_SYNC).toBe('1');
    expect(patch.mock.calls[0]?.[1]?.launch_config).not.toHaveProperty('config');
    expect(agent.launchConfig?.env).toMatchObject({ HYPER_SLACK_GATEWAY_ID: `agent:${AGENT_ID}` });
  });

  it('createOpenClaw derives the relay base from the agents API base', async () => {
    const post = vi.fn().mockResolvedValue(createdAgentPayload({ state: 'STOPPED' }));
    const patch = vi.fn().mockImplementation(async (_path: string, body: any) => ({
      ...createdAgentPayload({ state: 'STOPPED' }),
      launch_config: body.launch_config,
    }));
    const deployments = deploymentsWith({ post, patch });
    vi.stubEnv('HYPER_SLACK_RELAY_BASE_URL', '');
    vi.stubEnv('SLACK_RELAY_BASE_URL', '');

    await deployments.createOpenClaw({ name: 'test-agent', slack: true });

    expect(patch.mock.calls[0]?.[1]?.launch_config?.env).toMatchObject({
      HYPER_SLACK_RELAY_URL: RELAY_WS,
      HYPER_SLACK_API_URL: RELAY_API,
    });
    vi.unstubAllEnvs();
  });

  it('finishes the hosted Slack launch contract for a recovered stopped Agent', async () => {
    const get = vi.fn().mockResolvedValue(createdAgentPayload({
      state: 'STOPPED',
      runtime: 'openclaw',
    }));
    const patch = vi.fn().mockImplementation(async (_path: string, body: any) => ({
      ...createdAgentPayload({ state: 'STOPPED', runtime: 'openclaw' }),
      launch_config: body.launch_config,
    }));
    const deployments = deploymentsWith({ get, patch });

    const recovered = await deployments.ensureOpenClawHostedSlack(AGENT_ID, RELAY_BASE);

    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0]?.[1]?.launch_config?.env).toMatchObject({
      HYPER_SLACK_APP_ENABLED: '1',
      HYPER_SLACK_RELAY_URL: RELAY_WS,
      HYPER_SLACK_API_URL: RELAY_API,
      HYPER_SLACK_GATEWAY_ID: `agent:${AGENT_ID}`,
    });
    expect(recovered.launchConfig).not.toHaveProperty('config');
  });

  it('createOpenClaw refuses an explicitly partial Slack env', async () => {
    const post = vi.fn();
    const deployments = deploymentsWith({ post });

    await expect(deployments.createOpenClaw({
      name: 'test-agent',
      env: { HYPER_SLACK_APP_ENABLED: '1', HYPER_SLACK_RELAY_URL: RELAY_WS, HYPER_SLACK_API_URL: RELAY_API },
    })).rejects.toThrow(/HYPER_SLACK_GATEWAY_ID/);
    expect(post).not.toHaveBeenCalled();
  });

  it('createOpenClaw accepts a complete explicit Slack env unchanged', async () => {
    const post = vi.fn().mockResolvedValue(createdAgentPayload({ state: 'STOPPED' }));
    const patch = vi.fn();
    const deployments = deploymentsWith({ post, patch });

    await deployments.createOpenClaw({
      name: 'test-agent',
      env: HostedSlackLaunchEnv.build({ relayBaseUrl: RELAY_BASE, agentId: AGENT_ID }),
    });

    expect(post.mock.calls[0]?.[1]?.env).toMatchObject({
      HYPER_SLACK_APP_ENABLED: '1',
      HYPER_SLACK_GATEWAY_ID: `agent:${AGENT_ID}`,
    });
    expect(patch).not.toHaveBeenCalled();
  });

  it('createOpenClaw refuses hand-built Slack env alongside the slack flag', async () => {
    const post = vi.fn();
    const deployments = deploymentsWith({ post });

    await expect(deployments.createOpenClaw({
      name: 'test-agent',
      slack: true,
      env: { HYPER_SLACK_APP_ENABLED: '1' },
    })).rejects.toThrow(/state the intent with slack/);
    expect(post).not.toHaveBeenCalled();
  });

  it('createOpenClaw refuses Slack launch env passed as Secrets', async () => {
    const post = vi.fn();
    const deployments = deploymentsWith({ post });

    await expect(deployments.createOpenClaw({
      name: 'test-agent',
      secrets: { HYPER_SLACK_GATEWAY_ID: `agent:${AGENT_ID}` },
    })).rejects.toThrow(/is launch env, not a Secret/);
    expect(post).not.toHaveBeenCalled();
  });

  it('createOpenClaw refuses a Slack dry run without an explicit gateway id', async () => {
    const post = vi.fn();
    const deployments = deploymentsWith({ post });

    await expect(deployments.createOpenClaw({ name: 'test-agent', slack: true, dryRun: true }))
      .rejects.toThrow(/dry runs cannot preview hosted Slack/);
    expect(post).not.toHaveBeenCalled();
  });

  it('startOpenClaw repairs a stored launch env that predates the gateway id', async () => {
    const post = vi.fn().mockResolvedValue({ ...createdAgentPayload({ state: 'STARTING' }) });
    const get = vi.fn().mockResolvedValue(createdAgentPayload({ state: 'STOPPED' }));
    const deployments = deploymentsWith({ post, get });

    await deployments.startOpenClaw(AGENT_ID, {
      launchConfig: completeLaunchConfig({
        HYPER_SLACK_APP_ENABLED: '1',
        HYPER_SLACK_RELAY_URL: RELAY_WS,
        HYPER_SLACK_API_URL: RELAY_API,
      }),
    });

    const startBody = post.mock.calls.at(-1)?.[1];
    expect(startBody?.launch_config?.env).toMatchObject({
      HYPER_SLACK_APP_ENABLED: '1',
      HYPER_SLACK_GATEWAY_ID: `agent:${AGENT_ID}`,
    });
  });

  it('startOpenClaw refuses a launch env whose relay URL is missing', async () => {
    const post = vi.fn();
    const get = vi.fn().mockResolvedValue(createdAgentPayload({ state: 'STOPPED' }));
    const deployments = deploymentsWith({ post, get });

    await expect(deployments.startOpenClaw(AGENT_ID, {
      launchConfig: completeLaunchConfig({ HYPER_SLACK_APP_ENABLED: '1' }),
    })).rejects.toThrow(/HYPER_SLACK_RELAY_URL/);
    expect(post).not.toHaveBeenCalled();
  });
});
