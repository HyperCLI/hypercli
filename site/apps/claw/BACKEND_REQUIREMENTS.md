# Backend Requirements — Chat Redesign

Captures gaps discovered while wiring the new three-panel `/dashboard/agents/` UI to existing gateway/REST endpoints. Cross-reference with [WIRING_REFERENCE.md](./WIRING_REFERENCE.md).

**Scope:** OpenClaw Gateway (WebSocket RPC) + HyperClaw REST API.

---

## P0 — Bugs Blocking Current Functionality

### B-1. Agent hostname returns wrong TLD

**Symptom:** `GET /deployments` returns agents with `hostname: "cool-rune-agent.hypercli.app"` while frontend expects `.dev.hypercli.com` (per env config).

**Impact:** Gateway WebSocket connection fails immediately — chat, files, config, channels are all unreachable.

**Required:** Agent hostnames must match the cluster domain. The `dev` cluster should issue `.dev.hypercli.com` hostnames. Return canonical fully-qualified hostname per environment.

**Affects:** Every flow — chat, logs, shell, OpenClaw config, files, channels.

---

### B-2. Shell token endpoint returns 503

**Symptom:** `POST /agents/{id}/shell/token` returns `503 Service Unavailable`.

**Impact:** Shell terminal cannot connect.

**Required:** Endpoint must consistently return a valid pod JWT for shell WebSocket auth.

**Affects:** Shell view (gear dropdown → Shell).

---

## P1 — Missing Data Required for AgentView Modules

These modules currently fall back to mock data. Backend changes needed to provide real data.

### D-1. Sessions list enrichment

**Current:** `gw.sessionsList()` returns an array but field shape is uncertain. Frontend defensively normalizes with fallbacks.

**Required response shape (per session):**

```ts
{
  key: string;              // session identifier
  clientMode: string;       // "browser" | "cli" | "telegram" | "api" | etc.
  clientDisplayName: string; // human-readable (e.g. "Chrome on macOS")
  createdAt: number;        // Unix ms
  lastMessageAt: number;    // Unix ms
}
```

**Affects:** `SessionsModule` (Overview tab → Active Sessions).

---

### D-2. Cron job enrichment + toggle support

**Current:** `gw.cronList()` returns jobs, `cronAdd`/`cronRemove`/`cronRun` work. No way to toggle `enabled` without remove + re-add.

**Required response shape:**

```ts
{
  id: string;
  schedule: string;       // cron expression "0 9 * * *"
  prompt: string;         // what the cron triggers
  description: string;
  enabled: boolean;
  lastRun?: number;       // Unix ms
  nextRun?: number;       // Unix ms (server-computed from schedule)
}
```

**New RPC method needed:**

```
cron.patch { jobId, patch: { enabled?: boolean, schedule?: string, prompt?: string, description?: string } }
```

**Affects:** `CronTab` (Overview → Cron).

---

### D-3. Channel status enrichment

**Current shape:**

```ts
{ channels: { telegram: { configured, running, probe: { ok } } } }
```

**Required additional fields per channel:**

```ts
{
  configured: boolean;
  running: boolean;
  accountId?: string;        // for multi-account integrations
  accountDisplayName?: string; // e.g. "@mybot" for Telegram
  lastActiveAt?: number;     // Unix ms — last successful interaction
  errorDetail?: string;      // present if running=false due to error
  probe?: { ok: boolean; latencyMs?: number; error?: string };
}
```

**Affects:** `ConnectionRow`, Connections tab, integration status indicators.

---

### D-4. Tool usage analytics

**Current:** `ToolUsageModule` uses static mock stats. No backend endpoint exists.

**New RPC method needed:**

```
analytics.toolUsage { agentId?: string, days?: number }
  → { tools: [{ name: string, callCount: number, errorCount: number, avgLatencyMs: number, lastUsedAt: number }] }
```

**Affects:** `ToolUsageModule` (Overview).

---

### D-5. Activity history endpoint

**Current:** Activity feed is built client-side from `gw.onEvent` and lost on reload.

**New RPC method needed:**

```
activity.list { sessionKey?: string, limit?: number, types?: string[] }
  → { entries: [{ id, type: "message"|"tool"|"connection"|"cron"|"error"|"system", action, detail, timestamp }] }
```

**Affects:** Activity tab (would survive page reloads, support filtering by type).

---

### D-6. Recent tool calls endpoint

**Current:** Extracted client-side from chat messages. Misses tool calls from non-active sessions and history older than message limit.

**New RPC method needed:**

```
analytics.recentToolCalls { limit?: number }
  → { calls: [{ id, name, args, result?, error?, timestamp, sessionKey, duration_ms }] }
```

**Affects:** "Recent Tool Calls" section in Activity tab.

---

### D-7. Agent limits / quotas

**Current:** `LimitsModule` uses static mock data.

**New REST endpoint needed:**

```
GET /agents/{id}/limits
  → {
    tokens_per_minute: { used: number, limit: number },
    tokens_per_day: { used: number, limit: number },
    concurrent_calls: { used: number, limit: number },
    storage_mb: { used: number, limit: number }
  }
```

**Affects:** `LimitsModule` (Overview).

---

### D-8. Agent uptime + real-time metrics

**Current:** Frontend computes uptime from `started_at`. CPU/memory only available via 60s polling on the deployments list.

**Required:** Either return live metrics in `agent.get()`, or expose a streaming endpoint:

```
GET /agents/{id}/metrics
  → { uptime_s: number, cpu_pct: number, memory_used_mib: number, memory_total_mib: number }
```

Or via gateway:

```
gw.metrics() → same shape
```

**Affects:** `StatusCardModule`, `AgentCardModule`, `GatewayStatusModule`.

---

### D-9. Capability index for "What Can I Do?"

**Current:** `WhatCanIDoPanel` uses hardcoded capabilities. No backend mapping of tools → user-facing capability descriptions exists.

**Required:** The gateway already exposes tools via `configSchema`, but each tool needs a UX-facing capability tag and description.

**New RPC method or schema extension:**

```
gw.capabilities()
  → { capabilities: [{ id, label, description, requires: string[], enabled: boolean, examples: string[] }] }
```

Where `requires` lists the tools/integrations needed and `enabled` reflects current config state.

**Affects:** `WhatCanIDoPanel`, `ExamplePromptsModule`, `CompletenessRingModule`.

---

### D-10. Multi-participant Channels (group conversations)

**Current:** The `AgentsChannelsSidebar` has a "Channels" section and a `ChannelCreationWizard` modal that lets the user create a channel with a name, description, one agent, and multiple users. The wizard's `onCreate` callback is wired but has nowhere to call — the page.tsx handler currently just `console.log`s the draft.

**Important — terminology collision:** The existing SDK has `channels.*` methods (`channelsStatus`, `channelsLogout`, `channelUpsert`, `telegramConfig`, `slackConfig`, `discordConfig`). Those are **integration channels** — credentials/configuration for external messaging platforms attached to a single agent. They are **not** the same concept as the new "channels" in the sidebar, which are multi-participant chat threads (one agent + multiple human users). Pick a different name in the API surface to avoid confusion (suggested: `rooms`, `threads`, `groups`, or `conversations`).

**Required draft shape (frontend already builds this):**

```ts
{
  name: string,
  description: string,
  agent: { id, name, type: "agent" } | null,
  users: { id, name, type: "user" }[],
}
```

**Two implementation paths:**

#### Option A — Full backend (recommended for cross-user visibility)

Persist channels as first-class entities so multiple users can see and join the same channel.

**REST endpoints:**

```
POST /channels
  body { name, description, agent_id, user_ids: string[] }
  → { id, name, description, agent_id, user_ids, session_key, created_at }

GET /channels
  → { channels: [{ id, name, description, agent_id, user_ids, session_key, last_message_at, message_count }] }

GET /channels/{id}
  → { id, name, description, agent_id, user_ids, session_key, ... }

PATCH /channels/{id}
  body { name?, description?, user_ids? }
  → updated channel

DELETE /channels/{id}
```

**Gateway routing:** When a channel message is sent, the gateway needs to know which agent participates and route the response back to all participants' active sessions. Possible RPC:

```
gw.chatSend with sessionKey = channel.session_key
gw.onEvent fans out to all subscribers of that session_key
```

**Storage:** Channel metadata (name, description, members) needs to survive agent restarts — likely a new table in the same DB that stores agents/sessions.

#### Option B — Thin convention (single-user only)

Treat a "channel" as a labeled `sessionKey` plus client-side metadata (display name, description) stored in the agent's config. No new endpoints; reuse existing `chat.*` and `config.*` RPCs.

**Tradeoffs vs Option A:**

- ✅ No new backend work — only requires a config schema slot like `config.channels: { [sessionKey]: { name, description, member_ids } }`
- ❌ No cross-user visibility — channels are per-account
- ❌ Member `users` are decorative only since the gateway has no per-user identity in chat sessions

**Affects:** `ChannelCreationWizard` `onCreate` handler, `AgentsChannelsSidebar` Channels section, threading model in `useGatewayChat`.

---

## P2 — Optional Modules (Nice-to-Have)

These power the "out of scope for initial launch" modules listed in [the design doc, Section 11](../../2026-04-15-chat-redesign-design.md):

### O-1. Achievements

```
GET /agents/{id}/achievements?days=7
  → { achievements: [{ id, label, description, earnedAt, icon }] }
```

### O-2. Tool discovery (recommendation engine)

```
analytics.toolRecommendations { agentId? }
  → { recommendations: [{ tool: string, reason: string, priority: "low"|"med"|"high" }] }
```

### O-3. Connection recommendations

```
analytics.connectionRecommendations { agentId? }
  → { recommendations: [{ integration: string, reason: string, priority: "low"|"med"|"high" }] }
```

### O-4. Interaction patterns analytics

```
analytics.interactionPatterns { agentId?, days? }
  → { patterns: [{ category: "messages"|"tools"|"connections", count, percentage }] }
```

### O-5. Capability diff (config change history)

```
GET /agents/{id}/config/changelog?limit=20
  → { changes: [{ timestamp, path: string[], oldValue, newValue, source: "user"|"agent"|"cron" }] }
```

### O-6. Decision log

```
gw.decisionsList { sessionKey?, limit? }
  → { decisions: [{ id, summary, rationale, timestamp, relatedToolCalls: string[] }] }
```

### O-7. Exec approval queue

Currently `gw.execApprove` / `gw.execDeny` exist but no list endpoint:

```
gw.execList
  → { pending: [{ execId, command, args, requestedAt, requester, riskLevel }] }
```

### O-8. Permissions model

A permissions matrix doesn't exist server-side. Would need a full permissions design before this module can be wired.

---

## P3 — Integration Setup Guides (per design doc)

Each integration needs server-provided **setup walkthrough content**, not just config schema. Currently the OpenClaw schema only describes fields (e.g. Telegram: App ID, App Password, Tenant ID) — users must figure out how to obtain those values themselves.

**Required:** Extend schema UI hints or add dedicated metadata:

```
gw.integrationGuides()
  → {
    integrations: [{
      key: string,                    // matches integration name
      title: string,                  // "Microsoft Teams"
      description: string,
      requirements: string[],         // ["Azure AD account", "Bot registration"]
      steps: [{
        title: string,
        body: string,                 // markdown
        screenshot?: string,          // URL or asset key
        external_link?: { label, url } // e.g. "Open Azure Portal"
      }],
      troubleshooting: [{ issue, resolution }]
    }]
  }
```

**Affects:** Connections tab → Directory modal → integration setup flows.

---

## P4 — Directory / Marketplace Cleanup

Per design doc Section 5:

- **D-10.** Web category should keep Brave Search, DuckDuckGo. Remove or hide Exa, Tavily, Firecrawl.
- **D-11.** Split "Tools" category into:
  - **Integrations** — native OpenClaw plugins (web search, browser, memory, OpenShell)
  - **Skills** — `SKILL.md` files (workspace skills, ClawHub-installed)

These are config/registry changes, not new endpoints — but require coordination with the OpenClaw plugin registry.

---

## Endpoint Summary Table

| Need | Type | Status | Used By |
|------|------|--------|---------|
| `B-1` Hostname fix | Infra | **Bug** | Everything |
| `B-2` Shell token 503 | Bug | **Bug** | Shell view |
| `D-1` Sessions enrichment | RPC enrichment | Schema gap | SessionsModule |
| `D-2` Cron toggle (`cron.patch`) | New RPC | Missing | CronTab |
| `D-3` Channels enrichment | RPC enrichment | Schema gap | ConnectionRow |
| `D-4` Tool usage analytics | New RPC | Missing | ToolUsageModule |
| `D-5` Activity history | New RPC | Missing | Activity tab |
| `D-6` Recent tool calls | New RPC | Missing | Activity tab |
| `D-7` Agent limits | New REST | Missing | LimitsModule |
| `D-8` Real-time metrics | New endpoint | Missing | StatusCardModule |
| `D-9` Capability index | New RPC | Missing | WhatCanIDoPanel |
| `D-10` Multi-participant Channels | New REST + gateway routing | Missing | ChannelCreationWizard, AgentsChannelsSidebar |
| `O-1` to `O-8` | Various | Out of scope | Future modules |
| `P3` Integration guides | New RPC + content | Missing | Directory modal |
| `P4` Directory cleanup | Registry config | Pending | Directory modal |

---

## Frontend Workarounds Currently in Place

Until the backend changes land, frontend uses these fallbacks:

1. **Activity feed** — built client-side from `gw.onEvent`, lost on reload, capped at 500 entries
2. **Recent tool calls** — extracted from `chat.messages` (limited to last ~200 messages)
3. **Sessions** — defensive normalization with field fallbacks (`key` ← `id`, `clientMode` ← `client`, etc.)
4. **Channel status** — boolean derived as `configured && running`
5. **Agent uptime** — `Date.now() - new Date(agent.started_at).getTime()` (no clock-skew handling)
6. **Tool usage / limits / achievements / nudges** — modules show "mock" badge and use hardcoded data

When the backend lands, these workarounds should be removed and replaced with the real endpoints.
