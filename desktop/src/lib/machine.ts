/**
 * The state-machine primitive every connection in this app is built on.
 *
 * See FSM.md for why. In short: connections used to be owned by `useEffect`
 * closures with ad-hoc `cancelled` booleans, nonce counters and inline
 * `setTimeout` retries. That produced a reconnect storm, two sockets per agent,
 * an orphaned log socket, and panels that could not tell "empty" from "broken".
 *
 * This module is deliberately dependency-free and React-free so machines can be
 * tested in plain node against {@link FakeClock} — no jsdom, no fake timers.
 * React bindings live in `use-machine.ts`. The machines themselves live in
 * `fsm.ts` (one global session machine) and `agentFsm.ts` (one per agent).
 */

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

export type TimerHandle = number;

/** Injectable time, so backoff and deadlines are testable without waiting. */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as TimerHandle,
  clearTimeout: (handle) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>),
};

/** Deterministic clock for tests. `advance` fires due timers in scheduled order. */
export class FakeClock implements Clock {
  private current = 0;
  private nextHandle = 1;
  private readonly timers = new Map<TimerHandle, { at: number; seq: number; fn: () => void }>();
  private seq = 0;

  now(): number {
    return this.current;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const handle = this.nextHandle++;
    this.timers.set(handle, { at: this.current + Math.max(0, ms), seq: this.seq++, fn });
    return handle;
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handle);
  }

  /** Advance time, running every timer that comes due (including ones they schedule). */
  advance(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, t]) => t.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[1].seq - b[1].seq)[0];
      if (!due) break;
      const [handle, timer] = due;
      this.timers.delete(handle);
      this.current = Math.max(this.current, timer.at);
      timer.fn();
    }
    this.current = target;
  }

  get pending(): number {
    return this.timers.size;
  }
}

// ---------------------------------------------------------------------------
// AttemptSlot — the async-attempt guard
// ---------------------------------------------------------------------------

export interface Attempt {
  readonly id: number;
  readonly signal: AbortSignal;
  /** False once superseded or cancelled. Check before every state mutation. */
  readonly active: boolean;
}

/**
 * At most one in-flight operation. `begin()` aborts its predecessor rather than
 * abandoning it, which is the difference between "supersede" and the
 * abandon-and-restart pattern that leaked sockets.
 */
export class AttemptSlot {
  private nextId = 1;
  private slot: { id: number; controller: AbortController; active: boolean } | null = null;

  begin(): Attempt {
    this.cancel();
    const entry = { id: this.nextId++, controller: new AbortController(), active: true };
    this.slot = entry;
    return {
      id: entry.id,
      signal: entry.controller.signal,
      get active() {
        return entry.active;
      },
    };
  }

  get current(): Attempt | null {
    const entry = this.slot;
    if (!entry) return null;
    return {
      id: entry.id,
      signal: entry.controller.signal,
      get active() {
        return entry.active;
      },
    };
  }

  /** True when `attempt` is still the live one. Accepts an id for convenience. */
  owns(attempt: Attempt | number | null | undefined): boolean {
    if (attempt === null || attempt === undefined) return false;
    const id = typeof attempt === "number" ? attempt : attempt.id;
    return this.slot?.active === true && this.slot.id === id;
  }

  /** Idempotent. Safe to call mid-connect: consumers honour the signal. */
  cancel(reason?: unknown): void {
    const entry = this.slot;
    if (!entry) return;
    this.slot = null;
    entry.active = false;
    try {
      entry.controller.abort(reason);
    } catch {
      // An already-aborted controller is not an error.
    }
  }
}

// ---------------------------------------------------------------------------
// Backoff — pure, timer-free
// ---------------------------------------------------------------------------

export interface BackoffOptions {
  base: number;
  max: number;
  /** Growth per failure. Default 2. */
  factor?: number;
  /** Fraction of the delay applied as random jitter, 0..1. Default 0. */
  jitter?: number;
  /** Injectable randomness so jitter is testable. */
  random?: () => number;
}

/**
 * Owned by the machine, never by the caller. Every path out of a connection
 * consults it — the reconnect storm happened because one path did not.
 */
export class Backoff {
  private attempts = 0;
  private readonly base: number;
  private readonly max: number;
  private readonly factor: number;
  private readonly jitter: number;
  private readonly random: () => number;

  constructor(options: BackoffOptions) {
    this.base = Math.max(1, options.base);
    this.max = Math.max(this.base, options.max);
    this.factor = options.factor ?? 2;
    this.jitter = Math.min(1, Math.max(0, options.jitter ?? 0));
    this.random = options.random ?? Math.random;
  }

  /** How many delays have been handed out since the last reset. */
  get failures(): number {
    return this.attempts;
  }

  /** The next delay without consuming it. */
  peek(): number {
    const raw = this.base * this.factor ** this.attempts;
    return Math.min(this.max, Math.round(raw));
  }

  /** Advance and return the delay to wait. Never below `base`. */
  next(): number {
    const delay = this.peek();
    this.attempts += 1;
    if (this.jitter === 0) return delay;
    const spread = delay * this.jitter;
    return Math.max(this.base, Math.round(delay - spread / 2 + this.random() * spread));
  }

  reset(): void {
    this.attempts = 0;
  }
}

// ---------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------

export type StateShape = { readonly name: string };
export type EventShape = { readonly type: string };

/** Exhaustiveness check for `switch` over a discriminated union. */
export function assertNever(value: never, message = "Unhandled variant"): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}

export interface Disposable {
  dispose(): void;
}

/**
 * A machine owns one piece of async work and the state around it.
 *
 * Subclasses implement {@link reduce} and call {@link commit} to move state.
 * Side effects belong in {@link onEnter} / {@link onExit} or in `reduce` guarded
 * by `this.slot.owns(...)` — never in a component.
 */
export abstract class Machine<S extends StateShape, E extends EventShape> implements Disposable {
  protected readonly slot = new AttemptSlot();
  protected readonly clock: Clock;

  private currentState: S;
  private readonly listeners = new Set<() => void>();
  private readonly timers = new Map<string, TimerHandle>();
  private queue: E[] = [];
  private draining = false;
  private isDisposed = false;

  constructor(initial: S, clock: Clock = systemClock) {
    this.currentState = initial;
    this.clock = clock;
  }

  get state(): S {
    return this.currentState;
  }

  get disposed(): boolean {
    return this.isDisposed;
  }

  /** Stable identity per state object, for `useSyncExternalStore`. */
  readonly getSnapshot = (): S => this.currentState;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Deliver an event. Re-entrant: an event sent from within `reduce` is queued
   * and drained after the current one, so ordering is deterministic and the
   * stack cannot grow without bound.
   */
  send(event: E): void {
    if (this.isDisposed) return;
    this.queue.push(event);
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift() as E;
        if (this.isDisposed) break;
        try {
          this.reduce(this.currentState, next);
        } catch (error) {
          this.onCrash(error, next);
        }
      }
    } finally {
      this.draining = false;
      this.queue = [];
    }
  }

  /** Move to `next`. A no-op when the state object is unchanged. */
  protected commit(next: S): void {
    if (this.isDisposed || next === this.currentState) return;
    const previous = this.currentState;
    this.currentState = next;
    if (previous.name !== next.name) this.onExit(previous, next);
    this.onEnter(next, previous);
    this.notify();
  }

  /**
   * Schedule an event under a name. Arming the same name again replaces the
   * pending timer, so a machine can never accumulate duplicate retries.
   */
  protected after(name: string, ms: number, event: E): void {
    if (this.isDisposed) return;
    this.clearAfter(name);
    const handle = this.clock.setTimeout(() => {
      this.timers.delete(name);
      this.send(event);
    }, ms);
    this.timers.set(name, handle);
  }

  /** Cancel one named timer, or all of them. */
  protected clearAfter(name?: string): void {
    if (name === undefined) {
      for (const handle of this.timers.values()) this.clock.clearTimeout(handle);
      this.timers.clear();
      return;
    }
    const handle = this.timers.get(name);
    if (handle === undefined) return;
    this.clock.clearTimeout(handle);
    this.timers.delete(name);
  }

  protected hasTimer(name: string): boolean {
    return this.timers.has(name);
  }

  /** Idempotent. Cancels the in-flight attempt and every timer. */
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.queue = [];
    this.clearAfter();
    this.slot.cancel();
    try {
      this.onDispose();
    } finally {
      this.listeners.clear();
    }
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  protected abstract reduce(state: S, event: E): void;

  protected onEnter(_state: S, _previous: S | null): void {}
  protected onExit(_state: S, _next: S): void {}
  protected onDispose(): void {}

  /** A throw inside `reduce` must not wedge the queue. Override to report. */
  protected onCrash(error: unknown, event: E): void {
    console.error(`[fsm] ${this.constructor.name} crashed on ${event.type}:`, error);
  }
}

export type SnapshotOf<M> = M extends Machine<infer S, EventShape> ? S : never;
export type EventOf<M> = M extends Machine<StateShape, infer E> ? E : never;

// ---------------------------------------------------------------------------
// MachinePool
// ---------------------------------------------------------------------------

/**
 * Ref-counted instances keyed by a string, with disposal deferred past the
 * synchronous unmount/remount that React `<StrictMode>` performs in dev.
 *
 * This is the StrictMode answer. A per-effect `cancelled` flag stops stale state
 * writes but not the second dial; pooling means mount → unmount → mount reuses
 * one instance and connects once. It also lets one machine read another's live
 * client (see FSM.md §5.4) instead of opening a second socket to the same agent.
 */
export class MachinePool<M extends Disposable> {
  private readonly entries = new Map<string, { machine: M; refs: number; timer: TimerHandle | null }>();
  private readonly idleMs: number;
  private readonly clock: Clock;

  constructor(
    private readonly factory: (key: string) => M,
    options: { idleMs?: number; clock?: Clock } = {},
  ) {
    this.idleMs = options.idleMs ?? 1000;
    this.clock = options.clock ?? systemClock;
  }

  acquire(key: string): M {
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.timer !== null) {
        this.clock.clearTimeout(existing.timer);
        existing.timer = null;
      }
      existing.refs += 1;
      return existing.machine;
    }
    const machine = this.factory(key);
    this.entries.set(key, { machine, refs: 1, timer: null });
    return machine;
  }

  release(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.refs = Math.max(0, entry.refs - 1);
    if (entry.refs > 0 || entry.timer !== null) return;
    entry.timer = this.clock.setTimeout(() => {
      const current = this.entries.get(key);
      if (!current || current.refs > 0) return;
      this.entries.delete(key);
      current.machine.dispose();
    }, this.idleMs);
  }

  /** Read an instance without taking a reference. Null when not live. */
  peek(key: string): M | null {
    return this.entries.get(key)?.machine ?? null;
  }

  get size(): number {
    return this.entries.size;
  }

  disposeAll(): void {
    for (const [key, entry] of [...this.entries]) {
      if (entry.timer !== null) this.clock.clearTimeout(entry.timer);
      this.entries.delete(key);
      entry.machine.dispose();
    }
  }
}

// ---------------------------------------------------------------------------
// Socket helpers
// ---------------------------------------------------------------------------

/**
 * Close a WebSocket without the misleading console warning.
 *
 * Calling `close()` while a socket is still CONNECTING makes Chrome log
 * "WebSocket is closed before the connection is established." That text is
 * produced *only* by this situation — a handshake the server refuses logs a
 * different message, because by then `readyState` is already CLOSED and
 * `close()` is a silent no-op. So the warning is a reliable signal that the
 * client tore down its own in-flight dial, and it should stay that way: 450 of
 * them once masked a reconnect storm, and any that appear from here should mean
 * something.
 *
 * Cancelling an attempt therefore lets the handshake finish and then closes
 * cleanly, rather than yanking the socket mid-flight.
 */
export function closeSocket(socket: WebSocket | null | undefined, code = 1000, reason = ""): void {
  if (!socket) return;
  try {
    if (socket.readyState === 0 /* CONNECTING */) {
      socket.addEventListener("open", () => {
        try {
          socket.close(code, reason);
        } catch {
          // Already gone.
        }
      }, { once: true });
      // We asked for this teardown; its error is not a fault worth surfacing.
      socket.addEventListener("error", () => {}, { once: true });
      return;
    }
    if (socket.readyState === 1 /* OPEN */) socket.close(code, reason);
  } catch {
    // A socket that is already closing is not an error.
  }
}
