/**
 * Per-agent lifecycle machine — FSM.md §5.5.
 *
 * One instance per `agentId`, pooled at module level ({@link agentMachines}).
 * This replaces `App.tsx`'s `act()` wrapper and its `lifecycleErrors` map.
 *
 * ```
 * Stable → Applying → Settling → Stable
 *              ↓          ↓
 *            Failed ←─ DEADLINE
 * ```
 *
 * Both non-terminal states are on a clock. `Applying` waits
 * {@link APPLY_DEADLINE_MS} for the control plane to answer at all — `startAgent`
 * chains four SDK calls over a Tauri IPC that has no timeout of its own, and a
 * hang there used to park the machine forever: every op blocked by the guard,
 * `retry` refused because the state was not `Failed`, and no issue published
 * because only `Failed` publishes. `Settling` then waits
 * {@link SETTLE_DEADLINE_MS} for the *roster* to confirm.
 *
 * The state the old code lacked is **`Settling`**. `startAgent()` returns the
 * moment the control plane accepts the command; the agent is then `STARTING`,
 * not running. Today the button re-enables there and nothing correlates the
 * eventual `RUNNING` with the command that asked for it. `Settling` is a passive
 * wait driven by `ROSTER` events, which turns the roster refreshing underneath
 * us into the mechanism rather than a hazard — and it fails with a reason
 * ("still STARTING after 2 minutes") instead of pretending success.
 *
 * `restart` is one composite op with two steps: it issues `start` only after the
 * roster shows `STOPPED`. That matters because restart exists to rewrite
 * `OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN` (see `api.ts`) for origin-lock recovery,
 * and `stop(); start();` back-to-back races the control plane.
 *
 * Non-lifecycle one-shot mutations (desktop toggle, avatar upload/delete) have
 * no transition to wait for, so they are the degenerate case of the same
 * machine: `Applying → Stable | Failed` with no target predicate. They share the
 * instance rather than getting one of their own, which is what makes "one
 * in-flight operation per agent" true across the whole surface.
 *
 * **On backoff (FSM.md §2 guarantee 3).** This machine owns no `Backoff`,
 * because it has no automatic redial path to consult one from: a lifecycle
 * command is never retried on a timer — re-issuing `start` unattended would
 * double-start an agent. The only timers are the two deadlines, and the only
 * retry is the user-initiated {@link AgentMachine.retry}, which by construction
 * cannot bypass a delay that does not exist.
 *
 * **On retry (see {@link AgentFailureCause}).** `retry` may only re-issue a
 * command that demonstrably did *not* land. A deadline failure means the
 * opposite — the control plane accepted it and the agent is mid-transition —
 * so retrying there re-enters `Settling` instead of POSTing again.
 */

import { RUNNING, TRANSITIONAL } from "../agent-utils";
import type { ManagedAgentRuntime } from "../../../ts-sdk/src/agents.ts";
import {
  classifyConnectionError,
  clearConnectionIssue,
  reportConnectionIssue,
} from "./connection-errors";
import {
  assertNever,
  Machine,
  MachinePool,
  type Attempt,
  type Clock,
  type Disposable,
} from "./machine";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Every mutation the UI can ask for on one agent. */
export type AgentOp =
  | "start"
  | "stop"
  | "restart"
  | "archive"
  | "restore"
  | "delete"
  | "setDesktopEnabled"
  | "setRuntime"
  | "uploadAvatar"
  | "deleteAvatar"
  | "uploadVoice"
  | "deleteVoice";

/**
 * The single HTTP call in flight. Identical to {@link AgentOp} except that the
 * composite `restart` is never a step — it decomposes into `stop` then `start`.
 */
export type AgentStep = Exclude<AgentOp, "restart">;

/** Ops that must wait for the roster to confirm a deployment-state change. */
const SETTLING_OPS: ReadonlySet<AgentOp> = new Set<AgentOp>([
  "start",
  "stop",
  "restart",
  "archive",
  "restore",
  "delete",
]);

/** Ops with no transition to settle: `Applying → Stable | Failed`. */
function isOneShot(op: AgentOp): boolean {
  return !SETTLING_OPS.has(op);
}

/**
 * Sentinel for "observed, and not in the roster". Distinct from `null`, which
 * means "never observed" — FSM.md §2 guarantee 6: absent must not be
 * indistinguishable from unknown.
 */
export const ABSENT = "ABSENT";

export const ARCHIVED = "ARCHIVED";
export const STOPPED = "STOPPED";

/** How long `Settling` waits for the roster before giving up, in ms. */
export const SETTLE_DEADLINE_MS = 120_000;

/**
 * How long `Applying` waits for the control plane to answer *at all*, in ms.
 *
 * Deliberately much shorter than {@link SETTLE_DEADLINE_MS}: that one is a wait
 * for a container to boot, this one is a wait for a POST to return. Nothing
 * below this machine enforces an upper bound — `sdk()` awaits a Tauri IPC with
 * no timeout — so without it a hung port is a permanent park.
 */
export const APPLY_DEADLINE_MS = 30_000;

const DEADLINE_TIMER = "settle-deadline";
const APPLY_TIMER = "apply-deadline";

/**
 * The roster shape this machine reads. Structurally a subset of `AgentSummary`
 * (`src/api.ts`), declared locally so the machine — and its tests — never import
 * the SDK-bearing client layer.
 */
export interface AgentRosterEntry {
  readonly id: string;
  readonly state: string;
  /**
   * Whether the desktop route is enabled for this agent — the second half of
   * the Desktop row of FSM.md's capability table, which is otherwise not
   * derivable from anything the machine can see. Optional because the field is
   * the caller's to map (`has_desktop` on `AgentSummary`); when it is absent
   * the capability reads `false`, which is the safe answer for "unknown".
   */
  readonly desktopEnabled?: boolean;
}

/** What a command hands back, for callers that need to patch the roster. */
export interface AgentCommandOutcome {
  /** The agent as the control plane reported it, when the call returns one. */
  agent?: AgentRosterEntry | null;
  /** `uploadAvatar` / `deleteAvatar` only. */
  avatarUrl?: string | null;
  /** `uploadVoice` / `deleteVoice` only. */
  voiceAudioUrl?: string | null;
  /** Set when the avatar-audio routes answered 404/405 — environment lacks them. */
  voiceApiUnavailable?: boolean;
}

/**
 * Every network call the machine can make. Injected so tests need no network,
 * and so AGENTS.md rule 1 holds: the real implementation is nothing but a
 * forwarder to `src/api.ts`.
 */
export interface AgentLifecyclePort {
  start(id: string, signal: AbortSignal): Promise<AgentCommandOutcome | void>;
  stop(id: string, signal: AbortSignal): Promise<AgentCommandOutcome | void>;
  archive(id: string, signal: AbortSignal): Promise<AgentCommandOutcome | void>;
  restore(id: string, signal: AbortSignal): Promise<AgentCommandOutcome | void>;
  delete(id: string, signal: AbortSignal): Promise<AgentCommandOutcome | void>;
  setDesktopEnabled(
    id: string,
    enabled: boolean,
    signal: AbortSignal,
  ): Promise<AgentCommandOutcome | void>;
  setRuntime(
    id: string,
    runtime: ManagedAgentRuntime,
    resetImage: boolean,
    signal: AbortSignal,
  ): Promise<AgentCommandOutcome | void>;
  uploadAvatar(id: string, file: File, signal: AbortSignal): Promise<AgentCommandOutcome | void>;
  deleteAvatar(id: string, signal: AbortSignal): Promise<AgentCommandOutcome | void>;
  uploadVoice(id: string, file: File, signal: AbortSignal): Promise<AgentCommandOutcome | void>;
  deleteVoice(id: string, signal: AbortSignal): Promise<AgentCommandOutcome | void>;
}

/** Ops that carry no argument, so `request("start")` is spellable. */
export type SimpleAgentOp = Exclude<AgentOp, "setDesktopEnabled" | "setRuntime" | "uploadAvatar" | "uploadVoice">;

export type AgentCommand =
  | { op: SimpleAgentOp }
  | { op: "setDesktopEnabled"; enabled: boolean }
  | { op: "setRuntime"; runtime: ManagedAgentRuntime; resetImage: boolean }
  | { op: "uploadAvatar"; file: File }
  | { op: "uploadVoice"; file: File };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * `observed` is on every state deliberately: it is the last roster reading, and
 * it is what a future session index (§5.4) reads for agent readiness without
 * taking a reference on the machine. `null` = never observed,
 * {@link ABSENT} = observed and gone.
 */
export type AgentState =
  | {
      readonly name: "Stable";
      readonly observed: string | null;
      /** Result of the command that got us here, for roster patching. */
      readonly outcome: AgentCommandOutcome | null;
    }
  | {
      readonly name: "Applying";
      readonly observed: string | null;
      readonly op: AgentOp;
      readonly step: AgentStep;
      readonly command: AgentCommand;
      readonly attempt: number;
    }
  | {
      readonly name: "Settling";
      readonly observed: string | null;
      readonly op: AgentOp;
      readonly step: AgentStep;
      readonly command: AgentCommand;
      readonly attempt: number;
      readonly since: number;
      /** What the accepted command returned, carried through to `Stable`. */
      readonly outcome: AgentCommandOutcome;
    }
  | {
      readonly name: "Failed";
      readonly observed: string | null;
      readonly op: AgentOp;
      readonly step: AgentStep;
      readonly message: string;
      readonly error: unknown;
      /** Why it failed — this is what {@link AgentMachine.retry} branches on. */
      readonly cause: AgentFailureCause;
      /** The command that was being applied, for resuming the wait. */
      readonly command: AgentCommand;
      /** What {@link AgentMachine.retry} re-issues, when re-issuing is safe. */
      readonly resume: AgentCommand;
      /** The accepted command's result, when there was one. */
      readonly outcome: AgentCommandOutcome | null;
    };

/**
 * Why a command failed, which decides whether it is safe to send again.
 *
 * - `rejected` — the call itself threw. Nothing landed, so re-issuing is both
 *   safe and the only way forward, guard or no guard.
 * - `deadline` — the control plane *accepted* the command and the roster never
 *   confirmed it. The command landed and the agent is still moving; re-issuing
 *   `start` here would re-mint `OPENCLAW_GATEWAY_TOKEN` and rewrite
 *   `OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN` (see `api.ts`) against a mid-boot
 *   container.
 * - `unanswered` — the call never returned within {@link APPLY_DEADLINE_MS}. We
 *   cannot tell whether it landed, so it is treated as conservatively as
 *   `deadline`.
 */
export type AgentFailureCause = "rejected" | "deadline" | "unanswered";

export type AgentEvent =
  | { type: "REQUEST"; command: AgentCommand; force?: boolean }
  /** A roster refresh. `agent: null` means "not in the roster any more". */
  | { type: "ROSTER"; agent: AgentRosterEntry | null }
  | { type: "ACCEPTED"; attempt: number; outcome: AgentCommandOutcome }
  | { type: "REJECTED"; attempt: number; error: unknown }
  /** `apply` = the port never answered; `settle` = the roster never confirmed. */
  | { type: "DEADLINE"; attempt: number; phase: "apply" | "settle" }
  | { type: "RETRY" };

/**
 * FSM.md's capability table, one field per row, evaluated once here so no
 * consumer has to re-derive it — the previous arrangement had Sessions/Chat/
 * Logs/Shell derived two disagreeing ways (`observed === RUNNING` in one place,
 * `readiness.ready` in another, which folds in `!busy` and so would drop chat
 * for two minutes because of an unrelated avatar upload).
 */
export interface AgentCapabilities {
  /** Files: the agent exists. File storage outlives the container. */
  readonly files: boolean;
  /** Routines: backend-side, so available even while archived. */
  readonly routines: boolean;
  /** Sessions: a query on a connected machine. */
  readonly sessions: boolean;
  readonly chat: boolean;
  readonly logs: boolean;
  readonly shell: boolean;
  /** Desktop: running **and** the desktop route enabled. */
  readonly desktop: boolean;
}

/**
 * The single implementation of the capability table. Pure, so it is testable
 * and reusable without a machine instance.
 *
 * Note what is *not* here: `busy`. A command in flight does not remove a
 * capability — a running agent stays chattable while its avatar uploads.
 */
export function agentCapabilities(
  observed: string | null,
  desktopEnabled: boolean | null,
): AgentCapabilities {
  // "Exists" excludes a deletion tombstone: the SDK may list an explicitly
  // `DELETED` agent, and files for it are gone.
  const exists = observed !== ABSENT && observed !== null && observed.toUpperCase() !== "DELETED";
  const running = observed === RUNNING;
  return {
    files: exists,
    routines: true,
    sessions: running,
    chat: running,
    logs: running,
    shell: running,
    desktop: running && desktopEnabled === true,
  };
}

/** Readiness, for cross-machine reads (`agentMachines.peek(id)?.readiness`). */
export interface AgentReadiness {
  readonly agentId: string;
  /** Last roster reading: a deployment state, {@link ABSENT}, or null. */
  readonly observed: string | null;
  /**
   * Observed `RUNNING` with nothing in flight. This is a *quiescence* test —
   * "the agent is up and this machine is idle" — and it is deliberately **not**
   * the capability gate: use {@link AgentReadiness.capabilities} for that.
   */
  readonly ready: boolean;
  /** A command is in flight or awaiting roster confirmation. */
  readonly busy: boolean;
  readonly op: AgentOp | null;
  readonly failure: string | null;
  /** Last roster reading of the desktop route, or null when unknown. */
  readonly desktopEnabled: boolean | null;
  /** FSM.md's capability table for this agent, ready to read. */
  readonly capabilities: AgentCapabilities;
}

const VERB: Record<AgentStep, string> = {
  start: "Start",
  stop: "Stop",
  archive: "Archive",
  restore: "Restore",
  delete: "Delete",
  setDesktopEnabled: "Update desktop access",
  setRuntime: "Change runtime",
  uploadAvatar: "Upload avatar",
  deleteAvatar: "Remove avatar",
  uploadVoice: "Upload voice audio",
  deleteVoice: "Remove voice audio",
};

/**
 * Has the roster confirmed the step? The whole point of `Settling`: a command
 * is finished when the *roster* says so, not when the POST returns.
 */
export function targetReached(step: AgentStep, observed: string | null): boolean {
  switch (step) {
    case "start":
      return observed === RUNNING;
    case "stop":
      return observed === STOPPED;
    case "archive":
      return observed === ARCHIVED;
    case "restore":
      // Restore lands in whatever non-archived, non-transitional state the
      // control plane picks, so the predicate is "left ARCHIVED", not a value.
      return (
        observed !== null && observed !== ABSENT && observed !== ARCHIVED && !TRANSITIONAL.has(observed)
      );
    case "delete":
      // The tombstone counts: the SDK may keep listing an explicitly `DELETED`
      // agent, and waiting for absence alone would hang the full deadline.
      return observed === ABSENT || observed?.toUpperCase() === "DELETED";
    case "setDesktopEnabled":
    case "setRuntime":
    case "uploadAvatar":
    case "deleteAvatar":
    case "uploadVoice":
    case "deleteVoice":
      return true; // Degenerate: nothing to settle.
    default:
      return assertNever(step, "Unhandled step");
  }
}

/**
 * Guard driven by the agent's own state — this is what replaces disabled-button
 * guesswork. Permissive where the control plane is the authority (it, not us,
 * decides whether an archive is legal); strict only where the request is
 * obviously incoherent.
 */
function allowedFor(observed: string | null, op: AgentOp): boolean {
  if (observed === ABSENT) return false; // Nothing to command.
  if (observed === null) return true; // Never observed: do not block the UI.
  // A deletion tombstone answers nothing; do not offer incoherent commands.
  if (observed.toUpperCase() === "DELETED") return false;
  if (TRANSITIONAL.has(observed)) return isOneShot(op);
  switch (op) {
    case "start":
      return observed !== RUNNING && observed !== ARCHIVED;
    case "stop":
      return observed === RUNNING;
    case "restart":
      return observed === RUNNING;
    case "archive":
      return observed !== ARCHIVED;
    case "restore":
      return observed === ARCHIVED;
    case "delete":
      return true;
    case "setDesktopEnabled":
    case "setRuntime":
    case "uploadAvatar":
    case "deleteAvatar":
    case "uploadVoice":
    case "deleteVoice":
      return true;
    default:
      return assertNever(op, "Unhandled op");
  }
}

export interface AgentMachineOptions {
  port: AgentLifecyclePort;
  clock?: Clock;
  /**
   * Nudge the roster to refetch. `Settling` is driven by `ROSTER`, so the
   * machine asks for one rather than assuming the 4s transitional poll.
   */
  onRefreshRoster?: () => void;
  onDisposed?: () => void;
  settleDeadlineMs?: number;
  applyDeadlineMs?: number;
}

// ---------------------------------------------------------------------------
// The machine
// ---------------------------------------------------------------------------

export class AgentMachine extends Machine<AgentState, AgentEvent> {
  readonly agentId: string;
  private readonly port: AgentLifecyclePort;
  private readonly options: AgentMachineOptions;
  private readonly deadlineMs: number;
  private readonly applyMs: number;
  /**
   * Last roster reading of the desktop route. Kept beside the state rather than
   * in it: it is not a lifecycle state, it only feeds the capability table.
   */
  private desktopEnabled: boolean | null = null;

  constructor(agentId: string, options: AgentMachineOptions) {
    super({ name: "Stable", observed: null, outcome: null }, options.clock);
    this.agentId = agentId;
    this.port = options.port;
    this.options = options;
    this.deadlineMs = options.settleDeadlineMs ?? SETTLE_DEADLINE_MS;
    this.applyMs = options.applyDeadlineMs ?? APPLY_DEADLINE_MS;
  }

  /** The ErrorBar id this machine owns. One per agent, so it reports once. */
  get issueId(): string {
    return `lifecycle:${this.agentId}`;
  }

  get readiness(): AgentReadiness {
    const state = this.state;
    const busy = state.name === "Applying" || state.name === "Settling";
    return {
      agentId: this.agentId,
      observed: state.observed,
      ready: state.observed === RUNNING && !busy,
      busy,
      op: busy ? state.op : null,
      failure: state.name === "Failed" ? state.message : null,
      desktopEnabled: this.desktopEnabled,
      capabilities: agentCapabilities(state.observed, this.desktopEnabled),
    };
  }

  /**
   * Ask for a mutation. Returns `false` when a guard rejects it — FSM.md §7
   * rule 4: a guard rejects, it does not queue, and the UI must reflect that.
   */
  request(command: SimpleAgentOp | AgentCommand): boolean {
    const normalized: AgentCommand = typeof command === "string" ? { op: command } : command;
    if (this.disposed) return false;
    if (!this.allows(this.state, normalized.op)) return false;
    this.send({ type: "REQUEST", command: normalized });
    return true;
  }

  /** Is `op` permitted right now? Drives button enablement. */
  can(op: AgentOp): boolean {
    return this.allows(this.state, op);
  }

  /**
   * The way out of the terminal state (FSM.md §7 rule 5). What it *does*
   * depends on {@link AgentFailureCause} — see {@link AgentMachine.resume}.
   * Always moves the machine off `Failed`, so the promise of a way out holds
   * either way.
   */
  retry(): boolean {
    if (this.disposed || this.state.name !== "Failed") return false;
    this.send({ type: "RETRY" });
    return true;
  }

  /** Roster refresh. Inert unless it satisfies the settling target. */
  roster(agent: AgentRosterEntry | null): void {
    this.send({ type: "ROSTER", agent });
  }

  // -------------------------------------------------------------------------

  protected reduce(state: AgentState, event: AgentEvent): void {
    switch (event.type) {
      case "REQUEST": {
        if (!event.force && !this.allows(state, event.command.op)) return;
        this.issue(state, event.command);
        return;
      }
      case "RETRY": {
        if (state.name !== "Failed") return;
        this.resume(state);
        return;
      }
      case "ROSTER": {
        const observed = event.agent === null ? ABSENT : event.agent.state;
        const desktopEnabled = event.agent?.desktopEnabled ?? null;
        this.observe(state, observed, desktopEnabled);
        return;
      }
      case "ACCEPTED": {
        // Guarantee 1/2: a completion from a superseded or cancelled attempt
        // cannot move the machine.
        if (!this.slot.owns(event.attempt) || state.name !== "Applying") return;
        const observed = event.outcome.agent ? event.outcome.agent.state : state.observed;
        if (isOneShot(state.op)) {
          this.succeed(observed, event.outcome);
          return;
        }
        this.enterSettling(state, observed, event.outcome);
        return;
      }
      case "REJECTED": {
        if (!this.slot.owns(event.attempt)) return;
        if (state.name !== "Applying") return;
        this.fail({
          state,
          message: messageOf(event.error),
          error: event.error,
          cause: "rejected",
          outcome: null,
        });
        return;
      }
      case "DEADLINE": {
        if (!this.slot.owns(event.attempt)) return;
        if (event.phase === "apply") {
          if (state.name !== "Applying") return;
          this.fail({
            state,
            message: this.unansweredMessage(state),
            error: null,
            cause: "unanswered",
            outcome: null,
          });
          return;
        }
        if (state.name !== "Settling") return;
        this.fail({
          state,
          message: this.deadlineMessage(state),
          error: null,
          cause: "deadline",
          outcome: state.outcome,
        });
        return;
      }
      default:
        assertNever(event, "Unhandled agent event");
    }
  }

  // -------------------------------------------------------------------------
  // Transitions
  // -------------------------------------------------------------------------

  /** Begin a command. `restart` starts at its `stop` step. */
  private issue(state: AgentState, command: AgentCommand): void {
    const step: AgentStep = command.op === "restart" ? "stop" : command.op;
    this.dispatch(state.observed, command.op, step, command);
  }

  /**
   * Take the slot and fire the call. `slot.begin()` aborts any predecessor, so
   * there is exactly one in-flight operation and the abandoned one cannot write
   * state afterwards (FSM.md §2 guarantees 1 and 2).
   *
   * The apply deadline is armed here and nowhere else: every path into
   * `Applying` goes through this method, so there is no way to enter it without
   * a clock on it.
   */
  private dispatch(
    observed: string | null,
    op: AgentOp,
    step: AgentStep,
    command: AgentCommand,
  ): void {
    this.clearAfter();
    const attempt = this.slot.begin();
    this.commit({ name: "Applying", observed, op, step, command, attempt: attempt.id });
    this.after(APPLY_TIMER, this.applyMs, {
      type: "DEADLINE",
      attempt: attempt.id,
      phase: "apply",
    });
    void this.invoke(attempt, step, command);
  }

  private async invoke(attempt: Attempt, step: AgentStep, command: AgentCommand): Promise<void> {
    try {
      const outcome = (await this.call(step, command, attempt.signal)) ?? {};
      if (!this.slot.owns(attempt)) return;
      this.send({ type: "ACCEPTED", attempt: attempt.id, outcome });
    } catch (error) {
      if (!this.slot.owns(attempt)) return;
      this.send({ type: "REJECTED", attempt: attempt.id, error });
    }
  }

  private call(
    step: AgentStep,
    command: AgentCommand,
    signal: AbortSignal,
  ): Promise<AgentCommandOutcome | void> {
    const id = this.agentId;
    switch (step) {
      case "start":
        return this.port.start(id, signal);
      case "stop":
        return this.port.stop(id, signal);
      case "archive":
        return this.port.archive(id, signal);
      case "restore":
        return this.port.restore(id, signal);
      case "delete":
        return this.port.delete(id, signal);
      case "setDesktopEnabled":
        return this.port.setDesktopEnabled(
          id,
          command.op === "setDesktopEnabled" ? command.enabled : false,
          signal,
        );
      case "setRuntime":
        if (command.op !== "setRuntime") {
          return Promise.reject(new Error("setRuntime requires a runtime"));
        }
        return this.port.setRuntime(id, command.runtime, command.resetImage, signal);
      case "uploadAvatar":
        if (command.op !== "uploadAvatar") {
          return Promise.reject(new Error("uploadAvatar requires a file"));
        }
        return this.port.uploadAvatar(id, command.file, signal);
      case "deleteAvatar":
        return this.port.deleteAvatar(id, signal);
      case "uploadVoice":
        if (command.op !== "uploadVoice") {
          return Promise.reject(new Error("uploadVoice requires a file"));
        }
        return this.port.uploadVoice(id, command.file, signal);
      case "deleteVoice":
        return this.port.deleteVoice(id, signal);
      default:
        return assertNever(step, "Unhandled step");
    }
  }

  /**
   * The command landed. Wait for the roster to agree — unless it already does,
   * which happens when the command's own response carries the target state or a
   * refresh beat the response home.
   *
   * That optimisation is only sound for a *terminal* step. For the `stop` half
   * of `restart` the target came from the command's own response, which says
   * nothing about the roster; short-circuiting on it would issue `start` off the
   * stop's reply and race exactly the thing restart exists to serialise
   * (FSM.md:66-68). So {@link AgentMachine.advance} — and with it the composite
   * branch — is reachable only from {@link AgentMachine.observe}. Worst case
   * here is one extra roster tick of latency on a restart.
   */
  private enterSettling(
    state: Extract<AgentState, { name: "Applying" }>,
    observed: string | null,
    outcome: AgentCommandOutcome,
  ): void {
    const composite = state.op === "restart" && state.step === "stop";
    if (!composite && targetReached(state.step, observed)) {
      this.succeed(observed, outcome);
      return;
    }
    this.clearAfter(APPLY_TIMER);
    this.commit({
      name: "Settling",
      observed,
      op: state.op,
      step: state.step,
      command: state.command,
      attempt: state.attempt,
      since: this.clock.now(),
      outcome,
    });
    this.after(DEADLINE_TIMER, this.deadlineMs, {
      type: "DEADLINE",
      attempt: state.attempt,
      phase: "settle",
    });
  }

  /**
   * A settling step completed *according to the roster*: either the next step of
   * a composite, or done. Called only from {@link AgentMachine.observe}.
   */
  private advance(
    op: AgentOp,
    step: AgentStep,
    command: AgentCommand,
    observed: string | null,
    outcome: AgentCommandOutcome,
  ): void {
    // The composite: `start` is issued here and nowhere else, so it cannot race
    // the stop it depends on.
    if (op === "restart" && step === "stop") {
      this.dispatch(observed, "restart", "start", command);
      return;
    }
    this.succeed(observed, outcome);
  }

  /** Record a roster reading, and let it drive `Settling`. */
  private observe(
    state: AgentState,
    observed: string | null,
    desktopEnabled: boolean | null,
  ): void {
    const desktopChanged = desktopEnabled !== this.desktopEnabled;
    this.desktopEnabled = desktopEnabled;
    if (state.name === "Settling" && targetReached(state.step, observed)) {
      this.clearAfter(DEADLINE_TIMER);
      this.advance(state.op, state.step, state.command, observed, state.outcome);
      return;
    }
    // Everything else is a field update. Identical readings commit nothing, so
    // a roster refresh that changed an unrelated field is completely inert —
    // no re-dial, no notification, no port call.
    if (state.observed === observed) {
      // ...except the desktop route, which is not a lifecycle state but does
      // change the capability table, so subscribers must hear about it.
      if (desktopChanged) this.commit({ ...state } as AgentState);
      return;
    }
    this.commit({ ...state, observed } as AgentState);
  }

  private succeed(observed: string | null, outcome: AgentCommandOutcome): void {
    this.slot.cancel();
    this.clearAfter();
    this.commit({ name: "Stable", observed, outcome });
  }

  private fail(args: {
    state: Extract<AgentState, { name: "Applying" | "Settling" }>;
    message: string;
    error: unknown;
    cause: AgentFailureCause;
    outcome: AgentCommandOutcome | null;
  }): void {
    const { state, cause, outcome } = args;
    const { op, step, command } = state;
    this.slot.cancel();
    this.clearAfter();
    this.commit({
      name: "Failed",
      observed: state.observed,
      op,
      step,
      message: args.message,
      error: args.error,
      cause,
      command,
      outcome,
      // A restart whose `stop` half already landed resumes at `start`; retrying
      // the composite would stop an agent that is already stopped.
      resume: op === "restart" && step === "start" ? { op: "start" } : command,
    });
  }

  /**
   * The retry policy. The distinction this encodes is the whole point of
   * {@link AgentFailureCause}: `retry` may only POST again when the previous
   * POST demonstrably did not land.
   */
  private resume(state: Extract<AgentState, { name: "Failed" }>): void {
    // 1. The call threw, or there was never a transition to wait for. Nothing
    //    is in progress, so re-issue — forced, because after a failure the
    //    agent is often parked somewhere the guard would refuse, and a terminal
    //    state must offer a way out (FSM.md §7 rule 5).
    if (state.cause === "rejected" || isOneShot(state.op)) {
      this.issue(state, state.resume);
      return;
    }
    // 2. The command landed (or may have) and the agent is mid-transition.
    //    Re-issue only if it is coherent against what the roster says *now* —
    //    e.g. a start that timed out at STARTING and has since fallen back to
    //    STOPPED. `allows` is the ordinary guard, not the forced path.
    if (this.allows(state, state.resume.op)) {
      this.issue(state, state.resume);
      return;
    }
    // 3. Otherwise the only coherent action is to keep waiting, with a fresh
    //    deadline and a fresh attempt id so the expired one cannot speak.
    this.clearAfter();
    const attempt = this.slot.begin();
    this.commit({
      name: "Settling",
      observed: state.observed,
      op: state.op,
      step: state.step,
      command: state.command,
      attempt: attempt.id,
      since: this.clock.now(),
      outcome: state.outcome ?? {},
    });
    this.after(DEADLINE_TIMER, this.deadlineMs, {
      type: "DEADLINE",
      attempt: attempt.id,
      phase: "settle",
    });
  }

  /** "2 minutes" / "30 seconds". Sub-minute spans stay in seconds. */
  private spanText(ms: number): string {
    if (ms < 60_000) return `${Math.round(ms / 1000)} seconds`;
    const minutes = Math.round(ms / 60_000);
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  private unansweredMessage(state: Extract<AgentState, { name: "Applying" }>): string {
    return `${VERB[state.step]} was sent, but the control plane did not answer within ${this.spanText(
      this.applyMs,
    )}.`;
  }

  private deadlineMessage(state: Extract<AgentState, { name: "Settling" }>): string {
    const verb = VERB[state.step];
    const span = this.spanText(this.deadlineMs);
    if (state.observed === ABSENT) {
      return `${verb} was accepted, but the agent is no longer in the roster.`;
    }
    if (state.observed === null) {
      return `${verb} was accepted, but the agent never appeared in the roster after ${span}.`;
    }
    // Names the last observed state: "still STARTING after 2 minutes" is the
    // difference between a diagnosable failure and a spinner that lies.
    return `${verb} was accepted, but the agent is still ${state.observed} after ${span}.`;
  }

  private allows(state: AgentState, op: AgentOp): boolean {
    if (this.disposed) return false;
    if (state.name === "Applying") return false;
    if (state.name === "Settling") {
      // The one permitted supersede: aborting a start that has not landed.
      // `slot.begin()` in `dispatch` aborts the settling attempt explicitly,
      // which is what makes this a supersede and not an abandon-and-restart.
      return op === "stop" && state.step === "start";
    }
    return allowedFor(state.observed, op);
  }

  // -------------------------------------------------------------------------
  // Error surface — replaces `lifecycleErrors` and the ChatPane prop.
  // -------------------------------------------------------------------------

  protected onEnter(state: AgentState, previous: AgentState | null): void {
    if (previous && previous.name === state.name) return;
    if (state.name === "Failed") {
      const classified = classifyConnectionError(state.error ?? new Error(state.message), {
        operation: `${VERB[state.step]} agent`,
        agentId: this.agentId,
        url: null,
      });
      reportConnectionIssue({
        ...classified,
        // Stable per agent, so a retry loop refreshes one bar instead of
        // stacking them.
        id: this.issueId,
        detail: state.message || classified.detail,
        agentId: this.agentId,
        // Retry is the *default*, not an override: a 401 classifies as
        // `auth` with an "Open settings" action, and replacing that with Retry
        // only produces a second 401. Whatever action the classifier chose is
        // tagged with this agent so the bar can route it back here.
        action: classified.action
          ? { ...classified.action, agentId: classified.action.agentId ?? this.agentId }
          : { label: "Retry", kind: "retry", agentId: this.agentId },
      });
      this.options.onRefreshRoster?.();
      return;
    }
    if (state.name === "Stable") {
      clearConnectionIssue(this.issueId);
      this.options.onRefreshRoster?.();
      return;
    }
    if (state.name === "Settling") this.options.onRefreshRoster?.();
  }

  /** Leaving `Failed` retires its bar; a fresh failure republishes it. */
  protected onExit(state: AgentState): void {
    if (state.name === "Failed") clearConnectionIssue(this.issueId);
  }

  /**
   * A disposed machine can no longer answer its own Retry — `pool.retry` peeks,
   * finds nothing and no-ops — so leaving the issue in the bus would leave a
   * dead button on screen for the rest of the session.
   */
  protected onDispose(): void {
    clearConnectionIssue(this.issueId);
    this.options.onDisposed?.();
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  const text = String(error ?? "").trim();
  return text || "The command failed with no further detail.";
}

// ---------------------------------------------------------------------------
// The real port — a forwarder to src/api.ts, and nothing else.
// ---------------------------------------------------------------------------

/**
 * `src/api.ts` is imported dynamically so this module stays loadable in plain
 * node (it pulls in the Tauri IPC bridge and ts-sdk). The desktop control-plane
 * commands are short POSTs that take no `AbortSignal`; cancellation is enforced
 * by `slot.owns()` on the continuation instead, which is what keeps a late
 * resolution from mutating a torn-down machine.
 */
const apiAgentLifecyclePort: AgentLifecyclePort = {
  async start(id) {
    return { agent: await (await import("../api")).startAgent(id) };
  },
  async stop(id) {
    return { agent: await (await import("../api")).stopAgent(id) };
  },
  async archive(id) {
    return { agent: await (await import("../api")).archiveAgent(id) };
  },
  async restore(id) {
    return { agent: await (await import("../api")).restoreAgent(id) };
  },
  async delete(id) {
    await (await import("../api")).deleteAgent(id);
    return { agent: null };
  },
  async setDesktopEnabled(id, enabled) {
    return { agent: await (await import("../api")).setAgentDesktopEnabled(id, enabled) };
  },
  async setRuntime(id, runtime, resetImage) {
    return { agent: await (await import("../api")).setAgentRuntime(id, runtime, resetImage) };
  },
  async uploadAvatar(id, file) {
    const result = await (await import("../api")).uploadAgentAvatar(id, file);
    return { avatarUrl: result.avatar_url };
  },
  async deleteAvatar(id) {
    const result = await (await import("../api")).deleteAgentAvatar(id);
    return { avatarUrl: result.avatar_url ?? null };
  },
  async uploadVoice(id, file) {
    const result = await (await import("../api")).uploadAgentVoice(id, file);
    if (result.unavailable) return { voiceApiUnavailable: true };
    return { voiceAudioUrl: result.avatar_audio_url };
  },
  async deleteVoice(id) {
    const result = await (await import("../api")).deleteAgentVoice(id);
    if (result.unavailable) return { voiceApiUnavailable: true };
    return { voiceAudioUrl: result.avatar_audio_url };
  },
};

// ---------------------------------------------------------------------------
// Pool — FSM.md §3 and §7 rule 6
// ---------------------------------------------------------------------------

export interface AgentMachinePoolOptions {
  port: AgentLifecyclePort;
  clock?: Clock;
  idleMs?: number;
  onRefreshRoster?: () => void;
  settleDeadlineMs?: number;
  applyDeadlineMs?: number;
}

/**
 * A pool plus the id registry `applyRoster` needs — the pool itself does not
 * enumerate keys, and "the agent vanished" is only expressible if we know which
 * machines are live.
 */
export interface AgentMachinePool extends Disposable {
  acquire(agentId: string): AgentMachine;
  release(agentId: string): void;
  peek(agentId: string): AgentMachine | null;
  /** Broadcast a full roster to every live machine. */
  applyRoster(agents: readonly AgentRosterEntry[]): void;
  /** Resolve an ErrorBar `retry` action back to the machine that published it. */
  retry(agentId: string): boolean;
  readonly size: number;
}

export function createAgentMachinePool(options: AgentMachinePoolOptions): AgentMachinePool {
  const live = new Set<string>();
  const pool = new MachinePool<AgentMachine>(
    (agentId) => {
      live.add(agentId);
      return new AgentMachine(agentId, {
        port: options.port,
        clock: options.clock,
        onRefreshRoster: options.onRefreshRoster,
        settleDeadlineMs: options.settleDeadlineMs,
        applyDeadlineMs: options.applyDeadlineMs,
        onDisposed: () => live.delete(agentId),
      });
    },
    { idleMs: options.idleMs, clock: options.clock },
  );

  return {
    acquire: (agentId) => pool.acquire(agentId),
    release: (agentId) => pool.release(agentId),
    peek: (agentId) => pool.peek(agentId),
    applyRoster(agents) {
      const byId = new Map(agents.map((agent) => [agent.id, agent]));
      for (const agentId of [...live]) {
        // `peek`, not `acquire`: reading another machine never takes a
        // reference and never keeps one alive (FSM.md §7 rule 6).
        pool.peek(agentId)?.roster(byId.get(agentId) ?? null);
      }
    },
    retry(agentId) {
      return pool.peek(agentId)?.retry() ?? false;
    },
    get size() {
      return pool.size;
    },
    dispose() {
      pool.disposeAll();
      live.clear();
    },
  };
}

/**
 * The one instance per agent. Mount → unmount → mount under `<StrictMode>`
 * reuses it (FSM.md §2 guarantee 4), and a settling `start` survives the
 * remount that used to re-enable the button.
 */
export const agentMachines: AgentMachinePool = createAgentMachinePool({
  port: apiAgentLifecyclePort,
});
