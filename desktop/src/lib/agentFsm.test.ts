/**
 * Agent lifecycle machine — FSM.md §5.5, verification row 4 of §6.
 *
 * Pure node: no jsdom, no fake timers, no network. Time is {@link FakeClock};
 * the control plane is a recording fake port. Every case below is a bug that
 * shipped at least once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ABSENT,
  agentCapabilities,
  AgentMachine,
  APPLY_DEADLINE_MS,
  createAgentMachinePool,
  SETTLE_DEADLINE_MS,
  type AgentCommandOutcome,
  type AgentLifecyclePort,
  type AgentRosterEntry,
} from "./agentFsm";
import {
  clearConnectionIssues,
  subscribeConnectionIssues,
  type ConnectionIssue,
} from "./connection-errors";
import { FakeClock } from "./machine";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

type Deferred = { resolve: (outcome?: AgentCommandOutcome) => void; reject: (e: unknown) => void };

class FakePort implements AgentLifecyclePort {
  /** Every call in order, e.g. ["stop", "start"]. */
  readonly calls: string[] = [];
  readonly signals: AbortSignal[] = [];
  /** Set to pend a call so the test controls when it lands. */
  private pending: Deferred | null = null;
  private manual = false;
  failWith: unknown = null;

  /** Subsequent calls hang until `settle()` / `reject()`. */
  hold(): void {
    this.manual = true;
  }

  settle(outcome: AgentCommandOutcome = {}): void {
    const deferred = this.pending;
    this.pending = null;
    deferred?.resolve(outcome);
  }

  reject(error: unknown): void {
    const deferred = this.pending;
    this.pending = null;
    deferred?.reject(error);
  }

  get isPending(): boolean {
    return this.pending !== null;
  }

  private record(name: string, signal: AbortSignal): Promise<AgentCommandOutcome | void> {
    this.calls.push(name);
    this.signals.push(signal);
    if (this.failWith !== null) return Promise.reject(this.failWith);
    if (!this.manual) return Promise.resolve({});
    return new Promise<AgentCommandOutcome>((resolve, reject) => {
      this.pending = { resolve: (outcome = {}) => resolve(outcome), reject };
    });
  }

  start = (_id: string, signal: AbortSignal) => this.record("start", signal);
  stop = (_id: string, signal: AbortSignal) => this.record("stop", signal);
  archive = (_id: string, signal: AbortSignal) => this.record("archive", signal);
  restore = (_id: string, signal: AbortSignal) => this.record("restore", signal);
  delete = (_id: string, signal: AbortSignal) => this.record("delete", signal);
  setDesktopEnabled = (_id: string, _enabled: boolean, signal: AbortSignal) =>
    this.record("setDesktopEnabled", signal);
  setRuntime = (_id: string, _runtime: string, _resetImage: boolean, signal: AbortSignal) =>
    this.record("setRuntime", signal);
  uploadAvatar = (_id: string, _file: File, signal: AbortSignal) =>
    this.record("uploadAvatar", signal);
  deleteAvatar = (_id: string, signal: AbortSignal) => this.record("deleteAvatar", signal);
}

const AGENT = "agent-1";
const roster = (state: string): AgentRosterEntry => ({ id: AGENT, state });

/** Let the microtask queue drain, so a resolved port call reaches `reduce`. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function machineFor(port: FakePort, clock: FakeClock, observed?: string) {
  const machine = new AgentMachine(AGENT, { port, clock });
  if (observed !== undefined) machine.roster(roster(observed));
  return machine;
}

// The error bus is module-global; keep suites from leaking into each other.
let published: ConnectionIssue[][] = [];
let unsubscribe = () => {};

beforeEach(() => {
  clearConnectionIssues();
  published = [];
  unsubscribe = subscribeConnectionIssues((issues) => published.push(issues));
  // The subscribe callback fires immediately with the (empty) current set.
  published = [];
});

afterEach(() => {
  unsubscribe();
  clearConnectionIssues();
});

/** How many times an issue for this agent was published (not cleared). */
const lifecyclePublishes = () =>
  published.filter((issues) => issues.some((issue) => issue.id === `lifecycle:${AGENT}`)).length;

// ---------------------------------------------------------------------------

describe("AgentMachine — start settles on the roster", () => {
  it("Applying → Settling → Stable, driven by ROSTER", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const machine = machineFor(port, clock, "STOPPED");

    port.hold();
    expect(machine.request("start")).toBe(true);
    expect(machine.state.name).toBe("Applying");

    // The control plane accepted. The agent is *not* running yet — this is
    // exactly where the old code re-enabled the button.
    port.settle({ agent: roster("STARTING") });
    await flush();
    expect(machine.state.name).toBe("Settling");
    expect(machine.readiness.busy).toBe(true);
    expect(machine.readiness.ready).toBe(false);

    machine.roster(roster("STARTING"));
    expect(machine.state.name).toBe("Settling");

    machine.roster(roster("RUNNING"));
    expect(machine.state.name).toBe("Stable");
    expect(machine.readiness.ready).toBe(true);
    expect(machine.readiness.op).toBeNull();
    machine.dispose();
  });

  it("completes immediately when the command's own response already confirms", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const machine = machineFor(port, clock, "RUNNING");

    port.hold();
    machine.request("stop");
    port.settle({ agent: roster("STOPPED") });
    await flush();

    expect(machine.state.name).toBe("Stable");
    expect(clock.pending).toBe(0);
    machine.dispose();
  });
});

describe("AgentMachine — the settle deadline", () => {
  it("fails after 120s naming the last observed state", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const machine = machineFor(port, clock, "STOPPED");

    port.hold();
    machine.request("start");
    port.settle({ agent: roster("STARTING") });
    await flush();
    expect(machine.state.name).toBe("Settling");

    clock.advance(SETTLE_DEADLINE_MS - 1);
    expect(machine.state.name).toBe("Settling");

    clock.advance(1);
    expect(machine.state.name).toBe("Failed");
    const state = machine.state;
    if (state.name !== "Failed") throw new Error("expected Failed");
    expect(state.message).toContain("STARTING");
    expect(state.message).toContain("2 minutes");
    expect(state.observed).toBe("STARTING");
    expect(machine.readiness.failure).toContain("STARTING");
    machine.dispose();
  });

  it("names absence rather than a state when the agent left the roster", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const machine = machineFor(port, clock, "STOPPED");

    port.hold();
    machine.request("start");
    port.settle({});
    await flush();
    machine.roster(null);
    expect(machine.state.observed).toBe(ABSENT);

    clock.advance(SETTLE_DEADLINE_MS);
    const state = machine.state;
    if (state.name !== "Failed") throw new Error("expected Failed");
    expect(state.message).toContain("no longer in the roster");
    machine.dispose();
  });
});

describe("AgentMachine — the apply deadline", () => {
  it("a port that never answers fails instead of parking the machine forever", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const machine = machineFor(port, clock, "STOPPED");

    // `startAgent` chains four SDK calls over an IPC with no timeout of its
    // own. Nothing under the machine bounds this, so the machine must.
    port.hold();
    machine.request("start");
    expect(machine.state.name).toBe("Applying");
    expect(clock.pending).toBe(1);

    clock.advance(APPLY_DEADLINE_MS - 1);
    expect(machine.state.name).toBe("Applying");
    // Every op is blocked and `retry` refuses while Applying: without the
    // deadline this is a permanent park with no published issue.
    expect(machine.can("stop")).toBe(false);
    expect(machine.retry()).toBe(false);

    clock.advance(1);
    const state = machine.state;
    if (state.name !== "Failed") throw new Error("expected Failed");
    expect(state.cause).toBe("unanswered");
    expect(state.message).toContain("did not answer");
    expect(state.message).toContain("30 seconds");
    // Guarantee 5: a terminal state names a reason and publishes a way out.
    expect(lifecyclePublishes()).toBe(1);
    expect(clock.pending).toBe(0);
    // The abandoned call cannot come back and move the machine.
    expect(port.signals[0]?.aborted).toBe(true);
    port.settle({ agent: roster("RUNNING") });
    await flush();
    expect(machine.state.name).toBe("Failed");
    machine.dispose();
  });

  it("does not fire once the command has landed and Settling has taken over", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const machine = machineFor(port, clock, "STOPPED");

    port.hold();
    machine.request("start");
    port.settle({ agent: roster("STARTING") });
    await flush();
    expect(machine.state.name).toBe("Settling");
    // The apply budget was retired, not left armed alongside the settle one.
    expect(clock.pending).toBe(1);

    clock.advance(APPLY_DEADLINE_MS);
    expect(machine.state.name).toBe("Settling");
    machine.dispose();
  });
});

describe("AgentMachine — one in-flight operation", () => {
  it("rejects a second request while Applying and calls the port once", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const machine = machineFor(port, clock, "STOPPED");

    port.hold();
    expect(machine.request("start")).toBe(true);
    expect(machine.request("start")).toBe(false);
    expect(machine.request("stop")).toBe(false);
    expect(machine.can("start")).toBe(false);
    expect(port.calls).toEqual(["start"]);

    port.settle({});
    await flush();
    expect(port.calls).toEqual(["start"]);
    machine.dispose();
  });

  it("permits exactly one supersede: stop during Settling(start)", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const machine = machineFor(port, clock, "STOPPED");

    port.hold();
    machine.request("start");
    port.settle({ agent: roster("STARTING") });
    await flush();
    expect(machine.state.name).toBe("Settling");

    expect(machine.can("archive")).toBe(false);
    expect(machine.can("start")).toBe(false);
    expect(machine.can("stop")).toBe(true);

    expect(machine.request("stop")).toBe(true);
    expect(port.calls).toEqual(["start", "stop"]);
    // Superseding aborts the settling attempt rather than abandoning it.
    expect(port.signals[0]?.aborted).toBe(true);

    // The supersede must also retire the superseded op's *state*: a leftover
    // settle deadline would fire 120s later and fail the stop with the start's
    // message. Exactly one timer may remain — the new op's apply budget.
    const applying = machine.state;
    if (applying.name !== "Applying") throw new Error("expected Applying");
    expect(applying.op).toBe("stop");
    expect(applying.step).toBe("stop");
    expect(clock.pending).toBe(1);

    port.settle({ agent: roster("STOPPED") });
    await flush();
    expect(machine.state.name).toBe("Stable");
    expect(clock.pending).toBe(0);
    machine.dispose();
  });

  it("guards ops against the agent's own state", () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const running = machineFor(port, clock, "RUNNING");
    expect(running.can("start")).toBe(false);
    expect(running.can("stop")).toBe(true);
    expect(running.can("restart")).toBe(true);
    expect(running.request("start")).toBe(false);
    expect(port.calls).toEqual([]);

    const archived = machineFor(port, clock, "ARCHIVED");
    expect(archived.can("restore")).toBe(true);
    expect(archived.can("start")).toBe(false);

    const starting = machineFor(port, clock, "STARTING");
    expect(starting.can("start")).toBe(false);
    expect(starting.can("stop")).toBe(false);
    // One-shot mutations do not depend on a deployment transition.
    expect(starting.can("uploadAvatar")).toBe(true);

    running.dispose();
    archived.dispose();
    starting.dispose();
  });
});

describe("AgentMachine — restart is one composite op", () => {
  it("issues start only after the roster shows STOPPED", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const machine = machineFor(port, clock, "RUNNING");

    port.hold();
    expect(machine.request("restart")).toBe(true);
    expect(port.calls).toEqual(["stop"]);

    port.settle({ agent: roster("STOPPING") });
    await flush();
    expect(machine.state.name).toBe("Settling");
    expect(port.calls).toEqual(["stop"]);

    // The roster still says the agent is up: start must not be issued yet.
    machine.roster(roster("RUNNING"));
    machine.roster(roster("STOPPING"));
    expect(port.calls).toEqual(["stop"]);

    machine.roster(roster("STOPPED"));
    expect(port.calls).toEqual(["stop", "start"]);
    const applying = machine.state;
    if (applying.name !== "Applying") throw new Error("expected Applying");
    expect(applying.op).toBe("restart");
    expect(applying.step).toBe("start");

    port.settle({ agent: roster("STARTING") });
    await flush();
    machine.roster(roster("RUNNING"));
    expect(machine.state.name).toBe("Stable");
    machine.dispose();
  });

  it("waits for the roster even when the stop's own response says STOPPED", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const machine = machineFor(port, clock, "RUNNING");

    port.hold();
    machine.request("restart");
    expect(port.calls).toEqual(["stop"]);

    // The command's own reply is not the roster. Advancing off it is how the
    // second half comes to race the first (FSM.md:66-68).
    port.settle({ agent: roster("STOPPED") });
    await flush();
    expect(machine.state.name).toBe("Settling");
    expect(port.calls).toEqual(["stop"]);

    // ...and the *roster* saying the same thing is what releases it, even
    // though the reading is identical to the one already recorded.
    machine.roster(roster("STOPPED"));
    expect(port.calls).toEqual(["stop", "start"]);
    machine.dispose();
  });

  it("resumes at start when the start half is what failed", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const machine = machineFor(port, clock, "RUNNING");

    port.hold();
    machine.request("restart");
    port.settle({});
    await flush();
    machine.roster(roster("STOPPED"));
    expect(port.calls).toEqual(["stop", "start"]);

    port.reject(new Error("boom"));
    await flush();
    const state = machine.state;
    if (state.name !== "Failed") throw new Error("expected Failed");
    expect(state.op).toBe("restart");
    expect(state.step).toBe("start");
    expect(state.resume).toEqual({ op: "start" });

    expect(machine.retry()).toBe(true);
    expect(port.calls).toEqual(["stop", "start", "start"]);
    machine.dispose();
  });
});

describe("AgentMachine — the roster is a trigger, not a hazard", () => {
  it("a refresh with an unchanged state causes zero port calls", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const machine = machineFor(port, clock, "RUNNING");
    const before = machine.state;
    let notifications = 0;
    machine.subscribe(() => notifications++);

    // The roster poll returns a fresh object every 4s. Object identity changing
    // is exactly what used to re-dial chat and re-run commands.
    for (let i = 0; i < 10; i++) machine.roster(roster("RUNNING"));

    expect(port.calls).toEqual([]);
    expect(notifications).toBe(0);
    expect(machine.state).toBe(before);
    machine.dispose();
  });

  it("a refresh during Settling that misses the target is inert", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const machine = machineFor(port, clock, "STOPPED");

    port.hold();
    machine.request("start");
    port.settle({});
    await flush();
    for (let i = 0; i < 5; i++) machine.roster(roster("STARTING"));
    expect(port.calls).toEqual(["start"]);
    expect(machine.state.name).toBe("Settling");
    machine.dispose();
  });
});

describe("AgentMachine — failure publishes once and offers a way out", () => {
  it("Failed publishes lifecycle:<agentId>; retry re-issues; Stable clears", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const machine = machineFor(port, clock, "STOPPED");

    port.failWith = new Error("control plane said no");
    machine.request("start");
    await flush();

    expect(machine.state.name).toBe("Failed");
    expect(lifecyclePublishes()).toBe(1);
    const issue = published.at(-1)?.find((candidate) => candidate.id === `lifecycle:${AGENT}`);
    expect(issue?.detail).toContain("control plane said no");
    expect(issue?.agentId).toBe(AGENT);
    expect(issue?.action).toEqual({ label: "Retry", kind: "retry", agentId: AGENT });

    // Retry re-issues the same command.
    port.failWith = null;
    port.hold();
    expect(machine.retry()).toBe(true);
    expect(port.calls).toEqual(["start", "start"]);

    port.settle({});
    await flush();
    machine.roster(roster("RUNNING"));
    expect(machine.state.name).toBe("Stable");
    expect(published.at(-1)?.some((candidate) => candidate.id === `lifecycle:${AGENT}`)).toBe(false);
    machine.dispose();
  });

  it("retry after a deadline keeps waiting; it must not re-send a landed start", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const machine = machineFor(port, clock, "STOPPED");

    port.hold();
    machine.request("start");
    port.settle({ agent: roster("STARTING") });
    await flush();
    clock.advance(SETTLE_DEADLINE_MS);
    const failed = machine.state;
    if (failed.name !== "Failed") throw new Error("expected Failed");
    // The control plane accepted the start; the roster just never caught up.
    expect(failed.cause).toBe("deadline");

    // STARTING is transitional, so a plain request is refused...
    expect(machine.request("start")).toBe(false);
    // ...and a terminal state must still offer a way out — but re-POSTing
    // `start` at a mid-boot container re-mints OPENCLAW_GATEWAY_TOKEN and
    // rewrites the allowed origin, so the way out is a fresh wait.
    expect(machine.retry()).toBe(true);
    expect(port.calls).toEqual(["start"]);
    expect(machine.state.name).toBe("Settling");
    expect(clock.pending).toBe(1);

    // The fresh deadline is a full budget, not the remains of the old one.
    clock.advance(SETTLE_DEADLINE_MS - 1);
    expect(machine.state.name).toBe("Settling");
    machine.roster(roster("RUNNING"));
    expect(machine.state.name).toBe("Stable");
    expect(port.calls).toEqual(["start"]);
    machine.dispose();
  });

  it("retry after a deadline does re-issue once the roster makes it coherent", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const machine = machineFor(port, clock, "STOPPED");

    port.hold();
    machine.request("start");
    port.settle({ agent: roster("STARTING") });
    await flush();
    clock.advance(SETTLE_DEADLINE_MS);
    expect(machine.state.name).toBe("Failed");

    // The boot gave up and the agent fell back. Now `start` is coherent
    // against what the roster actually says, so retry means retry.
    machine.roster(roster("STOPPED"));
    expect(machine.retry()).toBe(true);
    expect(port.calls).toEqual(["start", "start"]);
    expect(machine.state.name).toBe("Applying");
    machine.dispose();
  });

  it("retry after an archive deadline does not re-archive an ARCHIVING agent", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const machine = machineFor(port, clock, "STOPPED");

    port.hold();
    machine.request("archive");
    port.settle({ agent: roster("ARCHIVING") });
    await flush();
    clock.advance(SETTLE_DEADLINE_MS);
    expect(machine.state.name).toBe("Failed");

    expect(machine.retry()).toBe(true);
    expect(port.calls).toEqual(["archive"]);
    expect(machine.state.name).toBe("Settling");

    machine.roster(roster("ARCHIVED"));
    expect(machine.state.name).toBe("Stable");
    machine.dispose();
  });

  it("retry after a rejection re-issues, because that command never landed", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const machine = machineFor(port, clock, "STARTING");

    port.failWith = new Error("nope");
    // A one-shot is legal while transitional, and its rejection is unambiguous.
    machine.request({ op: "setDesktopEnabled", enabled: true });
    await flush();
    const failed = machine.state;
    if (failed.name !== "Failed") throw new Error("expected Failed");
    expect(failed.cause).toBe("rejected");

    port.failWith = null;
    port.hold();
    expect(machine.retry()).toBe(true);
    expect(port.calls).toEqual(["setDesktopEnabled", "setDesktopEnabled"]);
    machine.dispose();
  });

  it("preserves the classifier's action instead of flattening it to Retry", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const machine = machineFor(port, clock, "STOPPED");

    // A 401 classifies as `auth`: retrying it just 401s again, so the bar must
    // keep the classifier's "Open settings".
    port.failWith = Object.assign(new Error("Unauthorized"), { status: 401 });
    machine.request("start");
    await flush();

    const issue = published.at(-1)?.find((candidate) => candidate.id === `lifecycle:${AGENT}`);
    expect(issue?.kind).toBe("auth");
    expect(issue?.action).toEqual({ label: "Open settings", kind: "open-settings", agentId: AGENT });
    machine.dispose();
  });

  it("publishes exactly once per failure, not once per roster tick", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const machine = machineFor(port, clock, "STOPPED");

    port.failWith = new Error("nope");
    machine.request("start");
    await flush();
    for (let i = 0; i < 5; i++) machine.roster(roster(i % 2 === 0 ? "STOPPED" : "STARTING"));

    expect(lifecyclePublishes()).toBe(1);
    machine.dispose();
  });
});

describe("AgentMachine — one-shot mutations", () => {
  it("setDesktopEnabled goes Applying → Stable with nothing to settle", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const machine = machineFor(port, clock, "RUNNING");

    port.hold();
    expect(machine.request({ op: "setDesktopEnabled", enabled: true })).toBe(true);
    expect(machine.state.name).toBe("Applying");
    // Shares the agent's single slot: no second command may interleave.
    expect(machine.request("stop")).toBe(false);

    port.settle({ agent: roster("RUNNING") });
    await flush();
    expect(machine.state.name).toBe("Stable");
    expect(clock.pending).toBe(0);
    machine.dispose();
  });

  it("setRuntime is a one-shot op that reaches the port with its arguments", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const machine = machineFor(port, clock, "RUNNING");

    port.hold();
    expect(machine.request({ op: "setRuntime", runtime: "openclaw", resetImage: true })).toBe(true);
    expect(machine.state.name).toBe("Applying");
    expect(machine.request("stop")).toBe(false);

    port.settle({ agent: roster("RUNNING") });
    await flush();
    expect(machine.state.name).toBe("Stable");
    expect(port.calls).toEqual(["setRuntime"]);
    machine.dispose();
  });

  it("avatar upload carries its result out on Stable", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const machine = machineFor(port, clock, "RUNNING");

    port.hold();
    machine.request({ op: "uploadAvatar", file: {} as File });
    port.settle({ avatarUrl: "https://example.test/a.png" });
    await flush();

    const state = machine.state;
    if (state.name !== "Stable") throw new Error("expected Stable");
    expect(state.outcome?.avatarUrl).toBe("https://example.test/a.png");
    machine.dispose();
  });
});

describe("AgentMachine — teardown", () => {
  it("dispose mid-Applying aborts the attempt and drops the late resolution", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const machine = machineFor(port, clock, "STOPPED");

    port.hold();
    machine.request("start");
    expect(machine.state.name).toBe("Applying");

    machine.dispose();
    expect(port.signals[0]?.aborted).toBe(true);

    port.settle({ agent: roster("RUNNING") });
    await flush();
    expect(machine.state.name).toBe("Applying"); // Frozen at teardown, not mutated.
    expect(machine.request("start")).toBe(false);
    expect(machine.retry()).toBe(false);
    expect(clock.pending).toBe(0);
  });

  it("dispose retires the machine's issue instead of leaving a dead Retry", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const pool = createAgentMachinePool({ port, clock, idleMs: 1000 });
    const machine = pool.acquire(AGENT);
    machine.roster(roster("STOPPED"));

    port.failWith = new Error("nope");
    machine.request("start");
    await flush();
    expect(published.at(-1)?.some((issue) => issue.id === `lifecycle:${AGENT}`)).toBe(true);

    // The bar's Retry routes through `pool.retry` → `peek` → null once the
    // machine is gone, so an issue that outlives its machine is a dead button.
    pool.release(AGENT);
    clock.advance(1000);
    expect(machine.disposed).toBe(true);
    expect(published.at(-1)?.some((issue) => issue.id === `lifecycle:${AGENT}`)).toBe(false);
    expect(pool.retry(AGENT)).toBe(false);
    pool.dispose();
  });

  it("disposeAll retires issues too", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const pool = createAgentMachinePool({ port, clock, idleMs: 1000 });
    const machine = pool.acquire(AGENT);
    machine.roster(roster("STOPPED"));

    port.failWith = new Error("nope");
    machine.request("start");
    await flush();
    expect(published.at(-1)?.some((issue) => issue.id === `lifecycle:${AGENT}`)).toBe(true);

    pool.dispose();
    expect(published.at(-1)?.some((issue) => issue.id === `lifecycle:${AGENT}`)).toBe(false);
  });

  it("dispose is idempotent and stops the settle deadline", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const machine = machineFor(port, clock, "STOPPED");

    port.hold();
    machine.request("start");
    port.settle({});
    await flush();
    expect(clock.pending).toBe(1);

    machine.dispose();
    machine.dispose();
    expect(clock.pending).toBe(0);

    clock.advance(SETTLE_DEADLINE_MS * 2);
    expect(machine.state.name).toBe("Settling");
  });
});

describe("agent machine pool", () => {
  it("acquire → release → acquire within idleMs is one instance, disposed zero times", () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const pool = createAgentMachinePool({ port, clock, idleMs: 1000 });

    const first = pool.acquire(AGENT); // StrictMode: mount
    pool.release(AGENT); //               unmount
    const second = pool.acquire(AGENT); // remount

    expect(second).toBe(first);
    expect(first.disposed).toBe(false);
    expect(pool.size).toBe(1);

    clock.advance(5000);
    expect(first.disposed).toBe(false);

    pool.release(AGENT);
    clock.advance(1000);
    expect(first.disposed).toBe(true);
    expect(pool.size).toBe(0);
    pool.dispose();
  });

  it("a settling command survives a StrictMode remount", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const pool = createAgentMachinePool({ port, clock, idleMs: 1000 });

    const machine = pool.acquire(AGENT);
    machine.roster(roster("STOPPED"));
    port.hold();
    machine.request("start");
    port.settle({});
    await flush();

    pool.release(AGENT);
    const remounted = pool.acquire(AGENT);
    expect(remounted).toBe(machine);
    expect(remounted.state.name).toBe("Settling");
    expect(remounted.can("start")).toBe(false);
    expect(port.calls).toEqual(["start"]);
    pool.dispose();
  });

  it("applyRoster feeds live machines and reports absence, via peek", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const pool = createAgentMachinePool({ port, clock, idleMs: 1000 });

    const machine = pool.acquire(AGENT);
    machine.roster(roster("RUNNING"));

    port.hold();
    machine.request("delete");
    port.settle({});
    await flush();
    expect(machine.state.name).toBe("Settling");

    pool.applyRoster([roster("STOPPING")]);
    expect(machine.state.name).toBe("Settling");

    // Gone from the roster is what confirms a delete.
    pool.applyRoster([]);
    expect(machine.state.name).toBe("Stable");
    expect(machine.state.observed).toBe(ABSENT);
    expect(pool.peek(AGENT)).toBe(machine);
    expect(pool.peek("nobody")).toBeNull();
    pool.dispose();
  });

  it("applyRoster routes each entry to its own machine, not the first one", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const pool = createAgentMachinePool({ port, clock, idleMs: 1000 });

    const first = pool.acquire("agent-a");
    const second = pool.acquire("agent-b");

    // Divergent states, so a wrong-agent lookup (or a first-entry-wins bug)
    // cannot pass: each machine must land on a different reading.
    pool.applyRoster([
      { id: "agent-b", state: "RUNNING" },
      { id: "agent-a", state: "STOPPED" },
      { id: "agent-c", state: "ARCHIVED" },
    ]);
    expect(first.state.observed).toBe("STOPPED");
    expect(second.state.observed).toBe("RUNNING");

    // And one agent leaving the roster must not touch the other.
    pool.applyRoster([{ id: "agent-b", state: "RUNNING" }]);
    expect(first.state.observed).toBe(ABSENT);
    expect(second.state.observed).toBe("RUNNING");

    // Settling is per machine too: only agent-a is waiting for a stop.
    port.hold();
    second.request("stop");
    port.settle({ agent: { id: "agent-b", state: "STOPPING" } });
    await flush();
    expect(second.state.name).toBe("Settling");

    pool.applyRoster([{ id: "agent-a", state: "STOPPED" }]);
    expect(second.state.observed).toBe(ABSENT);
    expect(second.state.name).toBe("Settling"); // ABSENT is not "stopped".
    expect(first.state.observed).toBe("STOPPED");
    pool.dispose();
  });

  it("pool.retry resolves an ErrorBar action back to the owning machine", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const pool = createAgentMachinePool({ port, clock, idleMs: 1000 });
    const machine = pool.acquire(AGENT);
    machine.roster(roster("STOPPED"));

    port.failWith = new Error("nope");
    machine.request("start");
    await flush();
    expect(machine.state.name).toBe("Failed");

    port.failWith = null;
    expect(pool.retry(AGENT)).toBe(true);
    expect(pool.retry("nobody")).toBe(false);
    pool.dispose();
  });
});

describe("AgentMachine — roster refresh hook", () => {
  it("asks for a refresh when a command lands, so Settling has an input", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const onRefreshRoster = vi.fn();
    const machine = new AgentMachine(AGENT, { port, clock, onRefreshRoster });
    machine.roster(roster("STOPPED"));

    port.hold();
    machine.request("start");
    expect(onRefreshRoster).not.toHaveBeenCalled();

    port.settle({});
    await flush();
    expect(onRefreshRoster).toHaveBeenCalledTimes(1); // entering Settling

    machine.roster(roster("RUNNING"));
    expect(onRefreshRoster).toHaveBeenCalledTimes(2); // entering Stable
    machine.dispose();
  });

  it("does not ask for a refresh per roster tick", () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const onRefreshRoster = vi.fn();
    const machine = new AgentMachine(AGENT, { port, clock, onRefreshRoster });

    // The absence is the valuable half: a refresh requested on every reading —
    // including a changed one, and including one while Failed — is a poll loop
    // feeding itself. Only entering a state asks for one.
    for (let i = 0; i < 5; i++) machine.roster(roster("RUNNING"));
    machine.roster(roster("STOPPING"));
    machine.roster(roster("STOPPED"));
    machine.roster(null);
    expect(onRefreshRoster).not.toHaveBeenCalled();
    machine.dispose();
  });
});

describe("AgentMachine — the capability table", () => {
  it("is FSM.md's table, derived once", () => {
    // Files and Routines survive a stopped agent; the connected capabilities
    // do not; Desktop needs the route as well.
    expect(agentCapabilities("STOPPED", false)).toEqual({
      files: true,
      routines: true,
      sessions: false,
      chat: false,
      logs: false,
      shell: false,
      desktop: false,
    });
    expect(agentCapabilities("RUNNING", true)).toEqual({
      files: true,
      routines: true,
      sessions: true,
      chat: true,
      logs: true,
      shell: true,
      desktop: true,
    });
    // Running without the route enabled: everything but Desktop.
    expect(agentCapabilities("RUNNING", false).desktop).toBe(false);
    expect(agentCapabilities("RUNNING", null).desktop).toBe(false);
    expect(agentCapabilities("RUNNING", true).desktop).toBe(true);
    // Archived: Routines only survives, because it is backend-side.
    expect(agentCapabilities("ARCHIVED", false).files).toBe(true);
    expect(agentCapabilities("ARCHIVED", false).chat).toBe(false);
    expect(agentCapabilities("ARCHIVED", false).routines).toBe(true);
    // Gone from the roster: no agent, no files.
    expect(agentCapabilities(ABSENT, true)).toEqual({
      files: false,
      routines: true,
      sessions: false,
      chat: false,
      logs: false,
      shell: false,
      desktop: false,
    });
  });

  it("reads desktop enablement off the roster", () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const machine = new AgentMachine(AGENT, { port, clock });

    expect(machine.readiness.desktopEnabled).toBeNull();
    expect(machine.readiness.capabilities.desktop).toBe(false);

    machine.roster({ id: AGENT, state: "RUNNING", desktopEnabled: true });
    expect(machine.readiness.desktopEnabled).toBe(true);
    expect(machine.readiness.capabilities.desktop).toBe(true);

    // A change in the route alone is a real change: subscribers must hear it.
    let notifications = 0;
    machine.subscribe(() => notifications++);
    machine.roster({ id: AGENT, state: "RUNNING", desktopEnabled: false });
    expect(notifications).toBe(1);
    expect(machine.readiness.capabilities.desktop).toBe(false);
    // ...but an unchanged reading stays inert.
    machine.roster({ id: AGENT, state: "RUNNING", desktopEnabled: false });
    expect(notifications).toBe(1);
    machine.dispose();
  });

  it("a busy agent keeps its connected capabilities", async () => {
    const port = new FakePort();
    const clock = new FakeClock();
    const machine = new AgentMachine(AGENT, { port, clock });
    machine.roster({ id: AGENT, state: "RUNNING", desktopEnabled: true });

    port.hold();
    machine.request({ op: "uploadAvatar", file: {} as File });
    expect(machine.state.name).toBe("Applying");

    // `ready` is quiescence and goes false; the capability table is about the
    // agent, not about this machine's inbox. An avatar upload must not take
    // chat away for the duration.
    expect(machine.readiness.ready).toBe(false);
    expect(machine.readiness.busy).toBe(true);
    expect(machine.readiness.capabilities.chat).toBe(true);
    expect(machine.readiness.capabilities.sessions).toBe(true);
    expect(machine.readiness.capabilities.desktop).toBe(true);

    port.settle({ avatarUrl: "https://example.test/a.png" });
    await flush();
    expect(machine.readiness.capabilities.chat).toBe(true);
    machine.dispose();
  });
});
