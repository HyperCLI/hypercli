/**
 * Keyed connection pool for {@link CodingAgentAcpClient}.
 *
 * Callers choose keys for connections they want to share (for example, an
 * agent ID or an agent/session pair). The pool hands out refcounted leases
 * on a single connected client per key: concurrent `acquire()` calls dedupe onto one
 * in-flight connect, the last `release()` closes the client, and a terminal
 * self-close makes the pool forget the entry so the next `acquire()` dials
 * fresh. Update fan-out across subscribers is handled by
 * `client.addUpdateListener(...)`.
 *
 * Protocol-version awareness: negotiation happens per connection — every key
 * negotiates independently — and the negotiated version is read off the
 * lease's client (`lease.client.negotiatedProtocolVersion`; the client only
 * speaks v2). Pool bookkeeping itself (refcounts, close discipline) is
 * version-agnostic.
 */
import {
  CodingAgentAcpClient,
  CodingAgentAcpConnectionError,
  type CodingAgentAcpConnectOptions,
} from './acp.js';

/** A live hold on a pooled connection. `release()` is idempotent per lease. */
export interface AcpLease {
  client: CodingAgentAcpClient;
  release(): void;
}

interface PoolEntry {
  refs: number;
  client: CodingAgentAcpClient | null;
  /** Removed from the pool map (last release, drop, or terminal self-close). */
  forgotten: boolean;
  promise: Promise<CodingAgentAcpClient>;
  controller: AbortController;
  dispose(): void;
}

export class CodingAgentAcpPool {
  private readonly connect: (
    key: string,
    options?: CodingAgentAcpConnectOptions,
  ) => Promise<CodingAgentAcpClient>;
  private readonly connectOptions?: (key: string) => CodingAgentAcpConnectOptions;
  private readonly entries = new Map<string, PoolEntry>();

  constructor(options: {
    /**
     * Dial one connection for the key. Forward the optional second argument
     * into the dial: its signal cancels pending initialization on pool teardown.
     * Legacy factories that ignore it still have their acquisitions rejected
     * and late clients closed, but must forward it to abort a pending socket.
     */
    connect: (
      key: string,
      options?: CodingAgentAcpConnectOptions,
    ) => Promise<CodingAgentAcpClient>;
    /** Per-key connect options; the pool chains its close bookkeeping into `onClose`. */
    connectOptions?: (key: string) => CodingAgentAcpConnectOptions;
  }) {
    this.connect = options.connect;
    this.connectOptions = options.connectOptions;
  }

  /**
   * Take a lease on the connection for `key`, dialing on first use. All
   * concurrent acquirers share one in-flight connect; each gets its own
   * lease. A terminal client close may redial; explicit pool teardown rejects
   * affected acquisitions instead of silently creating another connection.
   */
  async acquire(key: string): Promise<AcpLease> {
    for (;;) {
      let entry = this.entries.get(key);
      if (entry && (entry.forgotten || entry.client?.closed === true)) {
        this.forget(key, entry);
        entry = undefined;
      }
      if (!entry) {
        entry = this.dial(key);
        this.entries.set(key, entry);
      }
      entry.refs += 1;
      const client = await entry.promise;
      if (entry.controller.signal.aborted) throw entry.controller.signal.reason;
      if (entry.forgotten || client.closed) {
        entry.refs -= 1;
        continue;
      }
      const current = entry;
      let released = false;
      return {
        client,
        release: () => {
          if (released) return;
          released = true;
          this.releaseEntry(key, current);
        },
      };
    }
  }

  /** Live refcounts: per-key when `key` is given, pooled connections otherwise. */
  size(key?: string): number {
    if (key !== undefined) return this.entries.get(key)?.refs ?? 0;
    return this.entries.size;
  }

  /** Force-close the connection for `key` even with live leases and forget it. */
  drop(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    entry.forgotten = true;
    entry.controller.abort(new CodingAgentAcpConnectionError('ACP pool entry dropped'));
    entry.dispose();
    entry.client?.close();
  }

  /**
   * Force-close every connection whose key starts with `prefix` and forget
   * them. Pair with key builders that namespace sub-connections under a
   * parent id (e.g. `agentId` / `agentId#sessionId`) so tearing down the
   * parent reaps the pinned children too.
   */
  dropPrefix(prefix: string): void {
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) this.drop(key);
    }
  }

  /** Drop every pooled connection. */
  close(): void {
    for (const key of [...this.entries.keys()]) this.drop(key);
  }

  private dial(key: string): PoolEntry {
    const entry: PoolEntry = {
      refs: 0,
      client: null,
      forgotten: false,
      promise: null as unknown as Promise<CodingAgentAcpClient>,
      controller: new AbortController(),
      dispose: () => {},
    };
    const base = this.connectOptions?.(key);
    const signal = entry.controller.signal;
    const cancelled = new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    const abort = () => entry.controller.abort(new CodingAgentAcpConnectionError('ACP pool connect aborted'));
    base?.signal?.addEventListener('abort', abort, { once: true });
    entry.dispose = () => base?.signal?.removeEventListener('abort', abort);
    if (base?.signal?.aborted) abort();
    const options: CodingAgentAcpConnectOptions = {
      ...base,
      signal,
      onClose: (event) => {
        this.handleClientClosed(key, entry);
        base?.onClose?.(event);
      },
    };
    const connecting = Promise.resolve().then(() => {
      if (signal.aborted) throw signal.reason;
      return this.connect(key, options);
    }).then((client) => {
      entry.client = client;
      this.wrapClose(key, entry, client);
      if (entry.forgotten || signal.aborted || client.closed) client.close();
      return client;
    });
    entry.promise = Promise.race([connecting, cancelled]).catch((error) => {
      entry.dispose();
      this.forget(key, entry);
      throw error;
    });
    return entry;
  }

  /**
   * `terminate()` runs through `this.close()`, so shadowing it observes every
   * close path — explicit, abort-driven, or a terminal bridge close code —
   * without depending on the consumer threading connectOptions through.
   */
  private wrapClose(key: string, entry: PoolEntry, client: CodingAgentAcpClient): void {
    const original = client.close.bind(client);
    client.close = () => {
      const wasClosed = client.closed;
      original();
      if (!wasClosed) this.handleClientClosed(key, entry);
    };
  }

  private handleClientClosed(key: string, entry: PoolEntry): void {
    if (this.entries.get(key) !== entry) return;
    if (entry.client?.closed !== true) return;
    this.forget(key, entry);
  }

  private releaseEntry(key: string, entry: PoolEntry): void {
    if (entry.forgotten) return;
    entry.refs -= 1;
    if (entry.refs > 0) return;
    this.drop(key);
  }

  private forget(key: string, entry: PoolEntry): void {
    if (this.entries.get(key) !== entry) return;
    this.entries.delete(key);
    entry.forgotten = true;
    entry.dispose();
  }
}
