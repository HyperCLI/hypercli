# Data Layer Plan — Hook-Based SDK Consumption

## Architecture

```
HyperCLIProvider (creates SDK clients, keyed to auth token)
    │
    useHyperCLI() ← context consumer
    │
    ├── useAgents        → Deployments.list/create/start/stop/delete
    ├── useAgent         → Deployments.get (single agent + polling)
    ├── useAgentFiles    → Deployments.filesList/Read/Write/Delete
    ├── useAgentLogs     → Deployments.logsConnect (WebSocket)
    ├── useAgentShell    → Deployments.shellConnect (WebSocket)
    ├── usePlans         → HyperAgent.plans/currentPlan
    ├── useUsage         → clawFetch (no SDK equivalent)
    └── useBilling       → clawFetch via lib/billing.ts

useGatewayChat (unchanged core, uses useHyperCLI for token)
    └── depends on GatewayClient from @hypercli.com/sdk/gateway
```

## Caching Strategy

Add `@tanstack/react-query` to `apps/claw/package.json`. It is already a dependency of `@hypercli/shared-ui` so the bundle cost is zero. This gives us: automatic cache deduplication, background refetches, stale-while-revalidate, mutation invalidation, and polling.

Default stale time: 30 seconds. Default retry: 1.

## File Structure

```
site/apps/claw/src/
  providers/
    HyperCLIProvider.tsx          # SDK client context
    QueryProvider.tsx              # TanStack Query provider
  hooks/
    useHyperCLI.ts                # Access SDK clients from context
    useAgents.ts                  # Agent CRUD + lifecycle
    useAgent.ts                   # Single agent details + polling
    useAgentFiles.ts              # S3/deployment file operations
    useAgentLogs.ts               # Logs WebSocket connection
    useAgentShell.ts              # Shell WebSocket connection
    usePlans.ts                   # Plans + current plan + subscriptions
    useUsage.ts                   # Usage stats + history + key breakdown
    useBilling.ts                 # Payments + billing profile
    useGatewayChat.ts             # EXISTING — refactored to use context
    useAgentAuth.ts               # EXISTING — unchanged
    useClawAuth.ts                # EXISTING — unchanged
  types/
    index.ts                      # Shared types (re-exports SDK + frontend shapes)
```

## Tier 1: SDK Client Provider

### HyperCLIProvider.tsx

Creates and holds `Deployments` and `HyperAgent` SDK client instances, keyed to the current auth token.

```ts
interface HyperCLIContextValue {
  deployments: Deployments | null;
  hyperAgent: HyperAgent | null;
  token: string | null;
  ready: boolean;
  refreshClients: () => Promise<void>;
}
```

- Uses `useAgentAuth().getToken()` to obtain token
- Calls `createAgentClient(token)` and `createHyperAgentClient(token)` from `@/lib/agent-client.ts`
- Token refreshed on mount and when identity changes
- Stores raw `token` string so hooks still needing `clawFetch` can use it during migration

### QueryProvider.tsx

Wraps the app in `QueryClientProvider`. Placed in dashboard layout inside auth guard.

### useHyperCLI.ts

```ts
export function useHyperCLI(): HyperCLIContextValue;
```

Throws if used outside the provider.

## Tier 2: Domain Hooks

### useAgents — Agent List + Lifecycle Mutations

**File**: `hooks/useAgents.ts`
**Wraps**: `Deployments.list()`, `Deployments.create()`, `startOpenClawAgent()`, `Deployments.stop()`, `Deployments.delete()`
**Query key**: `["agents"]`

**Polling**: Adaptive:
- 3s when any agent is in transitional state (PENDING, STARTING, STOPPING)
- 60s otherwise
- Disabled when cluster unavailable (503)

**Returns**:
```ts
{
  agents: Agent[];
  budget: AgentBudget | null;
  isLoading: boolean;
  error: string | null;
  clusterUnavailable: boolean;
  refetch: () => void;
  createAgent: (options: CreateAgentOptions) => Promise<Agent>;
  startAgent: (agentId: string) => Promise<void>;
  stopAgent: (agentId: string) => Promise<void>;
  deleteAgent: (agentId: string) => Promise<void>;
  isStarting: (agentId: string) => boolean;
  isStopping: (agentId: string) => boolean;
  isDeleting: (agentId: string) => boolean;
}
```

**Used by**: Dashboard overview, Agents page sidebar.

### useAgent — Single Agent Detail

**File**: `hooks/useAgent.ts`
**Wraps**: `Deployments.get(agentId)`, `Deployments.refreshToken()`, `Deployments.env()`, `Deployments.metrics()`
**Query key**: `["agent", agentId]`
**Parameters**: `agentId: string | null` (null disables query)

**Returns**:
```ts
{
  agent: Agent | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  refreshToken: () => Promise<AgentTokenResponse>;
  getEnv: () => Promise<Record<string, string>>;
  getMetrics: () => Promise<Record<string, any>>;
}
```

**Used by**: Console page, agents page selected agent.

### useAgentFiles — Deployment File Operations

**File**: `hooks/useAgentFiles.ts`
**Wraps**: `Deployments.filesList()`, `Deployments.fileReadBytes()`, `Deployments.fileWriteBytes()`, `Deployments.fileDelete()`
**Query key**: `["agent-files", agentId, prefix]`
**Parameters**: `agentId: string | null, prefix?: string`

**Returns**:
```ts
{
  directories: AgentFileEntry[];
  files: AgentFileEntry[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  uploadFile: (path: string, content: ArrayBuffer) => Promise<void>;
  deleteFile: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  downloadFile: (path: string) => Promise<Uint8Array>;
}
```

**Used by**: Files tab (S3FilesPanel), FilesDrawer, FilesPanel.

### useAgentLogs — Log Streaming

**File**: `hooks/useAgentLogs.ts`
**Wraps**: `Deployments.logsConnect(agentId)` — WebSocket
**Parameters**: `agentId: string | null, enabled: boolean`

Extracted from agents/page.tsx inline WebSocket management.

**Returns**:
```ts
{
  logs: string[];
  status: "connected" | "connecting" | "disconnected";
  reconnect: () => void;
  clearLogs: () => void;
}
```

**Used by**: Logs tab.

### useAgentShell — Shell WebSocket

**File**: `hooks/useAgentShell.ts`
**Wraps**: `Deployments.shellConnect(agentId)` — WebSocket
**Parameters**: `agentId: string | null, enabled: boolean, terminalRef: RefObject<Terminal | null>`

Extracted from agents/page.tsx shell management.

**Returns**:
```ts
{
  status: "connected" | "connecting" | "disconnected";
  reconnect: () => void;
}
```

**Used by**: Shell tab.

### usePlans — Plan Catalog + Current Subscription

**File**: `hooks/usePlans.ts`
**Wraps**: `HyperAgent.plans()`, `HyperAgent.currentPlan()`, plus `clawFetch("/types")`
**Query keys**: `["plans"]`, `["plans", "current"]`, `["plans", "types"]`

**Returns**:
```ts
{
  plans: HyperAgentPlan[];
  currentPlan: HyperAgentCurrentPlan | null;
  typeCatalog: AgentTypeCatalogResponse | null;
  isLoading: boolean;
  error: string | null;
  refreshCurrentPlan: () => Promise<void>;
}
```

**Used by**: Plans page, PlanCheckoutModal.

### useUsage — Usage Statistics

**File**: `hooks/useUsage.ts`
**Wraps**: `clawFetch("/usage")`, `clawFetch("/usage/history?days=7")`, `clawFetch("/usage/keys?days=7")`
**Query keys**: `["usage"]`, `["usage", "history", days]`, `["usage", "keys", days]`
**Parameters**: `days?: number` (default 7)

These endpoints hit the HyperClaw API directly (no SDK equivalent).

**Returns**:
```ts
{
  usage: UsageInfo | null;
  history: DayData[];
  keyUsage: KeyUsageEntry[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}
```

**Used by**: Dashboard overview.

### useBilling — Payments + Billing Profile

**File**: `hooks/useBilling.ts`
**Wraps**: Functions from `@/lib/billing.ts`
**Query keys**: `["billing", "payments"]`, `["billing", "profile"]`

**Returns**:
```ts
{
  payments: AgentPayment[];
  profile: AgentBillingProfileResponse | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  getPayment: (id: string) => Promise<AgentPayment>;
  updateProfile: (fields: AgentBillingProfileFields) => Promise<void>;
}
```

**Used by**: Billing pages.

## useGatewayChat — Stays As-Is

Manages complex WebSocket lifecycle (challenge-response handshake, cookie auth, chat streaming, file ops, cron, exec approval). Gains a dependency on `useHyperCLI` for the token but core is unchanged. Config ops stay inside since they depend on the active gateway connection.

## Browser Safety

No hook imports `@hypercli.com/sdk` (main entry — pulls in Node `dns`). All imports use subpath exports:
- `@hypercli.com/sdk/agents`
- `@hypercli.com/sdk/gateway`
- `@hypercli.com/sdk/http`
- `@hypercli.com/sdk/agent`

## Error Handling

- `error` is `string | null` (not Error objects, matching codebase convention)
- Queries catch errors silently with fallback defaults
- Mutations throw so callers can show UI feedback
- 503 errors set `clusterUnavailable` flag

## Token Lifecycle

- `HyperCLIProvider` calls `getToken()` once on mount, stores result
- SDK clients are memoized: only recreated when token changes
- Query functions do NOT call `getToken()` — they use pre-created clients from context
- 401 failures trigger `refreshClients()` + single retry via react-query

## Migration Phases

### Phase 1 — Foundation
1. Add `@tanstack/react-query` to `apps/claw/package.json`
2. Create `QueryProvider.tsx` and `HyperCLIProvider.tsx`
3. Wrap dashboard layout in both providers
4. Create `useHyperCLI.ts`

### Phase 2 — Core Domain Hooks
5. `useAgents.ts` — migrate agents page sidebar list + mutations
6. `useAgent.ts` — migrate console page agent fetch
7. `useAgentFiles.ts` — migrate S3FilesPanel
8. `useAgentLogs.ts` — extract from agents page
9. `useAgentShell.ts` — extract from agents page

### Phase 3 — Secondary Domain Hooks
10. `usePlans.ts` — migrate plans page
11. `useUsage.ts` — migrate dashboard overview
12. `useBilling.ts` — migrate billing pages

### Phase 4 — Page Refactors
13. Refactor `agents/page.tsx` to use `useAgents`, `useAgentLogs`, `useAgentShell`, `useAgentFiles`
14. Refactor `dashboard/page.tsx` to use `useAgents`, `useUsage`, `usePlans`
15. Refactor `plans/page.tsx` to use `usePlans`
16. Refactor `agents/[id]/console/page.tsx` to use `useAgent`, `useAgentFiles`, `useGatewayChat`

## Dependency Graph

```
useAgentAuth (shared-ui, unchanged)
    │
    v
HyperCLIProvider (creates Deployments + HyperAgent)
    │
    v
useHyperCLI (accesses context)
    │
    ├── useAgents (Deployments.list, create, start, stop, delete)
    │     ├── useAgent (Deployments.get for single agent)
    │     ├── useAgentFiles (Deployments.filesList, etc.)
    │     ├── useAgentLogs (Deployments.logsConnect)
    │     └── useAgentShell (Deployments.shellConnect)
    │
    ├── usePlans (HyperAgent.plans, currentPlan)
    ├── useUsage (clawFetch — no SDK equivalent)
    └── useBilling (clawFetch via lib/billing.ts)

useGatewayChat (unchanged core, uses useHyperCLI for token)
    ├── GatewayClient from @hypercli.com/sdk/gateway
    └── agent-store for gateway token persistence
```
