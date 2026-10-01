import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HyperCLI } from '@hypercli.com/sdk';
import { run } from '../src/commands/integrations.js';
import { createOutput } from '../src/core/output.js';
import type { CommandContext } from '../src/core/types.js';

const { readFile } = vi.hoisted(() => ({ readFile: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile }));
let chunks: string[];
let fetchMock: ReturnType<typeof vi.fn>;
function ctx(): CommandContext {
  return { client: async () => new HyperCLI({ apiKey: 'synthetic-hyper-key', agentsApiBaseUrl: 'http://facade.test/agents' }),
    output: createOutput('json'), format: 'json', dev: false };
}
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
  chunks = [];
  vi.stubEnv('HYPER_INTEGRATIONS_API_BASE', '');
  vi.spyOn(process.stdout, 'write').mockImplementation((data) => { chunks.push(String(data)); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  fetchMock = vi.fn(() => { throw new Error('Unexpected offline fetch'); });
  vi.stubGlobal('fetch', fetchMock);
  readFile.mockReset();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('generic integration commands', () => {
  it('credentials fetches the selected connection with no provider-specific code', async () => {
    fetchMock.mockResolvedValue(response({ provider: 'fourth', connection_id: 'c1', credentials: { type: 'BASIC', username: 'synthetic-user', password: 'synthetic-password' }, stack: 'dev' }));
    await run(ctx(), ['credentials', 'fourth', '--connection', 'c1']);
    expect(fetchMock.mock.calls[0][0]).toBe('http://facade.test/integrations/credentials/fourth?connection_id=c1');
    expect(JSON.parse(chunks.join('')).credentials.type).toBe('BASIC');
  });
  it('field selection prints only the requested scalar and never other credentials', async () => {
    fetchMock.mockResolvedValue(response({ provider: 'openai', connection_id: 'c1', credentials: { type: 'API_KEY', apiKey: 'synthetic-key' }, stack: 'dev' }));
    const context = ctx();
    context.output = createOutput('table');
    await run(context, ['credentials', 'openai', '--field', 'apiKey']);
    expect(chunks.join('')).toBe('synthetic-key\n');
  });
  it('import reads native credentials from a file and prints only the summary', async () => {
    readFile.mockResolvedValue(JSON.stringify({ credentials: { type: 'API_KEY', apiKey: 'synthetic-key' }, connection_config: {} }));
    fetchMock.mockImplementation(async (url, init) => {
      expect(String(url)).toBe('http://facade.test/integrations/connections/openai/import');
      const body = JSON.parse(init.body);
      const valid = body.credentials.type === 'API_KEY' && typeof body.credentials.apiKey === 'string'
        && Object.keys(body.credentials).sort().join(',') === 'apiKey,type';
      return valid ? response({ connection: { connection_id: 'c1', enabled: true } }) : response({ detail: 'Invalid native credentials' }, 400);
    });
    await run(ctx(), ['import', 'openai', '--file', '/synthetic.json']);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ credentials: { type: 'API_KEY', apiKey: 'synthetic-key' }, connection_config: {} });
    expect(chunks.join('')).not.toContain('synthetic-key');
    expect(JSON.parse(chunks.join('')).id).toBe('c1');
    readFile.mockResolvedValue(JSON.stringify({ credentials: { type: 'API_KEY', api_key: 'synthetic-key' } }));
    await expect(run(ctx(), ['import', 'openai', '--file', '/synthetic.json'])).rejects.toThrow('HTTP 400');
  });
  it('never echoes invalid credential file contents or validation inputs', async () => {
    readFile.mockResolvedValue('synthetic-private-input');
    await expect(run(ctx(), ['import', 'fourth', '--file', '/synthetic.json'])).rejects.toThrow('Could not read native Nango credentials JSON');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(chunks.join('')).toBe('');
  });
  it('does not echo provider error bodies containing submitted credentials', async () => {
    fetchMock.mockResolvedValue(response({ detail: 'synthetic-private-input' }, 400));
    const error = await run(ctx(), ['call', 'fourth', 'POST', 'v1/search', '{}']).catch((err: unknown) => err);
    expect(String(error)).toContain('HTTP 400');
    expect(String(error)).not.toContain('synthetic-private-input');
    expect(chunks.join('')).toBe('');
  });
  it('passes generic proxy headers and independent connection selection', async () => {
    fetchMock.mockResolvedValue(response({ ok: true }));
    await run(ctx(), ['call', 'fourth', 'POST', 'v1/search', '{}', '--connection', 'c1', '--headers', '{"Notion-Version":"2022-06-28"}']);
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      'X-HyperCLI-Connection-Id': 'c1', 'Nango-Proxy-Notion-Version': '2022-06-28', Authorization: 'Bearer synthetic-hyper-key',
    });
  });
  it('does not pretend --wait proves reconnect completion', async () => {
    await expect(run(ctx(), ['connect', 'fourth', '--connection', 'c1', '--wait'])).rejects.toThrow('cannot prove');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('waits for a new connection rather than returning an existing account', async () => {
    const rows = (ids: string[]) => ({ connections: { fourth: { backend_available: true, connected: true,
      connections: ids.map((connection_id) => ({ connection_id, enabled: true })) } } });
    fetchMock.mockResolvedValueOnce(response(rows(['old'])))
      .mockResolvedValueOnce(response({ provider: 'fourth', authorize_url: 'https://consent.invalid', stack: 'dev' }))
      .mockResolvedValueOnce(response(rows(['old', 'new'])))
      .mockResolvedValueOnce(response({ provider: 'fourth', connected: true, connection: { connection_id: 'new', enabled: true }, stack: 'dev' }));
    await run(ctx(), ['connect', 'fourth', '--new', '--wait']);
    expect(fetchMock.mock.calls[1][0]).toContain('/start?new_connection=true');
    expect(fetchMock.mock.calls[3][0]).toContain('/complete?connection_id=new');
    expect(JSON.parse(chunks.join('')).connection.id).toBe('new');
  });
});
