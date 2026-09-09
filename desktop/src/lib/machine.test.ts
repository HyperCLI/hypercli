/**
 * Tests for the FSM primitive.
 *
 * Every assertion here corresponds to a guarantee in FSM.md §2, and most
 * correspond to a bug that actually shipped. Where that is true the test name
 * says which one, because the value of the primitive is that those bugs become
 * unrepresentable rather than merely fixed.
 *
 * Pure node: no jsdom, no fake timers, no testing-library. Time is injected.
 */
import { describe, expect, it, vi } from "vitest";
import {
  AttemptSlot,
  Backoff,
  FakeClock,
  Machine,
  MachinePool,
  assertNever,
  type Clock,
} from "./machine";

// ---------------------------------------------------------------------------
// AttemptSlot — guarantee 1 (one in-flight op) and 2 (teardown safe mid-flight)
// ---------------------------------------------------------------------------

describe("AttemptSlot", () => {
  it("supersedes rather than abandons: the predecessor is aborted", () => {
    const slot = new AttemptSlot();
    const first = slot.begin();
    expect(first.active).toBe(true);

    const second = slot.begin();

    // The orphaned-socket bug was an attempt left running with nobody holding
    // its handle. Superseding must abort, not just stop caring.
    expect(first.signal.aborted).toBe(true);
    expect(first.active).toBe(false);
    expect(second.active).toBe(true);
    expect(slot.owns(second)).toBe(true);
    expect(slot.owns(first)).toBe(false);
  });

  it("owns() is the guard every continuation checks", () => {
    const slot = new AttemptSlot();
    const attempt = slot.begin();
    expect(slot.owns(attempt)).toBe(true);
    expect(slot.owns(attempt.id)).toBe(true);
    expect(slot.owns(null)).toBe(false);
    expect(slot.owns(undefined)).toBe(false);
    expect(slot.owns(9999)).toBe(false);
  });

  it("cancel() is idempotent and safe to call twice", () => {
    const slot = new AttemptSlot();
    const attempt = slot.begin();
    slot.cancel();
    expect(() => slot.cancel()).not.toThrow();
    expect(attempt.active).toBe(false);
    expect(attempt.signal.aborted).toBe(true);
    expect(slot.current).toBeNull();
  });

  it("a completion arriving after cancel cannot be mistaken for the live one", async () => {
    const slot = new AttemptSlot();
    const attempt = slot.begin();
    const late = Promise.resolve("result");
    slot.cancel();
    await late;
    // This is the whole point: the continuation checks and does nothing.
    expect(slot.owns(attempt)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Backoff — guarantee 3 (backoff owned by the machine)
// ---------------------------------------------------------------------------

describe("Backoff", () => {
  it("grows geometrically and caps at max", () => {
    const backoff = new Backoff({ base: 500, max: 4000 });
    expect(backoff.next()).toBe(500);
    expect(backoff.next()).toBe(1000);
    expect(backoff.next()).toBe(2000);
    expect(backoff.next()).toBe(4000);
    expect(backoff.next()).toBe(4000);
  });

  it("never returns below base — the reconnect-storm guard", () => {
    // The storm happened because one code path redialled with no delay at all.
    const backoff = new Backoff({ base: 500, max: 30_000, jitter: 1, random: () => 0 });
    for (let i = 0; i < 20; i += 1) expect(backoff.next()).toBeGreaterThanOrEqual(500);
  });

  it("reset returns to base", () => {
    const backoff = new Backoff({ base: 100, max: 10_000 });
    backoff.next();
    backoff.next();
    expect(backoff.failures).toBe(2);
    backoff.reset();
    expect(backoff.failures).toBe(0);
    expect(backoff.next()).toBe(100);
  });

  it("peek does not consume", () => {
    const backoff = new Backoff({ base: 200, max: 5000 });
    expect(backoff.peek()).toBe(200);
    expect(backoff.peek()).toBe(200);
    expect(backoff.next()).toBe(200);
    expect(backoff.peek()).toBe(400);
  });

  it("jitter stays within the requested spread", () => {
    const low = new Backoff({ base: 1000, max: 10_000, jitter: 0.5, random: () => 0 });
    const high = new Backoff({ base: 1000, max: 10_000, jitter: 0.5, random: () => 1 });
    expect(low.next()).toBe(1000); // clamped at base
    expect(high.next()).toBe(1250); // 1000 + spread/2
  });
});

// ---------------------------------------------------------------------------
// FakeClock
// ---------------------------------------------------------------------------

describe("FakeClock", () => {
  it("fires timers in scheduled order, including ones they schedule", () => {
    const clock = new FakeClock();
    const order: string[] = [];
    clock.setTimeout(() => {
      order.push("first");
      clock.setTimeout(() => order.push("nested"), 10);
    }, 100);
    clock.setTimeout(() => order.push("second"), 150);

    clock.advance(200);
    expect(order).toEqual(["first", "nested", "second"]);
    expect(clock.now()).toBe(200);
  });

  it("clearTimeout prevents the callback", () => {
    const clock = new FakeClock();
    const fn = vi.fn();
    const handle = clock.setTimeout(fn, 50);
    clock.clearTimeout(handle);
    clock.advance(100);
    expect(fn).not.toHaveBeenCalled();
    expect(clock.pending).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------

type TestState =
  | { readonly name: "idle" }
  | { readonly name: "working"; readonly attempt: number }
  | { readonly name: "done"; readonly value: string };

type TestEvent =
  | { readonly type: "START" }
  | { readonly type: "FINISH"; readonly attempt: number; readonly value: string }
  | { readonly type: "TICK" }
  | { readonly type: "CHAIN" };

class TestMachine extends Machine<TestState, TestEvent> {
  readonly entered: string[] = [];
  readonly exited: string[] = [];
  readonly seen: string[] = [];

  constructor(clock: Clock) {
    super({ name: "idle" }, clock);
  }

  protected reduce(_state: TestState, event: TestEvent): void {
    this.seen.push(event.type);
    switch (event.type) {
      case "START": {
        const attempt = this.slot.begin();
        this.commit({ name: "working", attempt: attempt.id });
        return;
      }
      case "FINISH":
        if (!this.slot.owns(event.attempt)) return; // stale
        this.commit({ name: "done", value: event.value });
        return;
      case "TICK":
        this.commit({ name: "done", value: "ticked" });
        return;
      case "CHAIN":
        // Re-entrant send: must be queued, not recursed.
        this.send({ type: "TICK" });
        this.commit({ name: "working", attempt: 0 });
        return;
      default:
        assertNever(event);
    }
  }

  protected onEnter(state: TestState): void {
    this.entered.push(state.name);
  }

  protected onExit(state: TestState): void {
    this.exited.push(state.name);
  }

  arm(ms: number): void {
    this.after("retry", ms, { type: "TICK" });
  }

  armed(): boolean {
    return this.hasTimer("retry");
  }
}

describe("Machine", () => {
  it("notifies subscribers on a state change and not otherwise", () => {
    const machine = new TestMachine(new FakeClock());
    const listener = vi.fn();
    machine.subscribe(listener);

    machine.send({ type: "START" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(machine.getSnapshot().name).toBe("working");

    // Committing the identical object must not notify — snapshot stability is
    // what keeps useSyncExternalStore from re-rendering forever.
    const snapshot = machine.getSnapshot();
    listener.mockClear();
    machine.send({ type: "FINISH", attempt: 999, value: "stale" });
    expect(listener).not.toHaveBeenCalled();
    expect(machine.getSnapshot()).toBe(snapshot);
  });

  it("drops a stale completion — the supersede guard in practice", () => {
    const machine = new TestMachine(new FakeClock());
    machine.send({ type: "START" });
    const stale = machine.getSnapshot() as { name: "working"; attempt: number };
    machine.send({ type: "START" }); // supersedes

    machine.send({ type: "FINISH", attempt: stale.attempt, value: "from the old attempt" });
    expect(machine.getSnapshot().name).toBe("working");
  });

  it("queues re-entrant sends instead of recursing", () => {
    const machine = new TestMachine(new FakeClock());
    machine.send({ type: "CHAIN" });
    // CHAIN handled fully, then TICK.
    expect(machine.seen).toEqual(["CHAIN", "TICK"]);
    expect(machine.getSnapshot().name).toBe("done");
  });

  it("runs onEnter/onExit only across a name change", () => {
    const machine = new TestMachine(new FakeClock());
    machine.send({ type: "START" });
    machine.send({ type: "START" }); // working -> working, different object
    expect(machine.entered).toEqual(["working", "working"]);
    // idle -> working exits once; working -> working is a new object with the
    // same name, so it re-enters but does not exit.
    expect(machine.exited).toEqual(["idle"]);
  });

  it("arming the same timer name replaces the pending one", () => {
    const clock = new FakeClock();
    const machine = new TestMachine(clock);
    machine.arm(1000);
    machine.arm(5000);
    expect(clock.pending).toBe(1);

    clock.advance(1000);
    expect(machine.getSnapshot().name).toBe("idle"); // first was replaced
    clock.advance(4000);
    expect(machine.getSnapshot().name).toBe("done");
  });

  it("dispose is idempotent, clears timers, aborts the attempt, and ignores later sends", () => {
    const clock = new FakeClock();
    const machine = new TestMachine(clock);
    machine.send({ type: "START" });
    const attempt = machine["slot"].current;
    machine.arm(1000);

    machine.dispose();
    expect(() => machine.dispose()).not.toThrow();
    expect(machine.disposed).toBe(true);
    expect(clock.pending).toBe(0);
    expect(attempt?.signal.aborted).toBe(true);

    const before = machine.getSnapshot();
    machine.send({ type: "TICK" });
    expect(machine.getSnapshot()).toBe(before);
  });

  it("a throw inside reduce does not wedge the queue", () => {
    class Crashy extends Machine<TestState, TestEvent> {
      crashes: unknown[] = [];
      constructor() {
        super({ name: "idle" }, new FakeClock());
      }
      protected reduce(_s: TestState, event: TestEvent): void {
        if (event.type === "START") throw new Error("boom");
        this.commit({ name: "done", value: "recovered" });
      }
      protected onCrash(error: unknown): void {
        this.crashes.push(error);
      }
    }
    const machine = new Crashy();
    machine.send({ type: "START" });
    expect(machine.crashes).toHaveLength(1);
    machine.send({ type: "TICK" });
    expect(machine.getSnapshot().name).toBe("done");
  });
});

// ---------------------------------------------------------------------------
// MachinePool — guarantee 4 (StrictMode must not double-connect)
// ---------------------------------------------------------------------------

class Counted implements Disposable {
  static built = 0;
  disposed = false;
  constructor() {
    Counted.built += 1;
  }
  dispose(): void {
    this.disposed = true;
  }
}
interface Disposable {
  dispose(): void;
}

describe("MachinePool", () => {
  it("StrictMode remount reuses one instance and disposes nothing", () => {
    Counted.built = 0;
    const clock = new FakeClock();
    const pool = new MachinePool(() => new Counted(), { idleMs: 1000, clock });

    // React <StrictMode>: mount, unmount, mount — synchronously.
    const first = pool.acquire("agent-1");
    pool.release("agent-1");
    const second = pool.acquire("agent-1");

    expect(second).toBe(first);
    expect(Counted.built).toBe(1);
    clock.advance(5000);
    expect(first.disposed).toBe(false); // the pending disposal was cancelled
  });

  it("disposes once the idle window elapses with no holders", () => {
    const clock = new FakeClock();
    const pool = new MachinePool(() => new Counted(), { idleMs: 1000, clock });
    const machine = pool.acquire("a");
    pool.release("a");

    clock.advance(999);
    expect(machine.disposed).toBe(false);
    clock.advance(2);
    expect(machine.disposed).toBe(true);
    expect(pool.size).toBe(0);
  });

  it("keeps the instance alive while any holder remains", () => {
    const clock = new FakeClock();
    const pool = new MachinePool(() => new Counted(), { idleMs: 100, clock });
    const machine = pool.acquire("a");
    pool.acquire("a");
    pool.release("a");
    clock.advance(500);
    expect(machine.disposed).toBe(false);
  });

  it("peek reads without taking a reference", () => {
    const clock = new FakeClock();
    const pool = new MachinePool(() => new Counted(), { idleMs: 100, clock });
    expect(pool.peek("a")).toBeNull();
    const machine = pool.acquire("a");
    expect(pool.peek("a")).toBe(machine);
    pool.release("a");
    clock.advance(200);
    expect(pool.peek("a")).toBeNull();
  });

  it("keys instances independently", () => {
    Counted.built = 0;
    const pool = new MachinePool(() => new Counted(), { clock: new FakeClock() });
    expect(pool.acquire("a")).not.toBe(pool.acquire("b"));
    expect(Counted.built).toBe(2);
  });

  it("disposeAll clears everything", () => {
    const pool = new MachinePool(() => new Counted(), { clock: new FakeClock() });
    const a = pool.acquire("a");
    const b = pool.acquire("b");
    pool.disposeAll();
    expect(a.disposed).toBe(true);
    expect(b.disposed).toBe(true);
    expect(pool.size).toBe(0);
  });
});
