import {
  GatewayClient,
  type GatewayOptions,
} from './gateway.js';

export const DEFAULT_OPENCLAW_GATEWAY_MAX_CONNECTIONS = 6;
export const DEFAULT_OPENCLAW_GATEWAY_IDLE_TIMEOUT_MS = 5 * 60_000;

export interface OpenClawGatewayLease {
  readonly client: GatewayClient;
  release(options?: { retain?: boolean }): void;
}

export interface OpenClawGatewayConnectionRequest {
  deploymentId: string;
  launchEpoch: number;
  generation: number;
  options: GatewayOptions;
}

export interface OpenClawGatewayConnectionManagerOptions {
  /** Soft cap for retained clients. Active leases are never evicted. */
  maxConnections?: number;
  idleTimeoutMs?: number;
  clientFactory?: (options: GatewayOptions) => GatewayClient;
}

interface GatewaySubscriber {
  onHello?: GatewayOptions['onHello'];
  onClose?: GatewayOptions['onClose'];
  onGap?: GatewayOptions['onGap'];
  onProtocolError?: GatewayOptions['onProtocolError'];
  onPairing?: GatewayOptions['onPairing'];
}

interface GatewayConnectionEntry {
  key: string;
  deploymentId: string;
  launchEpoch: number;
  gatewayUrl: string;
  client: GatewayClient;
  subscribers: Set<GatewaySubscriber>;
  leaseCount: number;
  discardWhenIdle: boolean;
  closed: boolean;
  lastUsedAt: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

function sortedStrings(values: string[] | undefined): string[] | null {
  return values ? [...values].sort() : null;
}

function connectionProfileKey(request: OpenClawGatewayConnectionRequest): string {
  const { options } = request;
  return JSON.stringify({
    deploymentId: request.deploymentId,
    launchEpoch: request.launchEpoch,
    url: options.url,
    token: options.token ?? null,
    bootstrapToken: options.bootstrapToken ?? null,
    deviceToken: options.deviceToken ?? null,
    password: options.password ?? null,
    approvalRuntimeToken: options.approvalRuntimeToken ?? null,
    agentRuntimeIdentityToken: options.agentRuntimeIdentityToken ?? null,
    apiKey: options.apiKey ?? null,
    apiBase: options.apiBase ?? null,
    autoApprovePairing: options.autoApprovePairing ?? null,
    clientId: options.clientId ?? null,
    clientMode: options.clientMode ?? null,
    clientDisplayName: options.clientDisplayName ?? null,
    clientVersion: options.clientVersion ?? null,
    platform: options.platform ?? null,
    deviceFamily: options.deviceFamily ?? null,
    instanceId: options.instanceId ?? null,
    caps: sortedStrings(options.caps),
    role: options.role ?? null,
    scopes: sortedStrings(options.scopes),
    commands: sortedStrings(options.commands),
    permissions: options.permissions
      ? Object.entries(options.permissions).sort(([left], [right]) => left.localeCompare(right))
      : null,
    pathEnv: options.pathEnv ?? null,
    minProtocol: options.minProtocol ?? null,
    maxProtocol: options.maxProtocol ?? null,
    origin: options.origin ?? null,
    timeout: options.timeout ?? null,
  });
}

function subscriberFromOptions(options: GatewayOptions): GatewaySubscriber {
  return {
    onHello: options.onHello,
    onClose: options.onClose,
    onGap: options.onGap,
    onProtocolError: options.onProtocolError,
    onPairing: options.onPairing,
  };
}

export class OpenClawGatewayConnectionManager {
  private readonly maxConnections: number;
  private readonly idleTimeoutMs: number;
  private readonly clientFactory: (options: GatewayOptions) => GatewayClient;
  private readonly entries = new Map<string, GatewayConnectionEntry>();
  private readonly retiredEntries = new Set<GatewayConnectionEntry>();
  private readonly deploymentGenerations = new Map<string, number>();
  private readonly highestLaunchEpochs = new Map<string, number>();
  private disposed = false;

  constructor(options: OpenClawGatewayConnectionManagerOptions = {}) {
    this.maxConnections = Math.max(1, options.maxConnections ?? DEFAULT_OPENCLAW_GATEWAY_MAX_CONNECTIONS);
    this.idleTimeoutMs = Math.max(0, options.idleTimeoutMs ?? DEFAULT_OPENCLAW_GATEWAY_IDLE_TIMEOUT_MS);
    this.clientFactory = options.clientFactory ?? ((gatewayOptions) => new GatewayClient(gatewayOptions));
  }

  get size(): number {
    return this.entries.size + this.retiredEntries.size;
  }

  generation(deploymentId: string): number {
    return this.deploymentGenerations.get(deploymentId) ?? 0;
  }

  acquireExisting(request: OpenClawGatewayConnectionRequest): OpenClawGatewayLease | null {
    this.assertRequestIsCurrent(request);
    const entry = this.entries.get(connectionProfileKey(request));
    if (!entry || entry.discardWhenIdle) return null;
    return this.createLease(entry, request.options);
  }

  acquire(request: OpenClawGatewayConnectionRequest): OpenClawGatewayLease {
    this.assertRequestIsCurrent(request);
    const highestLaunchEpoch = this.highestLaunchEpochs.get(request.deploymentId) ?? 0;
    if (request.launchEpoch < highestLaunchEpoch) {
      throw new Error(
        `OpenClaw gateway context for ${request.deploymentId} is stale `
        + `(launch epoch ${request.launchEpoch} < ${highestLaunchEpoch})`,
      );
    }
    this.highestLaunchEpochs.set(request.deploymentId, Math.max(highestLaunchEpoch, request.launchEpoch));
    this.invalidateMismatchedContext(request);
    const key = connectionProfileKey(request);
    let entry = this.entries.get(key);
    if (entry?.discardWhenIdle) {
      this.retireEntry(entry);
      entry = undefined;
    }
    if (!entry) {
      entry = this.createEntry(key, request);
      this.entries.set(key, entry);
    }
    return this.createLease(entry, request.options);
  }

  invalidate(deploymentId: string, launchEpoch?: number): void {
    this.deploymentGenerations.set(deploymentId, this.generation(deploymentId) + 1);
    for (const entry of this.allEntries()) {
      if (entry.deploymentId !== deploymentId) continue;
      if (launchEpoch !== undefined && entry.launchEpoch !== launchEpoch) continue;
      this.closeEntry(entry);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.allEntries()) this.closeEntry(entry);
  }

  private createEntry(
    key: string,
    request: OpenClawGatewayConnectionRequest,
  ): GatewayConnectionEntry {
    const subscribers = new Set<GatewaySubscriber>();
    const notify = (run: (subscriber: GatewaySubscriber) => void) => {
      for (const subscriber of subscribers) {
        try {
          run(subscriber);
        } catch {
          // One consumer must not break the shared transport lifecycle.
        }
      }
    };
    const client = this.clientFactory({
      ...request.options,
      onHello: (hello) => notify((subscriber) => subscriber.onHello?.(hello)),
      onClose: (info) => notify((subscriber) => subscriber.onClose?.(info)),
      onGap: (info) => notify((subscriber) => subscriber.onGap?.(info)),
      onProtocolError: (info) => notify((subscriber) => subscriber.onProtocolError?.(info)),
      onPairing: (pairing) => notify((subscriber) => subscriber.onPairing?.(pairing)),
    });
    return {
      key,
      deploymentId: request.deploymentId,
      launchEpoch: request.launchEpoch,
      gatewayUrl: request.options.url,
      client,
      subscribers,
      leaseCount: 0,
      discardWhenIdle: false,
      closed: false,
      lastUsedAt: Date.now(),
      idleTimer: null,
    };
  }

  private createLease(entry: GatewayConnectionEntry, options: GatewayOptions): OpenClawGatewayLease {
    if (entry.idleTimer !== null) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
    if (options.gatewayToken !== undefined) entry.client.setGatewayToken(options.gatewayToken);
    const subscriber = subscriberFromOptions(options);
    entry.subscribers.add(subscriber);
    entry.leaseCount += 1;
    entry.lastUsedAt = Date.now();
    this.evictOverflow(entry.key);

    let released = false;
    return {
      client: entry.client,
      release: (releaseOptions = {}) => {
        if (released) return;
        released = true;
        entry.subscribers.delete(subscriber);
        entry.leaseCount = Math.max(0, entry.leaseCount - 1);
        if (entry.closed) return;
        if (releaseOptions.retain === false) entry.discardWhenIdle = true;
        entry.lastUsedAt = Date.now();
        if (entry.discardWhenIdle && entry.leaseCount > 0) {
          this.retireEntry(entry);
          return;
        }
        if (entry.leaseCount > 0) return;
        if (entry.discardWhenIdle) {
          this.closeEntry(entry);
          return;
        }
        if (this.entries.get(entry.key) !== entry) return;
        this.scheduleIdleClose(entry);
        this.evictOverflow();
      },
    };
  }

  private scheduleIdleClose(entry: GatewayConnectionEntry): void {
    if (this.idleTimeoutMs === 0) {
      this.closeEntry(entry);
      return;
    }
    entry.idleTimer = setTimeout(() => {
      entry.idleTimer = null;
      if (entry.leaseCount === 0) this.closeEntry(entry);
    }, this.idleTimeoutMs);
    (entry.idleTimer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  }

  private evictOverflow(excludedKey?: string): void {
    while (this.entries.size > this.maxConnections) {
      const candidate = [...this.entries.values()]
        .filter((entry) => entry.key !== excludedKey && entry.leaseCount === 0)
        .sort((left, right) => left.lastUsedAt - right.lastUsedAt)[0];
      if (!candidate) return;
      this.closeEntry(candidate);
    }
  }

  private invalidateMismatchedContext(request: OpenClawGatewayConnectionRequest): void {
    for (const entry of this.allEntries()) {
      if (entry.deploymentId !== request.deploymentId) continue;
      if (entry.launchEpoch === request.launchEpoch && entry.gatewayUrl === request.options.url) continue;
      this.closeEntry(entry);
    }
  }

  private assertRequestIsCurrent(request: OpenClawGatewayConnectionRequest): void {
    if (this.disposed) throw new Error('OpenClaw gateway connection manager is disposed');
    if (request.generation !== this.generation(request.deploymentId)) {
      throw new Error(`OpenClaw gateway acquisition for ${request.deploymentId} was invalidated`);
    }
  }

  private closeEntry(entry: GatewayConnectionEntry): void {
    if (entry.closed) return;
    entry.closed = true;
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
    this.retiredEntries.delete(entry);
    if (entry.idleTimer !== null) clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
    entry.subscribers.clear();
    entry.client.close();
  }

  private retireEntry(entry: GatewayConnectionEntry): void {
    if (entry.closed) return;
    entry.discardWhenIdle = true;
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
    if (entry.leaseCount === 0) {
      this.closeEntry(entry);
      return;
    }
    this.retiredEntries.add(entry);
  }

  private allEntries(): GatewayConnectionEntry[] {
    return [...this.entries.values(), ...this.retiredEntries];
  }
}
