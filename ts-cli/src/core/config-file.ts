import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function cliConfigDir(): string {
  const hyperHome = process.env.HYPER_HOME?.trim();
  return hyperHome || join(homedir(), '.hypercli');
}

export function cliConfigFile(): string {
  return join(cliConfigDir(), 'config');
}

function parseConfigValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function loadCliConfigFile(): Record<string, string> {
  const config: Record<string, string> = {};
  const path = cliConfigFile();
  if (!existsSync(path)) return config;

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const normalized = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
    const [key, ...valueParts] = normalized.split('=');
    config[key.trim()] = parseConfigValue(valueParts.join('='));
  }

  return config;
}

export function applyCliConfigFile(): void {
  const config = loadCliConfigFile();
  if (!process.env.HYPER_API_KEY && config.HYPER_API_KEY) {
    process.env.HYPER_API_KEY = config.HYPER_API_KEY;
  }
  if (!process.env.HYPER_API_BASE && config.HYPER_API_BASE) {
    process.env.HYPER_API_BASE = config.HYPER_API_BASE;
  }
}

export function saveCliConfig(apiKey: string, apiBase?: string): void {
  const config = loadCliConfigFile();
  config.HYPER_API_KEY = apiKey;
  delete config.HYPERCLI_API_KEY;
  delete config.HYPERCLI_API_URL;

  if (apiBase) {
    config.HYPER_API_BASE = apiBase;
  } else if (!config.HYPER_API_BASE) {
    delete config.HYPER_API_BASE;
  }

  const dir = cliConfigDir();
  const path = cliConfigFile();
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, Object.entries(config).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
  try {
    chmodSync(path, 0o600);
  } catch {
    // Some platforms do not support POSIX permissions.
  }
}
