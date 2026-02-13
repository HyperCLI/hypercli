/**
 * Configuration handling for HyperCLI SDK
 * Priority: env vars > config file > defaults
 */
import { homedir } from 'os';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { writeFileSync, mkdirSync, chmodSync } from 'fs';

export const CONFIG_DIR = join(homedir(), '.hypercli');
export const CONFIG_FILE = join(CONFIG_DIR, 'config');

export const DEFAULT_API_URL = 'https://api.hypercli.com';
export const DEFAULT_WS_URL = 'wss://api.hypercli.com';
export const WS_LOGS_PATH = '/orchestra/ws/logs'; // WebSocket path for job logs

// GHCR images
export const GHCR_IMAGES = 'ghcr.io/compute3ai/images';
export const COMFYUI_IMAGE = `${GHCR_IMAGES}/comfyui`;

/**
 * Load config from ~/.hypercli/config
 */
function loadConfigFile(): Record<string, string> {
  const config: Record<string, string> = {};
  
  if (!existsSync(CONFIG_FILE)) {
    return config;
  }

  try {
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

/**
 * Get config value: env var > config file > default
 */
export function getConfigValue(key: string, defaultValue?: string): string | undefined {
  // Try environment variable first
  const envVal = process.env[key];
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
 * Save configuration to ~/.hypercli/config
 */
export function configure(apiKey: string, apiUrl?: string): void {
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
