/** Agent-scoped chat connector launch configuration, separate from OAuth/MCP.
 * Pure construction: never reads process.env, contacts providers or starts hosts.
 */
export const CHAT_INTEGRATIONS = {
  slack: {
    name: 'Slack',
    fields: ['SLACK_MODE', 'SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'SLACK_SIGNING_SECRET'],
    secrets: ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'SLACK_SIGNING_SECRET'],
    defaults: { SLACK_MODE: 'socket' },
  },
  buzz: {
    name: 'Buzz',
    fields: ['BUZZ_RELAY_URL', 'BUZZ_PRIVATE_KEY', 'BUZZ_AUTH_TAG'],
    secrets: ['BUZZ_PRIVATE_KEY', 'BUZZ_AUTH_TAG'],
    defaults: {},
  },
  teams: {
    name: 'Microsoft Teams',
    fields: ['TEAMS_APP_ID', 'TEAMS_APP_SECRET', 'TEAMS_TENANT_ID', 'TEAMS_TRUSTED_SERVICE_BASES'],
    secrets: ['TEAMS_APP_SECRET'],
    defaults: {},
  },
  telegram: {
    name: 'Telegram',
    fields: ['TELEGRAM_MODE', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_URL', 'TELEGRAM_WEBHOOK_SECRET'],
    secrets: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET'],
    defaults: { TELEGRAM_MODE: 'polling' },
  },
} as const;

export type ChatIntegration = keyof typeof CHAT_INTEGRATIONS;
export interface ChatIntegrationLaunchConfig {
  env: Record<string, string>;
  secrets: Record<string, string>;
}

/** Validate a complete connector configuration and split it into launch maps.
 * Errors contain field names only. Validation proves syntax, not credentials,
 * provider scopes, webhook reachability or host support.
 */
export function buildChatIntegrationConfig(
  integration: ChatIntegration,
  values: Record<string, string>,
): ChatIntegrationLaunchConfig {
  if (!Object.prototype.hasOwnProperty.call(CHAT_INTEGRATIONS, integration)) {
    throw new Error('Unknown chat integration');
  }
  const descriptor = CHAT_INTEGRATIONS[integration];
  const fields: readonly string[] = descriptor.fields;
  const secretFields: readonly string[] = descriptor.secrets;
  const normalized: Record<string, string> = { ...descriptor.defaults };
  for (const [key, value] of Object.entries(values)) {
    if (!fields.includes(key)) throw new Error('Unknown field for chat integration');
    if (typeof value !== 'string' || /[\r\n\0]/.test(value)) throw new Error(`${key} must be a single-line string`);
    if (value.trim()) normalized[key] = value.trim();
  }
  function require(...keys: string[]) {
    for (const key of keys) if (!normalized[key]) throw new Error(`${key} is required`);
  }
  function url(key: string, protocols: string[], value = normalized[key]): URL {
    if (!/^[a-z]+:\/\//i.test(value) || /[\s\\?#\x00-\x1f\x7f-\x9f\ufeff]/.test(value)) throw new Error(`${key} has an invalid URL`);
    const authority = /^[a-z]+:\/\/([^/]+)/i.exec(value)?.[1] ?? '';
    if (/[^\x00-\x7f]/.test(authority)) throw new Error(`${key} has an invalid URL`);
    const match = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::([0-9]+))?$/i.exec(authority);
    if (!match || (match[2] !== undefined && Number(match[2]) > 65535)) throw new Error(`${key} has an invalid URL`);
    const host = match[1];
    if (!host.startsWith('[')) {
      const labels = host.replace(/\.$/, '').split('.');
      const numeric = /^(?:[0-9]+|0x[0-9a-f]*)$/i.test(labels.at(-1)!);
      if (host.length > 253 || labels.some(label => /^xn--/i.test(label) || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
        || (numeric && (labels.length !== 4 || labels.some(label => !/^(?:0|[1-9][0-9]{0,2})$/.test(label) || Number(label) > 255)))) {
        throw new Error(`${key} has an invalid URL`);
      }
    }
    let parsed: URL;
    try { parsed = new URL(value); } catch { throw new Error(`${key} must be an absolute URL`); }
    if (!protocols.includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.hash || parsed.search) {
      throw new Error(`${key} has an invalid URL`);
    }
    return parsed;
  }
  function absent(...keys: string[]) {
    for (const key of keys) if (normalized[key]) throw new Error(`${key} does not apply to the selected mode`);
  }
  switch (integration) {
    case 'slack':
      require('SLACK_BOT_TOKEN');
      if (normalized.SLACK_MODE === 'socket') {
        require('SLACK_APP_TOKEN'); absent('SLACK_SIGNING_SECRET');
      } else if (normalized.SLACK_MODE === 'http') {
        require('SLACK_SIGNING_SECRET'); absent('SLACK_APP_TOKEN');
      } else throw new Error('SLACK_MODE must be socket or http');
      break;
    case 'buzz':
      require('BUZZ_RELAY_URL', 'BUZZ_PRIVATE_KEY');
      url('BUZZ_RELAY_URL', ['ws:', 'wss:']);
      // Key and delegation cryptographic verification remains adapter-owned.
      break;
    case 'teams': {
      require('TEAMS_APP_ID', 'TEAMS_APP_SECRET', 'TEAMS_TENANT_ID', 'TEAMS_TRUSTED_SERVICE_BASES');
      for (const key of ['TEAMS_APP_ID', 'TEAMS_TENANT_ID']) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized[key])) {
          throw new Error(`${key} must be a UUID`);
        }
      }
      let bases: unknown;
      try { bases = JSON.parse(normalized.TEAMS_TRUSTED_SERVICE_BASES); } catch { /* handled below */ }
      if (!Array.isArray(bases) || !bases.length || bases.some((base) => typeof base !== 'string')) {
        throw new Error('TEAMS_TRUSTED_SERVICE_BASES must be a nonempty JSON array of URLs');
      }
      for (const base of bases) {
        url('TEAMS_TRUSTED_SERVICE_BASES', ['https:'], base);
        if (!base.endsWith('/')) {
          throw new Error('TEAMS_TRUSTED_SERVICE_BASES URLs must end with /');
        }
      }
      normalized.TEAMS_TRUSTED_SERVICE_BASES = JSON.stringify(bases);
      break;
    }
    case 'telegram':
      require('TELEGRAM_BOT_TOKEN');
      if (normalized.TELEGRAM_MODE === 'webhook') {
        require('TELEGRAM_WEBHOOK_URL', 'TELEGRAM_WEBHOOK_SECRET');
        url('TELEGRAM_WEBHOOK_URL', ['https:']);
        if (!/^[A-Za-z0-9_-]{1,256}$/.test(normalized.TELEGRAM_WEBHOOK_SECRET)) {
          throw new Error('TELEGRAM_WEBHOOK_SECRET must contain 1–256 letters, digits, _ or -');
        }
      } else if (normalized.TELEGRAM_MODE === 'polling') {
        absent('TELEGRAM_WEBHOOK_URL', 'TELEGRAM_WEBHOOK_SECRET');
      } else throw new Error('TELEGRAM_MODE must be polling or webhook');
  }
  const result: ChatIntegrationLaunchConfig = { env: {}, secrets: {} };
  for (const [key, value] of Object.entries(normalized)) {
    (secretFields.includes(key) ? result.secrets : result.env)[key] = value;
  }
  return result;
}
