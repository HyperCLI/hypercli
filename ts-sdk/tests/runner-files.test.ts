import { afterEach, describe, expect, it, vi } from 'vitest';
import { Deployments, RUNNER_FILE_MAX_BYTES } from '../src/agents.js';
import { APIError } from '../src/errors.js';
import type { HTTPClient } from '../src/http.js';
import { projectManagedContext } from '../src/managed-context.js';

const id = '11111111-2222-4333-8444-555555555555';
function setup() {
  const files = new Map<string, string>();
  const post = vi.fn(async (url: string, body?: any) => {
    if (url.endsWith('/files/token')) return { transport: 'runner', executor: 'process', max_bytes: RUNNER_FILE_MAX_BYTES, chunk_bytes: 262144 };
    if (url.endsWith('/files/list')) {
      const prefix = body.path ? `${body.path}/` : '';
      if (body.path && ![...files.keys()].some((key) => key.startsWith(prefix))) throw new APIError(404, 'Runner file not_found');
      const dirs = [...new Set([...files.keys()].filter((key) => key.startsWith(prefix) && key.slice(prefix.length).includes('/'))
        .map((key) => key.slice(prefix.length).split('/')[0]))].sort();
      const names = [...files.keys()].filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
        .map((key) => key.slice(prefix.length)).sort();
      return {
        type: 'directory', prefix, requested_path: body.path, truncated: false,
        directories: dirs.map((d) => ({ name: d, path: `${prefix}${d}/`, type: 'directory' })),
        files: names.map((n) => ({ name: n, path: `${prefix}${n}`, type: 'file', size: n.length })),
      };
    }
    if (url.endsWith('/files/delete')) {
      if (!files.delete(body.path)) throw new APIError(404, 'Runner file not_found');
      return { status: 'deleted', path: body.path };
    }
    throw new Error(`Unexpected request ${url}`);
  });
  const get = vi.fn().mockResolvedValue({ id, user_id: 'owner', state: 'STOPPED', runner: { runner_id: 'runner-id', tags: [] } });
  const getStream = vi.fn(async (url: string, consume: (response: Response) => unknown) => {
    const query = new URL(url, 'https://fixture.test').searchParams;
    const path = query.get('path')!;
    if (!files.has(path)) throw new APIError(404, 'Runner file not_found');
    const bytes = Buffer.from(files.get(path)!, 'base64');
    return consume(new Response(bytes, { headers: { 'content-length': String(bytes.length) } }));
  });
  const transfers = new Map<string, { path: string; bytes: Buffer }>();
  const postRaw = vi.fn(async (url: string, body: Uint8Array) => {
    const q = new URL(url, 'https://fixture.test').searchParams;
    const transfer = q.get('transfer_id')!;
    const action = q.get('action');
    const offset = Number(q.get('offset'));
    if (action === 'open_write') transfers.set(transfer, { path: q.get('path')!, bytes: Buffer.alloc(Number(q.get('total'))) });
    if (action === 'write') transfers.get(transfer)!.bytes.set(body, offset);
    if (action === 'commit') {
      const value = transfers.get(transfer)!;
      files.set(value.path, value.bytes.toString('base64'));
    }
    return { ok: true, transfer_id: transfer, total: Number(q.get('total')), offset: offset + body.length };
  });
  const deployments = new Deployments({ post, get, getStream, postRaw } as unknown as HTTPClient, 'fixture-key', 'https://api.example.test/agents');
  return { files, post, get, getStream, postRaw, deployments };
}

afterEach(() => vi.unstubAllGlobals());

describe('native assignment file transport', () => {
  it.each([undefined, null, 0, -1, '262144'])('rejects missing or invalid chunk metadata %s without fallback', async chunk_bytes => {
    const { deployments, post, getStream, postRaw } = setup();
    post.mockResolvedValueOnce({ transport: 'runner', executor: 'process', max_bytes: RUNNER_FILE_MAX_BYTES, chunk_bytes } as any);
    await expect(deployments.fileRead(id, 'x')).rejects.toThrow();
    expect(post).toHaveBeenCalledTimes(1);
    expect(getStream).not.toHaveBeenCalled();
    expect(postRaw).not.toHaveBeenCalled();
  });
  it('honors a smaller advertised ceiling for reads and writes', async () => {
    const { deployments, post, files, getStream } = setup();
    files.set('x', btoa('ok'));
    post.mockResolvedValueOnce({ transport: 'runner', executor: 'process', max_bytes: 2, chunk_bytes: 2 } as any);
    await expect(deployments.fileRead(id, 'x')).resolves.toBe('ok');
    expect(getStream).toHaveBeenLastCalledWith(`/deployments/${id}/files/stream?path=x&max_bytes=2`, expect.any(Function), { signal: undefined });
    post.mockResolvedValueOnce({ transport: 'runner', executor: 'process', max_bytes: 2, chunk_bytes: 2 } as any);
    await expect(deployments.fileWrite(id, 'x', 'big')).rejects.toThrow('limited to 2 bytes');
    expect(files.get('x')).toBe(btoa('ok'));
  });

  it.each([0, -1, 1.5, NaN, '2'])('rejects invalid advertised ceiling %s', async max_bytes => {
    const { deployments, post } = setup();
    post.mockResolvedValueOnce({ transport: 'runner', executor: 'process', max_bytes, chunk_bytes: 262144 } as any);
    await expect(deployments.fileRead(id, 'x')).rejects.toThrow('invalid runner file transport');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('clamps a ceiling larger than this client supports instead of refusing it', async () => {
    const { deployments, post, files } = setup();
    post.mockResolvedValueOnce({ transport: 'runner', executor: 'process',
      max_bytes: RUNNER_FILE_MAX_BYTES * 4, chunk_bytes: 262144 } as any);
    files.set('x', btoa('ok'));
    await expect(deployments.fileRead(id, 'x')).resolves.toBe('ok');
  });

  it.each(['kubernetes', undefined])('rejects unsupported or unreported assignment mode %s', async (executor) => {
    const { deployments, post } = setup();
    post.mockResolvedValueOnce({ transport: 'runner', executor, max_bytes: RUNNER_FILE_MAX_BYTES, chunk_bytes: 262144 } as any);
    await expect(deployments.fileWrite(id, 'AGENTS.md', 'User-provided instructions')).rejects.toThrow('invalid runner file transport');
    expect(post).toHaveBeenCalledTimes(1);
  });
  it.each(['process', 'docker'])('accepts the %s executor token and round-trips natively', async (executor) => {
    const { deployments, post, files } = setup();
    post.mockImplementationOnce(async () => ({ transport: 'runner', executor, max_bytes: RUNNER_FILE_MAX_BYTES, chunk_bytes: 262144 } as any));
    await expect(deployments.fileWrite(id, 'AGENTS.md', 'docker workspace')).resolves.toEqual({ ok: true });
    await expect(deployments.fileRead(id, 'AGENTS.md')).resolves.toBe('docker workspace');
    expect(files.has('AGENTS.md')).toBe(true);
  });

  it('routes Agent.files and deployment text/byte helpers through authenticated backend paths', async () => {
    const { deployments, getStream } = setup();
    const fetch = vi.fn(() => { throw new Error('No Reef request expected'); });
    vi.stubGlobal('fetch', fetch);
    const agent = await deployments.get(id);
    await expect(agent.files.write('.hypercli/USER.md', 'Hello 🌍')).resolves.toEqual({ ok: true });
    await expect(agent.files.read('.hypercli/USER.md')).resolves.toBe('Hello 🌍');
    await deployments.fileWriteBytes(id, 'binary', new Uint8Array([0, 255, 128]));
    await expect(deployments.fileReadBytes(id, 'binary')).resolves.toEqual(new Uint8Array([0, 255, 128]));
    expect(getStream).toHaveBeenCalledWith(`/deployments/${id}/files/stream?path=binary&max_bytes=${RUNNER_FILE_MAX_BYTES}`, expect.any(Function), { signal: undefined });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps hosted Reef access on its existing token/url path', async () => {
    const { deployments, post } = setup();
    post.mockResolvedValueOnce({ url: 'https://host.example.test/_reef', token: 'reef-fixture', expires_at: '2026-09-23T13:00:00Z' } as any);
    const fetch = vi.fn().mockResolvedValue(new Response('Hosted'));
    vi.stubGlobal('fetch', fetch);
    await expect(deployments.fileRead(id, 'USER.md')).resolves.toBe('Hosted');
    expect(fetch).toHaveBeenCalledWith('https://host.example.test/_reef/files/USER.md', expect.objectContaining({ redirect: 'error' }));
    expect(post).toHaveBeenCalledTimes(1);
  });

  it.each(['../file', 'a\0b', 'a.', 'a:stream'])('rejects native path %j without a file command', async (path) => {
    const { deployments, post, getStream, postRaw } = setup();
    await expect(deployments.fileWrite(id, path, 'x')).rejects.toThrow();
    await expect(deployments.fileRead(id, path)).rejects.toThrow();
    expect(post.mock.calls.every(([url]) => url.endsWith('/token'))).toBe(true);
    expect(getStream).not.toHaveBeenCalled();
    expect(postRaw).not.toHaveBeenCalled();
  });

  it.each(['/home/ubuntu/hcr_style/png/logo_vertical.png', '/root/link/../image #?%.png', 'C:\\images\\a.png'])('preserves absolute READ address %s in the existing wire shape', async path => {
    const { deployments, post, files, getStream } = setup();
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP4z8DwHwyBNBgAAEnICff5q7YNAAAAAElFTkSuQmCC';
    files.set(path, png);
    expect(Buffer.from(await deployments.fileReadBytes(id, path, { maxBytes: 25_000_000 })).toString('base64')).toBe(png);
    expect(getStream).toHaveBeenCalledWith(`/deployments/${id}/files/stream?${new URLSearchParams({ path, max_bytes: '25000000' })}`, expect.any(Function), { signal: undefined });
    const reads = post.mock.calls.length;
    await expect(deployments.fileWrite(id, path, 'x')).rejects.toThrow();
    await expect(deployments.fileDelete(id, path)).rejects.toThrow();
    await expect(deployments.filesList(id, path)).rejects.toThrow();
    expect(post).toHaveBeenCalledTimes(reads);
  });

  it('does not reinterpret hosted absolute paths as sync-root-relative paths', async () => {
    const { deployments, post } = setup();
    post.mockResolvedValueOnce({ url: 'https://host.example.test/_reef', token: 'fixture', expires_at: '2099-01-01' } as any);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(deployments.fileRead(id, '/outside/image.png')).rejects.toThrow('relative to the sync root');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('caps writes and read results, forwards abort signals, and round-trips listing and deletion', async () => {
    const { deployments, getStream, files } = setup();
    await expect(deployments.fileWriteBytes(id, 'x', new Uint8Array(RUNNER_FILE_MAX_BYTES + 1))).rejects.toThrow('limited');
    files.set('x', btoa('1234'));
    const signal = new AbortController().signal;
    await expect(deployments.fileRead(id, 'x', { maxBytes: 1, signal })).rejects.toThrow('read limit');
    expect(getStream).toHaveBeenCalledWith(`/deployments/${id}/files/stream?path=x&max_bytes=1`, expect.any(Function), { signal });
    files.set('.hypercli/USER.md', btoa('profile'));
    const root = await deployments.filesList(id);
    expect(root).toEqual([{ name: '.hypercli', path: '.hypercli/', type: 'directory' }, { name: 'x', path: 'x', type: 'file', size: 1 }]);
    expect((await deployments.filesList(id, '.hypercli')).map((entry) => entry.name)).toEqual(['USER.md']);
    await expect(deployments.fileDelete(id, 'x')).resolves.toEqual({ status: 'deleted', path: 'x' });
    expect(files.has('x')).toBe(false);
    await expect(deployments.fileDelete(id, 'x')).rejects.toMatchObject({ statusCode: 404 });
    await expect(deployments.fileDelete(id, '.hypercli', { recursive: true })).rejects.toThrow('never recursive');
  });

  it('projects native context without directory listing, refreshes managed markers and preserves edits', async () => {
    const { deployments, files } = setup();
    const list = vi.spyOn(deployments, 'filesList');
    const agent = await deployments.get(id);
    const context = { profile: 'Me', description: 'Instructions' };
    const run = () => projectManagedContext(deployments, agent, 'owner', context);
    expect((await run()).map((r) => r.status)).toEqual(['written', 'written']);
    expect((await run()).map((r) => r.status)).toEqual(['unchanged', 'unchanged']);
    context.profile = 'New me';
    files.set('.hypercli/SOUL.md', btoa('User edits'));
    expect((await run()).map((r) => r.status)).toEqual(['written', 'preserved']);
    expect(atob(files.get('.hypercli/SOUL.md')!)).toBe('User edits');
    // Readiness probes the native root listing; projection reads each file directly.
    expect(list).toHaveBeenCalled();
  });

  it.each([503, 501, 409])('reports offline/unsupported/unavailable (%i) without writing', async (statusCode) => {
    const { deployments, post, files } = setup();
    post.mockRejectedValue(new APIError(statusCode, 'Runner unavailable'));
    const wait = deployments.waitForFileApiReady.bind(deployments);
    vi.spyOn(deployments, 'waitForFileApiReady').mockImplementation((target) => wait(target, { timeoutMs: 0 }));
    const agent = await deployments.get(id);
    const result = await projectManagedContext(deployments, agent, 'owner', { profile: 'Me' });
    expect(result[0]).toMatchObject({ status: 'skipped' });
    expect(result[0].detail).toContain(String(statusCode));
    expect(files.size).toBe(0);
  });
});
