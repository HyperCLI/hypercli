/**
 * Configuration handling for HyperCLI SDK
 * Priority: env vars > config file > defaults
 */
type NodeRequireFn = ((id: string) => any) | null;

function getNodeRequire(): NodeRequireFn {
  try {
    return (0, eval)('require') as (id: string) => any;
  } catch {
    return null;
  }
}

function getNodeConfigPaths(): { configDir: string; configFile: string } | null {
  const req = getNodeRequire();
  if (!req) return null;
  try {
    const { homedir } = req('os') as typeof import('os');
    const { join } = req('path') as typeof import('path');
    const configDir = join(homedir(), '.hypercli');
    return {
      configDir,
      configFile: join(configDir, 'config'),
    };
  } catch {
    return null;
  }
}

export const CONFIG_DIR = getNodeConfigPaths()?.configDir || '.hypercli';
export const CONFIG_FILE = getNodeConfigPaths()?.configFile || '.hypercli/config';

export const DEFAULT_API_URL = 'https://api.hypercli.com';
export const DEFAULT_WS_URL = 'wss://api.hypercli.com';
export const DEFAULT_AGENTS_API_BASE_URL = 'https://api.hypercli.com/agents';
export const DEFAULT_AGENTS_WS_URL = 'wss://api.agents.hypercli.com/ws';
export const DEV_AGENTS_API_BASE_URL = 'https://api.dev.hypercli.com/agents';
export const DEV_AGENTS_WS_URL = 'wss://api.agents.dev.hypercli.com/ws';
export const WS_LOGS_PATH = '/orchestra/ws/logs'; // WebSocket path for job logs

// GHCR images
export const GHCR_IMAGES = 'ghcr.io/compute3ai/images';
export const COMFYUI_IMAGE = `${GHCR_IMAGES}/comfyui`;

/**
 * Load config from ~/.hypercli/config
 */
function loadConfigFile(): Record<string, string> {
  const config: Record<string, string> = {};

  const req = getNodeRequire();
  if (!req) {
    return config;
  }

  try {
    const { existsSync, readFileSync } = req('fs') as typeof import('fs');
    if (!existsSync(CONFIG_FILE)) {
      return config;
    }

    const content = readFileSync(CONFIG_FILE, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const [key, ...valueParts] = trimmed.split('=');
        config[key.trim()] = valueParts.join('=').trim();
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
  return getConfigValue('HYPERCLI_API_KEY');
}

/**
 * Get API URL
 */
export function getApiUrl(): string {
  return getConfigValue('HYPERCLI_API_URL', DEFAULT_API_URL) || DEFAULT_API_URL;
}

/**
 * Get WebSocket URL
 */
export function getWsUrl(): string {
  const ws = getConfigValue('HYPERCLI_WS_URL');
  if (ws) {
    return ws;
  }

  // Derive from API URL
  const apiUrl = getApiUrl();
  return apiUrl.replace('https://', 'wss://').replace('http://', 'ws://');
}

/**
 * Get HyperClaw agents API base URL
 */
export function getAgentsApiBaseUrl(dev: boolean = false): string {
  const fallback = dev ? DEV_AGENTS_API_BASE_URL : DEFAULT_AGENTS_API_BASE_URL;
  return getConfigValue('AGENTS_API_BASE_URL', fallback) || fallback;
}

/**
 * Get HyperClaw agents WebSocket URL
 */
export function getAgentsWsUrl(dev: boolean = false): string {
  const fallback = dev ? DEV_AGENTS_WS_URL : DEFAULT_AGENTS_WS_URL;
  return getConfigValue('AGENTS_WS_URL', fallback) || fallback;
}

/**
 * Save configuration to ~/.hypercli/config
 */
export function configure(
  apiKey: string,
  apiUrl?: string,
  agentsApiBaseUrl?: string,
  agentsWsUrl?: string,
): void {
  const req = getNodeRequire();
  if (!req) {
    throw new Error('configure() is only available in Node.js environments');
  }
  const { existsSync, writeFileSync, mkdirSync, chmodSync } = req('fs') as typeof import('fs');

  // Create directory if it doesn't exist
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // Load existing config
  const config = loadConfigFile();
  
  // Update values
  config['HYPERCLI_API_KEY'] = apiKey;
  if (apiUrl) {
    config['HYPERCLI_API_URL'] = apiUrl;
  }
  if (agentsApiBaseUrl) {
    config['AGENTS_API_BASE_URL'] = agentsApiBaseUrl;
  }
  if (agentsWsUrl) {
    config['AGENTS_WS_URL'] = agentsWsUrl;
  }

  // Write config file
  const lines = Object.entries(config).map(([k, v]) => `${k}=${v}`);
  writeFileSync(CONFIG_FILE, lines.join('\n') + '\n', 'utf-8');
  
  // Set permissions to 0600 (owner read/write only)
  try {
    chmodSync(CONFIG_FILE, 0o600);
  } catch {
    // Ignore permission errors (Windows doesn't support chmod)
  }
}
