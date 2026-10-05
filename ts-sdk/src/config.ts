/**
 * Configuration handling for HyperCLI SDK
 * Priority: env vars > config file > defaults
 */
import { getNodeRequire } from '#config-require';
import {
  agentsAdminApiBaseFromProductBase,
  defaultAgentsWsUrl,
  DEFAULT_AGENTS_API_BASE_URL,
  DEFAULT_AGENTS_WS_URL,
  DEV_AGENTS_API_BASE_URL,
  DEV_AGENTS_WS_URL,
  resolveAgentsApiBase,
} from './agent-urls.js';

function getNodeConfigPaths(): { configDir: string; configFile: string } | null {
  const req = getNodeRequire();
  if (!req) return null;
  try {
    const { homedir } = req('os') as typeof import('os');
    const { join } = req('path') as typeof import('path');
    const hyperHome = readEnvValue('HYPER_HOME')?.trim();
    const configDir = hyperHome || join(homedir(), '.hypercli');
    return {
      configDir,
      configFile: join(configDir, 'config'),
    };
  } catch {
    return null;
  }
}

export const DEFAULT_API_URL = 'https://api.hypercli.com';
// The agents defaults live in agent-urls.ts (single source for derivation);
// re-exported here for SDK surface compatibility.
export {
  DEFAULT_AGENTS_API_BASE_URL,
  DEFAULT_AGENTS_WS_URL,
  DEV_AGENTS_API_BASE_URL,
  DEV_AGENTS_WS_URL,
};
export const WS_LOGS_PATH = '/orchestra/ws/logs'; // WebSocket path for job logs

// GHCR images
const GHCR_IMAGES = 'ghcr.io/compute3ai/images';
export const COMFYUI_IMAGE = `${GHCR_IMAGES}/comfyui`;

/**
 * Load config from the active HyperCLI data directory.
 */
function loadConfigFile(): Record<string, string> {
  const config: Record<string, string> = {};

  const req = getNodeRequire();
  if (!req) {
    return config;
  }

  try {
    const paths = getNodeConfigPaths();
    if (!paths) {
      return config;
    }
    const { existsSync, readFileSync } = req('fs') as typeof import('fs');
    if (!existsSync(paths.configFile)) {
      return config;
    }

    const content = readFileSync(paths.configFile, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const normalized = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
        const [key, ...valueParts] = normalized.split('=');
        const value = valueParts.join('=').trim();
        config[key.trim()] = (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) ? value.slice(1, -1) : value;
      }
    }
  } catch {
    // Ignore read errors
  }

  return config;
}

function readEnvValue(key: string): string | undefined {
  if (typeof process === 'undefined' || !process?.env) {
    return undefined;
  }
  return process.env[key];
}

/**
 * Get config value: env var > config file > default
 */
export function getConfigValue(key: string, defaultValue?: string): string | undefined {
  // Try environment variable first
  const envVal = readEnvValue(key);
  if (envVal) {
    return envVal;
  }

  // Try config file
  const config = loadConfigFile();
  const fileVal = config[key];
  if (fileVal) {
    return fileVal;
  }

  return defaultValue;
}

/**
 * Get API key from env or config file
 */
export function getApiKey(): string | undefined {
  const envKey = readEnvValue('HYPER_API_KEY')?.trim();
  if (envKey) {
    return envKey;
  }
  const config = loadConfigFile();
  return config.HYPER_API_KEY || undefined;
}

/**
 * Get the user-selected key, falling back to the managed runtime token.
 */
export function getAgentApiKey(): string | undefined {
  const agentEnvKey = readEnvValue('HYPER_AGENTS_API_KEY')?.trim();
  return getApiKey() || agentEnvKey || undefined;
}

/**
 * Get API URL
 */
export function getApiUrl(): string {
  return getConfigValue('HYPER_API_BASE') || DEFAULT_API_URL;
}

/**
 * Get WebSocket URL, derived from the product API URL
 */
export function getWsUrl(): string {
  const apiUrl = getApiUrl();
  return apiUrl.replace('https://', 'wss://').replace('http://', 'ws://');
}

/**
 * Resolve Agents independently, falling back to the selected product base.
 */
export function getAgentsApiBaseUrl(dev: boolean = false, productBase?: string): string {
  const fallback = dev ? DEV_AGENTS_API_BASE_URL : DEFAULT_AGENTS_API_BASE_URL;
  if (dev) {
    return fallback;
  }
  const agentsBase = getConfigValue('HYPER_AGENTS_API_BASE');
  if (agentsBase) return resolveAgentsApiBase(agentsBase, true);
  const configuredBase = productBase || getConfigValue('HYPER_API_BASE');
  if (configuredBase) {
    return resolveAgentsApiBase(configuredBase);
  }
  return fallback;
}

export function getAgentsApiBaseUrlFromProductBase(productBase: string): string {
  return resolveAgentsApiBase(productBase);
}

/**
 * Derive the agents admin API base (service-key surface) from a product API base
 */
export function getAgentsAdminApiBaseUrlFromProductBase(productBase: string): string {
  return agentsAdminApiBaseFromProductBase(productBase);
}

/**
 * Get HyperClaw agents WebSocket URL, derived from the agents API base
 */
export function getAgentsWsUrl(dev: boolean = false): string {
  return defaultAgentsWsUrl(getAgentsApiBaseUrl(dev));
}

export function getAgentsWsUrlFromProductBase(productBase: string): string {
  return defaultAgentsWsUrl(getAgentsApiBaseUrlFromProductBase(productBase));
}

/**
 * Save configuration to ~/.hypercli/config
 */
export function configure(
  apiKey: string,
  apiUrl?: string,
): void {
  const req = getNodeRequire();
  if (!req) {
    throw new Error('configure() is only available in Node.js environments');
  }
  const paths = getNodeConfigPaths();
  if (!paths) {
    throw new Error('configure() is only available in Node.js environments');
  }
  const { existsSync, writeFileSync, mkdirSync, chmodSync } = req('fs') as typeof import('fs');

  // Create directory if it doesn't exist
  if (!existsSync(paths.configDir)) {
    mkdirSync(paths.configDir, { recursive: true });
  }

  // Load existing config
  const config = loadConfigFile();

  // Update values
  config['HYPER_API_KEY'] = apiKey;
  if (apiUrl) {
    config['HYPER_API_BASE'] = apiUrl;
  }

  // Write config file
  const lines = Object.entries(config).map(([k, v]) => `${k}=${v}`);
  writeFileSync(paths.configFile, lines.join('\n') + '\n', 'utf-8');

  // Set permissions to 0600 (owner read/write only)
  try {
    chmodSync(paths.configFile, 0o600);
  } catch {
    // Ignore permission errors (Windows doesn't support chmod)
  }
}
