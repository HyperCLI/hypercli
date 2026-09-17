/**
 * Experimental OpenClaw node egress helpers.
 *
 * Proves a narrow no-OpenClaw-change proxy/egress shape over the existing node
 * protocol:
 *
 * - A node process connects with `role: "node"` and declares explicit
 *   `egress.*` commands in the gateway connect handshake.
 * - An operator process calls `GatewayClient.nodeInvoke(nodeId, command, ...)`.
 * - The gateway sends exactly one `node.invoke.request` to the node and waits
 *   for exactly one `node.invoke.result`. This is RPC over `node.invoke`, not a
 *   generic socket bus.
 *
 * The portable API names are `NodeEgressServer`, `NodeEgressClient`, and
 * `NodeEgressCommandHandlers`. The reliable lane is `egress.http.fetch`: the
 * node performs one bounded HTTP request and returns base64 body chunks. The
 * TCP lane (`egress.tcp.*` and `LoopbackNodeProxy` CONNECT support) is
 * deliberately small and experimental: it approximates a socket by issuing many
 * chunked invoke calls, so latency and overhead are high. Production-grade
 * streaming would need a gateway protocol change (bidirectional stream frames,
 * flow control, node-pushed userland data frames).
 *
 * Security defaults are intentionally conservative: local proxy listeners bind
 * to 127.0.0.1, callers must provide an explicit node id, and node handlers
 * deny loopback, private, link-local, multicast, and cloud metadata addresses
 * unless `allowPrivateNetwork` is set by the operator.
 *
 * Pairing note: custom `egress.*` commands must be declared by the node,
 * approved as part of the node command surface, and may need to be listed in
 * the gateway config `gateway.nodes.allowCommands` before `node.invoke` accepts
 * them.
 */
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import dns from 'node:dns';

import { GatewayClient, NodeServer, type NodeServerOptions, type NodeCommandHandler } from './gateway.js';

export const EGRESS_HTTP_FETCH_COMMAND = 'egress.http.fetch';
export const EGRESS_TCP_OPEN_COMMAND = 'egress.tcp.open';
export const EGRESS_TCP_READ_COMMAND = 'egress.tcp.read';
export const EGRESS_TCP_WRITE_COMMAND = 'egress.tcp.write';
export const EGRESS_TCP_CLOSE_COMMAND = 'egress.tcp.close';
export const EGRESS_COMMANDS = [
  EGRESS_HTTP_FETCH_COMMAND,
  EGRESS_TCP_OPEN_COMMAND,
  EGRESS_TCP_READ_COMMAND,
  EGRESS_TCP_WRITE_COMMAND,
  EGRESS_TCP_CLOSE_COMMAND,
];

export const DEFAULT_CHUNK_BYTES = 64 * 1024;
export const MIN_CHUNK_BYTES = 1024;
export const MAX_CHUNK_BYTES = 64 * 1024;
export const DEFAULT_MAX_HTTP_BYTES = 2 * 1024 * 1024;
export const MAX_HTTP_BYTES = 8 * 1024 * 1024;
export const DEFAULT_TCP_READ_BYTES = 32 * 1024;
export const MAX_TCP_READ_BYTES = 64 * 1024;
export const DEFAULT_TCP_TTL_SECONDS = 60;
export const MAX_TCP_CONNECTIONS = 128;
export const DEFAULT_INVOKE_TIMEOUT_MS = 30_000;
export const DEFAULT_HTTP_TIMEOUT_SECONDS = 20;
export const DEFAULT_TCP_CONNECT_TIMEOUT_SECONDS = 10;
export const DEFAULT_TCP_READ_WAIT_MS = 250;
export const MAX_TCP_READ_WAIT_MS = 2_000;

const HTTP_HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** Raised when an egress request violates the local node policy. */
export class EgressPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EgressPolicyError';
  }
}

/** Raised when an egress node returns an invalid payload. */
export class EgressProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EgressProtocolError';
  }
}

function b64Encode(data: Buffer): string {
  return data.toString('base64');
}

function b64Decode(data: unknown, field: string): Buffer {
  if (typeof data !== 'string') {
    throw new Error(`${field} must be base64 text`);
  }
  const cleaned = data;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned) || cleaned.length % 4 !== 0) {
    throw new Error(`${field} is not valid base64`);
  }
  return Buffer.from(cleaned, 'base64');
}

function clampInt(value: unknown, defaultValue: number, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.trunc(value) !== value) {
    return defaultValue;
  }
  return Math.max(minimum, Math.min(maximum, value));
}

function nowSeconds(): number {
  return Date.now() / 1000;
}

function normalizeHost(host: unknown): string {
  if (typeof host !== 'string' || !host.trim()) {
    throw new Error('host required');
  }
  const normalized = host.trim().replace(/^\[|\]$/g, '');
  if (!normalized) {
    throw new Error('host required');
  }
  return normalized;
}

function normalizePort(port: unknown): number {
  let value = port;
  if (typeof value === 'string' && value.trim() !== '' && /^\d+$/.test(value.trim())) {
    value = Number(value.trim());
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error('port must be 1..65535');
  }
  return value;
}

function parseIpv4Octets(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

/**
 * Normalize an IPv6 address into 8 hextets, unwrapping IPv4-mapped suffixes.
 * Returns null when the address is not parseable.
 */
function parseIpv6Hextets(rawIp: string): number[] | null {
  let ip = rawIp.replace(/^\[|\]$/g, '');
  const zoneIndex = ip.indexOf('%');
  if (zoneIndex >= 0) ip = ip.slice(0, zoneIndex);

  let embeddedV4: number[] | null = null;
  const lastColon = ip.lastIndexOf(':');
  if (lastColon >= 0) {
    const maybeV4 = ip.slice(lastColon + 1);
    if (maybeV4.includes('.')) {
      embeddedV4 = parseIpv4Octets(maybeV4);
      if (!embeddedV4) return null;
      ip = ip.slice(0, lastColon);
      if (ip && !ip.endsWith(':')) return null;
    }
  }

  if (!/^[0-9a-fA-F:]*$/.test(ip)) return null;
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  for (const hextet of [...left, ...right]) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(hextet)) return null;
  }
  const leftValues = left.map((hextet) => parseInt(hextet, 16));
  const rightValues = right.map((hextet) => parseInt(hextet, 16));

  const embeddedCount = embeddedV4 ? 2 : 0;
  const fill = 8 - embeddedCount - leftValues.length - rightValues.length;
  if (fill < 0) return null;
  if (halves.length !== 2 && fill !== 0) return null;
  const hextets = [...leftValues, ...Array<number>(fill).fill(0), ...rightValues];
  if (embeddedV4) {
    hextets.push((embeddedV4[0] << 8) | embeddedV4[1], (embeddedV4[2] << 8) | embeddedV4[3]);
  }
  return hextets.length === 8 ? hextets : null;
}

function isDisallowedIpv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 0) return true; // 0.0.0.0/8 (unspecified / "this network")
  if (a >= 224) return true; // multicast (224/4), reserved (240/4), broadcast
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 (IETF protocol assignments)
  if (a === 192 && b === 31) return true; // 192.31.196.0/24 (AS112-v4)
  if (a === 192 && b === 52) return true; // 192.52.193.0/24 (AMT)
  if (a === 192 && b === 88) return true; // 192.88.99.0/24 (6to4 relay anycast)
  if (a === 192 && b === 175) return true; // 192.175.48.0/24 (AS112)
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18.0.0/15
  if (a === 198 && b === 51) return true; // documentation TEST-NET-2
  if (a === 203 && b === 0) return true; // documentation TEST-NET-3
  if (a === 233 && b === 252) return true; // MCAST-TEST-NET
  return false;
}

function isDisallowedIp(ip: string): boolean {
  const octets = parseIpv4Octets(ip);
  if (octets) {
    return isDisallowedIpv4(octets);
  }
  if (net.isIPv6(ip)) {
    const hextets = parseIpv6Hextets(ip);
    if (!hextets) return true; // unparseable ipv6 is never allowed
    // IPv4-mapped/compatible addresses follow the IPv4 policy.
    const isMapped = hextets.slice(0, 5).every((h) => h === 0) && (hextets[5] === 0xffff || hextets[5] === 0);
    if (isMapped && (hextets[5] === 0xffff || hextets.slice(6).some((h) => h !== 0))) {
      const v4 = [
        hextets[6] >> 8,
        hextets[6] & 0xff,
        hextets[7] >> 8,
        hextets[7] & 0xff,
      ];
      if (hextets[5] === 0xffff || hextets[6] !== 0 || hextets[7] !== 0) {
        return isDisallowedIpv4(v4);
      }
    }
    if (hextets.every((h) => h === 0)) return true; // ::
    if (hextets.slice(0, 7).every((h) => h === 0) && hextets[7] === 1) return true; // ::1 loopback
    const first = hextets[0];
    if ((first & 0xfe80) === 0xfe80) return true; // fe80::/10 link-local
    if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA (private)
    if (first === 0x2001 && hextets[1] === 0x0db8) return true; // documentation
    if (first === 0xfd00 && hextets[1] === 0x0ec2 && hextets[5] === 0 && hextets[6] === 0 && hextets[7] === 0x0254) {
      return true; // AWS VPC metadata fd00:ec2::254
    }
    return false;
  }
  return true; // unknown formats are not allowed
}

async function resolveHostIps(host: string, port: number): Promise<string[]> {
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new EgressPolicyError(`host resolution failed: ${host}`);
  }
  const seen = new Set<string>();
  const ips: string[] = [];
  for (const entry of addresses) {
    if (entry.family !== 4 && entry.family !== 6) continue;
    if (net.isIP(entry.address) === 0) continue;
    if (!seen.has(entry.address)) {
      seen.add(entry.address);
      ips.push(entry.address);
    }
  }
  if (!ips.length) {
    throw new EgressPolicyError(`host resolution returned no usable addresses: ${host}`);
  }
  void port;
  return ips;
}

/** Resolve and reject private/link-local/metadata destinations by default. */
export async function assertPublicDestination(
  host: string,
  port: number,
  options: { allowPrivateNetwork?: boolean } = {},
): Promise<void> {
  if (options.allowPrivateNetwork) return;
  const ips = await resolveHostIps(host, port);
  const blocked = ips.filter((ip) => isDisallowedIp(ip));
  if (blocked.length) {
    throw new EgressPolicyError(`destination resolves to blocked address: ${host} -> ${blocked[0]}`);
  }
}

const HTTP_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

function sanitizeRequestHeaders(headers: unknown): Record<string, string> {
  if (headers === null || headers === undefined) return {};
  if (typeof headers !== 'object' || Array.isArray(headers)) {
    throw new Error('headers must be an object');
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      throw new Error('headers must contain string keys and values');
    }
    const name = key.trim();
    const lower = name.toLowerCase();
    if (!name || HTTP_HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (lower === 'host') continue;
    out[name] = value;
  }
  return out;
}

function sanitizeResponseHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HTTP_HOP_BY_HOP_HEADERS.has(lower) || lower === 'set-cookie') return;
    out[key] = value;
  });
  return out;
}

function decodeRequestBody(params: Record<string, any>): Buffer | null {
  if (params.bodyBase64 !== undefined && params.bodyBase64 !== null) {
    return b64Decode(params.bodyBase64, 'bodyBase64');
  }
  if (params.bodyText !== undefined && params.bodyText !== null) {
    if (typeof params.bodyText !== 'string') {
      throw new Error('bodyText must be a string');
    }
    return Buffer.from(params.bodyText, 'utf8');
  }
  return null;
}

function payloadFromNodeResponse(response: unknown): Record<string, any> {
  const record = response && typeof response === 'object' && !Array.isArray(response)
    ? (response as Record<string, any>)
    : null;
  if (record) {
    if (record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)) {
      return record.payload as Record<string, any>;
    }
    if (typeof record.payloadJSON === 'string') {
      try {
        const decoded = JSON.parse(record.payloadJSON);
        if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
          return decoded as Record<string, any>;
        }
      } catch {
        // fall through to the invalid-payload error
      }
    }
    if ('ok' in record) {
      return record;
    }
  }
  throw new EgressProtocolError('node.invoke returned an invalid egress payload');
}

export interface NodeEgressCommandHandlerOptions {
  allowPrivateNetwork?: boolean;
  chunkBytes?: number;
  maxHttpBytes?: number;
  tcpTtlSeconds?: number;
  maxTcpConnections?: number;
}

interface TcpConnection {
  socket: net.Socket;
  buffered: Buffer;
  ended: boolean;
  createdAt: number;
  lastUsed: number;
  closed: boolean;
  waiter: (() => void) | null;
}

/** Node-local handlers for `egress.*` commands. */
export class NodeEgressCommandHandlers {
  readonly allowPrivateNetwork: boolean;
  readonly chunkBytes: number;
  readonly maxHttpBytes: number;
  readonly tcpTtlSeconds: number;
  readonly maxTcpConnections: number;
  private readonly tcp = new Map<string, TcpConnection>();

  constructor(options: NodeEgressCommandHandlerOptions = {}) {
    this.allowPrivateNetwork = Boolean(options.allowPrivateNetwork);
    this.chunkBytes = Math.max(
      MIN_CHUNK_BYTES,
      Math.min(MAX_CHUNK_BYTES, Math.trunc(options.chunkBytes ?? DEFAULT_CHUNK_BYTES)),
    );
    this.maxHttpBytes = Math.max(
      0,
      Math.min(MAX_HTTP_BYTES, Math.trunc(options.maxHttpBytes ?? DEFAULT_MAX_HTTP_BYTES)),
    );
    this.tcpTtlSeconds = Math.max(1, options.tcpTtlSeconds ?? DEFAULT_TCP_TTL_SECONDS);
    this.maxTcpConnections = Math.max(1, Math.trunc(options.maxTcpConnections ?? MAX_TCP_CONNECTIONS));
  }

  commands(): Record<string, NodeCommandHandler> {
    return {
      [EGRESS_HTTP_FETCH_COMMAND]: (params) => this.httpFetch(params),
      [EGRESS_TCP_OPEN_COMMAND]: (params) => this.tcpOpen(params),
      [EGRESS_TCP_READ_COMMAND]: (params) => this.tcpRead(params),
      [EGRESS_TCP_WRITE_COMMAND]: (params) => this.tcpWrite(params),
      [EGRESS_TCP_CLOSE_COMMAND]: (params) => this.tcpClose(params),
    };
  }

  async aclose(): Promise<void> {
    for (const connId of [...this.tcp.keys()]) {
      await this.closeConn(connId);
    }
  }

  async httpFetch(params: Record<string, any>): Promise<Record<string, any>> {
    const method = String(params.method || 'GET').toUpperCase();
    if (!HTTP_METHODS.has(method)) {
      throw new Error('unsupported HTTP method');
    }
    const rawUrl = params.url;
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
      throw new Error('url required');
    }
    const url = new URL(rawUrl.trim());
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) {
      throw new Error('url scheme must be http or https');
    }
    const port = url.port
      ? normalizePort(url.port)
      : url.protocol === 'https:'
        ? 443
        : 80;
    await assertPublicDestination(url.hostname, port, {
      allowPrivateNetwork: this.allowPrivateNetwork || params.allowPrivateNetwork === true,
    });

    const maxBytes = clampInt(params.maxBytes, this.maxHttpBytes, 0, MAX_HTTP_BYTES);
    const chunkBytes = clampInt(params.chunkBytes, this.chunkBytes, MIN_CHUNK_BYTES, MAX_CHUNK_BYTES);
    const timeoutMs = (Number(params.timeoutSeconds) || DEFAULT_HTTP_TIMEOUT_SECONDS) * 1000;
    const headers = sanitizeRequestHeaders(params.headers);
    const body = decodeRequestBody(params);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url.toString(), {
        method,
        headers,
        ...(body !== null && method !== 'GET' && method !== 'HEAD' ? { body } : {}),
        redirect: 'manual',
        signal: controller.signal,
      });

      const chunks: string[] = [];
      let total = 0;
      let truncated = false;
      const reader = response.body?.getReader();
      let pending = Buffer.alloc(0);
      const flushPending = () => {
        while (pending.length >= chunkBytes) {
          const remaining = maxBytes - total;
          if (remaining <= 0) return;
          const take = Math.min(chunkBytes, remaining, pending.length);
          chunks.push(b64Encode(pending.subarray(0, take)));
          pending = pending.subarray(take);
          total += take;
        }
      };
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value || !value.length) continue;
          pending = Buffer.concat([pending, Buffer.from(value)]);
          flushPending();
          if (total >= maxBytes) {
            truncated = true;
            break;
          }
        }
      }
      if (!truncated && pending.length) {
        while (pending.length && total < maxBytes) {
          const take = Math.min(pending.length, maxBytes - total);
          chunks.push(b64Encode(pending.subarray(0, take)));
          pending = pending.subarray(take);
          total += take;
        }
        if (pending.length) {
          truncated = true;
        }
      }

      return {
        ok: true,
        status: response.status,
        headers: sanitizeResponseHeaders(response.headers),
        bodyBase64Chunks: chunks,
        bodyBytes: total,
        truncated,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async tcpOpen(params: Record<string, any>): Promise<Record<string, any>> {
    this.cleanupExpired();
    if (this.tcp.size >= this.maxTcpConnections) {
      throw new Error('too many open egress tcp connections');
    }
    const host = normalizeHost(params.host);
    const port = normalizePort(params.port);
    await assertPublicDestination(host, port, {
      allowPrivateNetwork: this.allowPrivateNetwork || params.allowPrivateNetwork === true,
    });
    const timeoutMs = (Number(params.timeoutSeconds) || DEFAULT_TCP_CONNECT_TIMEOUT_SECONDS) * 1000;

    const socket = await new Promise<net.Socket>((resolve, reject) => {
      const sock = net.createConnection({ host, port });
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new Error(`tcp connect timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      sock.once('connect', () => {
        clearTimeout(timer);
        resolve(sock);
      });
      sock.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    const connId = randomUUID().replace(/-/g, '');
    const conn: TcpConnection = {
      socket,
      buffered: Buffer.alloc(0),
      ended: false,
      createdAt: nowSeconds(),
      lastUsed: nowSeconds(),
      closed: false,
      waiter: null,
    };
    socket.on('data', (chunk: Buffer) => {
      conn.buffered = Buffer.concat([conn.buffered, chunk]);
      this.wakeConn(conn);
    });
    socket.on('end', () => {
      conn.ended = true;
      this.wakeConn(conn);
    });
    socket.on('close', () => {
      conn.ended = true;
      this.wakeConn(conn);
    });
    socket.on('error', () => {
      conn.ended = true;
      this.wakeConn(conn);
    });
    this.tcp.set(connId, conn);
    return { ok: true, connId };
  }

  async tcpWrite(params: Record<string, any>): Promise<Record<string, any>> {
    const conn = this.requireConn(params.connId);
    const chunks = params.dataBase64Chunks;
    if (!Array.isArray(chunks)) {
      throw new Error('dataBase64Chunks must be a list');
    }
    let total = 0;
    for (let index = 0; index < chunks.length; index += 1) {
      const data = b64Decode(chunks[index], `dataBase64Chunks[${index}]`);
      if (data.length > MAX_CHUNK_BYTES) {
        throw new Error('tcp write chunk exceeds 64 KiB');
      }
      total += data.length;
      await new Promise<void>((resolve, reject) => {
        conn.socket.write(data, (error) => (error ? reject(error) : resolve()));
      });
    }
    conn.lastUsed = nowSeconds();
    return { ok: true, writtenBytes: total };
  }

  async tcpRead(params: Record<string, any>): Promise<Record<string, any>> {
    const conn = this.requireConn(params.connId);
    const maxBytes = clampInt(params.maxBytes, DEFAULT_TCP_READ_BYTES, 1, MAX_TCP_READ_BYTES);
    const waitMs = clampInt(params.waitMs, DEFAULT_TCP_READ_WAIT_MS, 0, MAX_TCP_READ_WAIT_MS);

    if (!conn.buffered.length && !conn.ended && waitMs > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          conn.waiter = null;
          resolve();
        }, waitMs);
        conn.waiter = () => {
          clearTimeout(timer);
          conn.waiter = null;
          resolve();
        };
      });
    }

    const data = conn.buffered.subarray(0, maxBytes);
    conn.buffered = conn.buffered.subarray(data.length);
    let closed = false;
    if (!data.length && conn.ended) {
      closed = true;
      conn.closed = true;
    }
    conn.lastUsed = nowSeconds();
    return {
      ok: true,
      dataBase64Chunks: data.length ? [b64Encode(Buffer.from(data))] : [],
      readBytes: data.length,
      closed,
    };
  }

  async tcpClose(params: Record<string, any>): Promise<Record<string, any>> {
    const connId = this.normalizeConnId(params.connId);
    const existed = this.tcp.has(connId);
    await this.closeConn(connId);
    return { ok: true, closed: existed };
  }

  private wakeConn(conn: TcpConnection): void {
    const waiter = conn.waiter;
    conn.waiter = null;
    waiter?.();
  }

  private normalizeConnId(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('connId required');
    }
    return value.trim();
  }

  private requireConn(value: unknown): TcpConnection {
    this.cleanupExpired();
    const connId = this.normalizeConnId(value);
    const conn = this.tcp.get(connId);
    if (!conn || conn.closed) {
      throw new Error('unknown or closed connId');
    }
    return conn;
  }

  private async closeConn(connId: string): Promise<void> {
    const conn = this.tcp.get(connId);
    if (!conn) return;
    this.tcp.delete(connId);
    conn.closed = true;
    this.wakeConn(conn);
    conn.socket.destroy();
  }

  private cleanupExpired(): void {
    const cutoff = nowSeconds() - this.tcpTtlSeconds;
    for (const [connId, conn] of [...this.tcp.entries()]) {
      if (conn.closed || conn.lastUsed < cutoff) {
        this.tcp.delete(connId);
        conn.closed = true;
        this.wakeConn(conn);
        conn.socket.destroy();
      }
    }
  }
}

export interface NodeEgressServerOptions
  extends Omit<NodeServerOptions, 'url' | 'nodeId' | 'clientDisplayName' | 'caps'> {
  /** Operator display name (default: "HyperCLI Egress Node"). */
  displayName?: string | null;
  /** Allow handlers to reach loopback/private/link-local/metadata destinations. */
  allowPrivateNetwork?: boolean;
}

/** Node-side egress server built on the existing OpenClaw `NodeServer`. */
export class NodeEgressServer {
  readonly handlers: NodeEgressCommandHandlers;
  readonly nodeServer: NodeServer;

  constructor(url: string, nodeId: string, options: NodeEgressServerOptions = {}) {
    const { displayName, allowPrivateNetwork, ...nodeServerOptions } = options;
    this.handlers = new NodeEgressCommandHandlers({ allowPrivateNetwork });
    this.nodeServer = new NodeServer(this.handlers.commands(), {
      ...nodeServerOptions,
      url,
      nodeId,
      clientDisplayName: displayName === undefined ? 'HyperCLI Egress Node' : (displayName ?? undefined),
      caps: ['egress'],
    });
  }

  get isConnected(): boolean {
    return this.nodeServer.gateway.isConnected;
  }

  async connect(): Promise<void> {
    await this.nodeServer.start();
  }

  async close(): Promise<void> {
    await this.handlers.aclose();
    this.nodeServer.stop();
  }
}

export interface NodeEgressClientOptions {
  nodeId: string;
  invokeTimeoutMs?: number;
}

export interface NodeEgressHttpFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: Buffer | Uint8Array | string | null;
  maxBytes?: number;
}

/** Operator-side helper that invokes explicit `egress.*` node commands. */
export class NodeEgressClient {
  readonly nodeId: string;
  readonly invokeTimeoutMs: number;

  constructor(
    private readonly gateway: Pick<GatewayClient, 'nodeInvoke'>,
    options: NodeEgressClientOptions,
  ) {
    const nodeId = options.nodeId?.trim() ?? '';
    if (!nodeId) {
      throw new Error('nodeId is required; egress helpers never auto-select a node');
    }
    this.nodeId = nodeId;
    this.invokeTimeoutMs = options.invokeTimeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS;
  }

  async httpFetch(url: string, options: NodeEgressHttpFetchOptions = {}): Promise<Record<string, any>> {
    const params: Record<string, any> = {
      url,
      method: options.method ?? 'GET',
      headers: options.headers ?? {},
      maxBytes: options.maxBytes ?? DEFAULT_MAX_HTTP_BYTES,
      chunkBytes: DEFAULT_CHUNK_BYTES,
    };
    if (options.body !== undefined && options.body !== null) {
      params.bodyBase64 = Buffer.isBuffer(options.body)
        ? b64Encode(options.body)
        : b64Encode(Buffer.from(options.body as any));
    }
    return await this.invoke(EGRESS_HTTP_FETCH_COMMAND, params);
  }

  async tcpOpen(host: string, port: number): Promise<string> {
    const payload = await this.invoke(EGRESS_TCP_OPEN_COMMAND, { host, port });
    const connId = payload.connId;
    if (typeof connId !== 'string' || !connId) {
      throw new EgressProtocolError('tcp.open response missing connId');
    }
    return connId;
  }

  async tcpWrite(connId: string, data: Buffer | Uint8Array | string): Promise<number> {
    const buffer = Buffer.isBuffer(data)
      ? data
      : Buffer.from(typeof data === 'string' ? data : (data as Uint8Array));
    const chunks: string[] = [];
    for (let offset = 0; offset < buffer.length; offset += MAX_CHUNK_BYTES) {
      chunks.push(b64Encode(buffer.subarray(offset, offset + MAX_CHUNK_BYTES)));
    }
    const payload = await this.invoke(EGRESS_TCP_WRITE_COMMAND, {
      connId,
      dataBase64Chunks: chunks,
    });
    return Number(payload.writtenBytes || 0);
  }

  async tcpRead(
    connId: string,
    options: { maxBytes?: number; waitMs?: number } = {},
  ): Promise<{ data: Buffer; closed: boolean }> {
    const payload = await this.invoke(EGRESS_TCP_READ_COMMAND, {
      connId,
      maxBytes: options.maxBytes ?? DEFAULT_TCP_READ_BYTES,
      waitMs: options.waitMs ?? DEFAULT_TCP_READ_WAIT_MS,
    });
    const chunks = payload.dataBase64Chunks;
    if (!Array.isArray(chunks)) {
      throw new EgressProtocolError('tcp.read response missing dataBase64Chunks');
    }
    const data = Buffer.concat(chunks.map((chunk) => b64Decode(chunk, 'dataBase64Chunks[]')));
    return { data, closed: payload.closed === true };
  }

  async tcpClose(connId: string): Promise<void> {
    await this.invoke(EGRESS_TCP_CLOSE_COMMAND, { connId });
  }

  async invoke(command: string, params: Record<string, any>): Promise<Record<string, any>> {
    const response = await this.gateway.nodeInvoke(this.nodeId, command, params, this.invokeTimeoutMs);
    const payload = payloadFromNodeResponse(response);
    if (payload.ok === false) {
      const message = payload.error ?? payload.message ?? 'egress command failed';
      throw new EgressProtocolError(typeof message === 'string' ? message : JSON.stringify(message));
    }
    return payload;
  }
}

function parseHttpHeaders(lines: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of lines) {
    if (!line || !line.includes(':')) continue;
    const index = line.indexOf(':');
    headers[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return headers;
}

function parseConnectTarget(target: string): { host: string; port: number } {
  const raw = target.trim();
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    if (end < 0 || end + 2 > raw.length || raw[end + 1] !== ':') {
      throw new Error('CONNECT target must be host:port');
    }
    return { host: raw.slice(1, end), port: normalizePort(raw.slice(end + 2)) };
  }
  const index = raw.lastIndexOf(':');
  if (index < 0) {
    throw new Error('CONNECT target must be host:port');
  }
  return { host: normalizeHost(raw.slice(0, index)), port: normalizePort(raw.slice(index + 1)) };
}

function writeSimpleResponse(socket: net.Socket, status: number, body: Buffer): void {
  socket.write(
    Buffer.concat([
      Buffer.from(
        `HTTP/1.1 ${status} Error\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`,
        'ascii',
      ),
      body,
    ]),
  );
}

export interface LoopbackNodeProxyOptions {
  host?: string;
  port?: number;
}

/**
 * Small loopback HTTP proxy using an egress node.
 *
 * Absolute-form HTTP requests are relayed through `egress.http.fetch`.
 * `CONNECT host:port` creates an experimental polling TCP tunnel through
 * `egress.tcp.*`. Bind remains loopback by default and node id is explicit.
 */
export class LoopbackNodeProxy {
  readonly egress: NodeEgressClient;
  readonly host: string;
  private readonly requestedPort: number;
  private server: net.Server | null = null;

  constructor(egress: NodeEgressClient, options: LoopbackNodeProxyOptions = {}) {
    const host = options.host ?? '127.0.0.1';
    if (host !== '127.0.0.1' && host !== 'localhost') {
      throw new Error('LoopbackNodeProxy binds to 127.0.0.1/localhost only');
    }
    this.egress = egress;
    this.host = '127.0.0.1';
    this.requestedPort = options.port ?? 0;
  }

  get boundPort(): number {
    const address = this.server?.address();
    if (address && typeof address === 'object') {
      return address.port;
    }
    return this.requestedPort;
  }

  async start(): Promise<void> {
    if (this.server) return;
    this.server = net.createServer((socket) => {
      void this.handleClient(socket).catch(() => {
        socket.destroy();
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.requestedPort, this.host, () => {
        this.server!.off('error', reject);
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  private async handleClient(socket: net.Socket): Promise<void> {
    try {
      const head = await this.readUntilHeaderEnd(socket);
      const requestHead = head.toString('latin1');
      const lines = requestHead.split('\r\n');
      const [method, target, _version] = lines[0].split(' ');
      const headers = parseHttpHeaders(lines.slice(1));
      if (!method || !target) {
        writeSimpleResponse(socket, 400, Buffer.from('malformed request line', 'utf8'));
        return;
      }
      if (method.toUpperCase() === 'CONNECT') {
        await this.handleConnect(target, socket);
      } else {
        await this.handleHttp(method, target, headers, socket);
      }
    } catch (error) {
      if (!socket.destroyed) {
        writeSimpleResponse(
          socket,
          502,
          Buffer.from(`proxy error: ${error instanceof Error ? error.message : String(error)}`, 'utf8'),
        );
      }
    } finally {
      if (!socket.destroyed) {
        socket.end();
      }
    }
  }

  private readUntilHeaderEnd(socket: net.Socket): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      let buffered = Buffer.alloc(0);
      const onData = (chunk: Buffer) => {
        buffered = Buffer.concat([buffered, chunk]);
        const end = buffered.indexOf('\r\n\r\n');
        if (end >= 0) {
          cleanup();
          const head = buffered.subarray(0, end + 2);
          const rest = buffered.subarray(end + 4);
          if (rest.length) socket.unshift(rest);
          resolve(Buffer.from(head));
        }
      };
      const onEnd = () => {
        cleanup();
        reject(new Error('client closed before headers completed'));
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        socket.off('data', onData);
        socket.off('end', onEnd);
        socket.off('error', onError);
      };
      socket.on('data', onData);
      socket.on('end', onEnd);
      socket.on('error', onError);
    });
  }

  private async handleHttp(
    method: string,
    target: string,
    headers: Record<string, string>,
    socket: net.Socket,
  ): Promise<void> {
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
      writeSimpleResponse(socket, 400, Buffer.from('absolute-form URL required', 'utf8'));
      return;
    }
    const body = await this.readProxyRequestBody(socket, headers);
    const payload = await this.egress.httpFetch(target, { method, headers, body });
    const status = Number(payload.status) || 502;
    const responseHeaders =
      payload.headers && typeof payload.headers === 'object'
        ? (payload.headers as Record<string, string>)
        : {};
    const bodyChunks = Array.isArray(payload.bodyBase64Chunks) ? payload.bodyBase64Chunks : [];
    const bodyBytes = Buffer.concat(
      bodyChunks.map((chunk: unknown) => b64Decode(chunk, 'bodyBase64Chunks[]')),
    );
    const head = [`HTTP/1.1 ${status} OK`];
    for (const [key, value] of Object.entries(responseHeaders)) {
      if (key.toLowerCase() !== 'content-length') {
        head.push(`${key}: ${value}`);
      }
    }
    head.push(`Content-Length: ${bodyBytes.length}`);
    head.push('Connection: close');
    const responseData = Buffer.concat([Buffer.from(`${head.join('\r\n')}\r\n\r\n`, 'latin1'), bodyBytes]);
    await new Promise<void>((resolve, reject) => {
      if (socket.destroyed || socket.writableEnded) {
        resolve();
        return;
      }
      socket.write(responseData, (error) => (error ? reject(error) : resolve()));
    });
  }

  private async readProxyRequestBody(
    socket: net.Socket,
    headers: Record<string, string>,
  ): Promise<Buffer | null> {
    const lengthRaw = Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-length')?.[1];
    if (!lengthRaw) return null;
    const length = Number(lengthRaw);
    if (!Number.isInteger(length)) {
      throw new Error('invalid content-length');
    }
    if (length < 0 || length > MAX_HTTP_BYTES) {
      throw new Error('request body too large');
    }
    if (!length) return Buffer.alloc(0);
    return await new Promise<Buffer>((resolve, reject) => {
      let buffered = Buffer.alloc(0);
      const onData = (chunk: Buffer) => {
        buffered = Buffer.concat([buffered, chunk]);
        if (buffered.length >= length) {
          cleanup();
          const body = buffered.subarray(0, length);
          const rest = buffered.subarray(length);
          if (rest.length) socket.unshift(rest);
          resolve(Buffer.from(body));
        }
      };
      const onEnd = () => {
        cleanup();
        reject(new Error('client closed before request body completed'));
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        socket.off('data', onData);
        socket.off('end', onEnd);
        socket.off('error', onError);
      };
      socket.on('data', onData);
      socket.on('end', onEnd);
      socket.on('error', onError);
    });
  }

  private async handleConnect(target: string, socket: net.Socket): Promise<void> {
    const { host, port } = parseConnectTarget(target);
    const connId = await this.egress.tcpOpen(host, port);
    socket.write(Buffer.from('HTTP/1.1 200 Connection Established\r\n\r\n', 'ascii'));
    let stopped = false;

    const upload = async () => {
      try {
        await new Promise<void>((resolve) => {
          // Serialize tcpWrite calls so chunk order is preserved.
          let chain: Promise<void> = Promise.resolve();
          const onData = (chunk: Buffer) => {
            chain = chain
              .then(() => this.egress.tcpWrite(connId, chunk))
              .then(() => undefined)
              .catch(() => {
                socket.destroy();
              });
          };
          const onEnd = () => {
            cleanup();
            resolve();
          };
          const onError = () => {
            cleanup();
            resolve();
          };
          const cleanup = () => {
            socket.off('data', onData);
            socket.off('end', onEnd);
            socket.off('error', onError);
          };
          socket.on('data', onData);
          socket.on('end', onEnd);
          socket.on('error', onError);
        });
      } finally {
        stopped = true;
      }
    };

    const download = async () => {
      try {
        while (!stopped) {
          const { data, closed } = await this.egress.tcpRead(connId);
          if (data.length && !socket.destroyed) {
            socket.write(data);
          }
          if (closed) break;
        }
      } finally {
        stopped = true;
      }
    };

    try {
      await Promise.all([upload(), download()]);
    } finally {
      await this.egress.tcpClose(connId).catch(() => undefined);
    }
  }
}

// Compatibility aliases for the first prototype naming. Prefer NodeEgress* for
// the portable contract shared by Python, native macOS/Android nodes, and TS.
export const EgressCommandHandlers = NodeEgressCommandHandlers;
export const EgressNodeServer = NodeEgressServer;
export const EgressNodeClient = NodeEgressClient;
