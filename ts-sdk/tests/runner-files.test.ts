import { afterEach, describe, expect, it, vi } from 'vitest';
import { Deployments, RUNNER_FILE_MAX_BYTES } from '../src/agents.js';
import { APIError } from '../src/errors.js';
import type { HTTPClient } from '../src/http.js';
import { projectManagedContext } from '../src/managed-context.js';

const id = '11111111-2222-4333-8444-555555555555';
function setup() {
  const files = new Map<string, string>();
  const post = vi.fn(async (url: string, body?: any) => {
    if (url.endsWith('/files/token')) return { transport: 'runner', executor: 'process', max_bytes: RUNNER_FILE_MAX_BYTES };
    if (url.endsWith('/files/read')) {
      if (!files.has(body.path)) throw new APIError(404, 'Runner file not_found');
      return { content_base64: files.get(body.path) };
    }
    if (url.endsWith('/files/write')) {
      files.set(body.path, body.content_base64);
      return { ok: true };
    }
    throw new Error(`Unexpected request ${url}`);
  });
  const get = vi.fn().mockResolvedValue({ id, user_id: 'owner', state: 'STOPPED', runner: { runner_id: 'runner-id', tags: [] } });
  const deployments = new Deployments({ post, get } as unknown as HTTPClient, 'fixture-key', 'https://api.example.test/agents');
  return { files, post, get, deployments };
}

afterEach(() => vi.unstubAllGlobals());

describe('native assignment file transport', () => {
  it.each(['kubernetes', undefined])('rejects unsupported or unreported assignment mode %s', async (executor) => {
    const { deployments, post } = setup();
    post.mockResolvedValueOnce({ transport: 'runner', executor, max_bytes: RUNNER_FILE_MAX_BYTES } as any);
    await expect(deployments.fileWrite(id, 'AGENTS.md', 'User-provided instructions')).rejects.toThrow('invalid runner file transport');
    expect(post).toHaveBeenCalledTimes(1);
  });
  it.each(['process', 'docker'])('accepts the %s executor token and round-trips natively', async (executor) => {
    const { deployments, post, files } = setup();
    post.mockImplementationOnce(async () => ({ transport: 'runner', executor, max_bytes: RUNNER_FILE_MAX_BYTES } as any));
    await expect(deployments.fileWrite(id, 'AGENTS.md', 'docker workspace')).resolves.toEqual({ ok: true });
    await expect(deployments.fileRead(id, 'AGENTS.md')).resolves.toBe('docker workspace');
    expect(files.has('AGENTS.md')).toBe(true);
  });

  it('routes Agent.files and deployment text/byte helpers through authenticated backend paths', async () => {
    const { deployments, post } = setup();
    const fetch = vi.fn(() => { throw new Error('No Reef request expected'); });
    vi.stubGlobal('fetch', fetch);
    const agent = await deployments.get(id);
    await expect(agent.files.write('.hypercli/USER.md', 'Hello 🌍')).resolves.toEqual({ ok: true });
    await expect(agent.files.read('.hypercli/USER.md')).resolves.toBe('Hello 🌍');
    await deployments.fileWriteBytes(id, 'binary', new Uint8Array([0, 255, 128]));
    await expect(deployments.fileReadBytes(id, 'binary')).resolves.toEqual(new Uint8Array([0, 255, 128]));
    expect(post).toHaveBeenCalledWith(`/deployments/${id}/files/read`, { path: 'binary', max_bytes: RUNNER_FILE_MAX_BYTES }, { signal: undefined, redirect: 'error' });
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

  it.each(['/tmp/file', '../file', 'C:/file', 'a\0b', 'a.', 'a:stream'])('rejects native path %j without a file command', async (path) => {
    const { deployments, post } = setup();
    await expect(deployments.fileWrite(id, path, 'x')).rejects.toThrow();
    await expect(deployments.fileRead(id, path)).rejects.toThrow();
    expect(post.mock.calls.every(([url]) => url.endsWith('/token'))).toBe(true);
  });

  it('caps writes and read results, forwards abort signals, and refuses unsupported operations', async () => {
    const { deployments, post, files } = setup();
    await expect(deployments.fileWriteBytes(id, 'x', new Uint8Array(RUNNER_FILE_MAX_BYTES + 1))).rejects.toThrow('limited');
    files.set('x', btoa('1234'));
    const signal = new AbortController().signal;
    await expect(deployments.fileRead(id, 'x', { maxBytes: 1, signal })).rejects.toThrow('Invalid runner file response');
    expect(post).toHaveBeenCalledWith(`/deployments/${id}/files/read`, { path: 'x', max_bytes: 1 }, { signal, redirect: 'error' });
    await expect(deployments.filesList(id)).rejects.toMatchObject({ statusCode: 501 });
    await expect(deployments.fileDelete(id, 'x')).rejects.toMatchObject({ statusCode: 501 });
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
    // The SDK discovers unsupported native listing locally, then probes a file.
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
