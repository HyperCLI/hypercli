/**
 * `hyper integrations` — third-party provider connections (OAuth via the
 * /integrations facade; Nango-backed or Slack relay).
 *
 *   hyper integrations providers
 *   hyper integrations connections
 *   hyper integrations status <agent>
 *   hyper integrations connect <provider> [--wait] [--timeout SECONDS]
 *   hyper integrations disconnect <provider>
 *   hyper integrations enable <provider> [--agent <name|id>]
 *   hyper integrations disable <provider> [--agent <name|id>]
 *   hyper integrations unset <provider> --agent <name|id>
 *   hyper integrations token <provider>
 *   hyper integrations call <provider> <METHOD> <path> [body]
 *
 * `token` prints ONLY the raw access token on stdout in table mode so it is
 * pipe-safe (`GH_TOKEN=$(hyper integrations token github)`); metadata goes to
 * stderr. Relay-managed Slack supports connect/disconnect, but not
 * token/credentials/proxy or global enable/disable.
 *
 * enable/disable without --agent flip the facade connection (PATCH
 * /connections/{provider}); with --agent they write the per-agent meta
 * override (meta.integrations[provider].enabled). `unset` removes that
 * override, reverting the provider to default-enabled for the agent.
 * `status` shows the effective per-provider state for one agent:
 * effective = connected AND facade hyper_enabled AND (agent override ?? true).
 */

import { APIError, type Agent, type ConnectionEntry, type Provider } from '@hypercli.com/sdk';
import { parseCommandArgs, parseUniversal } from '../core/argv.js';
import { CliError, UsageError } from '../core/errors.js';
import { renderGroupHelp } from '../core/help.js';
import type { CommandContext } from '../core/types.js';
import { runIntegrationsMcp } from '../core/integrations-mcp.js';
import { readFile } from 'node:fs/promises';

export const name = 'integrations';
export const summary = 'Manage third-party provider connections (GitHub, Slack, ...).';
export const usage = [
  'hyper integrations --mcp [--json]',
  'hyper integrations --mcp <tool> --help [--json]',
  'hyper integrations --mcp <tool> [--args JSON] [--json]',
  'hyper integrations providers [--json]',
  'hyper integrations connections [--json]',
  'hyper integrations status <agent> [--json]',
  'hyper integrations connect <provider> [--new | --connection ID] [--wait] [--timeout SECONDS]',
  'hyper integrations disconnect <provider> [--connection ID]',
  'hyper integrations enable <provider> [--agent <name|id> | --connection ID]',
  'hyper integrations disable <provider> [--agent <name|id> | --connection ID]',
  'hyper integrations unset <provider> --agent <name|id>',
  'hyper integrations token <provider> [--connection ID] [--json]',
  'hyper integrations credentials <provider> [--connection ID] [--field FIELD] [--json]',
  'hyper integrations import <provider> --file <path|-> [--connection ID]',
  'hyper integrations call <provider> <METHOD> <path> [body] [--connection ID] [--headers JSON] [--json]',
];

const DEFAULT_WAIT_TIMEOUT_S = 600;
const WAIT_POLL_INTERVAL_MS = 2000;

function stringOption(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** APIError -> CliError with the server detail verbatim (incl. relay 400s). */
function toCliError(err: unknown, action: string): CliError {
  if (err instanceof APIError) return new CliError(`${action}: ${err.detail}`);
  return err instanceof CliError ? err : new CliError(`${action}: ${err instanceof Error ? err.message : String(err)}`);
}

/** Credential and provider-call errors must not echo arbitrary response/request bodies. */
function privateRequestError(err: unknown, action: string): CliError {
  return new CliError(`${action}${err instanceof APIError ? ` (HTTP ${err.statusCode})` : ''}; check provider configuration, permissions and connection selection`);
}

function provider(parsed: { positionals: string[] }, usageLine: string): string {
  const name = parsed.positionals[0];
  if (!name) throw new UsageError(`usage: ${usageLine}`);
  const extra = parsed.positionals[1];
  if (extra !== undefined) throw new UsageError(`unexpected argument '${extra}' (${usageLine})`);
  return name;
}

async function cmdProviders(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args);
  if (parsed.positionals.length > 0) {
    throw new UsageError(`unexpected argument '${parsed.positionals[0]}' (hyper integrations providers)`);
  }
  const client = await ctx.client();
  let providers: Provider[];
  try {
    providers = await client.integrations.listProviders();
  } catch (err) {
    throw toCliError(err, 'failed to list providers');
  }
  ctx.output.result(providers, {
    columns: ['NAME', 'DISPLAY_NAME', 'AUTH', 'MODES'],
    rows: providers.map((p) => [p.name, p.displayName, p.auth, p.modes.join(', ')]),
  });
}

async function cmdConnections(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args);
  if (parsed.positionals.length > 0) {
    throw new UsageError(`unexpected argument '${parsed.positionals[0]}' (hyper integrations connections)`);
  }
  const client = await ctx.client();
  let connections: ConnectionEntry[];
  try {
    connections = await client.integrations.listConnections();
  } catch (err) {
    throw toCliError(err, 'failed to list connections');
  }
  ctx.output.result(connections, {
    columns: ['NAME', 'CONNECTED', 'ENABLED', 'BACKEND', 'CONNECTION_IDS'],
    rows: connections.map((entry) => [
      entry.name,
      entry.connected ? 'yes' : 'no',
      entry.connection?.hyperEnabled === null || entry.connection?.hyperEnabled === undefined
        ? ''
        : entry.connection.hyperEnabled
          ? 'yes'
          : 'no',
      entry.backendAvailable ? entry.backend : `${entry.backend} (unavailable)`,
      (entry.connections ?? (entry.connection ? [entry.connection] : [])).map((c) => c.id).join(', '),
    ]),
  });
}

async function cmdConnect(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, {
    wait: { type: 'boolean', default: false },
    timeout: { type: 'string' },
    connection: { type: 'string' },
    new: { type: 'boolean', default: false },
  });
  const name = provider(parsed, 'hyper integrations connect <provider> [--wait] [--timeout SECONDS]');
  if (parsed.values.new && parsed.values.connection) throw new UsageError('Choose --new or --connection, not both');
  if (parsed.values.connection && parsed.values.wait) throw new UsageError('Reconnect returns an authorization URL; --wait cannot prove a refresh of an existing connection');
  let timeoutS = DEFAULT_WAIT_TIMEOUT_S;
  if (parsed.values.timeout !== undefined) {
    timeoutS = Number(parsed.values.timeout);
    if (!Number.isFinite(timeoutS) || timeoutS <= 0) {
      throw new UsageError('--timeout expects a positive number of seconds');
    }
  }
  const client = await ctx.client();
  const previousIds = new Set<string>();
  if (parsed.values.new && parsed.values.wait) {
    try {
      const entry = (await client.integrations.listConnections()).find((p) => p.name === name);
      if (!entry?.backendAvailable) throw new CliError('Integration backend unavailable');
      for (const c of entry.connections ?? (entry.connection ? [entry.connection] : [])) previousIds.add(c.id);
    } catch (err) { throw toCliError(err, 'failed to inspect existing connections'); }
  }
  let session;
  try {
    session = await client.integrations.startConnection(name, stringOption(parsed.values.connection), Boolean(parsed.values.new));
  } catch (err) {
    throw toCliError(err, `failed to start ${name} connection`);
  }

  const payload: Record<string, unknown> = { ...session, connected: false };
  const lines = [`authorize  ${session.authorizeUrl}`];
  if (session.expiresAt) lines.push(`expires  ${session.expiresAt}`);

  if (!parsed.values.wait) {
    ctx.output.result(payload, lines.join('\n'));
    return;
  }

  ctx.output.info(`authorize  ${session.authorizeUrl}`);
  ctx.output.info(`waiting up to ${timeoutS}s for the ${name} OAuth flow to finish...`);
  const deadline = Date.now() + timeoutS * 1000;
  for (;;) {
    try {
      let connectionId: string | undefined;
      if (parsed.values.new) {
        const entry = (await client.integrations.listConnections()).find((p) => p.name === name);
        if (!entry?.backendAvailable) throw new CliError('Integration backend unavailable');
        const added = (entry.connections ?? (entry.connection ? [entry.connection] : [])).filter((c) => !previousIds.has(c.id));
        if (added.length === 0) throw new APIError(409, 'Connection is not complete');
        if (added.length > 1) throw new CliError('Multiple new connections found; inspect connections and select an ID');
        connectionId = added[0].id;
      }
      const completed = await client.integrations.completeConnection(name, connectionId);
      payload.connected = true;
      payload.connection = completed.connection;
      ctx.output.result(payload, [...lines, `connected  ${name}`].join('\n'));
      return;
    } catch (err) {
      if (!(err instanceof APIError && err.statusCode === 409 && err.detail === 'Connection is not complete')) {
        throw toCliError(err, `failed to complete ${name} connection`);
      }
      if (Date.now() >= deadline) {
        throw new CliError(`${name} connection not completed within ${timeoutS}s — finish the OAuth flow, then inspect 'hyper integrations connections'`);
      }
      await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_INTERVAL_MS));
    }
  }
}

async function cmdDisconnect(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, { connection: { type: 'string' } });
  const name = provider(parsed, 'hyper integrations disconnect <provider>');
  const client = await ctx.client();
  try {
    await client.integrations.disconnect(name, stringOption(parsed.values.connection));
  } catch (err) {
    throw toCliError(err, `failed to disconnect ${name}`);
  }
  ctx.output.result({ provider: name, deleted: true }, `disconnected ${name}`);
}

interface IntegrationStatusRow {
  provider: string;
  connected: boolean;
  /** Facade hyper_enabled; null when the provider has no connection. */
  facadeEnabled: boolean | null;
  /** Agent meta override; null when unset (default enabled). */
  agentEnabled: boolean | null;
  effective: boolean;
}

function agentOverrideEnabled(agentMeta: unknown, providerName: string): boolean | null {
  if (!agentMeta || typeof agentMeta !== 'object') return null;
  const integrations = (agentMeta as Record<string, unknown>).integrations;
  if (!integrations || typeof integrations !== 'object') return null;
  const entry = (integrations as Record<string, unknown>)[providerName];
  if (!entry || typeof entry !== 'object') return null;
  const enabled = (entry as Record<string, unknown>).enabled;
  return typeof enabled === 'boolean' ? enabled : null;
}

async function cmdStatus(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args);
  const agentRef = provider(parsed, 'hyper integrations status <agent>');
  const client = await ctx.client();
  let connections: ConnectionEntry[];
  let agent: Agent;
  try {
    [connections, agent] = await Promise.all([
      client.integrations.listConnections(),
      client.deployments.get(agentRef),
    ]);
  } catch (err) {
    throw toCliError(err, `failed to load integrations status for ${agentRef}`);
  }
  const rows: IntegrationStatusRow[] = connections.map((entry) => {
    const connectedRows = entry.connections ?? (entry.connection ? [entry.connection] : []);
    const facadeEnabled = connectedRows.length ? connectedRows.some((c) => c.hyperEnabled === true) : null;
    const agentEnabled = agentOverrideEnabled(agent.meta, entry.name);
    return {
      provider: entry.name,
      connected: entry.connected,
      facadeEnabled,
      agentEnabled,
      effective: entry.connected && facadeEnabled === true && agentEnabled !== false,
    };
  });
  ctx.output.result(
    { agent: { id: agent.id, name: agent.name }, providers: rows },
    {
      columns: ['PROVIDER', 'CONNECTED', 'FACADE', 'AGENT', 'EFFECTIVE'],
      rows: rows.map((row) => [
        row.provider,
        row.connected ? 'yes' : 'no',
        row.facadeEnabled === null ? '–' : row.facadeEnabled ? 'on' : 'off',
        row.agentEnabled === null ? 'unset' : row.agentEnabled ? 'enabled' : 'disabled',
        row.effective ? 'yes' : 'no',
      ]),
    },
  );
}

async function setEnabled(ctx: CommandContext, args: string[], enabled: boolean): Promise<void> {
  const parsed = parseCommandArgs(args, { agent: { type: 'string' }, connection: { type: 'string' } });
  const word = enabled ? 'enable' : 'disable';
  const name = provider(parsed, `hyper integrations ${word} <provider> [--agent <name|id>]`);
  const agentRef = typeof parsed.values.agent === 'string' ? parsed.values.agent : undefined;
  const client = await ctx.client();
  if (agentRef) {
    if (parsed.values.connection) throw new UsageError('--connection cannot be combined with --agent (policy is per provider)');
    try {
      await client.deployments.update(agentRef, { integrations: { [name]: { enabled } } });
    } catch (err) {
      throw toCliError(err, `failed to ${word} ${name} for ${agentRef}`);
    }
    ctx.output.result(
      { agent: agentRef, provider: name, enabled },
      `${enabled ? 'enabled' : 'disabled'} ${name} for ${agentRef}`,
    );
    return;
  }
  try {
    await client.integrations.setConnectionEnabled(name, enabled, stringOption(parsed.values.connection));
  } catch (err) {
    throw toCliError(err, `failed to ${word} ${name}`);
  }
  ctx.output.result({ provider: name, enabled }, `${enabled ? 'enabled' : 'disabled'} ${name}`);
}

async function cmdUnset(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, { agent: { type: 'string' } });
  const name = provider(parsed, 'hyper integrations unset <provider> --agent <name|id>');
  const agentRef = typeof parsed.values.agent === 'string' ? parsed.values.agent : undefined;
  if (!agentRef) {
    throw new UsageError('unset requires --agent <name|id> (only the per-agent override can be unset)');
  }
  const client = await ctx.client();
  try {
    await client.deployments.update(agentRef, { integrations: { [name]: { enabled: null } } });
  } catch (err) {
    throw toCliError(err, `failed to unset ${name} for ${agentRef}`);
  }
  ctx.output.result({ agent: agentRef, provider: name, enabled: null }, `unset ${name} for ${agentRef}`);
}

async function cmdToken(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, { connection: { type: 'string' } });
  const name = provider(parsed, 'hyper integrations token <provider>');
  const client = await ctx.client();
  let token;
  try {
    token = await client.integrations.mintToken(name, stringOption(parsed.values.connection));
  } catch (err) {
    throw privateRequestError(err, 'failed to retrieve token');
  }
  // Pipe-safe: table mode prints ONLY the token on stdout; metadata to stderr.
  const meta = [`provider  ${token.provider}`];
  if (token.expiresAt) meta.push(`expires  ${token.expiresAt}`);
  ctx.output.info(meta.join('\n'));
  ctx.output.result(token, token.accessToken);
}

async function cmdCredentials(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, { connection: { type: 'string' }, field: { type: 'string' } });
  const name = provider(parsed, 'hyper integrations credentials <provider> [--connection ID] [--field FIELD]');
  const client = await ctx.client();
  let result;
  try { result = await client.integrations.credentials(name, stringOption(parsed.values.connection)); }
  catch (err) { throw privateRequestError(err, 'failed to retrieve credentials'); }
  const field = stringOption(parsed.values.field);
  if (field) {
    const value = result.credentials[field];
    if (typeof value !== 'string') throw new CliError('Requested credential field is not a string');
    ctx.output.result(value, value);
  } else {
    ctx.output.result(result, JSON.stringify(result, null, 2));
  }
}

async function cmdImport(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, { connection: { type: 'string' }, file: { type: 'string' } });
  const name = provider(parsed, 'hyper integrations import <provider> --file <path|-> [--connection ID]');
  const file = stringOption(parsed.values.file);
  if (!file) throw new UsageError('--file is required; use - for stdin');
  let payload: { credentials: Record<string, unknown>; connection_config?: Record<string, unknown> };
  try {
    let text: string;
    if (file === '-') {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
      text = Buffer.concat(chunks).toString('utf8');
    } else text = await readFile(file, 'utf8');
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value) || !value.credentials || typeof value.credentials !== 'object' || Array.isArray(value.credentials)
      || Object.keys(value).some((k) => !['credentials', 'connection_config'].includes(k))
      || (value.connection_config !== undefined && (!value.connection_config || typeof value.connection_config !== 'object' || Array.isArray(value.connection_config)))) throw new Error();
    payload = value;
  } catch { throw new UsageError('Could not read native Nango credentials JSON (expected credentials and optional connection_config objects)'); }
  const client = await ctx.client();
  let connection;
  try { connection = await client.integrations.importConnection(name, payload.credentials, { connectionId: stringOption(parsed.values.connection), connectionConfig: payload.connection_config }); }
  catch (err) { throw privateRequestError(err, 'failed to import connection'); }
  ctx.output.result(connection, `connected ${name}  ${connection.id}`);
}

const PROXY_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

async function cmdCall(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, { connection: { type: 'string' }, headers: { type: 'string' } });
  const [name, rawMethod, path, bodyText, ...rest] = parsed.positionals;
  if (!name || !rawMethod || !path || rest.length > 0) {
    throw new UsageError('usage: hyper integrations call <provider> <METHOD> <path> [body]');
  }
  const method = rawMethod.toUpperCase();
  if (!PROXY_METHODS.has(method)) {
    throw new UsageError(`unknown method '${rawMethod}' (expected: ${[...PROXY_METHODS].join(', ')})`);
  }
  let body: unknown;
  if (bodyText !== undefined) {
    try {
      body = JSON.parse(bodyText);
    } catch {
      throw new UsageError('call body must be JSON');
    }
  }
  let headers: Record<string, string> | undefined;
  if (typeof parsed.values.headers === 'string') {
    try {
      const value = JSON.parse(parsed.values.headers);
      if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.values(value).every((v) => typeof v === 'string')) throw new Error();
      headers = value;
    } catch { throw new UsageError('--headers must be a JSON string map'); }
  }
  const client = await ctx.client();
  let result: unknown;
  try {
    result = await client.integrations.proxy(name, path, { method, body, connectionId: stringOption(parsed.values.connection), headers });
  } catch (err) {
    throw privateRequestError(err, 'provider request failed');
  }
  ctx.output.result(result, JSON.stringify(result, null, 2));
}

const COMMANDS: Record<string, (ctx: CommandContext, args: string[]) => Promise<void>> = {
  providers: cmdProviders,
  connections: cmdConnections,
  status: cmdStatus,
  connect: cmdConnect,
  disconnect: cmdDisconnect,
  enable: (ctx, args) => setEnabled(ctx, args, true),
  disable: (ctx, args) => setEnabled(ctx, args, false),
  unset: cmdUnset,
  token: cmdToken,
  credentials: cmdCredentials,
  import: cmdImport,
  call: cmdCall,
};

export async function run(ctx: CommandContext, args: string[]): Promise<number | void> {
  const scan = parseUniversal(args);
  if (scan.values.mcp !== undefined) {
    return runIntegrationsMcp(ctx, args);
  }
  const [sub] = scan.positionals;
  if (scan.help || !sub) {
    process.stdout.write(`${renderGroupHelp({ name, summary, usage, run })}\n`);
    return;
  }
  const handler = COMMANDS[sub];
  if (!handler) {
    throw new UsageError(
      `unknown integrations command '${sub}' (expected: ${Object.keys(COMMANDS).join(', ')})`,
    );
  }
  const subArgs = [...args];
  subArgs.splice(scan.firstPositionalIndex, 1);
  await handler(ctx, subArgs);
}
