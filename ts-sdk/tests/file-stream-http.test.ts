import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import { Deployments, RUNNER_FILE_MAX_BYTES } from '../src/agents.js';
import { HTTPClient } from '../src/http.js';

async function fixture(handle: (req: IncomingMessage, res: ServerResponse, url: URL) => void | Promise<void>, run: (sdk: Deployments) => Promise<void>, timeout = 100) {
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    if (url.pathname.endsWith('/token')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ transport: 'runner', executor: 'process', max_bytes: RUNNER_FILE_MAX_BYTES, chunk_bytes: 262144 }));
    } else void handle(req, res, url);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/agents`;
    await run(new Deployments(new HTTPClient(base, 'fixture', timeout), 'fixture', base));
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

function receipt(res: ServerResponse, url: URL, size = 0) {
  res.end(JSON.stringify({ ok: true, transfer_id: url.searchParams.get('transfer_id'),
    total: Number(url.searchParams.get('total')), offset: Number(url.searchParams.get('offset')) + size }));
}

it.each(['read-headers', 'read-body', 'write-headers', 'write-receipt', 'cancel-read', 'cancel-write'])(
  'settles %s over real HTTP without replaying an uncertain write', async mode => {
    const controller = new AbortController();
    let writes = 0;
    await fixture(async (req, res, url) => {
      const action = url.searchParams.get('action');
      if (action === 'open_write' || action === 'abort') { receipt(res, url); return; }
      for await (const _ of req) { /* drain the bounded upload */ }
      if (action === 'write') writes++;
      if (mode === 'read-body') {
        res.writeHead(200, { 'Content-Length': '3' });
        res.write('x');
      } else if (mode === 'write-receipt') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write('{');
      }
      if (mode.startsWith('cancel')) controller.abort(new Error('caller cancelled'));
      // Intentionally leave headers/body/receipt incomplete until SDK aborts.
    }, async sdk => {
      const operation = mode.includes('write')
        ? sdk.fileWriteBytes('agent-contract', 'x', new Uint8Array(262145), { signal: controller.signal })
        : sdk.fileReadBytes('agent-contract', 'x', { signal: controller.signal });
      await expect(operation).rejects.toThrow(mode.startsWith('cancel') ? 'caller cancelled' : /timed out/i);
      expect(writes).toBe(mode.includes('write') ? 1 : 0);
    });
  },
);

it('holds the next chunk until the preceding HTTP receipt and sends only bounded byte bodies', async () => {
  let release!: () => void;
  let started!: () => void;
  const first = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const lengths: number[] = [];
  await fixture(async (req, res, url) => {
    let size = 0;
    for await (const part of req) size += part.length;
    if (url.searchParams.get('action') === 'write') {
      lengths.push(size);
      expect(Number(req.headers['content-length'])).toBe(size);
      if (lengths.length === 1) { started(); await gate; }
    }
    receipt(res, url, size);
  }, async sdk => {
    const upload = sdk.fileWriteBytes('agent-contract', 'x', new Uint8Array(3 * 262144 + 17));
    await first;
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(lengths).toEqual([262144]);
    release();
    await upload;
    expect(lengths).toEqual([262144, 262144, 262144, 17]);
  }, 30000);
});
