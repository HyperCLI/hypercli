import { describe, expect, it, vi } from 'vitest';

import {
  OpenClawSlackProvider,
  type OpenClawSlackClient,
  type OpenClawSlackConfig,
  type OpenClawSlackEditMessageInput,
  type OpenClawSlackMessageActionRequest,
  type OpenClawSlackSendMessageInput,
  type OpenClawSlackPluginInfo,
} from '../src/openclaw/slack.js';
import type { GatewayClient } from '../src/openclaw/gateway.js';

type GatewayClientSupportsSlackFacade = GatewayClient extends OpenClawSlackClient ? true : false;
const gatewayClientSupportsSlackFacade: GatewayClientSupportsSlackFacade = true;

const plugin = (overrides: Partial<OpenClawSlackPluginInfo> = {}): OpenClawSlackPluginInfo => ({
  id: 'slack',
  name: 'Slack',
  installed: true,
  enabled: true,
  state: 'enabled',
  ...overrides,
});

function client(overrides: Partial<OpenClawSlackClient> = {}): OpenClawSlackClient {
  return {
    configGet: vi.fn(async () => ({})),
    configSchemaLookup: vi.fn(async () => ({ path: 'channels.slack', schema: {}, children: [] })),
    configPatch: vi.fn(async () => ({ ok: true })),
    channelsStatus: vi.fn(async () => ({})),
    channelsStart: vi.fn(async () => ({ started: true })),
    channelsStop: vi.fn(async () => ({ stopped: true })),
    channelsLogout: vi.fn(async () => ({ cleared: true })),
    messageAction: vi.fn(async () => ({ ok: true })),
    pluginsList: vi.fn(async () => ({ plugins: [], diagnostics: [], mutationAllowed: true })),
    pluginsInstall: vi.fn(async () => ({
      ok: true,
      plugin: plugin(),
      restartRequired: true,
    })),
    pluginsSetEnabled: vi.fn(async ({ enabled }) => ({
      ok: true,
      plugin: plugin({ enabled, state: enabled ? 'enabled' : 'disabled' }),
      restartRequired: true,
    })),
    pluginsUninstall: vi.fn(async () => ({
      ok: true,
      pluginId: 'slack',
      restartRequired: true,
      removed: ['config'],
    })),
    pluginsRefresh: vi.fn(async () => ({ ok: true })),
    commandsList: vi.fn(async () => ({ commands: [] })),
    ...overrides,
  };
}

describe('OpenClawSlackProvider config', () => {
  it('models the current canonical nested Slack configuration', () => {
    expect(gatewayClientSupportsSlackFacade).toBe(true);
    const config = {
      name: 'base',
      mode: 'socket',
      enterpriseOrgInstall: false,
      socketMode: { clientPingTimeout: 15_000, serverPingTimeout: 30_000, pingPongLoggingEnabled: true },
      relay: {
        url: 'wss://relay.example.test/ws',
        authToken: { source: 'exec', provider: 'vault', id: 'slack/relay' },
        gatewayId: 'gateway-1',
      },
      signingSecret: { source: 'file', provider: 'mounted-json', id: '/slack/signing' },
      webhookPath: '/slack/events',
      capabilities: { interactiveReplies: true },
      execApprovals: { enabled: 'auto', approvers: ['U1'], agentFilter: ['main'], sessionFilter: ['ops'], target: 'both' },
      markdown: { tables: 'block' },
      commands: { native: 'auto', nativeSkills: true },
      configWrites: true,
      enabled: true,
      botToken: { source: 'env', provider: 'default', id: 'SLACK_BOT_TOKEN' },
      appToken: 'xapp-token',
      userToken: 'xoxp-token',
      userTokenReadOnly: true,
      allowBots: 'mentions',
      botLoopProtection: { enabled: true, maxEventsPerWindow: 5, windowSeconds: 60, cooldownSeconds: 30 },
      dangerouslyAllowNameMatching: false,
      requireMention: true,
      implicitMentions: { replyToBot: true, quotedBot: true, threadParticipation: true },
      groupPolicy: 'allowlist',
      mentionPatterns: { mode: 'allow', allowIn: ['C1'], denyIn: ['C2'] },
      contextVisibility: 'allowlist_quote',
      historyLimit: 50,
      dmHistoryLimit: 20,
      dms: { U1: { historyLimit: 10 } },
      textChunkLimit: 3000,
      unfurlLinks: false,
      unfurlMedia: false,
      streaming: {
        mode: 'progress',
        chunkMode: 'newline',
        nativeTransport: true,
        preview: { chunk: { minChars: 20, maxChars: 200, breakPreference: 'sentence' }, toolProgress: true, commandText: 'status' },
        progress: { label: 'auto', labels: ['Working'], maxLines: 8, maxLineChars: 120, render: 'rich', toolProgress: true, commandText: 'raw', commentary: true, narration: true, nativeTaskCards: true },
        block: { enabled: true, coalesce: { minChars: 50, maxChars: 500, idleMs: 250 } },
      },
      mediaMaxMb: 20,
      reactionNotifications: 'allowlist',
      reactionAllowlist: ['U1'],
      replyToMode: 'first',
      replyToModeByChatType: { direct: 'all', group: 'first', channel: 'off' },
      thread: { historyScope: 'thread', inheritParent: true, initialHistoryLimit: 20 },
      presenceEvents: { mode: 'auto' },
      actions: { reactions: true, messages: true, pins: true, search: true, permissions: true, memberInfo: true, channelInfo: true, emojiList: true },
      slashCommand: { enabled: true, name: 'openclaw', sessionPrefix: 'slack:slash', ephemeral: true },
      dmPolicy: 'pairing',
      allowFrom: ['U1'],
      defaultTo: 'C1',
      dm: { enabled: true, groupEnabled: true, groupChannels: ['G1'] },
      channels: {
        C1: {
          enabled: true,
          requireMention: false,
          ignoreOtherMentions: true,
          replyToMode: 'all',
          tools: { allow: ['read'], alsoAllow: ['search'], deny: ['exec'] },
          toolsBySender: { 'id:U1': { allow: ['exec'] } },
          allowBots: true,
          botLoopProtection: { enabled: true },
          users: ['U1'],
          skills: ['support'],
          systemPrompt: 'Help the team.',
          presenceEvents: { mode: 'on' },
        },
      },
      heartbeat: { showOk: false, showAlerts: true, useIndicator: true },
      healthMonitor: { enabled: true },
      responsePrefix: '[bot]',
      ackReaction: 'eyes',
      typingReaction: 'hourglass_flowing_sand',
      defaultAccount: 'work',
      accounts: { work: { mode: 'http', botToken: 'xoxb-work', signingSecret: 'secret' } },
    } satisfies OpenClawSlackConfig;

    expect(config.streaming.progress.nativeTaskCards).toBe(true);
    expect(config.implicitMentions.threadParticipation).toBe(true);
    expect(config.thread).not.toHaveProperty('requireExplicitMention');
    expect(config).not.toHaveProperty('streamMode');
    expect(config).not.toHaveProperty('blockStreaming');
  });

  it('reads cloned base config and exact accounts without base fallback', async () => {
    const source = {
      channels: {
        slack: {
          enabled: true,
          botToken: 'base',
          accounts: { work: { enabled: false, name: 'Work' } },
        },
      },
    };
    const sdk = client({ configGet: vi.fn(async () => source) });
    const provider = new OpenClawSlackProvider(sdk);

    const config = await provider.getConfig();
    const account = await provider.getAccountConfig('work');
    const missing = await provider.getAccountConfig('missing');
    if (!config || !account) throw new Error('Expected Slack config fixtures.');
    config.enabled = false;
    account.name = 'Changed';

    expect(source.channels.slack.enabled).toBe(true);
    expect(source.channels.slack.accounts.work.name).toBe('Work');
    expect(missing).toBeUndefined();
  });

  it('patches and removes base/account config and sets the default account', async () => {
    const sdk = client();
    const provider = new OpenClawSlackProvider(sdk);

    await provider.patchConfig({ enabled: false });
    await provider.patchAccount('work', { name: 'Work', appToken: null });
    await provider.removeAccount('work');
    await provider.setDefaultAccount('work');
    await provider.removeConfig();

    expect(sdk.configPatch).toHaveBeenNthCalledWith(1, { channels: { slack: { enabled: false } } });
    expect(sdk.configPatch).toHaveBeenNthCalledWith(2, { channels: { slack: { accounts: { work: { name: 'Work', appToken: null } } } } });
    expect(sdk.configPatch).toHaveBeenNthCalledWith(3, { channels: { slack: { accounts: { work: null } } } });
    expect(sdk.configPatch).toHaveBeenNthCalledWith(4, { channels: { slack: { defaultAccount: 'work' } } });
    expect(sdk.configPatch).toHaveBeenNthCalledWith(5, { channels: { slack: null } });
  });

  it('configures socket, HTTP, and relay transports at base or account scope', async () => {
    const sdk = client();
    const provider = new OpenClawSlackProvider(sdk);
    const envBot = { source: 'env', provider: 'default', id: 'SLACK_BOT_TOKEN' } as const;

    await provider.configureSocket({ botToken: envBot, appToken: 'xapp', socketMode: { clientPingTimeout: 1000 } });
    await provider.configureHttp({ botToken: 'xoxb', signingSecret: 'signing', webhookPath: '/events' }, 'http-work');
    await provider.configureRelay({
      botToken: 'xoxb',
      relay: { url: 'wss://relay.example.test/ws', authToken: 'relay-token', gatewayId: 'gateway-1' },
    }, 'relay-work');

    expect(sdk.configPatch).toHaveBeenNthCalledWith(1, {
      channels: { slack: { botToken: envBot, appToken: 'xapp', socketMode: { clientPingTimeout: 1000 }, mode: 'socket' } },
    });
    expect(sdk.configPatch).toHaveBeenNthCalledWith(2, {
      channels: { slack: { accounts: { 'http-work': { botToken: 'xoxb', signingSecret: 'signing', webhookPath: '/events', mode: 'http' } } } },
    });
    expect(sdk.configPatch).toHaveBeenNthCalledWith(3, {
      channels: { slack: { accounts: { 'relay-work': { botToken: 'xoxb', enterpriseOrgInstall: false, relay: { url: 'wss://relay.example.test/ws', authToken: 'relay-token', gatewayId: 'gateway-1' }, mode: 'relay' } } } },
    });
  });

  it('validates mode-required secrets and relay websocket security', async () => {
    const sdk = client();
    const provider = new OpenClawSlackProvider(sdk);

    await expect(provider.configureSocket({ botToken: 'xoxb', appToken: '' })).rejects.toThrow(/app token is required/i);
    await expect(provider.configureHttp({ botToken: '', signingSecret: 'secret' })).rejects.toThrow(/bot token is required/i);
    await expect(provider.configureRelay({
      botToken: 'xoxb',
      relay: { url: 'ws://relay.example.test/ws', authToken: 'token', gatewayId: 'gateway' },
    })).rejects.toThrow(/must use wss/i);
    await expect(provider.configureRelay({
      botToken: 'xoxb',
      relay: { url: 'https://relay.example.test/ws', authToken: 'token', gatewayId: 'gateway' },
    })).rejects.toThrow(/must use wss/i);
    await expect(provider.configureRelay({
      botToken: 'xoxb',
      relay: { url: 'ws://localhost:3000/ws', authToken: 'token', gatewayId: 'gateway' },
    })).resolves.toBeUndefined();
    await expect(provider.configureRelay({
      botToken: 'xoxb',
      enterpriseOrgInstall: true,
      relay: { url: 'wss://relay.example.test/ws', authToken: 'token', gatewayId: 'gateway' },
    })).rejects.toThrow(/enterprise grid/i);
    expect(sdk.configPatch).toHaveBeenCalledTimes(1);
  });

  it('reads the runtime Slack config schema', async () => {
    const sdk = client();
    await expect(new OpenClawSlackProvider(sdk).getSchema()).resolves.toMatchObject({
      path: 'channels.slack',
    });
    expect(sdk.configSchemaLookup).toHaveBeenCalledWith('channels.slack');
  });
});

describe('OpenClawSlackProvider lifecycle and discovery', () => {
  it('selects exact account status for normal and probed reads', async () => {
    const sdk = client({
      channelsStatus: vi.fn(async () => ({
        channels: { slack: { configured: true, summary: true } },
        channelAccounts: {
          slack: [
            { accountId: 'work', configured: true, marker: 'work' },
            { accountId: 'support', configured: true, marker: 'support' },
          ],
        },
        channelDefaultAccountId: { slack: 'support' },
      })),
    });
    const provider = new OpenClawSlackProvider(sdk);

    await expect(provider.status('work')).resolves.toMatchObject({ accountId: 'work', marker: 'work' });
    await expect(provider.status('missing')).resolves.toBeUndefined();
    await expect(provider.status()).resolves.toMatchObject({ accountId: 'support' });
    await expect(provider.probe('support', 2500)).resolves.toMatchObject({ marker: 'support' });

    expect(sdk.channelsStatus).toHaveBeenNthCalledWith(1, false, undefined, 'slack');
    expect(sdk.channelsStatus).toHaveBeenNthCalledWith(4, true, 2500, 'slack');
  });

  it('supports account maps and only falls back to channel summary when no account was requested', async () => {
    const sdk = client({
      channelsStatus: vi.fn(async () => ({
        channels: { slack: { configured: false, summary: true } },
        channelAccounts: { slack: { work: { configured: true } } },
      })),
    });
    const provider = new OpenClawSlackProvider(sdk);
    await expect(provider.status('work')).resolves.toMatchObject({ accountId: 'work', configured: true });
    await expect(provider.status('absent')).resolves.toBeUndefined();

    const summaryProvider = new OpenClawSlackProvider(client({
      channelsStatus: vi.fn(async () => ({ channels: { slack: { configured: false, summary: true } } })),
    }));
    await expect(summaryProvider.status()).resolves.toMatchObject({ summary: true });
    await expect(summaryProvider.status('work')).resolves.toBeUndefined();
  });

  it('delegates start, stop, and logout to the exact Slack account', async () => {
    const sdk = client();
    const provider = new OpenClawSlackProvider(sdk);

    await provider.start('work');
    await provider.stop('work');
    await provider.logout('work');

    expect(sdk.channelsStart).toHaveBeenCalledWith('slack', 'work');
    expect(sdk.channelsStop).toHaveBeenCalledWith('slack', 'work');
    expect(sdk.channelsLogout).toHaveBeenCalledWith('slack', 'work');
  });

  it('rejects empty lifecycle account ids instead of targeting the default account', async () => {
    const sdk = client();
    const provider = new OpenClawSlackProvider(sdk);

    await expect(provider.start('')).rejects.toThrow(/account id must be nonempty/i);
    await expect(provider.stop('')).rejects.toThrow(/account id must be nonempty/i);
    await expect(provider.logout('')).rejects.toThrow(/account id must be nonempty/i);
    expect(sdk.channelsStart).not.toHaveBeenCalled();
    expect(sdk.channelsStop).not.toHaveBeenCalled();
    expect(sdk.channelsLogout).not.toHaveBeenCalled();
  });

  it('finds plugin info, preserves advertised install actions, and enables as needed', async () => {
    const advertised = plugin({
      installed: false,
      enabled: false,
      state: 'not-installed',
      install: { source: 'official', pluginId: 'slack' },
      catalogField: { featured: true },
    });
    const sdk = client({
      pluginsList: vi.fn(async () => ({ plugins: [advertised], diagnostics: [], mutationAllowed: true })),
      pluginsInstall: vi.fn(async (action) => ({
        ok: true,
        plugin: plugin({ enabled: false, state: 'disabled', install: action }),
        restartRequired: true,
      })),
    });
    const provider = new OpenClawSlackProvider(sdk);

    await expect(provider.pluginInfo()).resolves.toBe(advertised);
    await expect(provider.ensurePluginInstalled()).resolves.toMatchObject({
      plugin: { id: 'slack', enabled: true }, changed: true, restartRequired: true,
    });
    expect(sdk.pluginsInstall).toHaveBeenCalledWith({ source: 'official', pluginId: 'slack' });
    expect(sdk.pluginsSetEnabled).toHaveBeenCalledWith({ pluginId: 'slack', enabled: true });
  });

  it('returns enabled installed plugins, enables disabled plugins, and never guesses a package', async () => {
    const enabledSdk = client({
      pluginsList: vi.fn(async () => ({ plugins: [plugin()], diagnostics: [], mutationAllowed: true })),
    });
    await expect(new OpenClawSlackProvider(enabledSdk).ensurePluginInstalled()).resolves.toMatchObject({
      plugin: { enabled: true }, changed: false, restartRequired: false,
    });
    expect(enabledSdk.pluginsInstall).not.toHaveBeenCalled();
    expect(enabledSdk.pluginsSetEnabled).not.toHaveBeenCalled();

    const disabledSdk = client({
      pluginsList: vi.fn(async () => ({ plugins: [plugin({ enabled: false, state: 'disabled' })], diagnostics: [], mutationAllowed: true })),
    });
    await expect(new OpenClawSlackProvider(disabledSdk).ensurePluginInstalled()).resolves.toMatchObject({
      plugin: { enabled: true }, changed: true, restartRequired: true,
    });
    expect(disabledSdk.pluginsSetEnabled).toHaveBeenCalledWith({ pluginId: 'slack', enabled: true });

    const unavailableSdk = client();
    await expect(new OpenClawSlackProvider(unavailableSdk).ensurePluginInstalled()).rejects.toThrow(/no install action is advertised/i);
    expect(unavailableSdk.pluginsInstall).not.toHaveBeenCalled();
  });

  it('treats plugin discovery as optional on older gateways', async () => {
    const sdk = client({
      pluginsList: vi.fn(async () => {
        throw new Error('Gateway error: unknown method: plugins.list');
      }),
    });
    const provider = new OpenClawSlackProvider(sdk);

    await expect(provider.pluginSupport()).resolves.toEqual({ supported: false, mutationAllowed: false });
    await expect(provider.pluginInfo()).resolves.toBeUndefined();
    await expect(provider.ensurePluginInstalled()).rejects.toThrow(/unavailable on this gateway version/i);
    expect(sdk.pluginsInstall).not.toHaveBeenCalled();
    expect(sdk.pluginsSetEnabled).not.toHaveBeenCalled();
  });

  it('enforces the gateway plugin mutation policy before changing Slack support', async () => {
    const disabledSdk = client({
      pluginsList: vi.fn(async () => ({
        plugins: [plugin({ enabled: false, state: 'disabled' })],
        diagnostics: [],
        mutationAllowed: false,
      })),
    });

    await expect(new OpenClawSlackProvider(disabledSdk).ensurePluginInstalled()).rejects.toThrow(/changes are not allowed/i);
    expect(disabledSdk.pluginsSetEnabled).not.toHaveBeenCalled();

    const enabledSdk = client({
      pluginsList: vi.fn(async () => ({ plugins: [plugin()], diagnostics: [], mutationAllowed: false })),
    });
    await expect(new OpenClawSlackProvider(enabledSdk).ensurePluginInstalled()).resolves.toMatchObject({ changed: false });
  });

  it('installs and enables the official Slack plugin through the CLI when missing', async () => {
    let installed = false;
    const runCommand = vi.fn(async (command: string) => {
      if (command === 'openclaw plugins list --json') {
        return { stdout: JSON.stringify({ plugins: [{ id: 'slack', installed, enabled: installed, state: installed ? 'loaded' : 'not-installed' }] }), exitCode: 0 };
      }
      if (command === 'openclaw plugins install @openclaw/slack') installed = true;
      return { stdout: 'ok', exitCode: 0 };
    });
    const provider = new OpenClawSlackProvider(client(), { runCommand });

    await expect(provider.ensurePluginInstalledWithCli()).resolves.toMatchObject({
      plugin: { id: 'slack', installed: true, enabled: true },
      changed: true,
      restartRequired: true,
    });
    expect(runCommand.mock.calls.map(([command]) => command)).toEqual([
      'openclaw plugins list --json',
      'openclaw plugins install @openclaw/slack',
      'openclaw plugins enable slack',
      'openclaw plugins list --json',
    ]);
  });

  it('keeps CLI plugin installation idempotent and enables disabled Slack support', async () => {
    const enabledRunner = vi.fn(async () => ({
      stdout: JSON.stringify({ plugins: [{ id: 'slack', name: 'Slack', enabled: true, status: 'loaded' }] }),
      exitCode: 0,
    }));
    await expect(new OpenClawSlackProvider(client(), { runCommand: enabledRunner }).ensurePluginInstalledWithCli())
      .resolves.toMatchObject({ changed: false, restartRequired: false });
    expect(enabledRunner).toHaveBeenCalledOnce();

    let enabled = false;
    const disabledRunner = vi.fn(async (command: string) => {
      if (command === 'openclaw plugins list --json') {
        return { stdout: JSON.stringify({ entries: { slack: { name: 'Slack', enabled } } }), exitCode: 0 };
      }
      enabled = true;
      return { stdout: 'enabled', exitCode: 0 };
    });
    await expect(new OpenClawSlackProvider(client(), { runCommand: disabledRunner }).ensurePluginInstalledWithCli())
      .resolves.toMatchObject({ changed: true, restartRequired: true });
    expect(disabledRunner.mock.calls.map(([command]) => command)).toEqual([
      'openclaw plugins list --json',
      'openclaw plugins enable slack',
      'openclaw plugins list --json',
    ]);
  });

  it('validates CLI plugin inventory and gateway restart results', async () => {
    const malformed = new OpenClawSlackProvider(client(), {
      runCommand: vi.fn(async () => ({ stdout: 'not-json', exitCode: 0 })),
    });
    await expect(malformed.ensurePluginInstalledWithCli()).rejects.toThrow(/invalid JSON/i);

    const runCommand = vi.fn(async () => ({ stderr: 'restart denied', exitCode: 1 }));
    await expect(new OpenClawSlackProvider(client(), { runCommand }).restartGateway()).rejects.toThrow(/restart denied/i);
    expect(runCommand).toHaveBeenCalledWith('openclaw gateway restart');
  });

  it('verifies Slack runtime inspection output', async () => {
    const runCommand = vi.fn(async () => ({
      stdout: JSON.stringify({ plugin: { id: 'slack', name: 'Slack', enabled: true, status: 'loaded' } }),
      exitCode: 0,
    }));
    await expect(new OpenClawSlackProvider(client(), { runCommand }).verifyPluginRuntimeWithCli()).resolves.toMatchObject({
      id: 'slack', installed: true, enabled: true, state: 'loaded',
    });
    expect(runCommand).toHaveBeenCalledWith('openclaw plugins inspect slack --runtime --json');
  });

  it('delegates plugin policy, uninstall, and Slack-scoped command discovery', async () => {
    const command = {
      name: 'status', description: 'Show status', source: 'native', scope: 'both', acceptsArgs: false,
    } as const;
    const sdk = client({ commandsList: vi.fn(async () => ({ commands: [command] })) });
    const provider = new OpenClawSlackProvider(sdk);

    await provider.setPluginEnabled(false);
    await provider.uninstallPlugin();
    await expect(provider.refreshPlugins()).resolves.toEqual({ ok: true });
    await expect(provider.listCommands({ agentId: 'main', scope: 'native', includeArgs: true })).resolves.toEqual([command]);

    expect(sdk.pluginsSetEnabled).toHaveBeenCalledWith({ pluginId: 'slack', enabled: false });
    expect(sdk.pluginsUninstall).toHaveBeenCalledWith({ pluginId: 'slack' });
    expect(sdk.pluginsRefresh).toHaveBeenCalledOnce();
    expect(sdk.commandsList).toHaveBeenCalledWith({ provider: 'slack', agentId: 'main', scope: 'native', includeArgs: true });
  });
});

describe('OpenClawSlackProvider pairing', () => {
  it('parses JSON pairing lists and approves with constrained arguments', async () => {
    const runCommand = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ channel: 'slack', requests: [{ id: 'U1', code: 'ABCD2345', createdAt: 'now', lastSeenAt: 'now' }] }), stderr: '' })
      .mockResolvedValueOnce({ exit_code: 0, stdout: 'Approved Slack sender U1.', stderr: '' });
    const provider = new OpenClawSlackProvider(client(), { runCommand });

    await expect(provider.listPairings('work-1')).resolves.toMatchObject({
      channel: 'slack',
      requests: [{ id: 'U1', code: 'ABCD2345' }],
    });
    await expect(provider.approvePairing('abcd2345', { accountId: 'work-1', notify: true })).resolves.toEqual({
      channel: 'slack', approved: true, code: 'ABCD2345', mayBootstrapCommandOwner: true,
      raw: 'Approved Slack sender U1.',
    });

    expect(runCommand).toHaveBeenNthCalledWith(1, 'openclaw pairing list slack --account work-1 --json');
    expect(runCommand).toHaveBeenNthCalledWith(2, 'openclaw pairing approve slack ABCD2345 --account work-1 --notify');
  });

  it('rejects malformed pairing list output despite requesting JSON', async () => {
    const provider = new OpenClawSlackProvider(client(), { runCommand: vi.fn(async () => 'No pending requests.') });
    await expect(provider.listPairings()).rejects.toThrow(/invalid JSON/i);
  });

  it('rejects unsafe account ids, malformed codes, command failures, and missing runners', async () => {
    const runCommand = vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: 'denied' }));
    const provider = new OpenClawSlackProvider(client(), { runCommand });

    await expect(provider.listPairings('work; rm -rf /')).rejects.toThrow(/unsafe/i);
    await expect(provider.approvePairing('bad code')).rejects.toThrow(/code is invalid/i);
    expect(runCommand).not.toHaveBeenCalled();
    await expect(provider.approvePairing('ABCD2345')).rejects.toThrow('denied');
    await expect(new OpenClawSlackProvider(client()).listPairings()).rejects.toThrow(/unavailable/i);
  });
});

describe('OpenClawSlackProvider message actions', () => {
  const operationOptions = {
    accountId: 'work',
    sessionKey: 'main',
    sessionId: 'session-1',
    agentId: 'agent-1',
    directOperator: true,
    idempotencyKey: 'idem-1',
  } as const;

  const cases: Array<{
    name: string;
    action: OpenClawSlackMessageActionRequest['action'];
    params: Record<string, unknown>;
    invoke: (provider: OpenClawSlackProvider) => Promise<Record<string, unknown>>;
  }> = [
    {
      name: 'sendMessage',
      action: 'send',
      params: {
        to: 'C1', message: 'hello', threadId: '100.1', replyBroadcast: true,
        presentation: { title: 'Metrics', blocks: [{ type: 'table', caption: 'Totals', headers: ['Name', 'Value'], rows: [['Jobs', 3]] }] },
        interactive: { blocks: [{ type: 'buttons', buttons: [{ label: 'Legacy', value: 'legacy' }] }] },
      },
      invoke: (provider) => provider.sendMessage({
        to: 'C1', message: 'hello', threadId: '100.1', replyBroadcast: true,
        presentation: { title: 'Metrics', blocks: [{ type: 'table', caption: 'Totals', headers: ['Name', 'Value'], rows: [['Jobs', 3]] }] },
        interactive: { blocks: [{ type: 'buttons', buttons: [{ label: 'Legacy', value: 'legacy' }] }] },
      }, operationOptions),
    },
    {
      name: 'uploadFile', action: 'upload-file',
      params: { to: 'C1', filePath: '/tmp/report.pdf', initialComment: 'report', filename: 'report.pdf', title: 'Report', topLevel: true },
      invoke: (provider) => provider.uploadFile({ to: 'C1', filePath: '/tmp/report.pdf', initialComment: 'report', filename: 'report.pdf', title: 'Report', topLevel: true }, operationOptions),
    },
    {
      name: 'downloadFile', action: 'download-file',
      params: { fileId: 'F1', channelId: 'C1', threadId: '100.1' },
      invoke: (provider) => provider.downloadFile({ fileId: 'F1', channelId: 'C1', threadId: '100.1' }, operationOptions),
    },
    {
      name: 'readMessages', action: 'read',
      params: { channelId: 'C1', limit: 10, before: '200.1', after: '100.1', threadId: '100.1', messageId: '101.1' },
      invoke: (provider) => provider.readMessages({ channelId: 'C1', limit: 10, before: '200.1', after: '100.1', threadId: '100.1', messageId: '101.1' }, operationOptions),
    },
    {
      name: 'editMessage', action: 'edit',
      params: { channelId: 'C1', messageId: '100.1', message: 'updated', presentation: { blocks: [{ type: 'chart', chartType: 'pie', title: 'Use', segments: [{ label: 'GPU', value: 2 }] }] } },
      invoke: (provider) => provider.editMessage({ channelId: 'C1', messageId: '100.1', message: 'updated', presentation: { blocks: [{ type: 'chart', chartType: 'pie', title: 'Use', segments: [{ label: 'GPU', value: 2 }] }] } }, operationOptions),
    },
    {
      name: 'deleteMessage', action: 'delete', params: { channelId: 'C1', messageId: '100.1' },
      invoke: (provider) => provider.deleteMessage({ channelId: 'C1', messageId: '100.1' }, operationOptions),
    },
    {
      name: 'addReaction', action: 'react', params: { channelId: 'C1', messageId: '100.1', emoji: 'eyes' },
      invoke: (provider) => provider.addReaction({ channelId: 'C1', messageId: '100.1', emoji: 'eyes' }, operationOptions),
    },
    {
      name: 'removeReaction', action: 'react', params: { channelId: 'C1', messageId: '100.1', emoji: 'eyes', remove: true },
      invoke: (provider) => provider.removeReaction({ channelId: 'C1', messageId: '100.1', emoji: 'eyes' }, operationOptions),
    },
    {
      name: 'clearOwnReactions', action: 'react', params: { channelId: 'C1', messageId: '100.1', emoji: '' },
      invoke: (provider) => provider.clearOwnReactions({ channelId: 'C1', messageId: '100.1' }, operationOptions),
    },
    {
      name: 'listReactions', action: 'reactions', params: { channelId: 'C1', messageId: '100.1' },
      invoke: (provider) => provider.listReactions({ channelId: 'C1', messageId: '100.1' }, operationOptions),
    },
    {
      name: 'pinMessage', action: 'pin', params: { channelId: 'C1', messageId: '100.1' },
      invoke: (provider) => provider.pinMessage({ channelId: 'C1', messageId: '100.1' }, operationOptions),
    },
    {
      name: 'unpinMessage', action: 'unpin', params: { channelId: 'C1', messageId: '100.1' },
      invoke: (provider) => provider.unpinMessage({ channelId: 'C1', messageId: '100.1' }, operationOptions),
    },
    {
      name: 'listPins', action: 'list-pins', params: { channelId: 'C1' },
      invoke: (provider) => provider.listPins('C1', operationOptions),
    },
    {
      name: 'getMemberInfo', action: 'member-info', params: { userId: 'U1' },
      invoke: (provider) => provider.getMemberInfo('U1', operationOptions),
    },
    {
      name: 'listEmojis', action: 'emoji-list', params: { limit: 50 },
      invoke: (provider) => provider.listEmojis(50, operationOptions),
    },
  ];

  it.each(cases)('maps $name to the canonical $action action', async ({ action, params, invoke }) => {
    const response = { ok: true, extensionField: { retained: true } };
    const sdk = client({ messageAction: vi.fn(async () => response) });
    const provider = new OpenClawSlackProvider(sdk);

    await expect(invoke(provider)).resolves.toBe(response);
    expect(sdk.messageAction).toHaveBeenCalledWith({
      channel: 'slack',
      action,
      params,
      accountId: 'work',
      sessionKey: 'main',
      sessionId: 'session-1',
      agentId: 'agent-1',
      conversationReadOrigin: 'direct-operator',
      idempotencyKey: 'idem-1',
    });
  });

  it('generates idempotency keys and omits direct-operator authority unless opted in', async () => {
    const sdk = client();
    const provider = new OpenClawSlackProvider(sdk);
    await provider.listPins('C1');

    const request = vi.mocked(sdk.messageAction).mock.calls[0]?.[0];
    expect(request).toMatchObject({ channel: 'slack', action: 'list-pins', params: { channelId: 'C1' } });
    expect(request?.idempotencyKey).toMatch(/^slack-/);
    expect(request).not.toHaveProperty('conversationReadOrigin');
  });

  it('preserves successful image download results that omit an ok field', async () => {
    const response = {
      fileId: 'F1',
      path: '/tmp/F1.png',
      contentType: 'image/png',
      media: { mediaUrl: 'file:///tmp/F1.png', outbound: false as const, contentType: 'image/png' },
    };
    const sdk = client({ messageAction: vi.fn(async () => response) });

    await expect(new OpenClawSlackProvider(sdk).downloadFile({ fileId: 'F1', channelId: 'C1' }))
      .resolves.toBe(response);
  });

  it('rejects deterministic empty identifiers before calling the gateway', async () => {
    const sdk = client();
    const provider = new OpenClawSlackProvider(sdk);

    await expect(provider.sendMessage({ to: ' ', message: 'hello' })).rejects.toThrow(/target must be nonempty/i);
    await expect(provider.downloadFile({ fileId: '', channelId: 'C1' })).rejects.toThrow(/file id must be nonempty/i);
    await expect(provider.deleteMessage({ channelId: 'C1', messageId: '' })).rejects.toThrow(/message id must be nonempty/i);
    await expect(provider.getMemberInfo('')).rejects.toThrow(/user id must be nonempty/i);
    await expect(provider.listPins('C1', { idempotencyKey: '' })).rejects.toThrow(/idempotency key must be nonempty/i);
    expect(sdk.messageAction).not.toHaveBeenCalled();
  });

  it('rejects contentless sends and edits and media thread broadcasts', async () => {
    const sdk = client();
    const provider = new OpenClawSlackProvider(sdk);
    const contentlessSend = { to: 'C1' } as unknown as OpenClawSlackSendMessageInput;
    const contentlessEdit = { channelId: 'C1', messageId: '100.1' } as unknown as OpenClawSlackEditMessageInput;
    const mediaBroadcast = {
      to: 'C1', media: 'https://example.test/image.png', replyBroadcast: true,
    } as unknown as OpenClawSlackSendMessageInput;

    await expect(provider.sendMessage(contentlessSend)).rejects.toThrow(/content is required/i);
    await expect(provider.editMessage(contentlessEdit)).rejects.toThrow(/content is required/i);
    await expect(provider.sendMessage(mediaBroadcast)).rejects.toThrow(/cannot set replyBroadcast/i);
    expect(sdk.messageAction).not.toHaveBeenCalled();
  });
});
