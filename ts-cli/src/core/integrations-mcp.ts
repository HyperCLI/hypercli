import { deriveIntegrationsApiBase, getAgentsApiBaseUrlFromProductBase } from '@hypercli.com/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { parseCommandArgs } from './argv.js';
import { CliError, UsageError } from './errors.js';
import type { CommandContext } from './types.js';

const HELP = `hyper integrations --mcp [--json]
  List server tool names and descriptions; --json includes full input schemas.
hyper integrations --mcp <tool> --help [--json]
  Fetch a tool's description and input schema (requires authentication).
hyper integrations --mcp <tool> [--args JSON] [--json]
  Invoke a tool with a JSON object (defaults to {}). Server permissions apply.
  --json returns the complete MCP result; tool errors exit with status 1.
  Uses the same credentials and HYPER_API_BASE configuration as integrations REST.`;

export async function runIntegrationsMcp(ctx: CommandContext, args: string[]): Promise<number | void> {
  const parsed = parseCommandArgs(args, { mcp: { type: 'boolean' }, args: { type: 'string' } });
  const [name, extra] = parsed.positionals;
  if (extra !== undefined) throw new UsageError('expected at most one MCP tool name');
  if (parsed.values.args !== undefined && !name) throw new UsageError('--args requires an MCP tool name');
  if (parsed.help && !name) {
    ctx.output.result({ help: HELP }, HELP);
    return;
  }
  let toolArgs: Record<string, unknown> = {};
  if (typeof parsed.values.args === 'string') {
    try {
      const value: unknown = JSON.parse(parsed.values.args);
      if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      toolArgs = value as Record<string, unknown>;
    } catch {
      // Do not echo arguments: they may contain provider credentials.
      throw new UsageError('--args must be a valid JSON object');
    }
  }

  const resolved = await ctx.client();
  const client = new Client({ name: 'hyper-cli', version: '0.1.0' });
  let transport: StreamableHTTPClientTransport | undefined;
  let action = 'connect to integrations MCP';
  try {
    // Same base resolution as lazyClient -> HyperCLI.integrations. Reuse the
    // resolved key rather than introducing a separate credential precedence.
    const base = deriveIntegrationsApiBase(getAgentsApiBaseUrlFromProductBase(resolved.apiUrl));
    transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${resolved.apiKey}` } },
    });
    await client.connect(transport);
    action = 'list integrations MCP tools';
    const tools: Tool[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor === undefined ? undefined : { cursor });
      tools.push(...page.tools);
      cursor = page.nextCursor;
      if (cursor !== undefined) {
        if (cursors.has(cursor)) throw new CliError('integrations MCP returned a repeated pagination cursor');
        cursors.add(cursor);
      }
    } while (cursor !== undefined);

    if (!name) {
      ctx.output.result(tools, {
        columns: ['NAME', 'DESCRIPTION'],
        rows: tools.map((tool) => [tool.name, tool.description ?? '']),
      });
      return;
    }
    const tool = tools.find((entry) => entry.name === name);
    if (!tool) throw new UsageError('unknown MCP tool; run hyper integrations --mcp to list available tools');
    if (parsed.help) {
      ctx.output.result(tool, [
        `hyper integrations --mcp ${tool.name} --args JSON`,
        tool.description ?? '',
        'Arguments (inputSchema):',
        JSON.stringify(tool.inputSchema, null, 2),
      ].join('\n'));
      return;
    }
    action = 'call integrations MCP tool';
    const result = await client.callTool({ name, arguments: toolArgs }, undefined, { timeout: 90000 });
    // Preserve all content blocks and structuredContent in either output mode.
    // A server error can echo the request credential; never print that key.
    const safeResult = result.isError
      ? JSON.parse(JSON.stringify(result).split(resolved.apiKey).join('[REDACTED]'))
      : result;
    ctx.output.result(safeResult, JSON.stringify(safeResult, null, 2));
    return result.isError ? 1 : 0;
  } catch (err) {
    if (err instanceof CliError) throw err;
    // SDK/HTTP exceptions can embed response bodies, URLs or auth headers.
    throw new CliError(`failed to ${action}; check credentials, base URL and server availability`);
  } finally {
    try {
      await client.close();
    } catch {
      ctx.output.info('warning: failed to close integrations MCP client');
    } finally {
      // Also cover partial connect failures before the client owns transport.
      await transport?.close().catch(() => {
        ctx.output.info('warning: failed to close integrations MCP transport');
      });
    }
  }
}
