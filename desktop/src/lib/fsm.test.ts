/**
 * Session machine — FSM.md §4.
 *
 * Pure node: no jsdom, no testing-library, no real timers. Every edge is
 * driven through injected fakes and {@link FakeClock}, which is the point of
 * keeping the machine React-free.
 *
 * The regression this file exists for is `TypeError: Failed to fetch` being
 * read as a sign-out. See "the load-bearing edge" below.
 */
import { describe, expect, it } from "vitest";
import { FakeClock } from "./machine";
import {
  CREDENTIAL_DEADLINE_MS,
  MANUAL_RETRY_FLOOR_MS,
  ROSTER_DEADLINE_MS,
  SIGN_OUT_DEADLINE_MS,
  SessionMachine,
  isReady,
  mayOpenSubscriptions,
  resetSessionMachine,
  rosterOf,
  sessionMachine,
  sessionOf,
  type Session,
  type SessionClient,
  type SessionDeps,
  type SessionMachineOptions,
  type SessionState,
} from "./fsm";
import {
  MissingCredentialError,
  RUST_ABSENT_CREDENTIAL_MESSAGES,
  normalizeCredentialError,
  type AcpCredentials,
} from "./credentials";
import type { Endpoints } from "./endpoints";
import type { AgentSummary } from "../api";
import type { ConnectionIssue } from "./connection-errors";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CREDENTIALS: AcpCredentials = { api_base: "https://api.hypercli.com/agents", token: "k-1" };
const ENDPOINTS: Endpoints = {
  httpBase: "https://api.hypercli.com/agents",
  apiBase: "https://api.hypercli.com/agents",
  proxied: false,
};

function agent(id: string): AgentSummary {
  return {
    id,
    name: id,
    handle: null,
    avatar_url: null,
    avatar_audio_url: null,
    runtime: "openclaw",
    state: "RUNNING",
    hostname: null,
    launch_epoch: 0,
    size: null,
  };
}

/** A stand-in for the SDK client. Nothing in the machine calls into it. */
const CLIENT = { marker: "fake-sdk" } as unknown as SessionClient;

/** Resolves only when the test says so, so an attempt can be left in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // An unsettled/rejected deferred must not trip node's unhandled-rejection
  // guard before the machine attaches its own handler.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

/** Drain the microtask queue so async continuations inside the machine run. */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

interface Harness {
  machine: SessionMachine;
  clock: FakeClock;
  calls: { credentials: number; clients: number; rosters: number; logouts: number };
  issues: ConnectionIssue[];
  cleared: string[];
}

function harness(overrides: Partial<SessionDeps> & { clock?: FakeClock } = {}): Harness {
  const clock = overrides.clock ?? new FakeClock();
  const calls = { credentials: 0, clients: 0, rosters: 0, logouts: 0 };
  const issues: ConnectionIssue[] = [];
  const cleared: string[] = [];

  const options: SessionMachineOptions = {
    clock,
    backoff: { base: 1000, max: 8000, factor: 2 },
    resolveCredentials: async () => {
      calls.credentials += 1;
      return CREDENTIALS;
    },
    resolveEndpoints: () => ENDPOINTS,
    createClient: async () => {
      calls.clients += 1;
      return CLIENT;
    },
    listAgents: async () => {
      calls.rosters += 1;
      return [];
    },
    logout: async () => {
      calls.logouts += 1;
    },
    // Production's `reportConnectionIssue` de-duplicates by `id` — re-reporting
    // refreshes the existing entry rather than stacking a new one. A fake that
    // only pushes is *more permissive* than the real bus, which would let a
    // retry loop that spams the error bar pass here and fail in the app. So
    // the fake dedupes too, and `issues.length` means what it means in
    // production.
    report: (issue) => {
      const existing = issues.findIndex((candidate) => candidate.id === issue.id);
      if (existing === -1) issues.push(issue);
      else issues[existing] = issue;
    },
    clearIssue: (id) => {
      const existing = issues.findIndex((candidate) => candidate.id === id);
      if (existing !== -1) issues.splice(existing, 1);
      cleared.push(id);
    },
    ...stripClock(overrides),
  };

  // Wrap the caller's fakes so call counts stay accurate whichever is used.
  const counted: SessionMachineOptions = { ...options };
  if (overrides.resolveCredentials) {
    const inner = overrides.resolveCredentials;
    counted.resolveCredentials = (signal) => {
      calls.credentials += 1;
      return inner(signal);
    };
  }
  if (overrides.createClient) {
    const inner = overrides.createClient;
    counted.createClient = (creds, endpoints, signal) => {
      calls.clients += 1;
      return inner(creds, endpoints, signal);
    };
  }
  if (overrides.listAgents) {
    const inner = overrides.listAgents;
    counted.listAgents = (session, signal) => {
      calls.rosters += 1;
      return inner(session, signal);
    };
  }
  if (overrides.logout) {
    const inner = overrides.logout;
    counted.logout = () => {
      calls.logouts += 1;
      return inner();
    };
  }

  return { machine: new SessionMachine(counted), clock, calls, issues, cleared };
}

function stripClock(overrides: Partial<SessionDeps> & { clock?: FakeClock }): Partial<SessionDeps> {
  const { clock: _clock, ...rest } = overrides;
  void _clock;
  return rest;
}

/** What `classifySocketFailure` produces for a dropped live connection. */
function socketIssue(): ConnectionIssue {
  return {
    id: "socket:api",
    kind: "socket",
    title: "A live connection was refused",
    detail: "",
    at: 0,
  };
}

function failure(message: string, status?: number): Error {
  const error = new Error(message);
  if (status !== undefined) Object.assign(error, { status });
  return error;
}

/** Boot to `roster-loaded` with the given roster. */
async function booted(
  roster: AgentSummary[],
  listAgents: SessionDeps["listAgents"],
): Promise<Harness> {
  const h = harness({ listAgents });
  h.machine.send({ type: "BOOT" });
  await flush();
  expect(h.machine.state.name).toBe("roster-loaded");
  expect(rosterOf(h.machine.state)).toEqual(roster);
  return h;
}

// ---------------------------------------------------------------------------

describe("SessionMachine — boot", () => {
  it("resolves credentials exactly once under a double BOOT (StrictMode)", async () => {
    const gate = deferred<AcpCredentials>();
    const h = harness({ resolveCredentials: () => gate.promise });

    // React <StrictMode> invokes the boot effect twice, synchronously.
    h.machine.send({ type: "BOOT" });
    h.machine.send({ type: "BOOT" });
    expect(h.machine.state.name).toBe("resolving-credentials");
    expect(h.calls.credentials).toBe(1);

    gate.resolve(CREDENTIALS);
    await flush();
    expect(h.calls.credentials).toBe(1);
    expect(h.calls.clients).toBe(1);
  });

  it("BOOT after boot is ignored", async () => {
    const h = harness({ listAgents: async () => [agent("a")] });
    h.machine.send({ type: "BOOT" });
    await flush();
    expect(h.machine.state.name).toBe("roster-loaded");

    h.machine.send({ type: "BOOT" });
    await flush();
    expect(h.calls.credentials).toBe(1);
    expect(h.machine.state.name).toBe("roster-loaded");
  });

  it("reaches authenticated on resolve, then roster-loaded on ROSTER_OK", async () => {
    const gate = deferred<AgentSummary[]>();
    const h = harness({ listAgents: () => gate.promise });

    h.machine.send({ type: "BOOT" });
    await flush();

    expect(h.machine.state.name).toBe("authenticated");
    const session = sessionOf(h.machine.state);
    expect(session.credentials).toBe(CREDENTIALS);
    expect(session.endpoints).toBe(ENDPOINTS);
    expect(session.client).toBe(CLIENT);
    expect(session.epoch).toBe(1);
    // `authenticated` may open the deployment-events subscription; `degraded`
    // may not. Assert the distinction exists here where it is true.
    expect(mayOpenSubscriptions(h.machine.state)).toBe(true);
    expect(() => rosterOf(h.machine.state)).toThrow(/no roster exists in "authenticated"/);

    gate.resolve([agent("a"), agent("b")]);
    await flush();
    expect(h.machine.state.name).toBe("roster-loaded");
    expect(rosterOf(h.machine.state).map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("an externally pushed ROSTER_OK for the live epoch is accepted", async () => {
    const gate = deferred<AgentSummary[]>();
    const h = harness({ listAgents: () => gate.promise });
    h.machine.send({ type: "BOOT" });
    await flush();

    const epoch = sessionOf(h.machine.state).epoch;
    h.machine.send({ type: "ROSTER_OK", epoch, roster: [agent("z")] });
    expect(h.machine.state.name).toBe("roster-loaded");
    expect(rosterOf(h.machine.state).map((a) => a.id)).toEqual(["z"]);

    // ... and one for a stale epoch is not.
    h.machine.send({ type: "ROSTER_OK", epoch: epoch - 1, roster: [] });
    expect(rosterOf(h.machine.state).map((a) => a.id)).toEqual(["z"]);
  });

  it("a pushed ROSTER_OK supersedes the in-flight read rather than racing it", async () => {
    // A pushed event carries no attempt id by definition, and the cancel used
    // to be conditional on there being one — so the `listAgents` call still
    // open kept running and, landing second, rewound the roster to the older
    // value the push had already superseded.
    const gate = deferred<AgentSummary[]>();
    let signal: AbortSignal | null = null;
    let first = true;
    const h = await booted([agent("a")], (_session, sig) => {
      if (first) {
        first = false;
        return Promise.resolve([agent("a")]);
      }
      signal = sig;
      return gate.promise;
    });
    const epoch = sessionOf(h.machine.state).epoch;

    h.machine.send({ type: "REFRESH" });
    await flush();
    h.machine.send({ type: "ROSTER_OK", epoch, roster: [agent("z")] });
    expect(rosterOf(h.machine.state).map((a) => a.id)).toEqual(["z"]);
    expect((signal as unknown as AbortSignal).aborted).toBe(true);

    gate.resolve([agent("a")]);
    await flush();
    expect(
      rosterOf(h.machine.state).map((a) => a.id),
      "an older read must not overwrite a newer push",
    ).toEqual(["z"]);
  });

  it("an empty roster is a real empty result, not a failure", async () => {
    const h = harness({ listAgents: async () => [] });
    h.machine.send({ type: "BOOT" });
    await flush();
    expect(h.machine.state.name).toBe("roster-loaded");
    expect(rosterOf(h.machine.state)).toEqual([]);
    expect(h.issues).toEqual([]);
  });
});

describe("SessionMachine — no credential", () => {
  it('a "no credential" throw is unauthenticated{no-credential}', async () => {
    const h = harness({
      resolveCredentials: async () => {
        throw new MissingCredentialError(
          "No API credential available. Run the desktop app, or set HYPER_API_KEY in the environment that starts the dev server.",
        );
      },
    });
    h.machine.send({ type: "BOOT" });
    await flush();

    const state = h.machine.state;
    expect(state.name).toBe("unauthenticated");
    if (state.name !== "unauthenticated") throw new Error("unreachable");
    expect(state.reason).toBe("no-credential");
    expect(state.detail).toMatch(/No API credential available/);
    expect(h.calls.clients).toBe(0);
    // Nothing was published: "you have no key yet" is a screen, not a fault.
    expect(h.issues).toEqual([]);
  });

  it("the sentinel class routes to unauthenticated without matching on prose", async () => {
    // The class is the whole contract — this message matches nothing any
    // classifier has ever looked for, and it must still sign out.
    const h = harness({
      resolveCredentials: async () => {
        throw new MissingCredentialError("nothing here that mentions the usual words");
      },
    });
    h.machine.send({ type: "BOOT" });
    await flush();
    const state = h.machine.state;
    expect(state.name).toBe("unauthenticated");
    if (state.name !== "unauthenticated") throw new Error("unreachable");
    expect(state.reason).toBe("no-credential");
  });

  it.each(RUST_ABSENT_CREDENTIAL_MESSAGES)(
    "the Rust ConfigError %j is absent, not unreachable",
    async (rustMessage) => {
      // Exactly what the packaged app sees on a fresh install: `acp_credentials`
      // rejects with a bare `ConfigError::Display` string, `credentials.ts`
      // normalises it, and the machine must land on the sign-in screen — not
      // on the sessionless `degraded` splash this used to dead-end into.
      const h = harness({
        resolveCredentials: async () => {
          throw normalizeCredentialError(rustMessage);
        },
      });
      h.machine.send({ type: "BOOT" });
      await flush();

      const state = h.machine.state;
      expect(state.name).toBe("unauthenticated");
      if (state.name !== "unauthenticated") throw new Error("unreachable");
      expect(state.reason).toBe("no-credential");
      expect(state.detail).toBe(rustMessage);
      expect(h.issues).toEqual([]);
    },
  );

  it("an unrecognised credential-probe failure does not fall back to message matching", async () => {
    // The old fallback regex would have read this as "no key". Under the
    // allow-list default it is `degraded` with a retry, which is the safe
    // direction for a failure nobody has classified yet.
    const h = harness({
      resolveCredentials: async () => {
        throw new Error("no api key configured somewhere unexpected");
      },
    });
    h.machine.send({ type: "BOOT" });
    await flush();

    const state = h.machine.state;
    expect(state.name).toBe("degraded");
    if (state.name !== "degraded") throw new Error("unreachable");
    expect(state.retryDelay).toBe(1000);
  });

  it("KEY_SAVED from unauthenticated re-enters resolving-credentials", async () => {
    let fail = true;
    const h = harness({
      resolveCredentials: async () => {
        if (fail) throw new MissingCredentialError();
        return CREDENTIALS;
      },
      listAgents: async () => [agent("a")],
    });
    h.machine.send({ type: "BOOT" });
    await flush();
    expect(h.machine.state.name).toBe("unauthenticated");

    fail = false;
    h.machine.send({ type: "KEY_SAVED" });
    expect(h.machine.state.name).toBe("resolving-credentials");
    await flush();
    expect(h.machine.state.name).toBe("roster-loaded");
    expect(sessionOf(h.machine.state).epoch).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The load-bearing edge.
// ---------------------------------------------------------------------------

describe("SessionMachine — UNREACHABLE never means signed out", () => {
  const BLOCKED =
    "a blocked fetch (CORS/CSP/offline) must degrade, never sign the user out: routing it to the " +
    "sign-in screen is how a packaged CSP regression disguises itself as an auth failure (App.tsx:145)";

  it("TypeError: Failed to fetch while resolving credentials ⇒ degraded", async () => {
    const h = harness({
      resolveCredentials: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    h.machine.send({ type: "BOOT" });
    await flush();

    // `not.toBe("unauthenticated")` immediately after `toBe("degraded")` is
    // tautological — it can never fail on its own. What actually distinguishes
    // the two outcomes is what the state *carries*, so assert that instead.
    const state = h.machine.state;
    expect(state.name, BLOCKED).toBe("degraded");
    if (state.name !== "degraded") throw new Error("unreachable");
    expect(state.issue.kind).toBe("blocked");
    // It is a *retrying* state, not a resting one: a sign-out has neither.
    expect(state.retryDelay).toBe(1000);
    expect(h.clock.pending).toBe(1);
    // Terminal-with-a-reason: it published to the one error surface.
    expect(h.issues.map((i) => i.kind)).toEqual(["blocked"]);
    // No session yet, so the accessors must refuse rather than hand back junk.
    expect(isReady(state)).toBe(false);
    expect(() => sessionOf(state)).toThrow(/before any credential ever resolved/);
  });

  it("a plain Error('Failed to fetch') while resolving credentials ⇒ degraded", async () => {
    // `classifyConnectionError` says "blocked" only for `instanceof TypeError`
    // *and* a matching message, so this one classifies as `unknown` — and under
    // the old "anything unrecognised is a missing key" default it landed on the
    // sign-in screen. The default is now `degraded`, so only a positively
    // identified missing credential can sign the user out.
    const h = harness({
      resolveCredentials: async () => {
        throw new Error("Failed to fetch");
      },
    });
    h.machine.send({ type: "BOOT" });
    await flush();

    const state = h.machine.state;
    expect(state.name, BLOCKED).toBe("degraded");
    if (state.name !== "degraded") throw new Error("unreachable");
    expect(state.issue.kind).toBe("unknown");
    expect(state.retryDelay).toBe(1000);
  });

  it("undici's TypeError: fetch failed ⇒ degraded", async () => {
    // Not matched by the classifier's regex either. Same reasoning.
    const h = harness({
      resolveCredentials: async () => {
        throw new TypeError("fetch failed");
      },
    });
    h.machine.send({ type: "BOOT" });
    await flush();
    expect(h.machine.state.name, BLOCKED).toBe("degraded");
  });

  it("TypeError: Failed to fetch while loading the roster ⇒ degraded", async () => {
    const h = harness({
      listAgents: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    h.machine.send({ type: "BOOT" });
    await flush();

    expect(h.machine.state.name, BLOCKED).toBe("degraded");
    // A degraded session is still a usable session — that is the whole point,
    // and it is what a sign-out would *not* have left behind.
    expect(sessionOf(h.machine.state).epoch).toBe(1);
    expect(isReady(h.machine.state)).toBe(true);
    expect(rosterOf(h.machine.state)).toEqual([]);
    // But no new subscription may be opened until it recovers.
    expect(mayOpenSubscriptions(h.machine.state)).toBe(false);
  });

  it("TypeError: Failed to fetch while building the client ⇒ degraded", async () => {
    // The untested leg of the load-bearing guard: `createClient` is the second
    // await in `runResolve`, past the credential probe, and it is the one that
    // actually touches the network in a packaged webview.
    const h = harness({
      createClient: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    h.machine.send({ type: "BOOT" });
    await flush();

    const state = h.machine.state;
    expect(state.name, BLOCKED).toBe("degraded");
    if (state.name !== "degraded") throw new Error("unreachable");
    expect(state.issue.kind).toBe("blocked");
    expect(h.calls.credentials).toBe(1);
    expect(h.calls.clients).toBe(1);
    // The credential resolved but the session was never built, so there is
    // nothing to render a workspace against.
    expect(isReady(state)).toBe(false);
    expect(h.machine.epoch).toBe(0);
  });

  it("an HTTP 500 is degraded too, not a sign-out", async () => {
    const h = harness({
      listAgents: async () => {
        throw failure("Internal Server Error", 500);
      },
    });
    h.machine.send({ type: "BOOT" });
    await flush();
    expect(h.machine.state.name).toBe("degraded");
    expect(h.issues.map((i) => i.kind)).toEqual(["server"]);
  });
});

describe("SessionMachine — expiry", () => {
  it("a 401 from the roster is expired, and KEY_SAVED goes back through resolving-credentials", async () => {
    let firstBoot = true;
    const gate = deferred<AcpCredentials>();
    const h = harness({
      resolveCredentials: () => (firstBoot ? Promise.resolve(CREDENTIALS) : gate.promise),
      listAgents: async () => {
        throw failure("Unauthorized", 401);
      },
    });

    h.machine.send({ type: "BOOT" });
    await flush();
    const state = h.machine.state;
    expect(state.name).toBe("expired");
    if (state.name !== "expired") throw new Error("unreachable");
    expect(state.issue.kind).toBe("auth");
    expect(h.issues.map((i) => i.kind)).toEqual(["auth"]);
    // The rejected credential and everything read with it are dropped.
    expect(() => sessionOf(h.machine.state)).toThrow(/no session exists in "expired"/);
    expect(() => rosterOf(h.machine.state)).toThrow(/no roster exists in "expired"/);
    expect(mayOpenSubscriptions(h.machine.state)).toBe(false);

    firstBoot = false;
    h.machine.send({ type: "KEY_SAVED" });
    expect(h.machine.state.name).toBe("resolving-credentials");
    expect(h.calls.credentials).toBe(2);
    gate.resolve(CREDENTIALS);
    await flush();
    // A second credential resolution, so a second epoch.
    expect(h.machine.epoch).toBe(2);
  });

  it("a 401 during credential resolution is expired, not unauthenticated", async () => {
    const h = harness({
      resolveCredentials: async () => {
        throw failure("Unauthorized", 401);
      },
    });
    h.machine.send({ type: "BOOT" });
    await flush();
    expect(h.machine.state.name).toBe("expired");
  });
});

describe("SessionMachine — degraded", () => {
  it("retains the last known roster and backs off, resetting on recovery", async () => {
    let outcome: "ok" | "fail" = "ok";
    let roster = [agent("a")];
    const h = await booted([agent("a")], async () => {
      if (outcome === "fail") throw new TypeError("Failed to fetch");
      return roster;
    });

    // First failure.
    outcome = "fail";
    h.machine.send({ type: "REFRESH" });
    await flush();
    let state = h.machine.state;
    expect(state.name).toBe("degraded");
    if (state.name !== "degraded") throw new Error("unreachable");
    expect(state.roster.map((a) => a.id)).toEqual(["a"]);
    expect(state.retryDelay).toBe(1000);
    expect(state.failures).toBe(1);
    expect(state.retryAt).toBe(h.clock.now() + 1000);

    // Nothing happens before the backoff is due.
    const before = h.calls.rosters;
    h.clock.advance(999);
    await flush();
    expect(h.calls.rosters).toBe(before);

    // ... and the retry fires exactly when it is due, doubling on failure.
    h.clock.advance(1);
    await flush();
    expect(h.calls.rosters).toBe(before + 1);
    state = h.machine.state;
    if (state.name !== "degraded") throw new Error("unreachable");
    expect(state.retryDelay).toBe(2000);
    expect(state.failures).toBe(2);
    // The retained roster survives every retry.
    expect(state.roster.map((a) => a.id)).toEqual(["a"]);
    expect(mayOpenSubscriptions(state)).toBe(false);

    // Recovery: back to roster-loaded, backoff reset, issue cleared.
    outcome = "ok";
    roster = [agent("a"), agent("b")];
    h.clock.advance(2000);
    await flush();
    expect(h.machine.state.name).toBe("roster-loaded");
    expect(rosterOf(h.machine.state).map((a) => a.id)).toEqual(["a", "b"]);
    expect(h.cleared).toEqual([`blocked:${new URL(ENDPOINTS.httpBase).host}`]);

    // Backoff was reset, so the next failure waits `base` again, not 4000.
    outcome = "fail";
    h.machine.send({ type: "REFRESH" });
    await flush();
    state = h.machine.state;
    if (state.name !== "degraded") throw new Error("unreachable");
    expect(state.retryDelay).toBe(1000);
    expect(state.failures).toBe(1);
  });

  it("caps the delay at max and never stops retrying", async () => {
    const h = harness({
      resolveCredentials: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    h.machine.send({ type: "BOOT" });
    await flush();

    const delays: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const state = h.machine.state;
      if (state.name !== "degraded") throw new Error(`expected degraded, got ${state.name}`);
      delays.push(state.retryDelay);
      h.clock.advance(state.retryDelay);
      await flush();
    }
    // base 1000, max 8000: no state is a silent dead end (guarantee 5).
    expect(delays).toEqual([1000, 2000, 4000, 8000, 8000]);
    // Six failures, one entry on the bar. The real bus dedupes by `id`, so a
    // retry loop that re-reports every tick must not read as six problems.
    expect(h.issues).toHaveLength(1);
  });

  it("REFRESH is ignored in degraded — the backoff timer owns the schedule", async () => {
    const h = harness({
      listAgents: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    h.machine.send({ type: "BOOT" });
    await flush();
    const state = h.machine.state;
    if (state.name !== "degraded") throw new Error("unreachable");
    const before = h.calls.rosters;

    // Poll-driven refreshes arrive continuously from the UI. If one of them
    // could re-run the load, `degraded` would dial at the poll rate and the
    // backoff would never be consulted at all (guarantee 3).
    for (let i = 0; i < 10; i += 1) h.machine.send({ type: "REFRESH" });
    await flush();
    expect(h.calls.rosters).toBe(before);
    expect(h.machine.state).toBe(state);
    // ... and the armed retry is untouched, not re-armed ten times.
    expect(h.clock.pending).toBe(1);
  });

  it("SOCKET_DOWN degrades from roster-loaded and RETRY resets the backoff", async () => {
    let outcome: "ok" | "fail" = "ok";
    const h = await booted([agent("a")], async () => {
      if (outcome === "fail") throw new TypeError("Failed to fetch");
      return [agent("a")];
    });
    const epoch = sessionOf(h.machine.state).epoch;

    outcome = "fail";
    h.machine.send({ type: "REFRESH" });
    await flush();
    h.clock.advance(1000);
    await flush();
    let state = h.machine.state;
    if (state.name !== "degraded") throw new Error("unreachable");
    expect(state.retryDelay).toBe(2000);

    // "Resets backoff" — the next wait is `base` again, not 4000.
    const beforeRetry = h.calls.rosters;
    h.machine.send({ type: "RETRY" });
    await flush();
    state = h.machine.state;
    if (state.name !== "degraded") throw new Error("unreachable");
    expect(state.retryDelay).toBe(1000);
    expect(h.calls.rosters).toBe(beforeRetry + 1);

    // A dropped subscription degrades a healthy roster-loaded state.
    outcome = "ok";
    h.clock.advance(1000);
    await flush();
    expect(h.machine.state.name).toBe("roster-loaded");
    h.machine.send({ type: "SOCKET_DOWN", epoch, issue: socketIssue() });
    state = h.machine.state;
    expect(state.name).toBe("degraded");
    if (state.name !== "degraded") throw new Error("unreachable");
    expect(state.cause).toBe("socket");
    expect(rosterOf(h.machine.state).map((a) => a.id)).toEqual(["a"]);
  });

  it("a manual RETRY does not bypass its floor", async () => {
    // FSM.md §3, second half. Measured from `roster-loaded`, where no backoff
    // timer is armed, so the only thing under test is the floor.
    const h = await booted([agent("a")], async () => [agent("a")]);
    const before = h.calls.rosters;

    for (let i = 0; i < 20; i += 1) h.machine.send({ type: "RETRY" });
    await flush();
    expect(h.calls.rosters, "20 clicks must not be 20 listAgents at t=0").toBe(before + 1);
    // One deferred retry, not nineteen: `after` replaces a same-named timer.
    expect(h.clock.pending).toBe(1);

    h.clock.advance(MANUAL_RETRY_FLOOR_MS - 1);
    await flush();
    expect(h.calls.rosters).toBe(before + 1);

    // The clicks are floored, not dropped — the last one still gets an outcome.
    h.clock.advance(1);
    await flush();
    expect(h.calls.rosters).toBe(before + 2);
    expect(h.clock.pending).toBe(0);
    expect(h.machine.state.name).toBe("roster-loaded");
  });

  it("a RETRY the guard refuses leaves no trace behind it", async () => {
    // The reset used to run *before* the switch that decides whether to
    // reject, so the two states that "reject" had already mutated the backoff
    // by the time they returned. A guard rejects; it does not half-apply.
    const gate = deferred<AcpCredentials>();
    let call = 0;
    const h = harness({
      resolveCredentials: () => {
        call += 1;
        return call === 1 ? Promise.reject(new TypeError("Failed to fetch")) : gate.promise;
      },
    });
    h.machine.send({ type: "BOOT" });
    await flush();
    let state = h.machine.state;
    if (state.name !== "degraded") throw new Error("unreachable");
    expect(state.retryDelay).toBe(1000);

    h.clock.advance(1000);
    await flush();
    expect(h.machine.state.name).toBe("resolving-credentials");

    h.machine.send({ type: "RETRY" });
    expect(h.machine.state.name).toBe("resolving-credentials");
    expect(h.calls.credentials).toBe(2);

    gate.reject(new TypeError("Failed to fetch"));
    await flush();
    state = h.machine.state;
    if (state.name !== "degraded") throw new Error("unreachable");
    expect(state.retryDelay, "a refused RETRY must not have reset the backoff").toBe(2000);
    expect(state.failures).toBe(2);
  });

  it("a SOCKET_DOWN from a stale epoch is refused", async () => {
    const h = await booted([agent("a")], async () => [agent("a")]);
    const epoch = sessionOf(h.machine.state).epoch;

    // A socket from a previous credential is not evidence about this one. It
    // is exactly what a late teardown of the *old* subscription produces.
    h.machine.send({ type: "SOCKET_DOWN", epoch: epoch - 1, issue: socketIssue() });
    expect(h.machine.state.name).toBe("roster-loaded");
    expect(h.issues).toEqual([]);
    expect(h.clock.pending).toBe(0);
  });

  it("a roster read that started before a SOCKET_DOWN cannot un-degrade it", async () => {
    // The guarantee-3 hole: the GET was already open when the socket dropped,
    // so its success describes the world *before* the outage. Letting it land
    // rewinds to `roster-loaded`, resets the backoff that would have paced
    // recovery, cancels the retry and clears the issue — while the socket is
    // still down and nothing is left to re-dial it.
    const gate = deferred<AgentSummary[]>();
    let first = true;
    const h = await booted([agent("a")], async () => {
      if (first) {
        first = false;
        return [agent("a")];
      }
      return gate.promise;
    });
    const epoch = sessionOf(h.machine.state).epoch;

    h.machine.send({ type: "REFRESH" });
    await flush();
    h.machine.send({ type: "SOCKET_DOWN", epoch, issue: socketIssue() });
    expect(h.machine.state.name).toBe("degraded");
    expect(h.issues.map((i) => i.id)).toEqual(["socket:api"]);

    gate.resolve([agent("a"), agent("b")]);
    await flush();

    const state = h.machine.state;
    expect(state.name, "a read from before the drop must not resolve the outage").toBe("degraded");
    if (state.name !== "degraded") throw new Error("unreachable");
    expect(state.roster.map((a) => a.id)).toEqual(["a"]);
    expect(state.retryDelay).toBe(1000);
    expect(h.clock.pending).toBe(1);
    expect(h.cleared).toEqual([]);
    expect(h.issues.map((i) => i.id)).toEqual(["socket:api"]);
  });

  it("recovering from a SOCKET_DOWN keeps its pacing until SOCKET_UP", async () => {
    // A roster GET proves the request channel works. It says nothing about the
    // socket, so it must not retire the backoff: otherwise every
    // redial → fail → roster-ok cycle resets the pacing and "recovery" is a
    // one-second reconnect loop.
    const h = await booted([agent("a")], async () => [agent("a")]);
    const epoch = sessionOf(h.machine.state).epoch;

    h.machine.send({ type: "SOCKET_DOWN", epoch, issue: socketIssue() });
    let state = h.machine.state;
    if (state.name !== "degraded") throw new Error("unreachable");
    expect(state.retryDelay).toBe(1000);

    h.clock.advance(1000);
    await flush();
    expect(h.machine.state.name).toBe("roster-loaded");
    expect(mayOpenSubscriptions(h.machine.state)).toBe(true);
    expect(h.cleared).toEqual(["socket:api"]);

    // The redial fails again: the wait grows rather than restarting at base.
    h.machine.send({ type: "SOCKET_DOWN", epoch, issue: socketIssue() });
    state = h.machine.state;
    if (state.name !== "degraded") throw new Error("unreachable");
    expect(state.retryDelay).toBe(2000);

    // The owner's socket finally opens: *that* is the recovery signal.
    h.clock.advance(2000);
    await flush();
    expect(h.machine.state.name).toBe("roster-loaded");
    h.machine.send({ type: "SOCKET_UP", epoch });
    h.machine.send({ type: "SOCKET_DOWN", epoch, issue: socketIssue() });
    state = h.machine.state;
    if (state.name !== "degraded") throw new Error("unreachable");
    expect(state.retryDelay).toBe(1000);
  });

  it("with no session at all, the backoff retries credential resolution", async () => {
    let fail = true;
    const h = harness({
      resolveCredentials: async () => {
        if (fail) throw new TypeError("Failed to fetch");
        return CREDENTIALS;
      },
      listAgents: async () => [agent("a")],
    });
    h.machine.send({ type: "BOOT" });
    await flush();
    expect(h.machine.state.name).toBe("degraded");
    expect(h.calls.credentials).toBe(1);

    fail = false;
    h.clock.advance(1000);
    await flush();
    expect(h.calls.credentials).toBe(2);
    expect(h.machine.state.name).toBe("roster-loaded");
    expect(sessionOf(h.machine.state).epoch).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Guarantee 5: no silent dead ends. A promise that never settles is the way a
// state becomes one, and three of them could.
// ---------------------------------------------------------------------------

describe("SessionMachine — deadlines", () => {
  const HUNG = "a hung promise must not become a state with no reason and no way out";

  it("resolving-credentials fails with a reason when the probe never answers", async () => {
    // `api.ts` memoises `sdkPromise`, so one wedged `acp_credentials` IPC also
    // wedges every later `sdk()` caller: the app sits on a splash forever.
    const gate = deferred<AcpCredentials>();
    const h = harness({ resolveCredentials: () => gate.promise });
    h.machine.send({ type: "BOOT" });
    await flush();
    expect(h.machine.state.name).toBe("resolving-credentials");
    // RETRY is explicitly refused here, so the timer is the only way out.
    h.machine.send({ type: "RETRY" });
    expect(h.machine.state.name).toBe("resolving-credentials");

    h.clock.advance(CREDENTIAL_DEADLINE_MS - 1);
    await flush();
    expect(h.machine.state.name).toBe("resolving-credentials");

    h.clock.advance(1);
    await flush();
    const state = h.machine.state;
    expect(state.name, HUNG).toBe("degraded");
    if (state.name !== "degraded") throw new Error("unreachable");
    expect(state.issue.id).toBe("timeout:credentials");
    expect(h.issues.map((i) => i.id)).toEqual(["timeout:credentials"]);
    // And it retries on its own, so the deadline is not itself a dead end.
    expect(state.retryDelay).toBe(1000);
    expect(h.calls.credentials).toBe(1);
    h.clock.advance(1000);
    await flush();
    expect(h.calls.credentials).toBe(2);
  });

  it("authenticated fails with a reason when the roster never answers", async () => {
    const gate = deferred<AgentSummary[]>();
    const h = harness({ listAgents: () => gate.promise });
    h.machine.send({ type: "BOOT" });
    await flush();
    expect(h.machine.state.name).toBe("authenticated");
    // The state that made this worst than the others: it was a dead end that
    // also told the rest of the app it was safe to open subscriptions.
    expect(mayOpenSubscriptions(h.machine.state)).toBe(true);

    h.clock.advance(ROSTER_DEADLINE_MS);
    await flush();
    const state = h.machine.state;
    expect(state.name, HUNG).toBe("degraded");
    if (state.name !== "degraded") throw new Error("unreachable");
    expect(state.issue.id).toBe("timeout:roster");
    expect(state.issue.host).toBe(new URL(ENDPOINTS.httpBase).host);
    expect(mayOpenSubscriptions(state)).toBe(false);
    // The session survives — it is the roster that is unknown, not the key.
    expect(sessionOf(state).epoch).toBe(1);
  });

  it("signing-out completes locally when logout never answers", async () => {
    // No event can leave `signing-out`, so a backend that never replies used
    // to strand the user on a screen that says it is signing them out.
    const h = harness({
      listAgents: async () => [agent("a")],
      logout: () => deferred<void>().promise,
    });
    h.machine.send({ type: "BOOT" });
    await flush();
    h.machine.send({ type: "SIGN_OUT" });
    expect(h.machine.state.name).toBe("signing-out");
    expect(h.machine.epoch).toBe(1);

    h.clock.advance(SIGN_OUT_DEADLINE_MS);
    await flush();
    const state = h.machine.state;
    expect(state.name, HUNG).toBe("unauthenticated");
    if (state.name !== "unauthenticated") throw new Error("unreachable");
    expect(state.reason).toBe("signed-out");
    // Local state drops regardless: the alternative is a session the user
    // believes is gone. The epoch advances so late promises are discarded.
    expect(h.machine.epoch).toBe(2);
    expect(h.issues.map((i) => i.id)).toEqual(["timeout:sign-out"]);
    expect(h.clock.pending).toBe(0);
  });

  it("a deadline that lapses after the attempt was superseded does nothing", async () => {
    const h = await booted([agent("a")], async () => [agent("a")]);
    // The roster load already completed; its deadline must have gone with it.
    expect(h.clock.pending).toBe(0);
    h.clock.advance(ROSTER_DEADLINE_MS * 2);
    await flush();
    expect(h.machine.state.name).toBe("roster-loaded");
    expect(h.issues).toEqual([]);
  });
});

describe("SessionMachine — sign-out", () => {
  it("aborts the in-flight attempt, bumps the epoch, and discards a late promise", async () => {
    const gate = deferred<AgentSummary[]>();
    let signal: AbortSignal | null = null;
    const logoutGate = deferred<void>();
    const h = harness({
      listAgents: (_session, sig) => {
        signal = sig;
        return gate.promise;
      },
      logout: () => logoutGate.promise,
    });

    h.machine.send({ type: "BOOT" });
    await flush();
    expect(h.machine.state.name).toBe("authenticated");
    const stale = sessionOf(h.machine.state);
    expect(h.machine.epoch).toBe(1);

    h.machine.send({ type: "SIGN_OUT" });
    expect(h.machine.state.name).toBe("signing-out");
    // 1. the in-flight roster attempt is aborted, not abandoned
    expect((signal as unknown as AbortSignal).aborted).toBe(true);
    // 2. the epoch is bumped only once logout() has actually returned
    expect(h.machine.epoch).toBe(1);

    logoutGate.resolve(undefined);
    await flush();
    expect(h.calls.logouts).toBe(1);
    expect(h.machine.epoch).toBe(2);
    const state = h.machine.state;
    expect(state.name).toBe("unauthenticated");
    if (state.name !== "unauthenticated") throw new Error("unreachable");
    expect(state.reason).toBe("signed-out");

    // 3. a promise from the old epoch that resolves late changes nothing
    gate.resolve([agent("ghost")]);
    await flush();
    expect(h.machine.state.name).toBe("unauthenticated");

    // ... and an event minted against the old epoch is refused outright.
    h.machine.send({ type: "ROSTER_OK", epoch: stale.epoch, roster: [agent("ghost")] });
    expect(h.machine.state.name).toBe("unauthenticated");
  });

  it("a failing logout still drops the session and reports why", async () => {
    const h = harness({
      listAgents: async () => [agent("a")],
      logout: async () => {
        throw failure("keychain locked");
      },
    });
    h.machine.send({ type: "BOOT" });
    await flush();
    h.machine.send({ type: "SIGN_OUT" });
    await flush();
    expect(h.machine.state.name).toBe("unauthenticated");
    expect(h.machine.epoch).toBe(2);
    expect(h.issues.some((i) => i.title.startsWith("Sign out"))).toBe(true);
  });

  it("SIGN_OUT is accepted from degraded and expired, and ignored from unauthenticated", async () => {
    const h = harness({
      listAgents: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    h.machine.send({ type: "BOOT" });
    await flush();
    expect(h.machine.state.name).toBe("degraded");

    h.machine.send({ type: "SIGN_OUT" });
    await flush();
    expect(h.machine.state.name).toBe("unauthenticated");
    // The degraded backoff timer must not survive the sign-out.
    expect(h.clock.pending).toBe(0);

    const epoch = h.machine.epoch;
    h.machine.send({ type: "SIGN_OUT" });
    await flush();
    expect(h.machine.epoch).toBe(epoch);
    expect(h.calls.logouts).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The bar is a shared surface, so anything `degraded` publishes it must also
// retract. Clearing only on recovery pinned an issue to every other exit.
// ---------------------------------------------------------------------------

describe("SessionMachine — degraded owns its issue for as long as it is degraded", () => {
  async function degradedHarness(extra: Partial<SessionDeps> = {}): Promise<Harness> {
    const h = harness({
      listAgents: async () => {
        throw new TypeError("Failed to fetch");
      },
      ...extra,
    });
    h.machine.send({ type: "BOOT" });
    await flush();
    expect(h.machine.state.name).toBe("degraded");
    expect(h.issues).toHaveLength(1);
    return h;
  }

  const BLOCKED_ID = `blocked:${new URL(ENDPOINTS.httpBase).host}`;

  it("SIGN_OUT clears it — not left pinned behind the sign-in screen", async () => {
    const h = await degradedHarness();
    h.machine.send({ type: "SIGN_OUT" });
    await flush();
    expect(h.machine.state.name).toBe("unauthenticated");
    expect(h.cleared).toEqual([BLOCKED_ID]);
    expect(h.issues, "'couldn't reach the server' must not outlive the session").toEqual([]);
  });

  it("a retry that finds no credential clears it", async () => {
    // Sessionless degraded — the state a boot-time `Failed to fetch` produces.
    // Telling the user they have no key while "couldn't reach the server" is
    // still on the bar is two contradictory explanations at once.
    let fail = true;
    const h = harness({
      resolveCredentials: async () => {
        if (fail) throw new TypeError("Failed to fetch");
        throw new MissingCredentialError();
      },
    });
    h.machine.send({ type: "BOOT" });
    await flush();
    expect(h.machine.state.name).toBe("degraded");
    expect(h.issues.map((i) => i.id)).toEqual(["blocked:unknown"]);

    fail = false;
    h.clock.advance(1000);
    await flush();
    expect(h.machine.state.name).toBe("unauthenticated");
    expect(h.cleared).toEqual(["blocked:unknown"]);
    expect(h.issues).toEqual([]);
  });

  it("an expiry clears it and leaves only the auth issue", async () => {
    let status: number | null = null;
    const h = await degradedHarness({
      listAgents: async () => {
        if (status === null) throw new TypeError("Failed to fetch");
        throw failure("Unauthorized", status);
      },
    });

    status = 401;
    h.clock.advance(1000);
    await flush();
    expect(h.machine.state.name).toBe("expired");
    expect(h.cleared).toEqual([BLOCKED_ID]);
    expect(h.issues.map((i) => i.kind)).toEqual(["auth"]);
  });

  it("a degraded→degraded hop with a different cause clears the old one", async () => {
    let status: number | null = null;
    const h = await degradedHarness({
      listAgents: async () => {
        if (status === null) throw new TypeError("Failed to fetch");
        throw failure("Internal Server Error", status);
      },
    });

    status = 500;
    h.clock.advance(1000);
    await flush();
    expect(h.machine.state.name).toBe("degraded");
    expect(h.cleared).toEqual([BLOCKED_ID]);
    expect(h.issues.map((i) => i.kind), "one problem at a time on the bar").toEqual(["server"]);
  });

  it("a retry loop re-reporting the same failure does not stack entries", async () => {
    const h = await degradedHarness();
    for (let i = 0; i < 5; i += 1) {
      const state = h.machine.state;
      if (state.name !== "degraded") throw new Error(`expected degraded, got ${state.name}`);
      h.clock.advance(state.retryDelay);
      await flush();
    }
    expect(h.issues).toHaveLength(1);
    expect(h.cleared).toEqual([]);
  });
});

describe("accessors", () => {
  const states: SessionState[] = [
    { name: "booting" },
    { name: "resolving-credentials", attempt: 1, since: 0 },
    { name: "unauthenticated", reason: "no-credential", detail: null },
    { name: "signing-out", previous: null },
  ];

  it("sessionOf throws outside authenticated | roster-loaded | degraded", () => {
    for (const state of states) {
      expect(() => sessionOf(state), `sessionOf must refuse "${state.name}"`).toThrow(
        /no session exists/,
      );
      expect(isReady(state)).toBe(false);
      expect(mayOpenSubscriptions(state)).toBe(false);
    }
  });

  it("rosterOf throws outside roster-loaded | degraded", () => {
    const session = {
      credentials: CREDENTIALS,
      endpoints: ENDPOINTS,
      client: CLIENT,
      epoch: 1,
    } satisfies Session;
    for (const state of [...states, { name: "authenticated", session } as SessionState]) {
      expect(() => rosterOf(state), `rosterOf must refuse "${state.name}"`).toThrow(
        /no roster exists/,
      );
    }
  });

  it("a disposed machine cancels its armed retry and ignores further events", async () => {
    // Disposing from `roster-loaded` asserted nothing: that state has no timer,
    // so `pending === 0` held before dispose too. `degraded` is the state that
    // actually owns one.
    const h = harness({
      listAgents: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    h.machine.send({ type: "BOOT" });
    await flush();
    expect(h.machine.state.name).toBe("degraded");
    expect(h.clock.pending, "the retry is armed before dispose").toBe(1);

    h.machine.dispose();
    expect(h.clock.pending).toBe(0);
    // A disposed machine's issue has no owner left to retract it.
    expect(h.cleared).toEqual([`blocked:${new URL(ENDPOINTS.httpBase).host}`]);

    h.machine.send({ type: "SIGN_OUT" });
    await flush();
    expect(h.calls.logouts).toBe(0);
    expect(h.clock.pending).toBe(0);
  });
});

describe("resetSessionMachine", () => {
  it("replaces the singleton under test, and refuses to ship", () => {
    // It is a test-only hatch: in a shipped build it disposes the machine every
    // subscriber is bound to and installs one nothing is watching, freezing the
    // UI with no error. Vitest sets MODE=test, so the guard admits us here.
    const before = sessionMachine;
    const replacement = resetSessionMachine({ clock: new FakeClock() });
    expect(replacement).not.toBe(before);
    expect(before.disposed).toBe(true);
    expect(sessionMachine).toBe(replacement);
    replacement.dispose();
  });
});
