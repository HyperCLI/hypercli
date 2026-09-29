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
 * stderr. Relay-managed providers (Slack) reject enable/disable/disconnect/
 * token/call on the server — the 400 detail is surfaced verbatim.
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

export const name = 'integrations';
export const summary = 'Manage third-party provider connections (GitHub, Slack, ...).';
export const usage = [
  'hyper integrations providers [--json]',
  'hyper integrations connections [--json]',
  'hyper integrations status <agent> [--json]',
  'hyper integrations connect <provider> [--wait] [--timeout SECONDS]',
  'hyper integrations disconnect <provider>',
  'hyper integrations enable <provider> [--agent <name|id>]',
  'hyper integrations disable <provider> [--agent <name|id>]',
  'hyper integrations unset <provider> --agent <name|id>',
  'hyper integrations token <provider> [--json]',
  'hyper integrations call <provider> <METHOD> <path> [body] [--json]',
];

const DEFAULT_WAIT_TIMEOUT_S = 600;
const WAIT_POLL_INTERVAL_MS = 2000;

/** APIError -> CliError with the server detail verbatim (incl. relay 400s). */
function toCliError(err: unknown, action: string): CliError {
  if (err instanceof APIError) return new CliError(`${action}: ${err.detail}`);
  return err instanceof CliError ? err : new CliError(`${action}: ${err instanceof Error ? err.message : String(err)}`);
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
    columns: ['NAME', 'CONNECTED', 'ENABLED', 'BACKEND'],
    rows: connections.map((entry) => [
      entry.name,
      entry.connected ? 'yes' : 'no',
      entry.connection?.hyperEnabled === null || entry.connection?.hyperEnabled === undefined
        ? ''
        : entry.connection.hyperEnabled
          ? 'yes'
          : 'no',
      entry.backendAvailable ? entry.backend : `${entry.backend} (unavailable)`,
    ]),
  });
}

async function cmdConnect(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, {
    wait: { type: 'boolean', default: false },
    timeout: { type: 'string' },
  });
  const name = provider(parsed, 'hyper integrations connect <provider> [--wait] [--timeout SECONDS]');
  let timeoutS = DEFAULT_WAIT_TIMEOUT_S;
  if (parsed.values.timeout !== undefined) {
    timeoutS = Number(parsed.values.timeout);
    if (!Number.isFinite(timeoutS) || timeoutS <= 0) {
      throw new UsageError('--timeout expects a positive number of seconds');
    }
  }
  const client = await ctx.client();
  let session;
  try {
    session = await client.integrations.startConnection(name);
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
      const completed = await client.integrations.completeConnection(name);
      payload.connected = true;
      payload.connection = completed.connection;
      ctx.output.result(payload, [...lines, `connected  ${name}`].join('\n'));
      return;
    } catch (err) {
      if (!(err instanceof APIError && err.statusCode === 409)) {
        throw toCliError(err, `failed to complete ${name} connection`);
      }
      if (Date.now() >= deadline) {
        throw new CliError(`${name} connection not completed within ${timeoutS}s — finish the OAuth flow, then run 'hyper integrations connect ${name} --wait' again`);
      }
      await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_INTERVAL_MS));
    }
  }
}

async function cmdDisconnect(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args);
  const name = provider(parsed, 'hyper integrations disconnect <provider>');
  const client = await ctx.client();
  try {
    await client.integrations.disconnect(name);
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
    const facadeEnabled = entry.connection?.hyperEnabled ?? null;
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
  const parsed = parseCommandArgs(args, { agent: { type: 'string' } });
  const word = enabled ? 'enable' : 'disable';
  const name = provider(parsed, `hyper integrations ${word} <provider> [--agent <name|id>]`);
  const agentRef = typeof parsed.values.agent === 'string' ? parsed.values.agent : undefined;
  const client = await ctx.client();
  if (agentRef) {
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
    await client.integrations.setConnectionEnabled(name, enabled);
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
  const parsed = parseCommandArgs(args);
  const name = provider(parsed, 'hyper integrations token <provider>');
  const client = await ctx.client();
  let token;
  try {
    token = await client.integrations.mintToken(name);
  } catch (err) {
    throw toCliError(err, `failed to mint ${name} token`);
  }
  // Pipe-safe: table mode prints ONLY the token on stdout; metadata to stderr.
  const meta = [`provider  ${token.provider}`];
  if (token.expiresAt) meta.push(`expires  ${token.expiresAt}`);
  ctx.output.info(meta.join('\n'));
  ctx.output.result(token, token.accessToken);
}

const PROXY_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

async function cmdCall(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args);
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
      throw new UsageError(`call body must be JSON (got '${bodyText}')`);
    }
  }
  const client = await ctx.client();
  let result: unknown;
  try {
    result = await client.integrations.proxy(name, path, { method, body });
  } catch (err) {
    throw toCliError(err, `${method} ${path} via ${name} failed`);
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
  call: cmdCall,
};

export async function run(ctx: CommandContext, args: string[]): Promise<void> {
  const scan = parseUniversal(args);
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
