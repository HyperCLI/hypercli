import { describe, expect, it, vi } from 'vitest';
import {
  OpenClawWhatsAppProvider,
  type OpenClawWhatsAppClient,
  type OpenClawWhatsAppProgressEvent,
} from '../src/openclaw/whatsapp.js';

function client(overrides: Partial<OpenClawWhatsAppClient> = {}): OpenClawWhatsAppClient {
  return {
    channelsStatus: vi.fn(async () => ({ channels: {}, channelOrder: [] })),
    pluginsList: vi.fn(async () => {
      throw new Error('unknown method: plugins.list');
    }),
    pluginsInstall: vi.fn(),
    pluginsSetEnabled: vi.fn(),
    pluginsRefresh: vi.fn(),
    ...overrides,
  };
}

describe('OpenClawWhatsAppProvider', () => {
  it('skips plugin commands when WhatsApp is registered in the live gateway', async () => {
    const sdk = client({
      channelsStatus: vi.fn(async () => ({
        channels: { whatsapp: { configured: true, running: true } },
        channelOrder: ['whatsapp'],
      })),
    });
    const runCommand = vi.fn();
    const provider = new OpenClawWhatsAppProvider(sdk, { runCommand });

    await expect(provider.ensureSupport()).resolves.toEqual({
      changed: false,
      restartRequired: false,
      runtimeAvailable: true,
    });
    expect(runCommand).not.toHaveBeenCalled();
    expect(sdk.pluginsList).not.toHaveBeenCalled();
  });

  it('requests a QR before inspecting plugin support when the channel is already enabled', async () => {
    const events: OpenClawWhatsAppProgressEvent[] = [];
    const webLoginStart = vi.fn(async () => ({
      connected: false,
      message: 'Scan this code',
      qrDataUrl: 'data:image/png;base64,cXI=',
    }));
    const sdk = client();
    const runCommand = vi.fn();
    const provider = new OpenClawWhatsAppProvider(sdk, {
      runCommand,
      onProgress: (event) => events.push(event),
      pairing: {
        webLoginStart,
        webLoginWait: vi.fn(),
        waitReady: vi.fn(async () => ({})),
      },
    });

    await expect(provider.startPairing()).resolves.toMatchObject({
      qrDataUrl: 'data:image/png;base64,cXI=',
    });
    expect(runCommand).not.toHaveBeenCalled();
    expect(sdk.pluginsList).not.toHaveBeenCalled();
    expect(events).toEqual([
      {
        id: 'operation:requesting-qr',
        kind: 'operation',
        label: 'Requesting a WhatsApp pairing code',
        stage: 'requesting-qr',
        status: 'running',
      },
      {
        id: 'operation:requesting-qr',
        kind: 'operation',
        label: 'Requesting a WhatsApp pairing code',
        stage: 'requesting-qr',
        status: 'succeeded',
      },
    ]);
  });

  it('visibly restarts and retries when an installed plugin is absent from the live gateway', async () => {
    const events: OpenClawWhatsAppProgressEvent[] = [];
    const webLoginStart = vi.fn()
      .mockRejectedValueOnce(new Error('web login provider is not available'))
      .mockResolvedValueOnce({ connected: false, message: 'Scan', qrDataUrl: 'data:image/png;base64,cXI=' });
    const runCommand = vi.fn(async (command: string) => ({
      exitCode: 0,
      stdout: command === 'openclaw plugins list --json'
        ? JSON.stringify({ plugins: [{ id: 'whatsapp', installed: true, enabled: true, state: 'enabled' }] })
        : '',
      stderr: '',
    }));
    const waitReady = vi.fn(async () => ({}));
    const provider = new OpenClawWhatsAppProvider(client(), {
      runCommand,
      onProgress: (event) => events.push(event),
      pairing: {
        webLoginStart,
        webLoginWait: vi.fn(),
        waitReady,
      },
    });

    await expect(provider.startPairing()).resolves.toMatchObject({
      qrDataUrl: 'data:image/png;base64,cXI=',
    });
    expect(runCommand.mock.calls).toEqual([
      ['openclaw plugins list --json', 60],
      ['openclaw gateway restart', 60],
    ]);
    expect(waitReady).toHaveBeenCalledWith(120_000, { probe: 'status', retryIntervalMs: 2_000 });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'requesting-qr', status: 'failed' }),
      expect.objectContaining({ stage: 'checking-runtime', status: 'running' }),
      expect.objectContaining({ command: 'openclaw plugins list --json', status: 'succeeded' }),
      expect.objectContaining({ command: 'openclaw gateway restart', status: 'succeeded' }),
      expect.objectContaining({ stage: 'waiting-for-gateway', status: 'succeeded' }),
      expect.objectContaining({ stage: 'retrying-qr', status: 'succeeded' }),
    ]));
  });

  it('restarts when the login provider is missing even if channel status reports WhatsApp', async () => {
    const sdk = client({
      channelsStatus: vi.fn(async () => ({
        channels: { whatsapp: { configured: true, running: false } },
        channelOrder: ['whatsapp'],
      })),
    });
    const webLoginStart = vi.fn()
      .mockRejectedValueOnce(new Error('web login provider is not available'))
      .mockResolvedValueOnce({ connected: false, message: 'Scan', qrDataUrl: 'data:image/png;base64,cXI=' });
    const runCommand = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    const provider = new OpenClawWhatsAppProvider(sdk, {
      runCommand,
      pairing: {
        webLoginStart,
        webLoginWait: vi.fn(),
        waitReady: vi.fn(async () => ({})),
      },
    });

    await expect(provider.startPairing()).resolves.toMatchObject({
      qrDataUrl: 'data:image/png;base64,cXI=',
    });
    expect(runCommand).toHaveBeenCalledWith('openclaw gateway restart', 60);
    expect(sdk.pluginsList).not.toHaveBeenCalled();
  });

  it('installs, enables, and reports CLI command progress on older gateways', async () => {
    const events: OpenClawWhatsAppProgressEvent[] = [];
    const runCommand = vi.fn(async (command: string) => ({
      exitCode: 0,
      stdout: command === 'openclaw plugins list --json' ? JSON.stringify({ plugins: [] }) : '',
      stderr: '',
    }));
    const provider = new OpenClawWhatsAppProvider(client(), {
      runCommand,
      onProgress: (event) => events.push(event),
    });

    await expect(provider.ensureSupport()).resolves.toEqual({
      changed: true,
      restartRequired: true,
      runtimeAvailable: false,
    });
    expect(runCommand.mock.calls).toEqual([
      ['openclaw plugins list --json', 60],
      ['openclaw plugins install whatsapp', 300],
      ['openclaw plugins enable whatsapp', 60],
    ]);
    expect(events.filter((event) => event.kind === 'command')).toEqual([
      { id: 'command:openclaw plugins list --json', kind: 'command', label: 'Running workspace command', command: 'openclaw plugins list --json', status: 'running' },
      { id: 'command:openclaw plugins list --json', kind: 'command', label: 'Running workspace command', command: 'openclaw plugins list --json', status: 'succeeded', detail: 'Exit code 0' },
      { id: 'command:openclaw plugins install whatsapp', kind: 'command', label: 'Running workspace command', command: 'openclaw plugins install whatsapp', status: 'running' },
      { id: 'command:openclaw plugins install whatsapp', kind: 'command', label: 'Running workspace command', command: 'openclaw plugins install whatsapp', status: 'succeeded', detail: 'Exit code 0' },
      { id: 'command:openclaw plugins enable whatsapp', kind: 'command', label: 'Running workspace command', command: 'openclaw plugins enable whatsapp', status: 'running' },
      { id: 'command:openclaw plugins enable whatsapp', kind: 'command', label: 'Running workspace command', command: 'openclaw plugins enable whatsapp', status: 'succeeded', detail: 'Exit code 0' },
    ]);
  });

  it('restarts through the SDK command runner and reports failures', async () => {
    const events: OpenClawWhatsAppProgressEvent[] = [];
    const provider = new OpenClawWhatsAppProvider(client(), {
      runCommand: vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: 'restart unavailable' })),
      onProgress: (event) => events.push(event),
    });

    await expect(provider.restartGateway()).rejects.toThrow(
      'Could not restart the workspace after installing WhatsApp support. restart unavailable',
    );
    expect(events).toEqual([
      { id: 'command:openclaw gateway restart', kind: 'command', label: 'Running workspace command', command: 'openclaw gateway restart', status: 'running' },
      { id: 'command:openclaw gateway restart', kind: 'command', label: 'Running workspace command', command: 'openclaw gateway restart', status: 'failed', detail: 'Exit code 1: restart unavailable' },
    ]);
  });
});
