/**
 * In-page OpenClaw gateway mock for the deterministic Claw Skills specs.
 *
 * The Claw dashboard owns no gateway transport: `useOpenClawSession` composes
 * the SDK's `GatewayClient`, which speaks the OpenClaw WebSocket protocol
 * (connect challenge -> authenticated hello -> request/response frames). The
 * existing `openclaw-reconnect-token-refresh.spec.ts` already proves a mock
 * `WebSocket` class is a sanctioned seam for this composition, so the Skills
 * failure-state specs reuse it instead of forcing a live agent through
 * states a real gateway cannot reach on demand (stale revision, read-only
 * scopes, RPC failures).
 *
 * Everything here runs inside the tested page via `page.addInitScript`, so
 * this module is type-checked but never imported by the app bundle.
 */

export interface MockGatewaySkillProposal {
  id: string;
  skillName: string;
  skillKey: string;
  description: string;
  content: string;
  revisionHash: string;
  kind?: "create" | "update";
  status?: "pending" | "applied" | "rejected" | "quarantined" | "stale";
  scanState?: "pending" | "clean" | "failed" | "quarantined";
  createdAt?: string;
  updatedAt?: string;
}

export interface MockGatewayInstalledSkill {
  skillKey: string;
  name: string;
  description: string;
  filePath?: string;
  source?: string;
  bundled?: boolean;
  disabled?: boolean;
  eligible?: boolean;
}

/**
 * Deterministic chat transcript for one `chat.send`. The mock answers the
 * send, emits an optional raw thinking frame (private reasoning that must
 * never surface in the UI), streams each commentary entry as an explicit
 * `agent` commentary frame plus its ordinary cumulative `chat` mirror, and
 * then holds the terminal frame until `releaseMockGatewayFinals(page)` so the
 * spec can assert on the active working-note surface before finalizing.
 * Cumulative texts mirror the real gateway contract: commentary payloads
 * carry `replace: true` with cumulative `text`, and chat deltas replace their
 * visible content with that same latest commentary value.
 */
export interface MockGatewayChatScript {
  /** Gateway session key this script answers. Defaults to "main". */
  sessionKey?: string;
  /** Run id returned by the send ack and carried on every frame. */
  runId?: string;
  /** Cumulative user-facing working notes, in order. */
  commentary?: string[];
  /** Raw private reasoning frame emitted before commentary. */
  thinking?: string;
  /** Final answer text, appended after the last commentary note. */
  finalText: string;
  /** stopReason for the terminal message. Defaults to "stop". */
  finalStopReason?: string;
  /**
   * When false, the terminal frame is emitted immediately after the last
   * commentary mirror instead of being held for `releaseMockGatewayFinals`.
   */
  holdFinal?: boolean;
}

/** One persisted transcript row as `chat.history` returns it. */
export interface MockGatewayHistoryRow {
  role: string;
  stopReason?: string;
  timestamp: number;
  content: Array<{ type: string; text: string }>;
}

export interface MockGatewayOptions {
  /** Granted scopes in the authenticated hello. Defaults to admin. */
  scopes?: Array<"operator.read" | "operator.admin">;
  /** Methods advertised in the hello. Defaults to the proposal + skills set. */
  methods?: string[];
  /** Capabilities advertised in the hello (revision-bound by default). */
  capabilities?: string[];
  /** Server version string in the hello. */
  serverVersion?: string;
  proposals?: MockGatewaySkillProposal[];
  installedSkills?: MockGatewayInstalledSkill[];
  workspaceDir?: string;
  managedSkillsDir?: string;
  /**
   * When set, the first `skills.proposals.apply` for the named proposal id
   * answers a revision-conflict error once; later attempts proceed normally.
   */
  staleApplyOnceFor?: string;
  /**
   * When true, `skills.proposals.apply`/`reject` answer an error instead of
   * mutating state. Used to prove the UI never replays a mutation.
   */
  failMutations?: boolean;
  /**
   * Close every socket shortly after the authenticated hello. The app's own
   * reconnect path must recover and re-answer from live state.
   */
  restartOnce?: boolean;
  /** Initial parsed config returned by `config.get`. Defaults to `{}`. */
  config?: Record<string, unknown>;
  /**
   * When true, `config.patch`/`config.apply`/`config.set` are recorded and
   * then answered with an error instead of mutating state, mirroring a
   * gateway that refuses the write.
   */
  failConfigPatch?: boolean;
  /**
   * Persist the applied config in the page's sessionStorage so a full reload
   * rehydrates from the last written config, mirroring gateway-side
   * durability. State is per browser context, so specs stay isolated.
   */
  persistConfig?: boolean;
  /**
   * Queued `chat.send` transcripts, consumed one per send in arrival order.
   * Terminal frames are held until `releaseMockGatewayFinals(page)` so specs
   * can observe streaming states without sleeps.
   */
  chatScripts?: MockGatewayChatScript[];
  /**
   * Preloaded `chat.history` rows per session key; completed scripts append
   * their persisted rows here so a reload rehydrates from the same transcript.
   */
  chatHistories?: Record<string, MockGatewayHistoryRow[]>;
  /** Sessions returned by `sessions.list`. Defaults to the main session. */
  sessions?: Array<{ key: string; label?: string; updatedAt?: string }>;
}

const DEFAULT_METHODS = [
  "config.get",
  "config.patch",
  "config.schema",
  "chat.send",
  "chat.abort",
  "chat.history",
  "sessions.list",
  "agents.list",
  "files.list",
  "skills.status",
  "skills.search",
  "skills.update",
  "skills.read",
  "skills.proposals.list",
  "skills.proposals.inspect",
  "skills.proposals.apply",
  "skills.proposals.reject",
];

const REVISION_BOUND_CAPABILITY = "skill-proposals-revision-bound-v1";

/**
 * JavaScript source of the mock gateway installer, evaluated in-page by
 * `installMockGateway(page, options)`. Kept as a factory body so the whole
 * behavior ships through one serializable function.
 */
export async function installMockGateway(page: import("@playwright/test").Page, options: MockGatewayOptions): Promise<void> {
  // esbuild/tsx inject a `__name` helper for named function expressions when
  // this fixture is imported through those loaders; the init script is
  // serialized into the page without the helper, so it must be defined inline.
  await page.addInitScript("window.__name = (fn) => fn;");
  await page.addInitScript((rawOptions: string) => {
    type Proposal = {
      id: string;
      skillName: string;
      skillKey: string;
      description: string;
      content: string;
      revisionHash: string;
      kind: "create" | "update";
      status: "pending" | "applied" | "rejected" | "quarantined" | "stale";
      scanState: "pending" | "clean" | "failed" | "quarantined";
      createdAt: string;
      updatedAt: string;
    };
    type InstalledSkill = {
      skillKey: string;
      name: string;
      description: string;
      filePath: string;
      source: string;
      bundled: boolean;
      disabled: boolean;
      eligible: boolean;
    };
    type ChatScript = {
      sessionKey: string;
      runId: string;
      commentary: string[];
      thinking: string | null;
      finalText: string;
      finalStopReason: string;
      holdFinal: boolean;
    };
    type HistoryRow = {
      role: string;
      stopReason?: string;
      timestamp: number;
      content: Array<{ type: string; text: string }>;
    };
    type Options = {
      scopes: string[];
      methods: string[];
      capabilities: string[];
      serverVersion: string;
      proposals: Proposal[];
      installedSkills: InstalledSkill[];
      workspaceDir: string;
      managedSkillsDir: string;
      staleApplyOnceFor: string | null;
      failMutations: boolean;
      restartOnce: boolean;
      config: Record<string, unknown>;
      failConfigPatch: boolean;
      persistConfig: boolean;
      chatScripts: ChatScript[];
      chatHistories: Record<string, HistoryRow[]>;
      sessions: Array<{ key: string; label?: string; updatedAt?: string }>;
    };

    const parsed = JSON.parse(rawOptions) as Partial<Options>;
    const options: Options = {
      scopes: parsed.scopes ?? ["operator.read", "operator.admin"],
      methods: parsed.methods ?? [],
      capabilities: parsed.capabilities ?? [],
      serverVersion: parsed.serverVersion ?? "v2026.8.3",
      proposals: parsed.proposals ?? [],
      installedSkills: parsed.installedSkills ?? [],
      workspaceDir: parsed.workspaceDir ?? "/home/node/workspace",
      managedSkillsDir: parsed.managedSkillsDir ?? "/home/node/.openclaw/skills",
      staleApplyOnceFor: parsed.staleApplyOnceFor ?? null,
      failMutations: parsed.failMutations === true,
      restartOnce: parsed.restartOnce === true,
      config: parsed.config ?? {},
      failConfigPatch: parsed.failConfigPatch === true,
      persistConfig: parsed.persistConfig === true,
      chatScripts: (parsed.chatScripts ?? []).map((script, index) => ({
        sessionKey: script.sessionKey ?? "main",
        runId: script.runId ?? `run-mock-${index + 1}`,
        commentary: script.commentary ?? [],
        thinking: script.thinking ?? null,
        finalText: script.finalText ?? "",
        finalStopReason: script.finalStopReason ?? "stop",
        holdFinal: script.holdFinal !== false,
      })),
      chatHistories: JSON.parse(JSON.stringify(parsed.chatHistories ?? {})) as Record<string, HistoryRow[]>,
      sessions: parsed.sessions ?? [{ key: "main", label: "Main session" }],
    };

    const CONFIG_STORAGE_KEY = "__mockGatewayConfig";
    const persistedConfig = options.persistConfig ? window.sessionStorage.getItem(CONFIG_STORAGE_KEY) : null;

    const isPlainObject = (value: unknown): value is Record<string, unknown> =>
      Boolean(value) && typeof value === "object" && !Array.isArray(value);
    // Same merge contract as the gateway's config.patch: nested objects merge
    // key-by-key and an explicit null deletes the key.
    const mergeConfig = (current: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> => {
      const next: Record<string, unknown> = { ...current };
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) {
          delete next[key];
          continue;
        }
        const existing = next[key];
        if (isPlainObject(value) && isPlainObject(existing)) {
          next[key] = mergeConfig(existing, value);
          continue;
        }
        next[key] = value;
      }
      return next;
    };

    const state = {
      socketCount: 0,
      proposals: options.proposals.map((proposal, index) => ({
        ...proposal,
        kind: proposal.kind ?? ("create" as const),
        status: proposal.status ?? ("pending" as const),
        scanState: proposal.scanState ?? ("clean" as const),
        createdAt: proposal.createdAt ?? `2026-08-24T12:${String(index + 1).padStart(2, "0")}:00.000Z`,
        updatedAt: proposal.updatedAt ?? `2026-08-24T12:${String(index + 1).padStart(2, "0")}:00.000Z`,
      })),
      installedSkills: options.installedSkills.map((skill) => ({
        ...skill,
        source: skill.source ?? "workspace",
        bundled: skill.bundled ?? false,
        disabled: skill.disabled ?? false,
        eligible: skill.eligible ?? true,
        filePath: skill.filePath ?? `${options.workspaceDir}/skills/${skill.skillKey}/SKILL.md`,
      })),
      applyCalls: [] as Array<{ proposalId: string; expectedRevisionHash: string | null }>,
      rejectCalls: [] as Array<{ proposalId: string; expectedRevisionHash: string | null }>,
      staleApplyConsumed: false,
      restartConsumed: false,
      config: persistedConfig ? (JSON.parse(persistedConfig) as Record<string, unknown>) : options.config,
      configHash: "hash-1",
      configWrites: [] as Array<{ method: string; raw: string; baseHash: string }>,
      // Queued chat transcripts keyed by session key; each `chat.send` shifts
      // one script and replays it. Held terminal frames are closures owning
      // the receiving socket, released deterministically by the spec.
      chatScripts: options.chatScripts.reduce<Record<string, ChatScript[]>>((acc, script) => {
        (acc[script.sessionKey] ??= []).push(script);
        return acc;
      }, {}),
      chatHistories: options.chatHistories,
      heldFinals: [] as Array<() => void>,
      historyClock: 1000,
      sendCalls: [] as Array<Record<string, unknown>>,
    };
    (window as unknown as { __mockGateway: typeof state }).__mockGateway = state;
    (window as unknown as { __mockGatewayReleaseFinals: () => number }).__mockGatewayReleaseFinals = () => {
      // Every held emission routes through this.emit, which defers to the
      // page's task queue; the spec waits for the resulting DOM state.
      const releases = state.heldFinals.splice(0, state.heldFinals.length);
      for (const release of releases) release();
      return releases.length;
    };

    const manifestEntry = (proposal: Proposal) => ({
      id: proposal.id,
      kind: proposal.kind,
      status: proposal.status,
      title: proposal.skillName,
      description: proposal.description,
      skillName: proposal.skillName,
      skillKey: proposal.skillKey,
      createdAt: proposal.createdAt,
      updatedAt: proposal.updatedAt,
      scanState: proposal.scanState,
    });

    const proposalRecord = (proposal: Proposal) => ({
      schema: "openclaw.skill-workshop.proposal.v1",
      id: proposal.id,
      kind: proposal.kind,
      status: proposal.status,
      title: proposal.skillName,
      description: proposal.description,
      createdAt: proposal.createdAt,
      updatedAt: proposal.updatedAt,
      proposedVersion: "1.0.0",
      draftFile: "PROPOSAL.md",
      draftHash: proposal.revisionHash,
      target: {
        skillName: proposal.skillName,
        skillKey: proposal.skillKey,
        skillDir: proposal.skillKey,
        skillFile: "SKILL.md",
      },
      scan: {
        state: proposal.scanState,
        scannedAt: proposal.updatedAt,
        critical: 0,
        warn: 0,
        info: 0,
        findings: [],
      },
    });

    const skillStatusEntry = (skill: InstalledSkill) => ({
      name: skill.name,
      description: skill.description,
      source: skill.source,
      bundled: skill.bundled,
      filePath: skill.filePath,
      baseDir: skill.filePath.slice(0, -"/SKILL.md".length),
      skillKey: skill.skillKey,
      always: false,
      disabled: skill.disabled,
      blockedByAllowlist: false,
      blockedByAgentFilter: false,
      eligible: skill.eligible,
      modelVisible: true,
      userInvocable: true,
      commandVisible: true,
      requirements: {},
      missing: {},
      configChecks: [],
      install: [],
    });

    // Non-gateway sockets (Next dev HMR, telemetry) must keep working: the
    // page replaces the global WebSocket, so anything not aimed at the mock
    // gateway is delegated to the browser's real implementation. The mock's
    // deployments all live on `.example.test`, which is how a gateway socket
    // is told apart from an app-local one without knowing the app's origin.
    const NativeWebSocket = window.WebSocket;

    // The Deployments events stream is a second, protocol-distinct socket the
    // dashboard parks on: auth frame in, one `ready` frame out, then silence.
    // Its ws_url is test-controlled (`wss://deployment-events.example.test/…`)
    // so the same in-page seam can hold it open without any network traffic.
    type MockSocketMode = "gateway" | "deployment-events";
    const socketModeFor = (target: string): MockSocketMode =>
      target.includes("deployment-events") ? "deployment-events" : "gateway";

    // Class fields are deliberately avoided: the test runner's esbuild
    // transform drops field initializers when it also emits a static name
    // block for the class, which would leave a constructed mock socket with
    // no readyState and no send. Everything is assigned in the constructor.
    class MockGatewayWebSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 3;

      public readonly url: string;
      public readyState: number;
      public onopen: (() => void) | null;
      public onmessage: ((event: { data: string }) => void) | null;
      public onerror: (() => void) | null;
      public onclose: ((event: { code?: number; reason?: string }) => void) | null;

      private readonly socketNumber: number;
      private readonly mode: MockSocketMode;
      private readonly listeners: Record<"open" | "message" | "error" | "close", Array<(event?: unknown) => void>>;

      constructor(url: string, mode: MockSocketMode = "gateway") {
        this.url = url;
        this.mode = mode;
        this.readyState = MockGatewayWebSocket.CONNECTING;
        this.onopen = null;
        this.onmessage = null;
        this.onerror = null;
        this.onclose = null;
        this.listeners = { open: [], message: [], error: [], close: [] };
        state.socketCount += 1;
        this.socketNumber = state.socketCount;
        window.setTimeout(() => {
          if (this.readyState !== MockGatewayWebSocket.CONNECTING) return;
          this.readyState = MockGatewayWebSocket.OPEN;
          this.onopen?.();
          for (const listener of this.listeners.open) listener();
          // The deployment-events protocol has no connect challenge; the
          // client authenticates first and the server answers `ready`.
          if (this.mode !== "gateway") return;
          this.emit({
            type: "event",
            event: "connect.challenge",
            payload: { nonce: `nonce-${this.socketNumber}` },
          });
        }, 0);
      }

      // The SDK's Deployments events subscriber attaches DOM-style listeners,
      // so the mock supports both handler properties and addEventListener.
      addEventListener(type: "open" | "message" | "error" | "close", listener: (event?: unknown) => void) {
        this.listeners[type]?.push(listener);
      }

      removeEventListener(type: "open" | "message" | "error" | "close", listener: (event?: unknown) => void) {
        const list = this.listeners[type];
        if (!list) return;
        const index = list.indexOf(listener);
        if (index >= 0) list.splice(index, 1);
      }

      send(data: string) {
        let message: { id?: string; method?: string; type?: string; params?: Record<string, unknown> };
        try {
          message = JSON.parse(data);
        } catch {
          return;
        }
        if (this.mode === "deployment-events") {
          if (message.type === "auth") this.emit({ type: "ready" });
          return;
        }
        const id = message.id;
        const method = String(message.method ?? "");
        const params = (message.params ?? {}) as Record<string, unknown>;

        if (method === "connect") {
          this.emit({
            type: "res",
            id,
            ok: true,
            payload: {
              protocol: 3,
              server: { version: options.serverVersion },
              features: {
                methods: options.methods,
                events: ["chat", "agent"],
                capabilities: options.capabilities,
              },
              auth: {
                role: "operator",
                scopes: options.scopes,
              },
            },
          });
          if (options.restartOnce && !state.restartConsumed) {
            state.restartConsumed = true;
            window.setTimeout(() => this.close(1012, "gateway restart"), 25);
          }
          return;
        }

        if (method === "skills.proposals.list") {
          this.emit({
            type: "res",
            id,
            ok: true,
            payload: {
              schema: "openclaw.skill-workshop.proposals-manifest.v1",
              updatedAt: new Date().toISOString(),
              proposals: state.proposals.map(manifestEntry),
            },
          });
          return;
        }

        if (method === "skills.proposals.inspect") {
          const proposalId = String(params.proposalId ?? "");
          const proposal = state.proposals.find((entry) => entry.id === proposalId);
          if (!proposal) {
            this.emit({
              type: "res",
              id,
              ok: false,
              error: { code: "NOT_FOUND", message: `Unknown skill proposal ${proposalId}`, details: { code: "NOT_FOUND" } },
            });
            return;
          }
          this.emit({
            type: "res",
            id,
            ok: true,
            payload: {
              record: proposalRecord(proposal),
              revisionHash: proposal.revisionHash,
              content: proposal.content,
            },
          });
          return;
        }

        if (method === "skills.proposals.apply" || method === "skills.proposals.reject") {
          const proposalId = String(params.proposalId ?? "");
          const expectedRevisionHash = typeof params.expectedRevisionHash === "string" ? params.expectedRevisionHash : null;
          const proposal = state.proposals.find((entry) => entry.id === proposalId);

          if (!proposal) {
            this.emit({
              type: "res",
              id,
              ok: false,
              error: { code: "NOT_FOUND", message: `Unknown skill proposal ${proposalId}`, details: { code: "NOT_FOUND" } },
            });
            return;
          }

          const call = { proposalId, expectedRevisionHash };
          if (method === "skills.proposals.apply") state.applyCalls.push(call);
          else state.rejectCalls.push(call);

          if (options.failMutations) {
            this.emit({
              type: "res",
              id,
              ok: false,
              error: { code: "UNAVAILABLE", message: "gateway write failed", details: { code: "UNAVAILABLE" } },
            });
            return;
          }

          if (
            method === "skills.proposals.apply"
            && options.staleApplyOnceFor === proposalId
            && !state.staleApplyConsumed
          ) {
            state.staleApplyConsumed = true;
            // The gateway changed the draft underneath the reviewer: bump the
            // revision so a reload observes the new hash, then refuse this one.
            proposal.revisionHash = `${proposal.revisionHash}-revised`;
            this.emit({
              type: "res",
              id,
              ok: false,
              error: {
                code: "REVISION_CONFLICT",
                message: "revision conflict: the pending skill changed since it was loaded",
                details: { code: "REVISION_CONFLICT" },
              },
            });
            return;
          }

          if (proposal.status !== "pending") {
            this.emit({
              type: "res",
              id,
              ok: false,
              error: {
                code: "REVISION_CONFLICT",
                message: `revision conflict: proposal ${proposalId} is already ${proposal.status}`,
                details: { code: "REVISION_CONFLICT" },
              },
            });
            return;
          }

          proposal.status = method === "skills.proposals.apply" ? "applied" : "rejected";
          proposal.updatedAt = new Date().toISOString();
          if (method === "skills.proposals.apply") {
            state.installedSkills.push({
              skillKey: proposal.skillKey,
              name: proposal.skillName,
              description: proposal.description,
              filePath: `${options.workspaceDir}/skills/${proposal.skillKey}/SKILL.md`,
              source: "workspace",
              bundled: false,
              disabled: false,
              eligible: true,
            });
            this.emit({
              type: "res",
              id,
              ok: true,
              payload: {
                record: proposalRecord(proposal),
                targetSkillFile: `${options.workspaceDir}/skills/${proposal.skillKey}/SKILL.md`,
              },
            });
            return;
          }
          this.emit({ type: "res", id, ok: true, payload: proposalRecord(proposal) });
          return;
        }

        if (method === "skills.status") {
          this.emit({
            type: "res",
            id,
            ok: true,
            payload: {
              workspaceDir: options.workspaceDir,
              managedSkillsDir: options.managedSkillsDir,
              skills: state.installedSkills.map(skillStatusEntry),
            },
          });
          return;
        }

        if (method === "skills.read") {
          const skillKey = String(params.skillKey ?? "");
          const skill = state.installedSkills.find((entry) => entry.skillKey === skillKey);
          const applied = state.proposals.find((entry) => entry.skillKey === skillKey && entry.status === "applied");
          const content = applied?.content ?? `# ${skill?.name ?? skillKey}\n`;
          if (!skill) {
            this.emit({
              type: "res",
              id,
              ok: false,
              error: { code: "NOT_FOUND", message: `Unknown skill ${skillKey}`, details: { code: "NOT_FOUND" } },
            });
            return;
          }
          this.emit({
            type: "res",
            id,
            ok: true,
            payload: {
              skillKey,
              path: skill.filePath,
              sizeBytes: content.length,
              content,
            },
          });
          return;
        }

        if (method === "config.get") {
          this.emit({ type: "res", id, ok: true, payload: { parsed: state.config, hash: state.configHash } });
          return;
        }
        if (method === "config.patch" || method === "config.apply" || method === "config.set") {
          const raw = typeof params.raw === "string" ? params.raw : "";
          const baseHash = typeof params.baseHash === "string" ? params.baseHash : "";
          // Record the write attempt before the failure decision so the spec
          // can prove a failed save is never silently replayed.
          state.configWrites.push({ method, raw, baseHash });
          if (options.failConfigPatch) {
            this.emit({
              type: "res",
              id,
              ok: false,
              error: { code: "UNAVAILABLE", message: "config write failed", details: { code: "UNAVAILABLE" } },
            });
            return;
          }
          try {
            const parsedPatch: unknown = raw ? JSON.parse(raw) : {};
            if (isPlainObject(parsedPatch)) {
              state.config = method === "config.patch" ? mergeConfig(state.config, parsedPatch) : parsedPatch;
            }
          } catch {
            // Malformed raw payloads are answered ok here; the dashboard never
            // sends them, and this mock only needs the well-formed contract.
          }
          state.configHash = `hash-${state.configWrites.length + 1}`;
          if (options.persistConfig) {
            window.sessionStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(state.config));
          }
          this.emit({ type: "res", id, ok: true, payload: { parsed: state.config, hash: state.configHash } });
          return;
        }
        if (method === "config.schema") {
          this.emit({ type: "res", id, ok: true, payload: { schema: {}, uiHints: {} } });
          return;
        }
        if (method === "chat.send") {
          state.sendCalls.push({ method, sessionKey: params.sessionKey, message: params.message });
          // Dashboard chat uses a generated `dashboard:<uuid>` session key, so
          // a script may declare `sessionKey: "*"` as a catch-all; an exact
          // session queue always wins for cross-session specs.
          const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey : "main";
          const exactQueue = state.chatScripts[sessionKey] ?? [];
          const wildcardQueue = state.chatScripts["*"] ?? [];
          const queue = exactQueue.length > 0 ? exactQueue : wildcardQueue;
          const script = queue.length > 0 ? queue.shift()! : null;
          const runId = script?.runId ?? `run-mock-${state.historyClock++}`;
          this.emit({ type: "res", id, ok: true, payload: { runId } });
          if (!script) return;

          const userText = typeof params.message === "string" ? params.message : "";
          const rows = (state.chatHistories[sessionKey] ??= []);
          rows.push({ role: "user", timestamp: state.historyClock++, content: [{ type: "text", text: userText }] });

          // Emission order mirrors the live gateway contract: private
          // reasoning first, then each working note as an explicit
          // commentary frame paired with its cumulative ordinary chat
          // mirror, and finally the terminal frame.
          let visible = "";
          const emitCommentary = (note: string) => {
            visible = note;
            this.emit({
              type: "event",
              event: "agent",
              payload: {
                stream: "assistant",
                runId,
                sessionKey,
                data: { phase: "commentary", text: note, delta: "", replace: true },
              },
            });
            this.emit({
              type: "event",
              event: "chat",
              payload: {
                runId,
                sessionKey,
                state: "delta",
                message: { role: "assistant", content: [{ type: "text", text: visible }] },
              },
            });
          };
          const finalize = () => {
            const fullText = [visible, script.finalText].filter(Boolean).join("\n");
            // Persist exactly what the live gateway persists: each cumulative
            // note is its own text-only assistant row with
            // stopReason "toolUse", the final answer uses "stop".
            for (const note of script.commentary) {
              rows.push({ role: "assistant", stopReason: "toolUse", timestamp: state.historyClock++, content: [{ type: "text", text: note }] });
            }
            rows.push({
              role: "assistant",
              stopReason: script.finalStopReason,
              timestamp: state.historyClock++,
              content: [{ type: "text", text: fullText }],
            });
            this.emit({
              type: "event",
              event: "chat",
              payload: {
                runId,
                sessionKey,
                state: "final",
                message: {
                  role: "assistant",
                  stopReason: script.finalStopReason,
                  content: [{ type: "text", text: fullText }],
                },
              },
            });
          };

          if (script.thinking) {
            this.emit({
              type: "event",
              event: "agent",
              payload: {
                stream: "thinking",
                runId,
                sessionKey,
                data: { delta: script.thinking, text: script.thinking },
              },
            });
          }
          for (const note of script.commentary) emitCommentary(note);
          if (script.holdFinal) state.heldFinals.push(() => finalize());
          else finalize();
          return;
        }
        if (method === "chat.abort") {
          // Bounded behavior: discard any held terminal frames and ack. No
          // additional frames are emitted; the client owns its stop state.
          state.heldFinals.length = 0;
          this.emit({ type: "res", id, ok: true, payload: { aborted: true } });
          return;
        }
        if (method === "chat.history") {
          const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey : "main";
          const messages = (state.chatHistories[sessionKey] ?? []).map((row) => ({
            ...row,
            content: row.content.map((block) => ({ ...block })),
          }));
          this.emit({ type: "res", id, ok: true, payload: { messages } });
          return;
        }
        if (method === "sessions.list") {
          this.emit({ type: "res", id, ok: true, payload: { sessions: options.sessions } });
          return;
        }
        if (method === "agents.list") {
          this.emit({ type: "res", id, ok: true, payload: { agents: [{ id: "main" }] } });
          return;
        }
        if (method === "cron.list") {
          this.emit({ type: "res", id, ok: true, payload: { jobs: [] } });
          return;
        }
        if (method === "models.list") {
          this.emit({ type: "res", id, ok: true, payload: { models: [] } });
          return;
        }
        if (method === "files.list") {
          this.emit({
            type: "res",
            id,
            ok: true,
            payload: { type: "directory", prefix: "", directories: [], files: [], truncated: false },
          });
          return;
        }
        if (method === "skills.search") {
          this.emit({ type: "res", id, ok: true, payload: { results: [] } });
          return;
        }
        if (method === "skills.update") {
          this.emit({ type: "res", id, ok: true, payload: { ok: true } });
          return;
        }

        this.emit({ type: "res", id, ok: true, payload: {} });
      }

      close(code?: number, reason?: string) {
        if (this.readyState === MockGatewayWebSocket.CLOSED) return;
        this.readyState = MockGatewayWebSocket.CLOSED;
        window.setTimeout(() => {
          const event = { code, reason };
          this.onclose?.(event);
          for (const listener of this.listeners.close) listener(event);
        }, 0);
      }

      private emit(message: unknown) {
        window.setTimeout(() => {
          if (this.readyState !== MockGatewayWebSocket.OPEN) return;
          const event = { data: JSON.stringify(message) };
          this.onmessage?.(event);
          for (const listener of this.listeners.message) listener(event);
        }, 0);
      }
    }

    // A class expression whose constructor returns the right implementation:
    // mock for the agent gateway host, the browser's real socket for anything
    // else. Returning an object from a constructor is legal JS and keeps
    // `new WebSocket(...)` working for both call sites.
    const DispatchingWebSocket = class {
      constructor(url: string | URL, protocols?: string | string[]) {
        const target = String(url);
        if (target.includes(".example.test")) {
          return new MockGatewayWebSocket(target, socketModeFor(target));
        }
        return new NativeWebSocket(target, protocols);
      }
    };
    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      writable: true,
      value: DispatchingWebSocket,
    });
  }, JSON.stringify({
    scopes: options.scopes ?? ["operator.read", "operator.admin"],
    methods: options.methods ?? DEFAULT_METHODS,
    capabilities: options.capabilities ?? [REVISION_BOUND_CAPABILITY],
    serverVersion: options.serverVersion ?? "v2026.8.3",
    proposals: options.proposals ?? [],
    installedSkills: options.installedSkills ?? [],
    workspaceDir: options.workspaceDir ?? "/home/node/workspace",
    managedSkillsDir: options.managedSkillsDir ?? "/home/node/.openclaw/skills",
    staleApplyOnceFor: options.staleApplyOnceFor ?? null,
    failMutations: options.failMutations === true,
    restartOnce: options.restartOnce === true,
    config: options.config ?? {},
    failConfigPatch: options.failConfigPatch === true,
    persistConfig: options.persistConfig === true,
    chatScripts: options.chatScripts ?? [],
    chatHistories: options.chatHistories ?? {},
    sessions: options.sessions ?? [{ key: "main", label: "Main session" }],
  }));
}

/**
 * Emit every held terminal chat frame. Returns how many runs finalized so a
 * spec can prove it released exactly the runs it started.
 */
export async function releaseMockGatewayFinals(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    const release = (window as unknown as { __mockGatewayReleaseFinals?: () => number }).__mockGatewayReleaseFinals;
    return release ? release() : 0;
  });
}

export interface MockGatewayCall {
  proposalId: string;
  expectedRevisionHash: string | null;
}

export interface MockGatewayConfigWrite {
  method: string;
  raw: string;
  baseHash: string;
}

export interface MockGatewayInspection {
  socketCount: number;
  applyCalls: MockGatewayCall[];
  rejectCalls: MockGatewayCall[];
  pendingIds: string[];
  installedKeys: string[];
  configWrites: MockGatewayConfigWrite[];
  config: Record<string, unknown>;
  sendCalls: Array<Record<string, unknown>>;
}

/** Read the mock's recorded wire traffic back out of the page. */
export async function inspectMockGateway(page: import("@playwright/test").Page): Promise<MockGatewayInspection> {
  return page.evaluate(() => {
    const state = (window as unknown as {
      __mockGateway: {
        socketCount: number;
        proposals: Array<{ id: string; status: string }>;
        installedSkills: Array<{ skillKey: string }>;
        applyCalls: Array<{ proposalId: string; expectedRevisionHash: string | null }>;
        rejectCalls: Array<{ proposalId: string; expectedRevisionHash: string | null }>;
        configWrites: Array<{ method: string; raw: string; baseHash: string }>;
        config: Record<string, unknown>;
        sendCalls: Array<Record<string, unknown>>;
      };
    }).__mockGateway;
    return {
      socketCount: state.socketCount,
      applyCalls: state.applyCalls.map((call) => ({ ...call })),
      rejectCalls: state.rejectCalls.map((call) => ({ ...call })),
      pendingIds: state.proposals.filter((proposal) => proposal.status === "pending").map((proposal) => proposal.id),
      installedKeys: state.installedSkills.map((skill) => skill.skillKey),
      configWrites: state.configWrites.map((write) => ({ ...write })),
      config: JSON.parse(JSON.stringify(state.config)) as Record<string, unknown>,
      sendCalls: state.sendCalls.map((call) => ({ ...call })),
    };
  });
}
