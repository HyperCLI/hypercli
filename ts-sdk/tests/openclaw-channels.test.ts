import { describe, expect, it, vi } from 'vitest';

import {
  OpenClawChannelsProvider,
  normalizeOpenClawChannelsSnapshot,
  normalizeOpenClawChannelsStatus,
  type OpenClawChannelsClient,
} from '../src/openclaw/channels.js';
import {
  buildHostedSlackRelayChannelConfig,
  buildSlackRelayWebSocketUrl,
  configureHostedSlackRelayChannel,
  type AgentChannelsProvider,
} from '../src/channels.js';

function client(overrides: Partial<OpenClawChannelsClient> = {}): OpenClawChannelsClient {
  return {
    channelsStatus: vi.fn(async () => ({
      ts: Date.now(),
      channelOrder: [],
      channelLabels: {},
      channels: {},
      channelAccounts: {},
      channelDefaultAccountId: {},
    })),
    channelsLogout: vi.fn(async () => ({ ok: true })),
    configGet: vi.fn(async () => ({})),
    configPatch: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

describe('hosted Slack relay channel helpers', () => {
  it('builds hosted Slack relay config from relay base URL and agent id', () => {
    expect(buildSlackRelayWebSocketUrl('https://api.agents.dev.hypercli.com/')).toBe('wss://api.agents.dev.hypercli.com/slack/ws');
    expect(buildSlackRelayWebSocketUrl('http://localhost:8000/base')).toBe('ws://localhost:8000/slack/ws');
    expect(buildHostedSlackRelayChannelConfig({
      relayBaseUrl: 'https://api.agents.dev.hypercli.com/',
      agentId: 'agent-123',
    })).toEqual({
      enabled: true,
      mode: 'relay',
      botToken: { source: 'env', provider: 'default', id: 'SLACK_BOT_TOKEN' },
      relay: {
        url: 'wss://api.agents.dev.hypercli.com/slack/ws',
        authToken: { source: 'env', provider: 'default', id: 'HYPER_API_KEY' },
        gatewayId: 'agent:agent-123',
      },
    });
  });

  it('configures hosted Slack relay after verifying the install', async () => {
    const provider: Pick<AgentChannelsProvider, 'configure'> = {
      configure: vi.fn(async () => undefined),
    };
    const checkInstallStatus = vi.fn(async () => ({
      connected: true,
      teamId: 'T123',
      teamName: 'Test Workspace',
      botUserId: 'U123',
    }));

    const result = await configureHostedSlackRelayChannel({
      relayBaseUrl: 'https://api.agents.dev.hypercli.com/',
      token: 'app-jwt',
      agentId: 'agent-123',
      channelsProvider: provider,
      checkInstallStatus,
    });

    expect(result.status.connected).toBe(true);
    expect(checkInstallStatus).toHaveBeenCalledWith({
      relayBaseUrl: 'https://api.agents.dev.hypercli.com/',
      token: 'app-jwt',
    });
    expect(provider.configure).toHaveBeenCalledWith('slack', {
      enabled: true,
      mode: 'relay',
      botToken: { source: 'env', provider: 'default', id: 'SLACK_BOT_TOKEN' },
      relay: {
        url: 'wss://api.agents.dev.hypercli.com/slack/ws',
        authToken: { source: 'env', provider: 'default', id: 'HYPER_API_KEY' },
        gatewayId: 'agent:agent-123',
      },
    });
  });
});

describe('OpenClawChannelsProvider', () => {
  it('preserves grouped canonical status, UI metadata, diagnostics, and plugin fields', () => {
    const source = {
      ts: 1_700_000_000_123,
      channelOrder: ['telegram', 'custom-relay'],
      channelLabels: { telegram: 'Telegram', 'custom-relay': 'Custom Relay' },
      channelDetailLabels: { telegram: 'Telegram Bot' },
      channelSystemImages: { telegram: 'paper-plane' },
      channelMeta: [
        { id: 'telegram', label: 'Telegram', detailLabel: 'Telegram Bot', systemImage: 'paper-plane', pluginMeta: 42 },
        { id: 'custom-relay', label: 'Custom Relay', detailLabel: 'Relay' },
      ],
      channels: {
        telegram: { configured: true, summaryExtension: { region: 'eu' } },
        'custom-relay': { configured: false },
      },
      channelAccounts: {
        telegram: [{
          accountId: 'work',
          name: 'Weather Bot',
          configured: true,
          running: true,
          connected: true,
          healthState: 'stale-socket',
          tokenSource: 'config',
          probe: { ok: false, latencyMs: 15 },
          pluginRuntimeField: { shard: 2 },
        }],
        'custom-relay': [],
      },
      channelDefaultAccountId: { telegram: 'work', 'custom-relay': 'default' },
      eventLoop: {
        degraded: true,
        reasons: ['event_loop_delay'],
        intervalMs: 1000,
        delayP99Ms: 25,
        delayMaxMs: 40,
        utilization: 0.8,
        cpuCoreRatio: 0.5,
      },
      partial: true,
      warnings: ['telegram:work probe timed out'],
      gatewayDiagnostic: { revision: 'abc' },
    };

    const snapshot = normalizeOpenClawChannelsSnapshot(source);

    expect(snapshot.observedAt).toBe(1_700_000_000_123);
    expect(snapshot.partial).toBe(true);
    expect(snapshot.warnings).toEqual(['telegram:work probe timed out']);
    expect(snapshot.channels.map((channel) => channel.channelId)).toEqual(['telegram', 'custom-relay']);
    expect(snapshot.channels[0]).toMatchObject({
      channelId: 'telegram',
      label: 'Telegram',
      detailLabel: 'Telegram Bot',
      systemImage: 'paper-plane',
      defaultAccountId: 'work',
      metadata: { pluginMeta: 42 },
      rawChannelStatus: { summaryExtension: { region: 'eu' } },
    });
    expect(snapshot.channels[0]?.accounts[0]).toMatchObject({
      accountId: 'work',
      accountDisplayName: 'Weather Bot',
      configured: true,
      healthState: 'unhealthy',
      healthReason: 'stale-socket',
      rawRuntimeStatus: {
        tokenSource: 'config',
        probe: { ok: false, latencyMs: 15 },
        pluginRuntimeField: { shard: 2 },
      },
    });
    expect(snapshot.channels[1]?.accounts).toEqual([]);
    expect(snapshot.diagnostics).toMatchObject({
      eventLoop: { degraded: true, reasons: ['event_loop_delay'] },
      gatewayDiagnostic: { revision: 'abc' },
    });
    expect(snapshot.source).toBe(source);
  });

  it('unions canonical and legacy ids while keeping empty accounts grouped', () => {
    const source = {
      channelOrder: ['telegram'],
      channelLabels: { discord: 'Discord' },
      channels: { telegram: { configured: false } },
      channelAccounts: { telegram: [] },
      legacyRelay: { configured: true, running: true, legacyField: 'kept' },
    };

    const snapshot = normalizeOpenClawChannelsSnapshot(source);

    expect(snapshot.channels.map((channel) => channel.channelId)).toEqual(['telegram', 'discord', 'legacyRelay']);
    expect(snapshot.channels[0]?.accounts).toEqual([]);
    expect(snapshot.channels[2]?.rawChannelStatus).toMatchObject({ legacyField: 'kept' });
    expect(normalizeOpenClawChannelsStatus(source)).toEqual([
      expect.objectContaining({ channelId: 'discord', configured: false }),
      expect.objectContaining({ channelId: 'legacyRelay', configured: true, running: true }),
      expect.objectContaining({ channelId: 'telegram', configured: false }),
    ]);
  });

  it('uses the default id for a singleton and reserves indexes for flat multi-account compatibility', () => {
    const source = {
      channelOrder: ['single', 'multi'],
      channelAccounts: {
        single: [{ configured: true }],
        multi: [{ configured: true, plugin: 'a' }, { configured: false, plugin: 'b' }],
      },
      channelDefaultAccountId: { single: 'primary', multi: 'primary' },
    };

    const snapshot = normalizeOpenClawChannelsSnapshot(source);
    expect(snapshot.channels[0]?.accounts[0]?.accountId).toBe('primary');
    expect(snapshot.channels[1]?.accounts.map((account) => account.accountId)).toEqual([undefined, undefined]);
    expect(snapshot.channels[1]?.accounts.map((account) => account.rawRuntimeStatus)).toEqual([
      { configured: true, plugin: 'a' },
      { configured: false, plugin: 'b' },
    ]);
    expect(normalizeOpenClawChannelsStatus(source).filter((entry) => entry.channelId === 'multi').map((entry) => entry.accountId)).toEqual(['0', '1']);
  });

  it('normalizes supported configured and unconfigured channels', () => {
    expect(normalizeOpenClawChannelsStatus({
      channels: {
        telegram: { configured: true, running: true, probe: { ok: true }, username: 'weather_bot' },
        discord: { configured: false, running: false },
      },
    })).toEqual([
      expect.objectContaining({ channelId: 'discord', configured: false, running: false, healthState: 'unknown' }),
      expect.objectContaining({ channelId: 'telegram', configured: true, running: true, healthState: 'healthy', accountDisplayName: 'weather_bot' }),
    ]);
  });

  it('normalizes account-scoped channel status', () => {
    expect(normalizeOpenClawChannelsStatus({
      channels: {
        slack: {
          accounts: {
            work: { configured: true, connected: true, status: 'degraded', error: 'Rate limited' },
            support: { configured: false },
          },
        },
      },
    })).toEqual([
      expect.objectContaining({ channelId: 'slack', accountId: 'support', configured: false }),
      expect.objectContaining({ channelId: 'slack', accountId: 'work', authenticated: true, healthState: 'degraded', lastError: 'Rate limited' }),
    ]);
  });

  it('merges OpenClaw channel summaries with account snapshots', () => {
    expect(normalizeOpenClawChannelsStatus({
      channelOrder: ['telegram', 'discord', 'custom-relay'],
      channels: {
        telegram: { configured: true },
        discord: { configured: false },
      },
      channelAccounts: {
        telegram: [
          {
            accountId: 'default',
            running: true,
            connected: true,
            username: 'weather_bot',
            lastProbeAt: 1_700_000_000_000,
          },
        ],
        discord: [],
      },
    })).toEqual([
      expect.objectContaining({ channelId: 'custom-relay', configured: false }),
      expect.objectContaining({ channelId: 'discord', configured: false }),
      expect.objectContaining({
        channelId: 'telegram',
        accountId: 'default',
        accountDisplayName: 'weather_bot',
        configured: true,
        running: true,
        authenticated: true,
        healthState: 'healthy',
        lastProbeAt: 1_700_000_000_000,
      }),
    ]);
  });

  it('discovers channels from runtime metadata when summary maps are absent', () => {
    expect(normalizeOpenClawChannelsStatus({
      channelMeta: [
        { id: 'telegram', label: 'Telegram' },
        { channelId: 'custom-relay', label: 'Custom Relay' },
      ],
      channelLabels: { discord: 'Discord' },
    })).toEqual([
      expect.objectContaining({ channelId: 'custom-relay', configured: false }),
      expect.objectContaining({ channelId: 'discord', configured: false }),
      expect.objectContaining({ channelId: 'telegram', configured: false }),
    ]);
  });

  it('normalizes wrapped and legacy top-level status payloads', () => {
    expect(normalizeOpenClawChannelsStatus({
      data: {
        telegram: { configured: true, running: true },
        discord: { configured: false },
        ts: 1_700_000_000_000,
      },
    })).toEqual([
      expect.objectContaining({ channelId: 'discord', configured: false }),
      expect.objectContaining({ channelId: 'telegram', configured: true, running: true }),
    ]);
  });

  it('delegates probe, configuration, logout, and destructive removal separately', async () => {
    const sdk = client({
      channelsStatus: vi.fn(async () => ({ channels: { telegram: { configured: false } } })),
    });
    const provider = new OpenClawChannelsProvider(sdk);

    await expect(provider.list({ probe: true, timeoutMs: 2500 })).resolves.toEqual([
      expect.objectContaining({ channelId: 'telegram' }),
    ]);
    await provider.configure?.('telegram', { enabled: true, botToken: 'secret' });
    await provider.configure?.('slack', { enabled: true }, 'work');
    await provider.configureTelegram({ dmPolicy: 'allowlist', allowFrom: ['123'] });
    await provider.configureWhatsapp({ enabled: true }, 'default');
    await provider.logout?.('telegram');
    await provider.removeConfig?.('slack', 'work');
    await provider.removeConfig?.('telegram');

    expect(sdk.channelsStatus).toHaveBeenCalledWith(true, 2500);
    expect(sdk.configPatch).toHaveBeenNthCalledWith(1, { channels: { telegram: { enabled: true, botToken: 'secret' } } });
    expect(sdk.configPatch).toHaveBeenNthCalledWith(2, { channels: { slack: { accounts: { work: { enabled: true } } } } });
    expect(sdk.configPatch).toHaveBeenNthCalledWith(3, { channels: { telegram: { dmPolicy: 'allowlist', allowFrom: ['123'] } } });
    expect(sdk.configPatch).toHaveBeenNthCalledWith(4, { channels: { whatsapp: { accounts: { default: { enabled: true } } } } });
    expect(sdk.channelsLogout).toHaveBeenCalledWith('telegram', undefined);
    expect(sdk.configPatch).toHaveBeenNthCalledWith(5, { channels: { slack: { accounts: { work: null } } } });
    expect(sdk.configPatch).toHaveBeenNthCalledWith(6, { channels: { telegram: null } });
  });

  it('supports channel-scoped grouped reads', async () => {
    const sdk = client({
      channelsStatus: vi.fn(async () => ({
        ts: 123,
        channelOrder: ['telegram'],
        channelLabels: { telegram: 'Telegram' },
        channels: { telegram: { configured: false } },
        channelAccounts: { telegram: [] },
        channelDefaultAccountId: { telegram: 'default' },
      })),
    });
    const provider = new OpenClawChannelsProvider(sdk);

    await expect(provider.read({ channelId: 'telegram', probe: true, timeoutMs: 1500 })).resolves.toMatchObject({
      observedAt: 123,
      channels: [{ channelId: 'telegram', accounts: [] }],
    });
    expect(sdk.channelsStatus).toHaveBeenCalledWith(true, 1500, 'telegram');
  });

  it('reads cloned channel and account config and applies update patches', async () => {
    const config = {
      channels: {
        telegram: {
          enabled: true,
          nested: { locale: 'en' },
          accounts: {
            work: { enabled: true, nested: { team: 'ops' } },
          },
        },
      },
    };
    const sdk = client({ configGet: vi.fn(async () => config) });
    const provider = new OpenClawChannelsProvider(sdk);

    const channel = await provider.readConfig({ channelId: 'telegram' });
    const account = await provider.readConfig({ channelId: 'telegram', accountId: 'work' });
    const defaultAccount = await provider.readConfig({ channelId: 'telegram', accountId: 'default' });
    (channel.config as typeof config.channels.telegram).nested.locale = 'changed';
    (account.config as { nested: { team: string } }).nested.team = 'changed';

    expect(config.channels.telegram.nested.locale).toBe('en');
    expect(config.channels.telegram.accounts.work.nested.team).toBe('ops');
    expect(account).toMatchObject({
      channelId: 'telegram',
      accountId: 'work',
      config: { enabled: true },
    });
    expect(defaultAccount).toMatchObject({
      channelId: 'telegram',
      config: { enabled: true, nested: { locale: 'en' } },
    });
    expect(defaultAccount.accountId).toBeUndefined();

    await provider.update({ channelId: 'telegram', patch: { enabled: false } });
    await provider.update({ channelId: 'telegram', accountId: 'work', patch: { enabled: false } });
    expect(sdk.configPatch).toHaveBeenNthCalledWith(1, { channels: { telegram: { enabled: false } } });
    expect(sdk.configPatch).toHaveBeenNthCalledWith(2, {
      channels: { telegram: { accounts: { work: { enabled: false } } } },
    });
  });
});
