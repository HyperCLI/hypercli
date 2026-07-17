import {
  isOpenClawGatewayMethodUnsupported,
  type ChannelsStatusResult,
  type GatewayPluginCatalogEntry,
  type GatewayPluginsInstallParams,
  type GatewayPluginsInstallResult,
  type GatewayPluginsListResult,
  type GatewayPluginsRefreshResult,
  type GatewayPluginsSetEnabledParams,
  type GatewayPluginsSetEnabledResult,
  type GatewayWebLoginStartOptions,
  type GatewayWebLoginStartResult,
  type GatewayWebLoginWaitOptions,
  type GatewayWebLoginWaitResult,
} from './gateway.js';
import { normalizeOpenClawChannelsStatus } from './channels.js';

const PLUGIN_LIST_COMMAND = 'openclaw plugins list --json';
const PLUGIN_INSTALL_COMMAND = 'openclaw plugins install whatsapp';
const PLUGIN_ENABLE_COMMAND = 'openclaw plugins enable whatsapp';
const GATEWAY_RESTART_COMMAND = 'openclaw gateway restart';

export interface OpenClawWhatsAppCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type OpenClawWhatsAppProgressStatus = 'running' | 'succeeded' | 'failed';

export type OpenClawWhatsAppProgressStage =
  | 'configuring-channel'
  | 'requesting-qr'
  | 'checking-runtime'
  | 'inspecting-plugin'
  | 'installing-plugin'
  | 'enabling-plugin'
  | 'refreshing-plugins'
  | 'waiting-for-gateway'
  | 'waiting-for-scan'
  | 'retrying-qr';

export interface OpenClawWhatsAppProgressEvent {
  id: string;
  kind: 'operation' | 'command';
  label: string;
  command?: string;
  stage?: OpenClawWhatsAppProgressStage;
  status: OpenClawWhatsAppProgressStatus;
  detail?: string;
}

export interface OpenClawWhatsAppPairingStartOptions extends GatewayWebLoginStartOptions {
  retryAttempts?: number;
  retryIntervalMs?: number;
}

export interface OpenClawWhatsAppPairingOperations {
  webLoginStart(options: GatewayWebLoginStartOptions): Promise<GatewayWebLoginStartResult>;
  webLoginWait(options: GatewayWebLoginWaitOptions): Promise<GatewayWebLoginWaitResult>;
  activate(): Promise<void>;
}

export interface OpenClawWhatsAppSupportResult {
  changed: boolean;
  restartRequired: boolean;
  runtimeAvailable: boolean;
}

export interface OpenClawWhatsAppClient {
  channelsStatus(probe?: boolean, timeoutMs?: number, channel?: string): Promise<ChannelsStatusResult>;
  pluginsList?(): Promise<GatewayPluginsListResult>;
  pluginsInstall?(params: GatewayPluginsInstallParams): Promise<GatewayPluginsInstallResult>;
  pluginsSetEnabled?(params: GatewayPluginsSetEnabledParams): Promise<GatewayPluginsSetEnabledResult>;
  pluginsRefresh?(): Promise<GatewayPluginsRefreshResult>;
}

export interface OpenClawWhatsAppProviderOptions {
  runCommand(command: string, timeoutSeconds: number): Promise<OpenClawWhatsAppCommandResult>;
  pairing?: OpenClawWhatsAppPairingOperations;
  onProgress?: (event: OpenClawWhatsAppProgressEvent) => void;
}

export interface OpenClawWhatsAppPairingWaitOptions extends GatewayWebLoginWaitOptions {
  attempts?: number;
  onUpdate?: (result: GatewayWebLoginWaitResult) => void;
}

interface CliPluginStatus {
  installed: boolean;
  enabled: boolean;
  error?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function failureDetail(result: OpenClawWhatsAppCommandResult): string {
  return result.stderr.trim() || result.stdout.trim();
}

function parseCliPluginStatus(stdout: string): CliPluginStatus {
  let payload: unknown;
  try {
    payload = JSON.parse(stdout);
  } catch {
    throw new Error('Could not read the WhatsApp support inventory returned by this workspace.');
  }
  const record = asRecord(payload);
  const plugins = Array.isArray(record?.plugins) ? record.plugins : null;
  if (!plugins) throw new Error('This workspace returned an invalid WhatsApp support inventory.');
  const plugin = plugins.find((candidate) => asRecord(candidate)?.id === 'whatsapp');
  const entry = asRecord(plugin);
  if (!entry) return { installed: false, enabled: false };
  return {
    installed: entry.installed !== false && entry.state !== 'not-installed',
    enabled: entry.enabled === true,
    ...(typeof entry.error === 'string' ? { error: entry.error } : {}),
  };
}

export function isOpenClawWhatsAppProviderUnavailable(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
  return /web login provider is not available|not connected|gateway.*(?:closing|closed|reconnect)|socket.*(?:closing|closed)/i.test(message);
}

export class OpenClawWhatsAppProvider {
  constructor(
    private readonly client: OpenClawWhatsAppClient,
    private readonly options: OpenClawWhatsAppProviderOptions,
  ) {}

  async runtimeAvailable(): Promise<boolean> {
    const result = await this.client.channelsStatus(true, 5_000, 'whatsapp');
    return normalizeOpenClawChannelsStatus(result).some((channel) => channel.channelId === 'whatsapp');
  }

  async ensureSupport(): Promise<OpenClawWhatsAppSupportResult> {
    let runtimeAvailable = false;
    try {
      runtimeAvailable = await this.runOperation('checking-runtime', 'Checking the live WhatsApp runtime', () => this.runtimeAvailable());
    } catch {
      // Plugin inspection below is the compatibility path for older gateways.
    }
    if (runtimeAvailable) {
      return { changed: false, restartRequired: false, runtimeAvailable: true };
    }

    if (typeof this.client.pluginsList !== 'function') return await this.ensureThroughCli();
    try {
      return await this.ensureThroughGateway();
    } catch (cause) {
      if (!isOpenClawGatewayMethodUnsupported(cause)) throw cause;
      return await this.ensureThroughCli();
    }
  }

  async restartGateway(): Promise<void> {
    const result = await this.runCommand(GATEWAY_RESTART_COMMAND, 60);
    if (result.exitCode !== 0) {
      const detail = failureDetail(result);
      throw new Error(`Could not restart the workspace after installing WhatsApp support.${detail ? ` ${detail}` : ''}`);
    }
  }

  async startPairing(options: OpenClawWhatsAppPairingStartOptions = {}): Promise<GatewayWebLoginStartResult> {
    const pairing = this.options.pairing;
    if (!pairing) throw new Error('WhatsApp pairing operations are unavailable.');
    const {
      retryAttempts = 20,
      retryIntervalMs = 1_500,
      ...loginOptions
    } = options;
    const initialLoginOptions = {
      ...loginOptions,
      timeoutMs: Math.min(loginOptions.timeoutMs ?? 5_000, 5_000),
    };
    try {
      return await this.runOperation('requesting-qr', 'Requesting a WhatsApp pairing code', () => (
        pairing.webLoginStart(initialLoginOptions)
      ));
    } catch (cause) {
      if (!isOpenClawWhatsAppProviderUnavailable(cause)) throw cause;
    }

    await this.ensureSupport();
    await this.runOperation('configuring-channel', 'Activating WhatsApp in the workspace gateway', () => pairing.activate());

    for (let attempt = 0; attempt < retryAttempts; attempt += 1) {
      try {
        return await this.runOperation(
          'retrying-qr',
          `Requesting a WhatsApp pairing code${attempt > 0 ? ` (attempt ${attempt + 1})` : ''}`,
          () => pairing.webLoginStart(loginOptions),
          `retrying-qr:${attempt}`,
        );
      } catch (cause) {
        if (!isOpenClawWhatsAppProviderUnavailable(cause) || attempt === retryAttempts - 1) throw cause;
        await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
      }
    }
    throw new Error('WhatsApp pairing did not become available in time.');
  }

  async waitForPairing(options: OpenClawWhatsAppPairingWaitOptions = {}): Promise<GatewayWebLoginWaitResult> {
    const pairing = this.options.pairing;
    if (!pairing) throw new Error('WhatsApp pairing operations are unavailable.');
    const { attempts = 20, onUpdate, ...waitOptions } = options;
    let currentQrDataUrl = waitOptions.currentQrDataUrl;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const result = await this.runOperation(
        'waiting-for-scan',
        'Waiting for the WhatsApp QR scan',
        () => pairing.webLoginWait({ ...waitOptions, currentQrDataUrl }),
        `waiting-for-scan:${attempt}`,
      );
      onUpdate?.(result);
      if (result.connected) return result;
      if (!result.qrDataUrl) throw new Error(result.message || 'The WhatsApp pairing code expired.');
      currentQrDataUrl = result.qrDataUrl;
    }
    throw new Error('WhatsApp pairing timed out. Generate a new code to try again.');
  }

  private async ensureThroughGateway(): Promise<OpenClawWhatsAppSupportResult> {
    const pluginsList = this.client.pluginsList;
    if (!pluginsList) throw new Error('unsupported method: plugins.list');
    const support = await this.runOperation('inspecting-plugin', 'Inspecting WhatsApp support', () => pluginsList.call(this.client));
    let plugin: GatewayPluginCatalogEntry | undefined = support.plugins.find((candidate) => candidate.id === 'whatsapp');
    this.options.onProgress?.({
      id: 'operation:plugin-inventory',
      kind: 'operation',
      label: 'WhatsApp support inventory',
      status: 'succeeded',
      detail: plugin ? `Installed: ${plugin.installed ? 'yes' : 'no'}; enabled: ${plugin.enabled ? 'yes' : 'no'}` : 'WhatsApp support is not installed.',
    });
    if ((!plugin?.installed || !plugin.enabled) && !support.mutationAllowed) {
      throw new Error('This workspace does not allow WhatsApp support changes.');
    }
    let changed = false;
    let restartRequired = false;
    if (!plugin?.installed) {
      const pluginsInstall = this.client.pluginsInstall;
      if (!pluginsInstall) throw new Error('unsupported method: plugins.install');
      const installed = await this.runOperation('installing-plugin', 'Installing WhatsApp support', () => (
        pluginsInstall.call(this.client, { source: 'official', pluginId: 'whatsapp' })
      ));
      plugin = installed.plugin;
      changed = true;
      restartRequired ||= installed.restartRequired;
    }
    if (!plugin.enabled) {
      const pluginsSetEnabled = this.client.pluginsSetEnabled;
      if (!pluginsSetEnabled) throw new Error('unsupported method: plugins.setEnabled');
      const enabled = await this.runOperation('enabling-plugin', 'Enabling WhatsApp support', () => (
        pluginsSetEnabled.call(this.client, { pluginId: 'whatsapp', enabled: true })
      ));
      plugin = enabled.plugin;
      changed = true;
      restartRequired ||= enabled.restartRequired;
    }
    if (changed) {
      try {
        await this.runOperation('refreshing-plugins', 'Refreshing WhatsApp support', () => this.client.pluginsRefresh?.());
      } catch (cause) {
        if (!isOpenClawGatewayMethodUnsupported(cause, 'plugins.refresh')) throw cause;
      }
    }
    return {
      changed,
      restartRequired: restartRequired || (!changed && plugin.installed && plugin.enabled),
      runtimeAvailable: false,
    };
  }

  private async ensureThroughCli(): Promise<OpenClawWhatsAppSupportResult> {
    const inventory = await this.runCommand(PLUGIN_LIST_COMMAND, 60);
    if (inventory.exitCode !== 0) {
      const detail = failureDetail(inventory);
      throw new Error(`Could not inspect WhatsApp support.${detail ? ` ${detail}` : ''}`);
    }
    const status = parseCliPluginStatus(inventory.stdout);
    this.options.onProgress?.({
      id: 'operation:plugin-inventory',
      kind: 'operation',
      label: 'WhatsApp support inventory',
      status: 'succeeded',
      detail: `Installed: ${status.installed ? 'yes' : 'no'}; enabled: ${status.enabled ? 'yes' : 'no'}`,
    });
    const incompatibleInstall = status.installed && /requires plugin api/i.test(status.error ?? '');
    let changed = false;
    if (!status.installed || incompatibleInstall) {
      const command = `${PLUGIN_INSTALL_COMMAND}${incompatibleInstall ? ' --force' : ''}`;
      const installed = await this.runCommand(command, 300);
      if (installed.exitCode !== 0) {
        const detail = failureDetail(installed);
        throw new Error(`Could not install WhatsApp support.${detail ? ` ${detail}` : ''}`);
      }
      changed = true;
    }
    if (!status.installed || incompatibleInstall || !status.enabled) {
      const enabled = await this.runCommand(PLUGIN_ENABLE_COMMAND, 60);
      if (enabled.exitCode !== 0) {
        const detail = failureDetail(enabled);
        throw new Error(`Could not enable WhatsApp support.${detail ? ` ${detail}` : ''}`);
      }
      changed = true;
    }
    return {
      changed,
      restartRequired: changed || (status.installed && status.enabled),
      runtimeAvailable: false,
    };
  }

  private async runCommand(command: string, timeoutSeconds: number): Promise<OpenClawWhatsAppCommandResult> {
    const id = `command:${command}`;
    this.options.onProgress?.({ id, kind: 'command', label: 'Running workspace command', command, status: 'running' });
    try {
      const result = await this.options.runCommand(command, timeoutSeconds);
      const detail = failureDetail(result);
      this.options.onProgress?.({
        id,
        kind: 'command',
        label: 'Running workspace command',
        command,
        status: result.exitCode === 0 ? 'succeeded' : 'failed',
        detail: result.exitCode === 0 ? 'Exit code 0' : `Exit code ${result.exitCode}${detail ? `: ${detail}` : ''}`,
      });
      return result;
    } catch (cause) {
      this.options.onProgress?.({
        id,
        kind: 'command',
        label: 'Running workspace command',
        command,
        status: 'failed',
        detail: cause instanceof Error ? cause.message : 'Command execution failed.',
      });
      throw cause;
    }
  }

  private async runOperation<T>(
    stage: OpenClawWhatsAppProgressStage,
    label: string,
    operation: () => Promise<T> | T,
    id = `operation:${stage}`,
  ): Promise<T> {
    this.options.onProgress?.({ id, kind: 'operation', label, stage, status: 'running' });
    try {
      const result = await operation();
      this.options.onProgress?.({ id, kind: 'operation', label, stage, status: 'succeeded' });
      return result;
    } catch (cause) {
      this.options.onProgress?.({
        id,
        kind: 'operation',
        label,
        stage,
        status: 'failed',
        detail: cause instanceof Error ? cause.message : 'Operation failed.',
      });
      throw cause;
    }
  }
}
