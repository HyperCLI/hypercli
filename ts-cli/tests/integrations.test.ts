/**
 * Tests for `hyper integrations` (src/commands/integrations.ts).
 *
 * Mock seam: CommandContext.client is an injectable lazy factory — tests pass
 * a fake HyperCLI straight through ctx, capturing stdout/stderr via spies.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APIError, type HyperCLI } from '@hypercli.com/sdk';
import * as integrations from '../src/commands/integrations.js';
import { UsageError } from '../src/core/errors.js';
import { createOutput } from '../src/core/output.js';
import type { CommandContext } from '../src/core/types.js';

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let stdoutChunks: string[];
let stderrChunks: string[];

const stdout = () => stdoutChunks.join('');
const stderr = () => stderrChunks.join('');

beforeEach(() => {
  stdoutChunks = [];
  stderrChunks = [];
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdoutChunks.push(String(chunk));
    return true;
  }) as typeof stdoutSpy;
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderrChunks.push(String(chunk));
    return true;
  }) as typeof stderrSpy;
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
});

interface FakeHandlers {
  listProviders?: () => Promise<unknown>;
  listConnections?: () => Promise<unknown>;
  setConnectionEnabled?: (provider: string, enabled: boolean) => Promise<unknown>;
  mintToken?: () => Promise<unknown>;
  getAgent?: (ref: string) => Promise<unknown>;
  updateAgent?: (ref: string, options: unknown) => Promise<unknown>;
}

function fakeClient(handlers: FakeHandlers): HyperCLI {
  return {
    integrations: {
      listProviders: handlers.listProviders ?? (async () => []),
      listConnections: handlers.listConnections ?? (async () => []),
      setConnectionEnabled: handlers.setConnectionEnabled ?? (async () => ({})),
      mintToken: handlers.mintToken ?? (async () => ({})),
    },
    deployments: {
      get: handlers.getAgent ?? (async () => ({ id: 'agent-1', name: 'my-agent', meta: null })),
      update: handlers.updateAgent ?? (async () => ({})),
    },
  } as unknown as HyperCLI;
}

function makeCtx(client: HyperCLI, format: 'table' | 'json'): CommandContext {
  return {
    client: vi.fn(async () => client),
    output: createOutput(format),
    format,
    dev: false,
  };
}

describe('hyper integrations token', () => {
  it('prints ONLY the bare token on stdout; metadata goes to stderr', async () => {
    const client = fakeClient({
      mintToken: async () => ({
        provider: 'github',
        accessToken: 'gho_token123',
        expiresAt: '2026-10-01T00:00:00Z',
        stack: 'prod',
      }),
    });

    await integrations.run(makeCtx(client, 'table'), ['token', 'github']);

    expect(stdout()).toBe('gho_token123\n');
    expect(stderr()).toContain('github');
    expect(stderr()).toContain('2026-10-01T00:00:00Z');
  });

  it('unknown provider surfaces the server 404 detail verbatim', async () => {
    const client = fakeClient({
      mintToken: async () => {
        throw new APIError(404, "Unknown integration 'gitlab'");
      },
    });

    await expect(integrations.run(makeCtx(client, 'table'), ['token', 'gitlab'])).rejects.toMatchObject({
      message: expect.stringContaining("Unknown integration 'gitlab'"),
    });
    expect(stdout()).toBe('');
  });
});

describe('hyper integrations connections', () => {
  it('renders the NAME/CONNECTED/ENABLED/BACKEND table', async () => {
    const client = fakeClient({
      listConnections: async () => [
        {
          name: 'github',
          providerId: 'github',
          displayName: 'GitHub',
          auth: 'oauth2',
          modes: ['token', 'proxy'],
          backend: 'nango',
          iconUrl: '/integrations/icons/github.svg',
          categories: null,
          docsUrl: null,
          description: null,
          connected: true,
          backendAvailable: true,
          connection: { id: 'conn_1', errors: [], hyperEnabled: true, createdAt: '2026-09-01T00:00:00Z' },
        },
        {
          name: 'slack',
          providerId: 'slack',
          displayName: 'Slack',
          auth: 'oauth2',
          modes: [],
          backend: 'relay',
          iconUrl: '/integrations/icons/slack.svg',
          categories: null,
          docsUrl: null,
          description: null,
          connected: false,
          backendAvailable: false,
          connection: null,
        },
      ],
    });

    await integrations.run(makeCtx(client, 'table'), ['connections']);

    expect(stdout()).toBe(
      [
        'NAME    CONNECTED  ENABLED  BACKEND',
        'github  yes        yes      nango',
        'slack   no                  relay (unavailable)',
      ].join('\n') + '\n',
    );
  });

  it('emits the raw entries in json mode', async () => {
    const rows = [{ name: 'github', connected: true }];
    const client = fakeClient({ listConnections: async () => rows });

    await integrations.run(makeCtx(client, 'json'), ['connections', '--json']);

    expect(JSON.parse(stdout())).toEqual(rows);
  });
});

function connectionFixture(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    name: 'github',
    providerId: 'github',
    displayName: 'GitHub',
    auth: 'oauth2',
    modes: ['token', 'proxy'],
    backend: 'nango',
    iconUrl: '/integrations/icons/github.svg',
    categories: null,
    docsUrl: null,
    description: null,
    connected: true,
    backendAvailable: true,
    connection: { id: 'conn_1', errors: [], hyperEnabled: true, createdAt: '2026-09-01T00:00:00Z' },
    ...overrides,
  };
}

describe('hyper integrations status', () => {
  it('renders PROVIDER/CONNECTED/FACADE/AGENT/EFFECTIVE per provider', async () => {
    const client = fakeClient({
      listConnections: async () => [
        connectionFixture({ name: 'github' }),
        connectionFixture({
          name: 'slack',
          backend: 'relay',
          connection: { id: 'conn_2', errors: [], hyperEnabled: false, createdAt: '2026-09-01T00:00:00Z' },
        }),
        connectionFixture({ name: 'notion' }),
        connectionFixture({ name: 'linear', connected: false, connection: null }),
      ],
      getAgent: async (ref: string) => {
        expect(ref).toBe('self');
        return {
          id: 'agent-1',
          name: 'my-agent',
          meta: { integrations: { notion: { enabled: false } } },
        };
      },
    });

    await integrations.run(makeCtx(client, 'table'), ['status', 'self']);

    expect(stdout()).toBe(
      [
        'PROVIDER  CONNECTED  FACADE  AGENT     EFFECTIVE',
        'github    yes        on      unset     yes',
        'slack     yes        off     unset     no',
        'notion    yes        on      disabled  no',
        'linear    no         –       unset     no',
      ].join('\n') + '\n',
    );
  });

  it('json mode emits the agent ref plus the full per-provider rows', async () => {
    const client = fakeClient({
      listConnections: async () => [connectionFixture({})],
      getAgent: async () => ({
        id: 'agent-1',
        name: 'my-agent',
        meta: { integrations: { github: { enabled: true } } },
      }),
    });

    await integrations.run(makeCtx(client, 'json'), ['status', 'agent-1', '--json']);

    expect(JSON.parse(stdout())).toEqual({
      agent: { id: 'agent-1', name: 'my-agent' },
      providers: [
        { provider: 'github', connected: true, facadeEnabled: true, agentEnabled: true, effective: true },
      ],
    });
  });

  describe('effective = connected AND facade hyper_enabled AND (agent override ?? true)', () => {
    it.each([
      { connected: false, facadeEnabled: true, agentEnabled: true, expected: false },
      { connected: true, facadeEnabled: false, agentEnabled: true, expected: false },
      { connected: true, facadeEnabled: true, agentEnabled: false, expected: false },
      { connected: true, facadeEnabled: true, agentEnabled: true, expected: true },
    ])('effective=$expected: connected=$connected facade=$facadeEnabled agent=$agentEnabled', async ({ connected, facadeEnabled, agentEnabled, expected }) => {
      const client = fakeClient({
        listConnections: async () => [
          connectionFixture({
            connected,
            connection: { id: 'conn_1', errors: [], hyperEnabled: facadeEnabled, createdAt: null },
          }),
        ],
        getAgent: async () => ({
          id: 'agent-1',
          name: 'my-agent',
          meta: { integrations: { github: { enabled: agentEnabled } } },
        }),
      });

      await integrations.run(makeCtx(client, 'json'), ['status', 'agent-1', '--json']);

      expect(JSON.parse(stdout()).providers[0].effective).toBe(expected);
    });

    it('an unset agent override behaves as enabled', async () => {
      const client = fakeClient({
        listConnections: async () => [connectionFixture({})],
        getAgent: async () => ({ id: 'agent-1', name: 'my-agent', meta: null }),
      });

      await integrations.run(makeCtx(client, 'json'), ['status', 'agent-1', '--json']);

      const [row] = JSON.parse(stdout()).providers;
      expect(row.agentEnabled).toBeNull();
      expect(row.effective).toBe(true);
    });
  });
});

describe('hyper integrations enable/disable/unset --agent', () => {
  it('enable --agent writes the agent meta override instead of the facade PATCH', async () => {
    const updateAgent = vi.fn(async () => ({}));
    const setConnectionEnabled = vi.fn(async () => {
      throw new Error('facade PATCH must not be called with --agent');
    });
    const client = fakeClient({ updateAgent, setConnectionEnabled });

    await integrations.run(makeCtx(client, 'table'), ['enable', 'github', '--agent', 'my-agent']);

    expect(updateAgent).toHaveBeenCalledWith('my-agent', { integrations: { github: { enabled: true } } });
    expect(setConnectionEnabled).not.toHaveBeenCalled();
    expect(stdout()).toBe('enabled github for my-agent\n');
  });

  it('disable --agent writes enabled:false to the agent meta', async () => {
    const updateAgent = vi.fn(async () => ({}));
    const client = fakeClient({ updateAgent });

    await integrations.run(makeCtx(client, 'table'), ['disable', 'github', '--agent', 'my-agent']);

    expect(updateAgent).toHaveBeenCalledWith('my-agent', { integrations: { github: { enabled: false } } });
    expect(stdout()).toBe('disabled github for my-agent\n');
  });

  it('enable without --agent keeps the facade PATCH behavior', async () => {
    const setConnectionEnabled = vi.fn(async () => ({ provider: 'github', enabled: true }));
    const updateAgent = vi.fn(async () => {
      throw new Error('agent meta update must not run without --agent');
    });
    const client = fakeClient({ setConnectionEnabled, updateAgent });

    await integrations.run(makeCtx(client, 'table'), ['enable', 'github']);

    expect(setConnectionEnabled).toHaveBeenCalledWith('github', true);
    expect(updateAgent).not.toHaveBeenCalled();
    expect(stdout()).toBe('enabled github\n');
  });

  it('unset --agent sends enabled:null to remove the override', async () => {
    const updateAgent = vi.fn(async () => ({}));
    const client = fakeClient({ updateAgent });

    await integrations.run(makeCtx(client, 'table'), ['unset', 'github', '--agent', 'my-agent']);

    expect(updateAgent).toHaveBeenCalledWith('my-agent', { integrations: { github: { enabled: null } } });
    expect(stdout()).toBe('unset github for my-agent\n');
  });

  it('unset requires --agent', async () => {
    const client = fakeClient({});
    await expect(integrations.run(makeCtx(client, 'table'), ['unset', 'github'])).rejects.toBeInstanceOf(UsageError);
    expect(stdout()).toBe('');
  });
});

describe('hyper integrations providers', () => {
  it('renders NAME/DISPLAY_NAME/AUTH/MODES', async () => {
    const client = fakeClient({
      listProviders: async () => [
        {
          name: 'github',
          providerId: 'github',
          displayName: 'GitHub',
          auth: 'oauth2',
          modes: ['token', 'proxy'],
          backend: 'nango',
          iconUrl: '/integrations/icons/github.svg',
          categories: ['developer-tools'],
          docsUrl: 'https://docs.github.com',
          description: null,
        },
      ],
    });

    await integrations.run(makeCtx(client, 'table'), ['providers']);

    expect(stdout()).toBe(
      ['NAME    DISPLAY_NAME  AUTH    MODES', 'github  GitHub        oauth2  token, proxy'].join('\n') + '\n',
    );
  });
});

describe('hyper integrations errors & usage', () => {
  it('unknown subcommand is a UsageError listing the commands', async () => {
    const client = fakeClient({});
    await expect(integrations.run(makeCtx(client, 'table'), ['bogus'])).rejects.toBeInstanceOf(UsageError);
    expect(stdout()).toBe('');
  });

  it('relay 400 detail is surfaced verbatim on enable', async () => {
    const client = {
      integrations: {
        setConnectionEnabled: async () => {
          throw new APIError(400, 'Slack is managed by the HyperCLI Slack relay');
        },
      },
    } as unknown as HyperCLI;

    await expect(integrations.run(makeCtx(client, 'table'), ['enable', 'slack'])).rejects.toMatchObject({
      message: expect.stringContaining('Slack is managed by the HyperCLI Slack relay'),
    });
  });
});
