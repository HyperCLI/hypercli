import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '../src/commands/integrations.js';
import { lazyClient } from '../src/core/client.js';
import { applyCliConfigFile } from '../src/core/config-file.js';
import { exitCodeFor } from '../src/core/errors.js';
import { createOutput } from '../src/core/output.js';
import type { CommandContext } from '../src/core/types.js';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(), listTools: vi.fn(), callTool: vi.fn(), close: vi.fn(), transportClose: vi.fn(),
  Client: vi.fn(), Transport: vi.fn(),
}));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: mocks.Client }));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: mocks.Transport }));

const tool = {
  name: 'github_request', description: 'Call GitHub',
  inputSchema: { type: 'object', properties: { method: { type: 'string' }, path: { type: 'string' } }, required: ['method', 'path'] },
  annotations: { readOnlyHint: false },
};
const statusTool = { name: 'integrations_status', description: 'Connection status', inputSchema: { type: 'object' } };
let home: string;
let chunks: string[];
let errors: string[];
function ctx(format: 'table' | 'json' = 'table', dev = false): CommandContext {
  return { client: lazyClient(dev), output: createOutput(format), format, dev };
}
const stdout = () => chunks.join('');

beforeEach(() => {
  vi.resetAllMocks();
  home = mkdtempSync(join(tmpdir(), 'hyper-mcp-test-'));
  for (const key of ['HYPER_API_KEY', 'HYPER_AGENTS_API_KEY', 'HYPER_API_BASE', 'HYPERCLI_API_URL', 'AGENTS_API_BASE_URL', 'HYPER_INTEGRATIONS_API_BASE']) {
    vi.stubEnv(key, '');
  }
  vi.stubEnv('HYPER_HOME', home);
  vi.stubEnv('HYPER_API_KEY', 'test-product-key');
  chunks = [];
  errors = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { chunks.push(String(chunk)); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => { errors.push(String(chunk)); return true; });
  // No test may accidentally contact a real endpoint.
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('unexpected live fetch'); }));
  mocks.Client.mockImplementation(() => ({ connect: mocks.connect, listTools: mocks.listTools, callTool: mocks.callTool, close: mocks.close }));
  mocks.Transport.mockImplementation(() => ({ close: mocks.transportClose }));
  mocks.connect.mockResolvedValue(undefined);
  mocks.close.mockResolvedValue(undefined);
  mocks.transportClose.mockResolvedValue(undefined);
  mocks.listTools.mockResolvedValue({ tools: [tool, statusTool] });
  mocks.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], structuredContent: { ok: true } });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(home, { recursive: true, force: true });
});

describe('integrations MCP discovery and help', () => {
  it('lists names/descriptions after connect and closes both resources', async () => {
    await run(ctx(), ['--mcp']);
    expect(stdout()).toContain('NAME');
    expect(stdout()).toContain('github_request');
    expect(stdout()).toContain('Call GitHub');
    expect(stdout()).not.toContain('inputSchema');
    expect(mocks.connect).toHaveBeenCalledWith(mocks.Transport.mock.results[0].value);
    expect(mocks.connect.mock.invocationCallOrder[0]).toBeLessThan(mocks.listTools.mock.invocationCallOrder[0]);
    expect(mocks.callTool).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.transportClose).toHaveBeenCalledOnce();
  });
  it('returns full definitions across paginated lists as one JSON value', async () => {
    mocks.listTools.mockResolvedValueOnce({ tools: [tool], nextCursor: 'page2' }).mockResolvedValueOnce({ tools: [statusTool] });
    await run(ctx('json'), ['--mcp', '--json']);
    expect(JSON.parse(stdout())).toEqual([tool, statusTool]);
    expect(mocks.listTools.mock.calls).toEqual([[undefined], [{ cursor: 'page2' }]]);
  });
  it.each(['--help', '-h'])('fetches dynamic schema for tool %s rather than static group help', async (help) => {
    await run(ctx(), ['--mcp', 'github_request', help]);
    expect(stdout()).toContain('Call GitHub');
    expect(stdout()).toContain('Arguments (inputSchema)');
    expect(stdout()).toContain('"required"');
    expect(mocks.callTool).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it('returns the full definition for JSON tool help', async () => {
    await run(ctx('json'), ['--mcp', 'github_request', '--help', '--json']);
    expect(JSON.parse(stdout())).toEqual(tool);
  });
  it('keeps bare MCP help offline and documents arguments', async () => {
    const context = ctx();
    context.client = vi.fn();
    await run(context, ['--mcp', '--help']);
    expect(stdout()).toContain('--args JSON');
    expect(context.client).not.toHaveBeenCalled();
    expect(mocks.Client).not.toHaveBeenCalled();
  });
});

describe('integrations MCP invocation and failures', () => {
  it('passes JSON arguments and preserves all result fields', async () => {
    const result = await run(ctx('json'), ['--mcp', 'github_request', '--args', '{"method":"GET","path":"/user/repos"}']);
    expect(result).toBe(0);
    expect(mocks.callTool).toHaveBeenCalledWith({ name: tool.name, arguments: { method: 'GET', path: '/user/repos' } }, undefined, { timeout: 90000 });
    expect(JSON.parse(stdout())).toEqual({ content: [{ type: 'text', text: 'ok' }], structuredContent: { ok: true } });
  });
  it('defaults arguments to an empty object', async () => {
    await run(ctx(), ['--mcp', 'integrations_status']);
    expect(mocks.callTool).toHaveBeenCalledWith({ name: 'integrations_status', arguments: {} }, undefined, { timeout: 90000 });
  });
  it.each(['bad-secret-json', 'null', '[]', '42', '"string"'])('rejects invalid object arguments %s before connecting', async (args) => {
    await expect(run(ctx(), ['--mcp', 'github_request', '--args', args])).rejects.toMatchObject({ message: '--args must be a valid JSON object', exitCode: 2 });
    expect(mocks.Client).not.toHaveBeenCalled();
  });
  it.each([['--mcp', '--args', '{}'], ['--mcp', 'one', 'two'], ['--mcp', '--bogus']])('rejects invalid usage %j', async (...args) => {
    await expect(run(ctx(), args)).rejects.toMatchObject({ exitCode: 2 });
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it('reports unknown tools with a discovery hint and closes', async () => {
    await expect(run(ctx(), ['--mcp', 'unknown'])).rejects.toMatchObject({ exitCode: 2, message: expect.stringContaining('hyper integrations --mcp') });
    expect(mocks.callTool).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it('preserves isError result with a nonzero exit and redacts echoed auth', async () => {
    mocks.callTool.mockResolvedValue({ isError: true, content: [{ type: 'text', text: 'denied test-product-key' }] });
    expect(await run(ctx('json'), ['--mcp', 'github_request'])).toBe(1);
    expect(JSON.parse(stdout())).toEqual({ isError: true, content: [{ type: 'text', text: 'denied [REDACTED]' }] });
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it.each(['connect', 'listTools', 'callTool'] as const)('sanitizes %s errors and cleans up', async (method) => {
    mocks[method].mockRejectedValue(new Error('Authorization: Bearer test-product-key; upstream-secret'));
    const error = await run(ctx(), ['--mcp', 'github_request']).catch((err: unknown) => err);
    expect(exitCodeFor(error)).toBe(1);
    expect(String(error)).toContain('failed to');
    expect(String(error)).not.toContain('test-product-key');
    expect(String(error)).not.toContain('upstream-secret');
    expect(stdout()).toBe('');
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.transportClose).toHaveBeenCalledOnce();
  });
  it('does not mask the primary failure when cleanup also fails', async () => {
    mocks.listTools.mockRejectedValue(new Error('list failed'));
    mocks.close.mockRejectedValue(new Error('secret-client'));
    mocks.transportClose.mockRejectedValue(new Error('secret-transport'));
    await expect(run(ctx(), ['--mcp'])).rejects.toThrow('failed to list');
    expect(errors.join('')).toContain('warning: failed to close');
    expect(errors.join('')).not.toContain('secret');
    expect(mocks.transportClose).toHaveBeenCalledOnce();
  });
  it('stops repeated pagination cursors', async () => {
    mocks.listTools.mockResolvedValue({ tools: [], nextCursor: 'repeat' });
    await expect(run(ctx(), ['--mcp'])).rejects.toThrow('repeated pagination cursor');
    expect(mocks.listTools).toHaveBeenCalledTimes(2);
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});

describe('integrations MCP uses REST credential and URL selection', () => {
  it.each([
    [false, {}, 'https://api.hypercli.com/integrations/mcp'],
    [true, {}, 'https://api.dev.hypercli.com/integrations/mcp'],
    [false, { HYPER_API_BASE: 'https://product.example/prefix' }, 'https://product.example/prefix/integrations/mcp'],
    [false, { HYPERCLI_API_URL: 'https://legacy.example' }, 'https://legacy.example/integrations/mcp'],
    [true, { HYPER_API_BASE: 'https://product.example' }, 'https://api.dev.hypercli.com/integrations/mcp'],
    [true, { AGENTS_API_BASE_URL: 'http://localhost:9000/prefix/agents/' }, 'http://localhost:9000/prefix/integrations/mcp'],
    [true, { HYPER_INTEGRATIONS_API_BASE: 'https://facade.example/custom/integrations/', AGENTS_API_BASE_URL: 'https://agents.example' }, 'https://facade.example/custom/integrations/mcp'],
  ] as const)('dev=%s config=%j selects %s', async (dev, env, expected) => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    await run(ctx('json', dev), ['--mcp']);
    const [url, options] = mocks.Transport.mock.calls[0];
    expect(url.href).toBe(expected);
    expect(options.requestInit.headers).toEqual({ Authorization: 'Bearer test-product-key' });
  });
  it('prefers product credentials to agent credentials', async () => {
    vi.stubEnv('HYPER_AGENTS_API_KEY', 'test-agent-key');
    await run(ctx(), ['--mcp']);
    expect(mocks.Transport.mock.calls[0][1].requestInit.headers.Authorization).toBe('Bearer test-product-key');
  });
  it('uses the agent credential fallback', async () => {
    vi.stubEnv('HYPER_API_KEY', '');
    vi.stubEnv('HYPER_AGENTS_API_KEY', 'test-agent-key');
    await run(ctx(), ['--mcp']);
    expect(mocks.Transport.mock.calls[0][1].requestInit.headers.Authorization).toBe('Bearer test-agent-key');
  });
  it('uses CLI config file key/base ahead of the agent fallback', async () => {
    vi.stubEnv('HYPER_API_KEY', '');
    vi.stubEnv('HYPER_AGENTS_API_KEY', 'test-agent-key');
    writeFileSync(join(home, 'config'), 'HYPER_API_KEY="test-file-key"\nHYPER_API_BASE=https://file.example/prefix\n');
    applyCliConfigFile();
    await run(ctx(), ['--mcp']);
    expect(mocks.Transport.mock.calls[0][0].href).toBe('https://file.example/prefix/integrations/mcp');
    expect(mocks.Transport.mock.calls[0][1].requestInit.headers.Authorization).toBe('Bearer test-file-key');
  });
  it('keeps environment key/base ahead of file config', async () => {
    vi.stubEnv('HYPER_API_BASE', 'https://env.example');
    writeFileSync(join(home, 'config'), 'HYPER_API_KEY=test-file-key\nHYPER_API_BASE=https://file.example\n');
    applyCliConfigFile();
    await run(ctx(), ['--mcp']);
    expect(mocks.Transport.mock.calls[0][0].href).toBe('https://env.example/integrations/mcp');
    expect(mocks.Transport.mock.calls[0][1].requestInit.headers.Authorization).toBe('Bearer test-product-key');
  });
  it('fails without credentials before connecting', async () => {
    vi.stubEnv('HYPER_API_KEY', '');
    await expect(run(ctx(), ['--mcp'])).rejects.toThrow('API key required');
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});

it('performs the official SDK handshake, pagination and invocation over mocked HTTP', async () => {
  const { Client } = await vi.importActual<typeof import('@modelcontextprotocol/sdk/client/index.js')>('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await vi.importActual<typeof import('@modelcontextprotocol/sdk/client/streamableHttp.js')>('@modelcontextprotocol/sdk/client/streamableHttp.js');
  mocks.Client.mockImplementation((...args: ConstructorParameters<typeof Client>) => new Client(...args));
  mocks.Transport.mockImplementation((...args: ConstructorParameters<typeof StreamableHTTPClientTransport>) => new StreamableHTTPClientTransport(...args));
  const requests: { method: string; params?: Record<string, unknown> }[] = [];
  const fetchMock = vi.fn(async (url: URL, init: RequestInit) => {
    expect(String(url)).toBe('https://api.hypercli.com/integrations/mcp');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-product-key');
    if (init.method === 'GET') return new Response(null, { status: 405 });
    const request = JSON.parse(String(init.body));
    requests.push(request);
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    let result;
    if (request.method === 'initialize') {
      result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'mock-facade', version: '1' } };
    } else if (request.method === 'tools/list') {
      result = request.params?.cursor ? { tools: [statusTool] } : { tools: [tool], nextCursor: 'next' };
    } else if (request.method === 'tools/call') {
      result = { content: [{ type: 'text', text: 'done' }] };
    } else {
      throw new Error(`unexpected MCP method ${request.method}`);
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  expect(await run(ctx('json'), ['--mcp', 'integrations_status'])).toBe(0);
  expect(requests.map((r) => r.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'tools/list', 'tools/call']);
  expect(requests[3].params).toEqual({ cursor: 'next' });
  expect(requests[4].params).toEqual({ name: 'integrations_status', arguments: {} });
  expect(JSON.parse(stdout())).toEqual({ content: [{ type: 'text', text: 'done' }] });
});
