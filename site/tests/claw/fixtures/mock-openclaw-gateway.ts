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
}

const DEFAULT_METHODS = [
  "config.get",
  "config.schema",
  "chat.history",
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
    };
    (window as unknown as { __mockGateway: typeof state }).__mockGateway = state;

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

      constructor(url: string) {
        this.url = url;
        this.readyState = MockGatewayWebSocket.CONNECTING;
        this.onopen = null;
        this.onmessage = null;
        this.onerror = null;
        this.onclose = null;
        state.socketCount += 1;
        this.socketNumber = state.socketCount;
        window.setTimeout(() => {
          if (this.readyState !== MockGatewayWebSocket.CONNECTING) return;
          this.readyState = MockGatewayWebSocket.OPEN;
          this.onopen?.();
          this.emit({
            type: "event",
            event: "connect.challenge",
            payload: { nonce: `nonce-${this.socketNumber}` },
          });
        }, 0);
      }

      send(data: string) {
        let message: { id?: string; method?: string; params?: Record<string, unknown> };
        try {
          message = JSON.parse(data);
        } catch {
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
          this.emit({ type: "res", id, ok: true, payload: { parsed: {}, hash: "hash-1" } });
          return;
        }
        if (method === "config.schema") {
          this.emit({ type: "res", id, ok: true, payload: { schema: {}, uiHints: {} } });
          return;
        }
        if (method === "chat.history") {
          this.emit({ type: "res", id, ok: true, payload: { messages: [] } });
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
        window.setTimeout(() => this.onclose?.({ code, reason }), 0);
      }

      private emit(message: unknown) {
        window.setTimeout(() => {
          if (this.readyState !== MockGatewayWebSocket.OPEN) return;
          this.onmessage?.({ data: JSON.stringify(message) });
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
          return new MockGatewayWebSocket(target);
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
  }));
}

export interface MockGatewayCall {
  proposalId: string;
  expectedRevisionHash: string | null;
}

export interface MockGatewayInspection {
  socketCount: number;
  applyCalls: MockGatewayCall[];
  rejectCalls: MockGatewayCall[];
  pendingIds: string[];
  installedKeys: string[];
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
      };
    }).__mockGateway;
    return {
      socketCount: state.socketCount,
      applyCalls: state.applyCalls.map((call) => ({ ...call })),
      rejectCalls: state.rejectCalls.map((call) => ({ ...call })),
      pendingIds: state.proposals.filter((proposal) => proposal.status === "pending").map((proposal) => proposal.id),
      installedKeys: state.installedSkills.map((skill) => skill.skillKey),
    };
  });
}
