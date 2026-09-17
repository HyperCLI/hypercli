/**
 * Per-agent connection pool for {@link CodingAgentAcpClient}.
 *
 * Two clients dialed to the same agent through the backend bridge share one
 * underlying stdio session, so every caller must ride one connection instead
 * of dialing its own. The pool hands out refcounted leases on a single
 * connected client per key: concurrent `acquire()` calls dedupe onto one
 * in-flight connect, the last `release()` closes the client, and a terminal
 * self-close makes the pool forget the entry so the next `acquire()` dials
 * fresh. Update fan-out across subscribers is handled by
 * `client.addUpdateListener(...)`.
 */
import {
  CodingAgentAcpClient,
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
     * Dial one connection for the key. When `connectOptions` is also given,
     * the pool passes the wrapped per-key options as an optional second
     * argument — thread them into your dial so `onClose` bookkeeping reaches
     * the wire options; one-argument implementations keep working (the pool
     * detects terminal closes on its own regardless).
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
   * lease. Never resolves with a closed client: a terminal close or a
   * `drop()` racing the acquire makes it redial instead.
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
    entry.client?.close();
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
    };
    const base = this.connectOptions?.(key);
    if (base) {
      const previous = base.onClose;
      base.onClose = (event) => {
        this.handleClientClosed(key, entry);
        previous?.(event);
      };
    }
    entry.promise = Promise.resolve()
      .then(() => this.connect(key, base))
      .then(
        (client) => {
          entry.client = client;
          this.wrapClose(key, entry, client);
          if (entry.forgotten || client.closed) client.close();
          return client;
        },
        (error) => {
          this.forget(key, entry);
          throw error;
        },
      );
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
    this.entries.delete(key);
    entry.forgotten = true;
    // The connect may still be in flight; close once it resolves.
    void entry.promise.then((client) => client.close(), () => {});
  }

  private forget(key: string, entry: PoolEntry): void {
    if (this.entries.get(key) !== entry) return;
    this.entries.delete(key);
    entry.forgotten = true;
  }
}
