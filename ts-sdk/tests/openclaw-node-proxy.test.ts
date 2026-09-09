import { describe, expect, it, vi, afterEach } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import {
  DEFAULT_CHUNK_BYTES,
  EgressPolicyError,
  EgressProtocolError,
  NodeEgressClient,
  NodeEgressCommandHandlers,
  LoopbackNodeProxy,
  assertPublicDestination,
} from '../src/openclaw/node-proxy.js';

type HttpServerHandle = { server: http.Server; url: string };

async function startHttpServer(handler: http.RequestListener): Promise<HttpServerHandle> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { server, url: `http://127.0.0.1:${port}` };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('node egress policy', () => {
  it('rejects private and loopback destinations by default', async () => {
    await expect(assertPublicDestination('127.0.0.1', 80)).rejects.toBeInstanceOf(EgressPolicyError);
    await expect(assertPublicDestination('192.168.1.10', 443)).rejects.toBeInstanceOf(EgressPolicyError);
    await expect(assertPublicDestination('169.254.169.254', 80)).rejects.toBeInstanceOf(EgressPolicyError);
    await expect(assertPublicDestination('10.0.0.5', 22)).rejects.toBeInstanceOf(EgressPolicyError);
    await expect(assertPublicDestination('::1', 80)).rejects.toBeInstanceOf(EgressPolicyError);
  });

  it('allows the same destinations when allowPrivateNetwork is set', async () => {
    await assertPublicDestination('127.0.0.1', 80, { allowPrivateNetwork: true });
  });

  it('validates the egress handler request shape', async () => {
    const handlers = new NodeEgressCommandHandlers({ allowPrivateNetwork: true });
    await expect(handlers.httpFetch({ url: '' })).rejects.toThrow(/url required/);
    await expect(handlers.httpFetch({ url: 'ftp://example.com/x' })).rejects.toThrow(/http or https/);
    await expect(handlers.httpFetch({ url: 'http://127.0.0.1/', method: 'TRACE' })).rejects.toThrow(
      /unsupported HTTP method/,
    );
  });
});

describe('NodeEgressCommandHandlers http.fetch', () => {
  it('fetches a URL and returns chunked base64 body', async () => {
    const { server, url } = await startHttpServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': 'no=leak' });
      res.end('hello-egress');
    });
    try {
      const handlers = new NodeEgressCommandHandlers({ allowPrivateNetwork: true });
      const result = await handlers.httpFetch({ url, method: 'GET' });
      expect(result.status).toBe(200);
      expect(Buffer.concat(result.bodyBase64Chunks.map((c: string) => Buffer.from(c, 'base64'))).toString()).toBe(
        'hello-egress',
      );
      expect(result.bodyBytes).toBe(12);
      expect(result.headers['set-cookie']).toBeUndefined();
      expect(result.truncated).toBe(false);
    } finally {
      server.close();
    }
  });

  it('truncates bodies over maxBytes', async () => {
    const { server, url } = await startHttpServer((_req, res) => {
      res.end(Buffer.alloc(DEFAULT_CHUNK_BYTES * 2, 65));
    });
    try {
      const handlers = new NodeEgressCommandHandlers({ allowPrivateNetwork: true });
      const result = await handlers.httpFetch({ url, maxBytes: 5000 });
      expect(result.bodyBytes).toBe(5000);
      expect(result.truncated).toBe(true);
    } finally {
      server.close();
    }
  });

  it('posts a base64 request body', async () => {
    const { server, url } = await startHttpServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => res.end(Buffer.concat(chunks).toString().toUpperCase()));
    });
    try {
      const handlers = new NodeEgressCommandHandlers({ allowPrivateNetwork: true });
      const result = await handlers.httpFetch({
        url,
        method: 'POST',
        bodyBase64: Buffer.from('echo me').toString('base64'),
      });
      expect(Buffer.concat(result.bodyBase64Chunks.map((c: string) => Buffer.from(c, 'base64'))).toString()).toBe(
        'ECHO ME',
      );
    } finally {
      server.close();
    }
  });
});

describe('NodeEgressCommandHandlers tcp lane', () => {
  it('opens, writes, reads, and closes a connection', async () => {
    const echo = net.createServer((socket) => socket.pipe(socket));
    await new Promise<void>((resolve) => echo.listen(0, '127.0.0.1', resolve));
    const port = (echo.address() as net.AddressInfo).port;
    try {
      const handlers = new NodeEgressCommandHandlers({ allowPrivateNetwork: true });
      const { connId } = await handlers.tcpOpen({ host: '127.0.0.1', port });
      expect(typeof connId).toBe('string');

      const written = await handlers.tcpWrite({
        connId,
        dataBase64Chunks: [Buffer.from('ping').toString('base64')],
      });
      expect(written.writtenBytes).toBe(4);

      await new Promise((resolve) => setTimeout(resolve, 50));
      const read = await handlers.tcpRead({ connId, waitMs: 250 });
      expect(Buffer.concat(read.dataBase64Chunks.map((c: string) => Buffer.from(c, 'base64'))).toString()).toBe('ping');
      expect(read.closed).toBe(false);

      const closed = await handlers.tcpClose({ connId });
      expect(closed.closed).toBe(true);
      expect(await handlers.tcpClose({ connId })).toMatchObject({ ok: true, closed: false });
    } finally {
      echo.close();
    }
  });

  it('rejects writes with oversized chunks and unknown connIds', async () => {
    const handlers = new NodeEgressCommandHandlers({ allowPrivateNetwork: true });
    await expect(handlers.tcpWrite({ connId: 'nope', dataBase64Chunks: [] })).rejects.toThrow(/unknown or closed/);
    await expect(handlers.tcpRead({ connId: '' })).rejects.toThrow(/connId required/);
  });
});

describe('NodeEgressClient', () => {
  function makeGateway(invokeResult: any) {
    const nodeInvoke = vi.fn().mockResolvedValue(invokeResult);
    return { nodeInvoke };
  }

  it('requires an explicit node id', () => {
    expect(() => new NodeEgressClient(makeGateway({}), { nodeId: '' })).toThrow(/nodeId is required/);
  });

  it('parses payloadJSON results and rejects ok:false payloads', async () => {
    const gateway = makeGateway({ ok: true, payloadJSON: JSON.stringify({ ok: true, answer: 42 }) });
    const client = new NodeEgressClient(gateway, { nodeId: 'node-1' });
    const payload = await client.invoke('egress.http.fetch', { url: 'http://example.com' });
    expect(payload.answer).toBe(42);
    expect(gateway.nodeInvoke).toHaveBeenCalledWith(
      'node-1',
      'egress.http.fetch',
      { url: 'http://example.com' },
      30_000,
    );

    const failing = new NodeEgressClient(makeGateway({ ok: true, payloadJSON: JSON.stringify({ ok: false, error: 'denied' }) }), { nodeId: 'node-1' });
    await expect(failing.invoke('egress.tcp.open', {})).rejects.toBeInstanceOf(EgressProtocolError);
  });

  it('raises EgressProtocolError on malformed node results', async () => {
    const client = new NodeEgressClient(makeGateway('not-a-payload'), { nodeId: 'node-1' });
    await expect(client.invoke('egress.http.fetch', {})).rejects.toBeInstanceOf(EgressProtocolError);
  });
});

describe('LoopbackNodeProxy', () => {
  it('relays absolute-form HTTP requests through egress http fetch', async () => {
    const gateway = {
      nodeInvoke: vi.fn().mockResolvedValue({
        ok: true,
        payloadJSON: JSON.stringify({
          ok: true,
          status: 200,
          headers: { 'content-type': 'text/plain' },
          bodyBase64Chunks: [Buffer.from('proxied').toString('base64')],
          bodyBytes: 7,
        }),
      }),
    };
    const client = new NodeEgressClient(gateway, { nodeId: 'node-1' });
    const proxy = new LoopbackNodeProxy(client);
    await proxy.start();
    try {
      const raw = await new Promise<Buffer>((resolve, reject) => {
        const socket = net.connect(proxy.boundPort, '127.0.0.1');
        const chunks: Buffer[] = [];
        socket.on('connect', () => {
          socket.write('GET http://example.com/page HTTP/1.1\r\nHost: example.com\r\n\r\n');
        });
        socket.on('data', (chunk) => chunks.push(chunk));
        socket.on('close', () => resolve(Buffer.concat(chunks)));
        socket.on('error', reject);
      });
      const text = raw.toString('latin1');
      expect(text).toContain('HTTP/1.1 200');
      expect(text).toContain('Content-Length: 7');
      expect(text.endsWith('proxied')).toBe(true);
      expect(gateway.nodeInvoke).toHaveBeenCalledWith(
        'node-1',
        'egress.http.fetch',
        expect.objectContaining({ url: 'http://example.com/page', method: 'GET' }),
        30_000,
      );
    } finally {
      await proxy.close();
    }
  });

  it('refuses non-loopback bind hosts', () => {
    const client = new NodeEgressClient({ nodeInvoke: vi.fn() }, { nodeId: 'node-1' });
    expect(() => new LoopbackNodeProxy(client, { host: '0.0.0.0' })).toThrow(/loopback/i);
  });
});
