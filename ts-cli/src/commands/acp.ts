import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { parseCommandArgs } from '../core/argv.js';
import { CliError, UsageError } from '../core/errors.js';
import type { CommandContext } from '../core/types.js';
import { APP_VERSION } from '../version.js';

export const name = 'acp';
export const summary = 'Publish files through the local Hyper-ACP host';
export const usage = ['hyper acp attach --file PATH [--session-id UUID]'];

export async function run(ctx: CommandContext, args: string[]): Promise<number | void> {
  const parsed = parseCommandArgs(args, { file: { type: 'string' }, 'session-id': { type: 'string' } });
  if (parsed.help) { ctx.output.result(usage, usage.join('\n')); return; }
  if (parsed.positionals.length !== 1 || parsed.positionals[0] !== 'attach') throw new UsageError(usage[0]!);
  const file = parsed.values.file;
  const sessionId = parsed.values['session-id'] ?? process.env.HYPER_SESSION_ID;
  if (typeof file !== 'string' || !file) throw new UsageError('--file is required');
  if (typeof sessionId !== 'string' || !sessionId) throw new UsageError('HYPER_SESSION_ID or --session-id is required');
  const bearer = process.env.HYPER_AGENTS_API_KEY;
  if (!bearer) throw new CliError('HYPER_AGENTS_API_KEY is required for the local host');
  const port = process.env.HYPER_ACP_MCP_PORT ?? '18521';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new UsageError('Invalid HYPER_ACP_MCP_PORT');
  const endpoint = `http://127.0.0.1:${Number(port)}/mcp`;
  if (process.env.HYPER_ACP_MCP_SERVER && process.env.HYPER_ACP_MCP_SERVER !== endpoint) throw new UsageError('HYPER_ACP_MCP_SERVER must match the loopback listener');
  const client = new Client({ name: 'hyper-cli', version: APP_VERSION });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: 'attach_file', arguments: { path: resolve(file), sessionId } }, undefined, { timeout: 90000 });
    ctx.output.result(result, JSON.stringify(result, null, 2));
    return result.isError ? 1 : 0;
  } catch {
    throw new CliError('Local attachment request failed; delivery may be uncertain. Do not automatically retry.');
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}
