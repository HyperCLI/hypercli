import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Deployments, RUNNER_FILE_MAX_BYTES } from '../src/agents.js';
import { HTTPClient } from '../src/http.js';

const vectors = JSON.parse(readFileSync(new URL('../../rs-sdk/tests/fixtures/agent-file-contract.json', import.meta.url), 'utf8'));
const id = 'agent-contract';
const native = { transport: 'runner', executor: 'process', max_bytes: RUNNER_FILE_MAX_BYTES };
const reef = { url: 'https://reef.example.test/_reef', token: 'reef-secret', expires_at: '2026-10-01T00:00:00Z' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

function client() {
  const http = new HTTPClient('https://api.example.test/agents', 'api-secret');
  return new Deployments(http, 'api-secret', 'https://api.example.test/agents');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe.each(['hosted', 'native'])('%s file transport through the real HTTP client', (transport) => {
  function setup() {
    const files = new Map<string, Uint8Array>();
    const calls: string[] = [];
    vi.stubGlobal('WebSocket', class { constructor() { throw new Error('SDK must not open file WS'); } });
    vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input);
      calls.push(input);
      const headers = new Headers(init.headers);
      expect(url.search).toBe('');
      if (url.host === 'api.example.test') {
        expect(headers.get('Authorization')).toBe('Bearer api-secret');
        if (url.pathname.endsWith('/files/token')) return json(transport === 'native' ? native : reef);
        if (url.pathname === `/agents/deployments/${id}`) return json({ id, state: 'STOPPED', user_id: 'owner' });
        expect(transport).toBe('native');
        const body = JSON.parse(init.body as string);
        if (url.pathname.endsWith('/files/write')) {
          files.set(body.path, Uint8Array.from(Buffer.from(body.content_base64, 'base64')));
          return json({ ok: true });
        }
        if (url.pathname.endsWith('/files/read')) return json({ content_base64: Buffer.from(files.get(body.path)!).toString('base64') });
        throw new Error(`Unexpected API request ${url.pathname}`);
      }
      expect(transport).toBe('hosted');
      expect(url.host).toBe('reef.example.test');
      expect(headers.get('Authorization')).toBe('Bearer reef-secret');
      expect(init.redirect).toBe('error');
      const path = decodeURIComponent(url.pathname.slice('/_reef/files/'.length));
      if (init.method === 'PUT') {
        files.set(path, new Uint8Array(init.body as Uint8Array));
        return json({ status: 'ok', path, size: files.get(path)!.length });
      }
      return new Response(files.get(path) as BodyInit, { headers: { 'Content-Type': 'application/json' } });
    }));
    return { deployments: client(), files, calls };
  }

  it('uses identical bound methods for shared path/byte vectors and regular JSON files', async () => {
    const { deployments, files, calls } = setup();
    const agent = await deployments.get(id);
    for (const { input, normalized } of vectors.paths) {
      for (const hex of vectors.bytes_hex) {
        const bytes = Uint8Array.from(Buffer.from(hex, 'hex'));
        await agent.files.writeBytes(input, bytes);
        expect(files.get(normalized)).toEqual(bytes);
        expect(await agent.files.readBytes(input)).toEqual(bytes);
      }
    }
    await agent.files.write('fixture.json', vectors.directory_shaped_json);
    expect(await agent.files.read('fixture.json')).toBe(vectors.directory_shaped_json);
    await agent.files.write('text', 'Hello 🌍');
    expect(await agent.files.read('text')).toBe('Hello 🌍');
    for (const { hex, decoded } of vectors.text) {
      await agent.files.writeBytes('encoding.txt', Uint8Array.from(Buffer.from(hex, 'hex')));
      expect(await agent.files.read('encoding.txt')).toBe(decoded);
      await agent.files.write('encoding.txt', decoded);
      expect(await agent.files.read('encoding.txt')).toBe(decoded);
      expect(await agent.files.readBytes('encoding.txt')).toEqual(new TextEncoder().encode(decoded));
    }
    expect(calls.every((url) => !url.includes('secret'))).toBe(true);
    if (transport === 'hosted') expect(calls.some((url) => url.endsWith('/a%252Fb'))).toBe(true);
  });

  it.each(vectors.invalid_paths)('rejects unsafe path %j before any request', async (path) => {
    const { deployments, calls } = setup();
    await expect(deployments.fileWrite(id, path, 'x')).rejects.toThrow();
    await expect(deployments.fileRead(id, path)).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it('copy helpers use the same discovered byte methods', async () => {
    const { deployments } = setup();
    const scratch = await mkdtemp(join(tmpdir(), 'sdk-file-contract-'));
    try {
      const source = join(scratch, 'source');
      const destination = join(scratch, 'nested', 'result');
      const bytes = new Uint8Array([0, 255, 128]);
      await writeFile(source, bytes);
      await deployments.cpTo(id, source, './copies//file.bin');
      await deployments.cpFrom(id, 'copies/file.bin', destination);
      expect(Uint8Array.from(await readFile(destination))).toEqual(bytes);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});

it('does not replay a committed native write after the response is lost', async () => {
  let writes = 0;
  let content = '';
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/files/token')) return json(native);
    writes++;
    content = JSON.parse(init.body as string).content_base64;
    if (writes === 1) {
      content = 'intervening user edit';
      throw Object.assign(new Error('response lost'), { cause: { code: 'ECONNRESET' } });
    }
    return json({ ok: true });
  }));
  await expect(client().fileWrite(id, 'x', 'original')).rejects.toThrow('response lost');
  expect(writes).toBe(1);
  expect(content).toBe('intervening user edit');
});

it.each([null, [], {}, { ...native, executor: 'kubernetes' }, { ...native, max_bytes: 1 }, { ...native, transport: 'other' }, { ...native, extra: true }, { ...reef, extra: true }].map((value) => [value]))('rejects malformed discovery without fallback: %j', async (value) => {
  const fetch = vi.fn().mockImplementation(async () => json(value));
  vi.stubGlobal('fetch', fetch);
  await expect(client().fileRead(id, 'x')).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(vectors.error_statuses)('preserves backend HTTP status %i without fallback', async (status) => {
  const fetch = vi.fn().mockImplementation(async () => json({ detail: 'file unavailable' }, status));
  vi.stubGlobal('fetch', fetch);
  await expect(client().fileRead(id, 'x')).rejects.toMatchObject({ statusCode: status });
  expect(fetch).toHaveBeenCalledTimes(1);
});

const emptyListing = { type: 'directory', prefix: '', requested_path: '', truncated: false, directories: [], files: [] };

it('native readiness uses discovery even when the Agent projection has no runner field', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/files/token')) return json(native);
    if (url.endsWith('/files/list')) return json(emptyListing);
    return json({ id, state: 'STOPPED' });
  }));
  await expect(client().waitForFileApiReady(id, { consecutive: 1 })).resolves.toBeUndefined();
});

it('native readiness resets its requested streak on transient read failure and polls between attempts', async () => {
  vi.useFakeTimers();
  const outcomes = [200, 503, 200, 200, 404, 200, 200, 200];
  let reads = 0;
  let settled = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/files/token')) return json(native);
    if (url.endsWith('/files/list')) {
      const status = outcomes[reads++];
      if (status === undefined) throw new Error('Unexpected extra readiness probe');
      return status === 200 ? json(emptyListing)
        : json({ detail: status === 404 ? 'Runner file not_found' : 'Runner is offline' }, status);
    }
    return json({ id, state: 'STOPPED' });
  }));
  const waiting = client().waitForFileApiReady(id, { consecutive: 3, pollMs: 100, timeoutMs: 2000 });
  const finished = waiting.then(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(0);
  expect(reads).toBe(1);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(399);
  expect(reads).toBe(4);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(301);
  await finished;
  expect(reads).toBe(8);
});

it('native readiness times out under persistent read failure without tight spinning', async () => {
  vi.useFakeTimers();
  let reads = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/files/token')) return json(native);
    if (url.endsWith('/files/list')) { reads++; return json({ detail: 'Runner is offline' }, 503); }
    return json({ id, state: 'STOPPED' });
  }));
  const waiting = expect(client().waitForFileApiReady(id, { consecutive: 3, pollMs: 100, timeoutMs: 250 }))
    .rejects.toThrow(/3 consecutive reads.*503/);
  await vi.advanceTimersByTimeAsync(300);
  await waiting;
  expect(reads).toBe(4);
});

describe.each(['read', 'write'])('native %s HTTP errors after discovery', (operation) => {
  it.each(vectors.error_statuses)('preserves status %i without fallback or replay', async (status) => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      return url.endsWith('/files/token') ? json(native) : json({ detail: 'operation rejected' }, status);
    }));
    const deployments = client();
    await expect(operation === 'read' ? deployments.fileRead(id, 'x') : deployments.fileWrite(id, 'x', 'content'))
      .rejects.toMatchObject({ statusCode: status, detail: 'operation rejected' });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe(`https://api.example.test/agents/deployments/${id}/files/${operation}`);
  });
});

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe.each([307, 308])('real HTTP %i file redirects', (status) => {
  describe.each(['same-origin', 'cross-origin'])('%s', (origin) => {
    it.each(['token', 'read', 'write'])('rejects %s redirect before any receiver gets bytes', async (operation) => {
      const received: Buffer[] = [];
      let receiverRequests = 0;
      let redirectedRequests = 0;
      const receiver = createServer(async (request, response) => {
        receiverRequests++;
        for await (const chunk of request) received.push(Buffer.from(chunk));
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(operation === 'read' ? { content_base64: '' } : operation === 'token' ? native : { ok: true }));
      });
      const receiverBase = await listen(receiver);
      const source = createServer(async (request, response) => {
        if (request.url === '/receiver') {
          receiverRequests++;
          for await (const chunk of request) received.push(Buffer.from(chunk));
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify(operation === 'read' ? { content_base64: '' } : operation === 'token' ? native : { ok: true }));
          return;
        }
        for await (const _chunk of request) { /* consume the original request before replying */ }
        if (request.url?.endsWith(`/files/${operation}`)) {
          redirectedRequests++;
          response.writeHead(status, { Location: origin === 'same-origin' ? '/receiver' : `${receiverBase}/receiver` });
          response.end();
          return;
        }
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(native));
      });
      const base = await listen(source);
      try {
        const http = new HTTPClient(`${base}/agents`, 'api-secret');
        const deployments = new Deployments(http, 'api-secret', `${base}/agents`);
        const call = operation === 'write' ? deployments.fileWrite(id, 'private.txt', 'private-content')
          : deployments.fileRead(id, 'private.txt');
        await expect(call).rejects.toThrow();
        expect(redirectedRequests).toBe(1);
        expect(receiverRequests).toBe(0);
        expect(Buffer.concat(received).length).toBe(0);
      } finally {
        await close(source);
        await close(receiver);
      }
    });
  });
});

it('unrelated HTTPClient POST retains its existing redirect default', async () => {
  let receiverRequests = 0;
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* drain */ }
    if (request.url === '/start') { response.writeHead(307, { Location: '/receiver' }); response.end(); }
    else { receiverRequests++; response.setHeader('Content-Type', 'application/json'); response.end('{"ok":true}'); }
  });
  const base = await listen(server);
  try {
    await expect(new HTTPClient(base, 'fixture').post('/start', { harmless: true })).resolves.toEqual({ ok: true });
    expect(receiverRequests).toBe(1);
  } finally {
    await close(server);
  }
});

it('native metadata, maximum bytes, listing and deletion retain the public contract', async () => {
  const bytes = new Uint8Array(RUNNER_FILE_MAX_BYTES).fill(255);
  let writes = 0;
  const files = new Map<string, Uint8Array>();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url.endsWith('/files/token')) return json(native);
    const body = init.body ? JSON.parse(init.body as string) : {};
    if (url.endsWith('/files/write')) {
      writes++;
      const content = Uint8Array.from(Buffer.from(body.content_base64, 'base64'));
      expect(content.length).toBe(RUNNER_FILE_MAX_BYTES);
      files.set(body.path, content);
      return json({ ok: true });
    }
    if (url.endsWith('/files/list')) {
      const prefix = body.path ? `${body.path}/` : '';
      const names = [...files.keys()].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
      return json({
        type: 'directory', prefix, requested_path: body.path, truncated: false, directories: [],
        files: names.map((name) => ({ name, path: `${prefix}${name}`, size: files.get(`${prefix}${name}`)!.length, size_formatted: '262144 B', last_modified: null, type: 'file' })),
      });
    }
    if (url.endsWith('/files/delete')) {
      if (!files.delete(body.path)) return json({ detail: 'Runner file not_found' }, 404);
      return json({ status: 'deleted', path: body.path });
    }
    return json({ content_base64: Buffer.from(files.get(body.path)!).toString('base64') });
  }));
  const deployments = client();
  await expect(deployments.fileWriteBytes(id, 'max', bytes)).resolves.toEqual({ ok: true });
  await expect(deployments.fileReadBytesWithMetadata(id, 'max')).resolves.toEqual({ content: bytes });
  await expect(deployments.fileWriteBytes(id, 'max', new Uint8Array(RUNNER_FILE_MAX_BYTES + 1))).rejects.toThrow('limited');
  expect(writes).toBe(1);
  await expect(deployments.filesList(id)).resolves.toEqual([
    { name: 'max', path: 'max', size: RUNNER_FILE_MAX_BYTES, size_formatted: '262144 B', last_modified: null, type: 'file' },
  ]);
  await expect(deployments.fileDelete(id, 'max')).resolves.toEqual({ status: 'deleted', path: 'max' });
  await expect(deployments.fileDelete(id, 'max')).rejects.toMatchObject({ statusCode: 404 });
});
