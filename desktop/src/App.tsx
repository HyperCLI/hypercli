import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { subscribeAgentUpdates, type AgentSummary } from "./api";
import { TRANSITIONAL, runtimeFamily } from "./agent-utils";
import type { ManagedAgentRuntime } from "../../ts-sdk/src/agents.ts";
import type { ConnectionIssue } from "./lib/connection-errors";
import { assertNever } from "./lib/machine";
import { useMachine, usePooledMachine, usePooledMachines } from "./lib/use-machine";
import {
  mayOpenSubscriptions,
  rosterOf,
  sessionMachine,
  sessionOf,
  type SessionState,
} from "./lib/fsm";
import {
  agentMachines,
  type AgentCommand,
  type SimpleAgentOp,
} from "./lib/agentFsm";
import { useTheme } from "./theme";
import { useAgentChat } from "./useAgentChat";
import { Sidebar } from "./components/Sidebar";
import { ChatPane } from "./components/ChatPane";
import { ContextPanel } from "./components/ContextPanel";
import type { ContextTab } from "./components/ContextPanel";
import { SignIn } from "./components/SignIn";
import { SettingsModal } from "./components/SettingsModal";
import { TutorialModal } from "./components/TutorialModal";
import { NewAgentModal } from "./components/NewAgentModal";
import ErrorBar from "./components/ErrorBar";
import UpdateBanner from "./components/UpdateBanner";

const LEFT_DEFAULT_WIDTH = 176;
const RIGHT_DEFAULT_WIDTH = 272;
const LEFT_MIN_WIDTH = 144;
const LEFT_MAX_WIDTH = 340;
const RIGHT_MIN_WIDTH = 240;
const RIGHT_MAX_VIEWPORT_PADDING = 360;
const PANE_SNAP_DISTANCE = 14;

/** Backstop only. The deployment-events socket is the primary refresh. */
const POLL_IDLE_MS = 30_000;
const POLL_TRANSITIONAL_MS = 4_000;

const NO_AGENTS: AgentSummary[] = [];

function storedPaneWidth(key: string, fallback: number) {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function snapPaneWidth(value: number, defaultWidth: number) {
  return Math.abs(value - defaultWidth) <= PANE_SNAP_DISTANCE ? defaultWidth : value;
}

/**
 * "An API key is set."
 *
 * Deliberately *not* in `fsm.ts`: the machine's job is to distinguish
 * `expired` from `unauthenticated` from `degraded`, and collapsing that back
 * into a boolean there would invite the old `auth.signed_in` habit of routing
 * every failure to the sign-in screen. Components that genuinely only need
 * "is there a key" ask this; components that need to know *why* switch on the
 * state itself.
 *
 * `expired` counts as signed in: a key is on file, the backend just rejected
 * it. Only `unauthenticated` means no credential exists.
 */
export function loggedIn(state: SessionState): boolean {
  return state.name !== "unauthenticated";
}

/** Roster-bearing states. `degraded` carries the last known good roster. */
function hasRoster(state: SessionState): boolean {
  return state.name === "roster-loaded" || state.name === "degraded";
}

function Splash({ note }: { note?: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center bg-background">
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 h-[52px]" />
      {note && <div className="text-[12px] text-text-secondary">{note}</div>}
    </div>
  );
}

/**
 * The splash for a sessionless `degraded` — the very first credential
 * resolution never completed, so there is no workspace to render. FSM.md
 * guarantee 5 forbids a silent dead end here: the issue says *why*, the Retry
 * re-runs the probe now, and the sign-in escape lets the user abandon a
 * credential that may be the whole problem.
 */
function UnreachableSplash({
  issue,
  onRetry,
  onSignIn,
}: {
  issue: ConnectionIssue;
  onRetry: () => void;
  onSignIn: () => void;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center bg-background">
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 h-[52px]" />
      <div className="w-[380px]">
        <div className="text-[16px] font-semibold mb-1.5">{issue.title}</div>
        <p className="text-[12px] text-text-secondary leading-relaxed">{issue.detail}</p>
        {issue.hint && (
          <p className="mt-2 text-[12px] text-text-secondary/70 leading-relaxed">{issue.hint}</p>
        )}
        <p className="mt-2 text-[11px] text-text-secondary/50">Retrying automatically.</p>
        <div className="mt-5 flex flex-col gap-2">
          <button type="button" onClick={onRetry} className="ui-primary-button w-full py-2">
            Retry now
          </button>
          <button type="button" onClick={onSignIn} className="ui-secondary-button w-full py-2">
            Sign in with a different key
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  useTheme();

  // The one global machine. Everything that used to live in `auth`/`agents`
  // `useState` pairs — and the six nonce counters around them — is this.
  const session = useMachine(sessionMachine);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [newAgentOpen, setNewAgentOpen] = useState(false);
  const [leftOpen, setLeftOpen] = useState(
    () => localStorage.getItem("desktop-ng-left-open") !== "0",
  );
  const [rightOpen, setRightOpen] = useState(
    () => localStorage.getItem("desktop-ng-right-open") !== "0",
  );
  const [contextTab, setContextTab] = useState<ContextTab>("agent");
  const [leftWidth, setLeftWidth] = useState(() => storedPaneWidth("desktop-ng-left-width", LEFT_DEFAULT_WIDTH));
  const [rightWidth, setRightWidth] = useState(() => storedPaneWidth("desktop-ng-right-width", RIGHT_DEFAULT_WIDTH));

  // Two purely local overlays on the machine-owned roster, both of which used
  // to be `setAgents` calls: an agent created a moment ago that the next
  // roster read has not returned yet, and fields a one-shot command changed
  // whose GET can lag (`has_desktop`, `avatar_url`).
  const [createdAgent, setCreatedAgent] = useState<AgentSummary | null>(null);
  const [patches, setPatches] = useState<Record<string, Partial<AgentSummary>>>({});

  const toggleLeft = useCallback(() => {
    setLeftOpen((v) => {
      localStorage.setItem("desktop-ng-left-open", v ? "0" : "1");
      return !v;
    });
  }, []);
  const toggleRight = useCallback(() => {
    setRightOpen((v) => {
      localStorage.setItem("desktop-ng-right-open", v ? "0" : "1");
      return !v;
    });
  }, []);

  const startLeftResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = leftWidth;
    const onMove = (moveEvent: PointerEvent) => {
      const raw = clamp(startWidth + moveEvent.clientX - startX, LEFT_MIN_WIDTH, LEFT_MAX_WIDTH);
      const next = snapPaneWidth(raw, LEFT_DEFAULT_WIDTH);
      setLeftWidth(next);
      localStorage.setItem("desktop-ng-left-width", String(next));
    };
    const onUp = () => {
      document.body.classList.remove("pane-resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    document.body.classList.add("pane-resizing");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }, [leftWidth]);

  const startRightResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = rightWidth;
    const maxWidth = Math.max(RIGHT_MIN_WIDTH, window.innerWidth - RIGHT_MAX_VIEWPORT_PADDING);
    const onMove = (moveEvent: PointerEvent) => {
      const raw = clamp(startWidth + startX - moveEvent.clientX, RIGHT_MIN_WIDTH, maxWidth);
      const next = snapPaneWidth(raw, RIGHT_DEFAULT_WIDTH);
      setRightWidth(next);
      localStorage.setItem("desktop-ng-right-width", String(next));
    };
    const onUp = () => {
      document.body.classList.remove("pane-resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    document.body.classList.add("pane-resizing");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }, [rightWidth]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.key.toLowerCase() !== "b") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      )
        return;
      e.preventDefault();
      if (e.shiftKey) toggleRight();
      else toggleLeft();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleLeft, toggleRight]);

  // The boot probe. `BOOT` is ignored outside `booting`, so StrictMode's
  // double-invoke cannot mint two credentials or two SDK clients.
  useEffect(() => {
    sessionMachine.send({ type: "BOOT" });
  }, []);

  const serverRoster = hasRoster(session) ? rosterOf(session) : NO_AGENTS;

  const agents = useMemo(() => {
    const base =
      createdAgent && !serverRoster.some((agent) => agent.id === createdAgent.id)
        ? [createdAgent, ...serverRoster]
        : serverRoster;
    if (Object.keys(patches).length === 0) return base;
    return base.map((agent) => (patches[agent.id] ? { ...agent, ...patches[agent.id] } : agent));
  }, [serverRoster, createdAgent, patches]);

  useEffect(() => {
    if (createdAgent && serverRoster.some((agent) => agent.id === createdAgent.id)) {
      setCreatedAgent(null);
    }
  }, [serverRoster, createdAgent]);

  const rosterIds = useMemo(() => agents.map((agent) => agent.id), [agents]);

  // The roster drives every agent machine (FSM.md §5). A refresh that changed
  // an unrelated field is inert inside the machine, so this is safe to call on
  // every read.
  useEffect(() => {
    // `desktopEnabled` is the caller's to map: it is the second half of the
    // Desktop row of FSM.md's capability table and the machine cannot see it.
    agentMachines.applyRoster(
      agents.map((agent) => ({
        id: agent.id,
        state: agent.state,
        desktopEnabled: agent.has_desktop,
      })),
    );
  }, [agents]);

  // One pool reference per agent that exists, so `applyRoster` reaches them
  // all and a settling `start` survives the row scrolling out of view.
  const agentStates = usePooledMachines(agentMachines, rosterIds);

  const busyIds = useMemo(() => {
    const busy = new Set<string>();
    for (const [id, state] of agentStates) {
      if (state.name === "Applying" || state.name === "Settling") busy.add(id);
    }
    return busy;
  }, [agentStates]);

  // `agentMachines` is constructed in `agentFsm.ts` without an
  // `onRefreshRoster` hook (it cannot import `fsm.ts` without a cycle), so the
  // nudge it would have made lives here: whenever a command starts or finishes,
  // ask for a roster read. Everything else is the socket and the poll below.
  const busySignature = useMemo(() => [...busyIds].sort().join(","), [busyIds]);
  const nudged = useRef(false);
  useEffect(() => {
    if (!nudged.current) {
      nudged.current = true;
      return;
    }
    sessionMachine.send({ type: "REFRESH" });
  }, [busySignature]);

  // A failed one-shot op can leave an optimistic patch behind (the expected
  // path: resetImage rejected on a non-stopped agent). Reconcile it from the
  // server roster the moment the machine reports Failed.
  useEffect(() => {
    setPatches((current) => {
      let changed = false;
      const next = { ...current };
      for (const [id, state] of agentStates) {
        if (state.name === "Failed" && next[id]?.runtime !== undefined) {
          const { runtime: _dropped, ...rest } = next[id];
          next[id] = rest;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [agentStates]);

  // Live updates. `mayOpenSubscriptions` is false in `degraded`, so a blocked
  // app stops dialling instead of retrying a socket that cannot open — and the
  // dependency is a boolean, never the roster, so a refresh cannot re-run this.
  const canSubscribe = mayOpenSubscriptions(session);
  useEffect(() => {
    if (!canSubscribe) return;
    return subscribeAgentUpdates(
      () => sessionMachine.send({ type: "REFRESH" }),
      // The live channel is open. Nothing else can tell the machine that: a
      // roster GET proves the request channel and nothing more.
      () => sessionMachine.send({ type: "SOCKET_UP", epoch: sessionMachine.epoch }),
      // The subscription died for good (a rejected token mint, not a drop the
      // SDK retries). The machine degrades, keeps its roster, and owns the way
      // back — RETRY re-reads the roster and this effect re-establishes the
      // subscription when it recovers.
      (issue) => sessionMachine.send({ type: "SOCKET_DOWN", epoch: sessionMachine.epoch, issue }),
    );
  }, [canSubscribe]);

  // Backstop behind the socket. `degraded` is excluded on purpose: its refresh
  // is owned by the machine's backoff, and a poll would bypass it (guarantee 3).
  const transitional = agents.some((agent) => TRANSITIONAL.has(agent.state));
  useEffect(() => {
    if (!canSubscribe) return;
    const poll = setInterval(
      () => sessionMachine.send({ type: "REFRESH" }),
      transitional ? POLL_TRANSITIONAL_MS : POLL_IDLE_MS,
    );
    return () => clearInterval(poll);
  }, [canSubscribe, transitional]);

  useEffect(() => {
    if (session.name !== "roster-loaded") return;
    if (activeId && !agents.some((agent) => agent.id === activeId)) setActiveId(null);
  }, [session.name, agents, activeId]);

  const active = agents.find((agent) => agent.id === activeId) ?? null;
  const [sessionNonce, setSessionNonce] = useState(0);
  const chat = useAgentChat(active, sessionNonce);

  // The active agent's own machine, for the avatar outcome and the busy state
  // the composer's "Start agent" button reads.
  const { state: activeAgentState } = usePooledMachine(agentMachines, activeId);

  useEffect(() => {
    if (!activeId || activeAgentState?.name !== "Stable") return;
    const avatarUrl = activeAgentState.outcome?.avatarUrl;
    if (avatarUrl === undefined) return;
    setPatches((current) => ({
      ...current,
      [activeId]: { ...current[activeId], avatar_url: avatarUrl },
    }));
  }, [activeId, activeAgentState]);

  const handleSelectSession = useCallback((agentId: string, sessionId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    const storageKey = agent && runtimeFamily(agent.runtime) !== "acp"
      ? `runtime-session:${agentId}`
      : `acp-session:${agentId}`;
    localStorage.setItem(storageKey, sessionId);
    setActiveId(agentId);
    setSessionNonce((n) => n + 1);
  }, [agents]);

  const handleNewSession = useCallback((agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    localStorage.removeItem(
      agent && runtimeFamily(agent.runtime) !== "acp" ? `runtime-session:${agentId}` : `acp-session:${agentId}`,
    );
    setActiveId(agentId);
    setSessionNonce((n) => n + 1);
  }, [agents]);

  /**
   * Every mutation goes through the agent's machine, which owns the guard, the
   * single in-flight slot, the settle deadline and the error surface — so
   * there is no `act()` wrapper and no `lifecycleErrors` map any more.
   *
   * `acquire`/`release` is balanced: an agent in the roster is already held by
   * the effect above, so this only pins the pool entry for the duration of the
   * call. `request` returns false when a guard rejects the command.
   */
  const command = useCallback((id: string, request: SimpleAgentOp | AgentCommand): boolean => {
    const machine = agentMachines.acquire(id);
    try {
      return machine.request(request);
    } finally {
      agentMachines.release(id);
    }
  }, []);

  const onStart = useCallback((id: string) => {
    command(id, "start");
  }, [command]);
  // Restart is one op with two steps inside the machine: `start` is issued only
  // once the roster shows the agent stopped. It exists to rewrite
  // OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN, so racing the halves defeats the point.
  const onRestart = useCallback((id: string) => {
    command(id, "restart");
  }, [command]);
  const onStop = useCallback((id: string) => {
    command(id, "stop");
  }, [command]);
  const onArchive = useCallback((id: string) => {
    command(id, "archive");
  }, [command]);
  const onRestore = useCallback((id: string) => {
    command(id, "restore");
  }, [command]);
  const onDelete = useCallback((id: string) => {
    command(id, "delete");
  }, [command]);

  const onUploadAgentAvatar = useCallback((id: string, file: File) => {
    command(id, { op: "uploadAvatar", file });
  }, [command]);

  const onDeleteAgentAvatar = useCallback((id: string) => {
    command(id, "deleteAvatar");
  }, [command]);

  const onSetAgentDesktopEnabled = useCallback((id: string, enabled: boolean) => {
    // The control plane's own GET can still report the previous value, which is
    // why the old code patched this locally too.
    if (command(id, { op: "setDesktopEnabled", enabled })) {
      setPatches((current) => ({
        ...current,
        [id]: { ...current[id], has_desktop: enabled },
      }));
    }
  }, [command]);

  const onSetAgentRuntime = useCallback((id: string, runtime: ManagedAgentRuntime, resetImage: boolean) => {
    if (command(id, { op: "setRuntime", runtime, resetImage })) {
      setPatches((current) => ({
        ...current,
        [id]: { ...current[id], runtime },
      }));
    }
  }, [command]);

  const onSignedIn = useCallback(() => {
    sessionMachine.send({ type: "KEY_SAVED" });
  }, []);

  const onSignedOut = useCallback(() => {
    setSettingsOpen(false);
    setActiveId(null);
    setCreatedAgent(null);
    setPatches({});
    // The machine performs the logout, bumps the epoch (aborting every
    // subscription registered against it) and drops the roster.
    sessionMachine.send({ type: "SIGN_OUT" });
  }, []);

  /**
   * The bar's Retry button. A lifecycle failure names its agent, so it is
   * re-issued on that agent's machine; anything else is a session-level
   * problem and retries the roster read (which also resets its backoff).
   */
  const onRetry = useCallback((agentId?: string) => {
    if (agentId && agentMachines.retry(agentId)) return;
    sessionMachine.send({ type: "RETRY" });
  }, []);

  switch (session.name) {
    case "booting":
    case "resolving-credentials":
      return <Splash />;
    case "signing-out":
      return <Splash note="Signing out…" />;
    case "unauthenticated":
    case "expired": {
      // `loggedIn` is the boolean question — is a key on file? `expired` means
      // yes, and it was rejected, which is a different sentence from "you have
      // never signed in here".
      const message = loggedIn(session)
        ? "That API key was rejected or no longer has the permissions this app needs. Sign in again to mint a new key."
        : session.name === "unauthenticated" && session.reason === "signed-out"
          ? "You're signed out. Sign in again to continue."
          : null;
      return <SignIn onSignedIn={onSignedIn} message={message} />;
    }
    case "degraded":
      // `sessionOf` is unsafe here: the very first credential resolution never
      // completed, so there is nothing to render a workspace against. But a
      // bare splash with no way out is a dead end (FSM.md guarantee 5) — this
      // names the issue, retries on demand, and offers sign-in as the escape.
      if (!session.session) {
        return (
          <UnreachableSplash
            issue={session.issue}
            onRetry={() => sessionMachine.send({ type: "RETRY" })}
            onSignIn={onSignedOut}
          />
        );
      }
      break;
    case "authenticated":
    case "roster-loaded":
      break;
    default:
      return assertNever(session, "Unhandled session state");
  }

  // Safe by construction: the switch above returned for every state without a
  // session, including `degraded` before the first credential ever resolved.
  const live = sessionOf(session);
  const degraded = session.name === "degraded";

  return (
    <div className="h-full flex flex-col bg-background">
      <UpdateBanner />
      {degraded && (
        <div className="flex shrink-0 items-center gap-3 border-b border-warning/40 bg-warning-bg px-4 py-1.5 text-[11px] text-warning">
          <span className="font-medium">{session.issue.title}</span>
          <span className="min-w-0 flex-1 truncate text-foreground/70">
            Showing the last agent list. Retrying automatically.
          </span>
          <button
            type="button"
            onClick={() => onRetry()}
            className="shrink-0 rounded-md border border-warning/50 px-2 py-0.5 font-medium transition-colors hover:bg-warning/10"
          >
            Retry now
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div
          className={leftOpen ? "relative flex shrink-0" : "hidden"}
          style={{ "--pane-left-width": `${leftWidth}px` } as CSSProperties}
        >
          <Sidebar
            agents={agents}
            activeId={activeId}
            onSelect={setActiveId}
            onNewAgent={() => setNewAgentOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenTutorial={() => setTutorialOpen(true)}
            onStart={onStart}
            onStop={onStop}
            onRestore={onRestore}
            busyIds={busyIds}
            rosterLoading={session.name === "authenticated"}
            activeSessionId={chat.activeSessionId}
            onSelectSession={handleSelectSession}
            onNewSession={handleNewSession}
          />
          <div
            className="pane-resize-handle pane-resize-handle-left"
            onPointerDown={startLeftResize}
            onDoubleClick={() => {
              setLeftWidth(LEFT_DEFAULT_WIDTH);
              localStorage.setItem("desktop-ng-left-width", String(LEFT_DEFAULT_WIDTH));
            }}
            title="Drag to resize. Double-click to reset."
          />
        </div>
        <div className="relative flex min-w-0 flex-1">
          <ChatPane
            agent={active}
            chat={chat}
            sessionNonce={sessionNonce}
            busy={active ? busyIds.has(active.id) : false}
            onStart={onStart}
            onRestore={onRestore}
            onOpenLogs={() => {
              setContextTab("status");
              setRightOpen(true);
              localStorage.setItem("desktop-ng-right-open", "1");
            }}
            leftOpen={leftOpen}
            rightOpen={rightOpen}
            onOpenLeft={toggleLeft}
            onOpenRight={toggleRight}
          />
          <ErrorBar
            agent={active}
            onRestartAgent={onRestart}
            onOpenSettings={() => setSettingsOpen(true)}
            onRetry={onRetry}
          />
        </div>
        {active && (
          <div
            className={rightOpen ? "relative flex shrink-0" : "hidden"}
            style={{ "--pane-right-width": `${rightWidth}px` } as CSSProperties}
          >
            <div
              className="pane-resize-handle pane-resize-handle-right"
              onPointerDown={startRightResize}
              onDoubleClick={() => {
                setRightWidth(RIGHT_DEFAULT_WIDTH);
                localStorage.setItem("desktop-ng-right-width", String(RIGHT_DEFAULT_WIDTH));
              }}
              title="Drag to resize. Double-click to reset."
            />
            <ContextPanel
              agent={active}
              tab={contextTab}
              onTab={setContextTab}
              onArchive={onArchive}
              onRestore={onRestore}
              onStop={onStop}
              onDelete={onDelete}
              onSetAgentDesktopEnabled={onSetAgentDesktopEnabled}
              onSetAgentRuntime={onSetAgentRuntime}
              onUploadAgentAvatar={onUploadAgentAvatar}
              onDeleteAgentAvatar={onDeleteAgentAvatar}
            />
          </div>
        )}
      </div>
      {settingsOpen && (
        <SettingsModal
          apiBase={live.credentials.api_base}
          onClose={() => setSettingsOpen(false)}
          onSignedOut={onSignedOut}
        />
      )}
      {newAgentOpen && (
        <NewAgentModal
          onClose={() => setNewAgentOpen(false)}
          onCreated={(agent) => {
            setNewAgentOpen(false);
            setCreatedAgent(agent);
            setActiveId(agent.id);
            setContextTab("agent");
            sessionMachine.send({ type: "REFRESH" });
          }}
        />
      )}
      {tutorialOpen && <TutorialModal onClose={() => setTutorialOpen(false)} />}
    </div>
  );
}
