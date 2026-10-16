/** Product policy v1, matching agents/shared/protocol/session_policy.py. Not ACP. */
export type SessionPolicyMode = 'ask' | 'auto' | 'none';
export interface SessionPolicyTarget { sessionId: string; agentId: string }
export interface SessionPolicyDesired { mode: SessionPolicyMode; revision: number }
export interface SessionPolicyApplied {
  status: 'pending' | 'applied' | 'unsupported' | 'unavailable' | 'failed';
  mode?: SessionPolicyMode | null;
  revision?: number | null;
  runtime_generation?: string | null;
  binding_id?: string | null;
}
export interface SessionPolicySnapshot {
  type: 'session.policy.snapshot' | 'session.policy.changed' | 'session.policy.applied';
  session_id: string;
  agent_id: string;
  request_id?: string | null;
  origin?: string | null;
  desired: SessionPolicyDesired;
  applied: SessionPolicyApplied;
}
export interface SessionPolicyResult {
  type: 'session.policy.result';
  request_id: string;
  origin: string;
  outcome: 'accepted' | 'conflict' | 'forbidden' | 'storage_unavailable' | 'invalid' | 'unavailable';
}
/** Content-free host observation forwarded by the product channel; never actionable. */
export interface SessionPolicyResolution {
  type: 'session.policy.result';
  session_id: string;
  agent_id: string;
  resolution_id: string;
  revision: number;
  runtime_generation: string;
  binding_id: string;
  origin: string;
  outcome: 'allowed' | 'rejected' | 'cancelled' | 'retired';
  actionable: false;
}
export type SessionPolicyRequest = {
  type: 'session.policy.subscribe'; request_id: string; session_id: string; agent_id: string;
} | {
  type: 'session.policy.set'; request_id: string; session_id: string; agent_id: string;
  mode: SessionPolicyMode; expected_revision: number;
};
export type SessionPolicyEvent = SessionPolicySnapshot | SessionPolicyResult | SessionPolicyResolution;

export class SessionPolicyError extends Error {
  constructor(public readonly code: string, message: string, public readonly snapshot?: SessionPolicySnapshot,
    public readonly closeCode?: number) {
    super(message);
    this.name = 'SessionPolicyError';
  }
}
export interface SessionPolicySocket {
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: any) => void): void;
  removeEventListener(type: string, listener: (event: any) => void): void;
}
export interface SessionPolicyObservers {
  onSnapshot?: (snapshot: SessionPolicySnapshot) => void;
  onResolution?: (event: SessionPolicyResolution) => void;
  onError?: (error: SessionPolicyError) => void;
}
export interface SessionPolicyConnectOptions {
  /** Explicit URL is preserved, for app bridges and custom transports. */
  url: string;
  /** Product credential; added as the backend's supported token query parameter. */
  token?: string;
  signal?: AbortSignal;
  createWebSocket?: (url: string) => SessionPolicySocket;
  createRequestId?: () => string;
  timeoutMs?: number;
  reconnectDelaysMs?: readonly number[];
  onError?: (error: SessionPolicyError) => void;
}
export type SessionPolicyConnectionOverrides = Partial<SessionPolicyConnectOptions>;
export interface SessionPolicyWaitOptions {
  revision: number;
  runtimeGeneration: string;
  bindingId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}
interface PendingRequest {
  target: SessionPolicyTarget;
  accept(snapshot: SessionPolicySnapshot): void;
  reject(error: SessionPolicyError): void;
}
interface Entry {
  target: SessionPolicyTarget;
  subscribers: Set<SessionPolicySubscription>;
  snapshot?: SessionPolicySnapshot;
  fresh: boolean;
}
function key(target: SessionPolicyTarget): string { return JSON.stringify([target.sessionId, target.agentId]); }
function observe<T>(listener: ((value: T) => void) | undefined, value: T): void {
  try { void Promise.resolve(listener?.(value)).catch(() => {}); } catch { /* Observers do not own settlement. */ }
}
function failure(code: string): SessionPolicyError { return new SessionPolicyError(code, `Session policy ${code.replaceAll('_', ' ')}`); }

/** One caller's hold on a shared (public session, agent participant) subscription. */
export class SessionPolicySubscription {
  private closed = false;
  private readonly mutations = new Set<AbortController>();
  private readonly waiters = new Set<{ check(): void; reject(error: SessionPolicyError): void }>();
  constructor(private readonly client: SessionPolicyClient, private readonly entry: Entry,
    private readonly observers: SessionPolicyObservers) {}

  /** Last observation; fresh=false means reconnect has not reconciled it yet. */
  get snapshot(): SessionPolicySnapshot | undefined { return this.entry.snapshot; }
  get fresh(): boolean { return this.entry.fresh && !this.closed; }
  async set(mode: SessionPolicyMode, options: { expectedRevision: number; signal?: AbortSignal }): Promise<SessionPolicySnapshot> {
    if (this.closed) throw failure('closed');
    const controller = new AbortController();
    const abort = () => controller.abort();
    this.mutations.add(controller);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    try { return await this.client.set(this.entry.target, mode, { ...options, signal: controller.signal }); }
    finally { this.mutations.delete(controller); options.signal?.removeEventListener('abort', abort); }
  }
  /** Observe host evidence only. Never apply policy or answer ACP permission requests locally. */
  waitApplied(options: SessionPolicyWaitOptions): Promise<SessionPolicySnapshot> {
    if (this.closed) return Promise.reject(failure('closed'));
    return new Promise((resolve, reject) => {
      const finish = (error?: SessionPolicyError, snapshot?: SessionPolicySnapshot) => {
        clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
        this.waiters.delete(waiter);
        if (error) reject(error); else resolve(snapshot!);
      };
      const waiter = {
        reject: (error: SessionPolicyError) => finish(error),
        check: () => {
          const snapshot = this.snapshot;
          if (!this.fresh || !snapshot) return;
          const { desired, applied } = snapshot;
          if (desired.revision > options.revision) return finish(new SessionPolicyError('superseded', 'Session policy revision superseded', snapshot));
          if (desired.revision < options.revision) return;
          if (applied.status === 'unsupported' || applied.status === 'failed' || applied.status === 'unavailable') {
            return finish(new SessionPolicyError(applied.status, `Session policy host ${applied.status}`, snapshot));
          }
          if (applied.runtime_generation !== options.runtimeGeneration || applied.binding_id !== options.bindingId) {
            return finish(new SessionPolicyError('superseded', 'Session policy runtime binding superseded', snapshot));
          }
          if (applied.status === 'applied' && applied.revision === options.revision && applied.mode === desired.mode) finish(undefined, snapshot);
        },
      };
      const abort = () => finish(failure('aborted'));
      const timer = setTimeout(() => finish(failure('timeout')), options.timeoutMs ?? this.client.timeoutMs);
      this.waiters.add(waiter);
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort(); else waiter.check();
    });
  }
  /** Local unsubscribe. The current server protocol releases its subscriptions on socket close. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.fail(failure('closed'));
    for (const controller of this.mutations) controller.abort(failure('closed'));
    this.mutations.clear();
    this.client.release(this.entry, this);
  }
  /** @internal */
  changed(snapshot: SessionPolicySnapshot): void {
    if (this.closed) return;
    for (const waiter of this.waiters) waiter.check();
    observe(this.observers.onSnapshot, snapshot);
  }
  /** @internal */
  resolution(event: SessionPolicyResolution): void { if (!this.closed) observe(this.observers.onResolution, event); }
  /** @internal */
  error(error: SessionPolicyError): void { if (!this.closed) observe(this.observers.onError, error); }
  /** @internal */
  fail(error: SessionPolicyError): void { for (const waiter of this.waiters) waiter.reject(error); }
}

/** Multiplexed product channel. Reconnect re-subscribes; mutations are never replayed. */
export class SessionPolicyClient {
  readonly timeoutMs: number;
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, PendingRequest>();
  private socket: SessionPolicySocket | null = null;
  private disposeSocket: (() => void) | null = null;
  private connected = false;
  private closed = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private failures = 0;
  private readonly abort = () => this.close();
  private constructor(private readonly options: SessionPolicyConnectOptions) { this.timeoutMs = options.timeoutMs ?? 15_000; }

  static async connect(options: SessionPolicyConnectOptions): Promise<SessionPolicyClient> {
    const client = new SessionPolicyClient(options);
    if (options.signal?.aborted) throw failure('aborted');
    options.signal?.addEventListener('abort', client.abort, { once: true });
    try { await client.open(); return client; }
    catch (error) { client.close(); throw error; }
  }
  async subscribe(target: SessionPolicyTarget, observers: SessionPolicyObservers = {}): Promise<SessionPolicySubscription> {
    if (this.closed) throw failure('closed');
    let entry = this.entries.get(key(target));
    if (!entry) {
      entry = { target: { ...target }, subscribers: new Set(), fresh: false };
      this.entries.set(key(target), entry);
    }
    const subscription = new SessionPolicySubscription(this, entry, observers);
    entry.subscribers.add(subscription);
    try {
      if (entry.fresh && entry.snapshot) subscription.changed(entry.snapshot);
      else await this.request(target, { type: 'session.policy.subscribe' });
      return subscription;
    } catch (error) { subscription.close(); throw error; }
  }
  /** Returns the correlated server snapshot, not an application acknowledgement. */
  set(target: SessionPolicyTarget, mode: SessionPolicyMode,
    options: { expectedRevision: number; signal?: AbortSignal }): Promise<SessionPolicySnapshot> {
    return this.request(target, { type: 'session.policy.set', mode, expected_revision: options.expectedRevision }, options.signal);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.options.signal?.removeEventListener('abort', this.abort);
    clearTimeout(this.reconnectTimer);
    this.disconnect(failure('closed'));
    for (const entry of this.entries.values()) for (const subscriber of entry.subscribers) subscriber.close();
    this.entries.clear();
  }
  /** @internal */
  release(entry: Entry, subscription: SessionPolicySubscription): void {
    entry.subscribers.delete(subscription);
    if (!entry.subscribers.size && this.entries.get(key(entry.target)) === entry) this.entries.delete(key(entry.target));
  }
  private report(error: SessionPolicyError): void {
    observe(this.options.onError, error);
    for (const entry of this.entries.values()) for (const subscriber of entry.subscribers) subscriber.error(error);
  }
  private request(target: SessionPolicyTarget,
    body: { type: 'session.policy.subscribe' } | { type: 'session.policy.set'; mode: SessionPolicyMode; expected_revision: number },
    signal?: AbortSignal): Promise<SessionPolicySnapshot> {
    if (this.closed || !this.connected || !this.socket) return Promise.reject(failure(this.closed ? 'closed' : 'disconnected'));
    if (signal?.aborted) return Promise.reject(failure('aborted'));
    const requestId = this.options.createRequestId?.() ?? globalThis.crypto.randomUUID();
    if (this.pending.has(requestId)) return Promise.reject(failure('duplicate_request_id'));
    return new Promise((resolve, reject) => {
      const finish = (error?: SessionPolicyError, snapshot?: SessionPolicySnapshot) => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort); this.pending.delete(requestId);
        if (error) reject(error); else resolve(snapshot!);
      };
      const abort = () => finish(signal?.reason instanceof SessionPolicyError ? signal.reason : failure('aborted'));
      const timer = setTimeout(() => finish(failure('timeout')), this.timeoutMs);
      this.pending.set(requestId, { target, accept: snapshot => finish(undefined, snapshot), reject: error => finish(error) });
      signal?.addEventListener('abort', abort, { once: true });
      try {
        this.socket!.send(JSON.stringify({ ...body, request_id: requestId, session_id: target.sessionId, agent_id: target.agentId }));
      } catch { finish(failure('send_failed')); }
    });
  }
  private receive(data: unknown): void {
    let event: SessionPolicyEvent;
    try {
      event = JSON.parse(String(data)) as SessionPolicyEvent;
      if (!event || typeof event !== 'object' || typeof event.type !== 'string') throw failure('invalid_frame');
      if (event.type === 'session.policy.result') {
        if ('request_id' in event) {
          if (!['accepted', 'conflict', 'forbidden', 'storage_unavailable', 'invalid', 'unavailable'].includes(event.outcome)) throw failure('invalid_frame');
          if (event.outcome !== 'accepted') this.pending.get(event.request_id)?.reject(failure(event.outcome));
        } else {
          const entry = this.entries.get(key({ sessionId: event.session_id, agentId: event.agent_id }));
          if (event.actionable === false) for (const subscriber of entry?.subscribers ?? []) subscriber.resolution(event);
        }
        return;
      }
      if (!['session.policy.snapshot', 'session.policy.changed', 'session.policy.applied'].includes(event.type)) return;
      const snapshot = event as SessionPolicySnapshot;
      if (!snapshot.desired || !snapshot.applied || typeof snapshot.desired.revision !== 'number') throw failure('invalid_frame');
      const target = { sessionId: snapshot.session_id, agentId: snapshot.agent_id };
      const entry = this.entries.get(key(target));
      if (entry) {
        const changed = !entry.snapshot || snapshot.desired.revision >= entry.snapshot.desired.revision;
        if (changed) entry.snapshot = snapshot;
        // A reconnect needs its subscription snapshot barrier, even if a concurrent
        // broadcast arrived first. Never regress the desired revision at that barrier.
        if (snapshot.type === 'session.policy.snapshot') entry.fresh = true;
        if (entry.fresh && entry.snapshot && (changed || snapshot.type === 'session.policy.snapshot')) {
          for (const subscriber of entry.subscribers) subscriber.changed(entry.snapshot);
        }
      }
      // Broadcasts carry the originator's request ID too; only the direct snapshot settles a request.
      if (snapshot.type === 'session.policy.snapshot' && snapshot.request_id) {
        const pending = this.pending.get(snapshot.request_id);
        if (pending && key(pending.target) === key(target)) pending.accept(snapshot);
      }
    } catch { this.report(failure('invalid_frame')); }
  }
  private disconnect(error: SessionPolicyError): void {
    this.connected = false;
    this.disposeSocket?.(); this.disposeSocket = null;
    const socket = this.socket; this.socket = null;
    try { socket?.close(); } catch { /* Already failed. */ }
    for (const pending of this.pending.values()) pending.reject(error);
    for (const entry of this.entries.values()) entry.fresh = false;
  }
  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      let opened = false, settled = false;
      const fail = (error: SessionPolicyError, code?: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.disconnect(error);
        if (!opened) reject(error);
        else { this.report(error); this.reconnect(code); }
      };
      const timer = setTimeout(() => fail(failure('connect_timeout')), this.timeoutMs);
      try {
        const url = new URL(this.options.url);
        if (this.options.token !== undefined) url.searchParams.set('token', this.options.token);
        const create = this.options.createWebSocket ?? (url => new globalThis.WebSocket(url));
        const socket = create(url.toString());
        this.socket = socket;
        const onOpen = () => {
          if (settled || this.closed) return;
          opened = true; this.connected = true;
          clearTimeout(timer); resolve();
        };
        const onMessage = (event: { data: unknown }) => { if (!settled && this.socket === socket) this.receive(event.data); };
        const onError = () => fail(failure('transport_failed'));
        const onClose = (event: { code?: number }) => fail(new SessionPolicyError(
          'transport_closed', `Session policy transport closed (${event.code ?? 1006})`, undefined, event.code ?? 1006,
        ), event.code);
        const listeners = { open: onOpen, message: onMessage, error: onError, close: onClose };
        for (const [type, listener] of Object.entries(listeners)) socket.addEventListener(type, listener);
        this.disposeSocket = () => {
          for (const [type, listener] of Object.entries(listeners)) socket.removeEventListener(type, listener);
          clearTimeout(timer);
          if (!opened && !settled) { settled = true; reject(failure('closed')); }
        };
      } catch { fail(failure('connect_failed')); }
    });
  }
  private reconnect(code?: number): void {
    if (this.closed) return;
    const delays = this.options.reconnectDelaysMs ?? [1000, 2000, 4000];
    if ((code !== undefined && [4400, 4401, 4403, 4404].includes(code)) || this.failures >= delays.length) {
      const error = failure('disconnected');
      for (const entry of this.entries.values()) for (const subscriber of entry.subscribers) subscriber.fail(error);
      this.close(); return;
    }
    this.reconnectTimer = setTimeout(() => {
      void this.open().then(async () => {
        const socket = this.socket;
        try {
          await Promise.all([...this.entries.values()].map(entry => this.request(entry.target, { type: 'session.policy.subscribe' })));
          this.failures = 0;
        } catch (error) {
          if (this.closed || socket !== this.socket) return;
          this.report(error instanceof SessionPolicyError ? error : failure('reconnect_failed'));
          this.disconnect(failure('disconnected')); this.reconnect();
        }
      }, error => this.reconnect(error instanceof SessionPolicyError ? error.closeCode : undefined));
    }, delays[this.failures++]);
  }
}
