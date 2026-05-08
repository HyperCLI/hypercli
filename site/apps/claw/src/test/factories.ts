import type { GatewayEvent } from "@hypercli.com/sdk/openclaw/gateway";
import type { AgentFileEntry, SdkAgent } from "@/types";
import type { AgentBudget } from "@/app/dashboard/agents/types";
import type { Plan } from "@/lib/format";

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Record<string, unknown> ? DeepPartial<T[K]> : T[K];
};

export function buildPlan(overrides: DeepPartial<Plan> = {}): Plan {
  return {
    id: "large",
    name: "Large",
    price: 100,
    aiu: 100,
    features: ["1 large agent"],
    models: ["kimi-k2.5"],
    highlighted: false,
    limits: {
      tpd: 1_000_000,
      tpm: 100_000,
      burst_tpm: 250_000,
      rpm: 600,
      ...overrides.limits,
    },
    agents: 1,
    ...overrides,
  } as Plan;
}

export function buildCurrentPlan(overrides: Record<string, unknown> = {}) {
  return {
    id: "large",
    name: "Large",
    price: 100,
    aiu: 100,
    agents: 1,
    tpmLimit: 100_000,
    rpmLimit: 600,
    expiresAt: null,
    cancelAtPeriodEnd: false,
    secondsRemaining: null,
    pooledTpd: 1_000_000,
    slotInventory: {},
    ...overrides,
  };
}

export function buildAgentFileEntry(overrides: Partial<AgentFileEntry> = {}): AgentFileEntry {
  return {
    name: "README.md",
    path: "/workspace/README.md",
    type: "file",
    size: 128,
    ...overrides,
  };
}

export function buildAgentBudget(overrides: Partial<AgentBudget> = {}): AgentBudget {
  return {
    slots: {
      small: { granted: 1, used: 0, available: 1 },
      large: { granted: 1, used: 1, available: 0 },
    },
    pooled_tpd: 1_000_000,
    size_presets: {
      small: { cpu: 1, memory: 1 },
      large: { cpu: 4, memory: 4 },
    },
    ...overrides,
  };
}

export function buildSdkAgent(overrides: Partial<SdkAgent> = {}): SdkAgent {
  return {
    id: "agent-1",
    userId: "user-1",
    podId: "pod-1",
    podName: "agent-1",
    state: "RUNNING",
    name: "Test Agent",
    cpu: 4,
    memory: 4,
    hostname: "agent.example.com",
    tags: [],
    jwtToken: null,
    jwtExpiresAt: null,
    startedAt: new Date("2026-04-28T00:00:00Z"),
    stoppedAt: null,
    lastError: null,
    createdAt: new Date("2026-04-28T00:00:00Z"),
    updatedAt: new Date("2026-04-28T00:00:00Z"),
    launchConfig: null,
    meta: null,
    routes: {},
    command: [],
    entrypoint: [],
    ports: [],
    dryRun: false,
    publicUrl: "https://agent.example.com",
    desktopUrl: null,
    vncUrl: null,
    routeUrl: () => null,
    ...overrides,
  } as unknown as SdkAgent;
}

export function buildGatewayEvent(overrides: Partial<GatewayEvent> = {}): GatewayEvent {
  return {
    event: "chat.content",
    payload: { text: "Hello" },
    ...overrides,
  } as GatewayEvent;
}
