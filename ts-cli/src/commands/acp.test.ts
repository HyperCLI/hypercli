import { afterEach, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import type { CommandContext } from '../core/types.js';

const mock = vi.hoisted(() => ({ callTool: vi.fn(), connect: vi.fn(), close: vi.fn(async () => {}), transport: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: class {
  callTool = mock.callTool; connect = mock.connect; close = mock.close;
} }));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: class {
  constructor(...args: unknown[]) { mock.transport(...args); }
  close = mock.close;
} }));
import { run } from './acp.js';

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it('uses invocation session ENV and the identical MCP operation without reading file bytes', async () => {
  vi.stubEnv('HYPER_SESSION_ID', '58387b0b-d4aa-43b3-875c-888750d43c57');
  vi.stubEnv('HYPER_AGENTS_API_KEY', 'offline-test-key');
  vi.stubEnv('HYPER_ACP_MCP_PORT', '18521');
  vi.stubEnv('HYPER_ACP_MCP_SERVER', '');
  const receipt = { content: [{ type: 'text', text: '{"ok":true,"persisted":false}' }] };
  mock.callTool.mockResolvedValue(receipt);
  const result = vi.fn();
  const ctx = { output: { result }, client: vi.fn() } as unknown as CommandContext;
  expect(await run(ctx, ['attach', '--file', 'test.bin'])).toBe(0);
  expect(mock.callTool).toHaveBeenCalledWith({ name: 'attach_file', arguments: {
    path: resolve('test.bin'), sessionId: '58387b0b-d4aa-43b3-875c-888750d43c57',
  } }, undefined, { timeout: 90000 });
  expect(result).toHaveBeenCalledWith(receipt, JSON.stringify(receipt, null, 2));
  expect(ctx.client).not.toHaveBeenCalled();
});

it('refuses missing session context without connecting', async () => {
  vi.stubEnv('HYPER_SESSION_ID', '');
  await expect(run({} as CommandContext, ['attach', '--file', 'test.bin'])).rejects.toThrow('HYPER_SESSION_ID');
  expect(mock.connect).not.toHaveBeenCalled();
});
