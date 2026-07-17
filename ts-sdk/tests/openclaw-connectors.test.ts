import { describe, expect, it, vi } from 'vitest';

import type { AgentRuntimeDescriptor } from '../src/connectors.js';
import {
  normalizeOpenClawConnectors,
  OpenClawConnectorsProvider,
  type OpenClawConnectorsClient,
} from '../src/openclaw/connectors.js';

const runtime: AgentRuntimeDescriptor = {
  provider: 'openclaw',
  version: '2026.7.1',
  protocol: 'gateway-v3',
  image: 'registry.example/runtime@sha256:exact',
  schemaVersion: 'openclaw.runtime.v1',
  capabilities: ['channels', 'integrations.auth'],
};

function client(overrides: Partial<OpenClawConnectorsClient> = {}): OpenClawConnectorsClient {
  return {
    channelsStatus: vi.fn(async () => ({ channels: {} })),
    configPatch: vi.fn(async () => ({ ok: true })),
    integrationsStatus: vi.fn(async () => ({ integrations: {} })),
    integrationsAuthStart: vi.fn(async () => ({})),
    integrationsAuthStatus: vi.fn(async () => ({ status: 'pending' })),
    ...overrides,
  };
}

describe('OpenClawConnectorsProvider', () => {
  it('composes normalized channel and managed integration status', async () => {
    const sdk = client({
      channelsStatus: vi.fn(async () => ({
        channels: {
          telegram: { configured: true, running: true, authenticated: true, probe: { ok: true } },
          github: { configured: true, running: false },
        },
      })),
      integrationsStatus: vi.fn(async () => ({
        integrations: {
          github: { configured: true, authenticated: true },
        },
      })),
    });
    const provider = new OpenClawConnectorsProvider(sdk, runtime);

    await expect(provider.list({ probe: true, timeoutMs: 1500 })).resolves.toEqual([
      {
        connectorId: 'github',
        configured: true,
        authenticated: true,
        usable: true,
        setupModes: ['managed-auth', 'config'],
      },
      {
        connectorId: 'telegram',
        configured: true,
        authenticated: true,
        usable: true,
        setupModes: ['config'],
      },
    ]);
    expect(sdk.channelsStatus).toHaveBeenCalledWith(true, 1500);
    expect(sdk.integrationsStatus).toHaveBeenCalledWith({ integrationId: undefined, probe: true, timeoutMs: 1500 });
  });

  it('normalizes descriptors without runtime image or version heuristics', () => {
    const channels = { channels: { telegram: { configured: false }, github: { configured: false } } };
    const integrations = { integrations: { telegram: {}, github: {} } };

    expect(normalizeOpenClawConnectors(channels, integrations)).toEqual([
      expect.objectContaining({ connectorId: 'github', setupModes: ['managed-auth', 'config'] }),
      expect.objectContaining({ connectorId: 'telegram', setupModes: ['config', 'managed-auth'] }),
    ]);
  });

  it('keeps channel discovery available when managed integrations are unsupported', async () => {
    const sdk = client({
      channelsStatus: vi.fn(async () => ({ channels: { telegram: { configured: false } } })),
      integrationsStatus: vi.fn(async () => {
        throw new Error('unknown method: integrations.status');
      }),
    });

    await expect(new OpenClawConnectorsProvider(sdk, runtime).list()).resolves.toEqual([
      expect.objectContaining({ connectorId: 'telegram', setupModes: ['config'] }),
    ]);
  });

  it('does not request managed integration status for a scoped config channel', async () => {
    const sdk = client({
      channelsStatus: vi.fn(async () => ({
        channels: {
          telegram: { configured: false },
          discord: { configured: true, running: true },
        },
      })),
      integrationsStatus: vi.fn(async () => {
        throw new Error('unknown method: integrations.status');
      }),
    });

    await expect(new OpenClawConnectorsProvider(sdk, runtime).list({ connectorId: 'telegram' })).resolves.toEqual([
      expect.objectContaining({ connectorId: 'telegram', setupModes: ['config'] }),
    ]);
    expect(sdk.integrationsStatus).not.toHaveBeenCalled();
  });

  it('scopes managed integration status to the requested connector', async () => {
    const sdk = client({
      channelsStatus: vi.fn(async () => ({ channels: {} })),
      integrationsStatus: vi.fn(async () => ({
        integrations: {
          github: { configured: true, authenticated: true },
          gitlab: { configured: true, authenticated: true },
        },
      })),
    });

    await expect(new OpenClawConnectorsProvider(sdk, runtime).list({ connectorId: 'github' })).resolves.toEqual([
      expect.objectContaining({ connectorId: 'github' }),
    ]);
    expect(sdk.integrationsStatus).toHaveBeenCalledWith({
      integrationId: 'github',
      probe: undefined,
      timeoutMs: undefined,
    });
  });

  it('maps dynamic auth-start instructions and device flow details with runtime provenance', async () => {
    const sdk = client({
      integrationsAuthStart: vi.fn(async () => ({
        authId: 'auth-1',
        verificationUri: 'https://github.com/login/device',
        userCode: 'ABCD-EFGH',
        expiresAt: '2026-07-16T12:00:00Z',
        intervalMs: 5000,
        scopes: ['repo', 'read:org'],
        instructions: 'Open the device page and enter the code shown here.',
      })),
    });
    const provider = new OpenClawConnectorsProvider(sdk, runtime);

    await expect(provider.startSetup({
      connectorId: 'github',
      scopes: ['repo'],
      force: true,
    })).resolves.toEqual({
      connectorId: 'github',
      mode: 'managed-auth',
      setupId: 'auth-1',
      instructions: 'Open the device page and enter the code shown here.',
      deviceUrl: 'https://github.com/login/device',
      deviceCode: 'ABCD-EFGH',
      expiresAt: '2026-07-16T12:00:00Z',
      pollIntervalMs: 5000,
      scopes: ['repo', 'read:org'],
      provenance: runtime,
    });
    expect(sdk.integrationsAuthStart).toHaveBeenCalledWith({
      integrationId: 'github',
      scopes: ['repo'],
      accountId: undefined,
      force: true,
    });
  });

  it('prefers config setup for Telegram and delegates channel configuration', async () => {
    const sdk = client();
    const provider = new OpenClawConnectorsProvider(sdk, runtime);

    await expect(provider.startSetup({ connectorId: 'telegram' })).resolves.toEqual({
      connectorId: 'telegram',
      mode: 'config',
      provenance: runtime,
    });
    await provider.configure('telegram', { enabled: true, botToken: 'secret' }, 'work');

    expect(sdk.integrationsAuthStart).not.toHaveBeenCalled();
    expect(sdk.configPatch).toHaveBeenCalledWith({
      channels: {
        telegram: { accounts: { work: { enabled: true, botToken: 'secret' } } },
      },
    });
  });

  it('uses runtime-reported setup modes for other connectors', async () => {
    const sdk = client({
      channelsStatus: vi.fn(async () => ({ channels: { discord: { configured: false } } })),
    });
    const provider = new OpenClawConnectorsProvider(sdk, runtime);

    await expect(provider.startSetup({ connectorId: 'discord' })).resolves.toEqual({
      connectorId: 'discord',
      mode: 'config',
      provenance: runtime,
    });
    expect(sdk.integrationsAuthStart).not.toHaveBeenCalled();
  });

  it('normalizes managed auth polling results', async () => {
    const sdk = client({
      integrationsAuthStatus: vi.fn(async () => ({
        status: 'pending',
        connectionId: 'connection-1',
        accountId: 'octocat',
        accountDisplayName: 'Octocat',
        scopes: ['repo'],
      })),
    });
    const provider = new OpenClawConnectorsProvider(sdk, runtime);

    await expect(provider.pollSetup({ connectorId: 'github', setupId: 'auth-1' })).resolves.toEqual({
      connectorId: 'github',
      setupId: 'auth-1',
      state: 'complete',
      connectionId: 'connection-1',
      accountId: 'octocat',
      accountDisplayName: 'Octocat',
      scopes: ['repo'],
      error: undefined,
      provenance: runtime,
    });
    expect(sdk.integrationsAuthStatus).toHaveBeenCalledWith({
      authId: 'auth-1',
      integrationId: 'github',
      accountId: undefined,
    });
  });

  it('approves short-code authorization through a constrained runtime operation', async () => {
    const sdk = client({ runCommand: vi.fn(async () => undefined) });
    const provider = new OpenClawConnectorsProvider(sdk, runtime);

    await expect(provider.approveAuthorization({
      connectorId: 'signal',
      protocol: 'short-code',
      code: 'ABCD2345',
      accountId: 'work',
      notify: true,
    })).resolves.toEqual({
      connectorId: 'signal',
      protocol: 'short-code',
      state: 'complete',
    });
    expect(sdk.runCommand).toHaveBeenCalledWith('openclaw pairing approve signal ABCD2345 --account work --notify');
  });

  it('rejects unsafe authorization arguments before running a command', async () => {
    const sdk = client({ runCommand: vi.fn(async () => undefined) });
    const provider = new OpenClawConnectorsProvider(sdk, runtime);

    await expect(provider.approveAuthorization({
      connectorId: 'signal; rm -rf /',
      protocol: 'short-code',
      code: 'ABCD2345',
    })).rejects.toThrow(/connector id is invalid/i);
    await expect(provider.approveAuthorization({
      connectorId: 'signal',
      protocol: 'short-code',
      code: 'bad-code',
    })).rejects.toThrow(/authorization code is invalid/i);
    expect(sdk.runCommand).not.toHaveBeenCalled();
  });
});
