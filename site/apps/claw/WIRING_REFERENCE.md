# Module Wiring Reference

Maps every AgentView module to its real data source and action handlers.
Use this document when connecting modules to live gateway/API data.

**Source of truth for data layer:** `useGatewayChat` hook + `createAgentClient()` REST calls.

---

## AgentViewProps — Real Data Mapping

These props on `<AgentView>` replace mock data with live values:

| Prop | Type | Source | How to Derive |
|------|------|--------|---------------|
| `agentName` | `string` | `selectedAgent.name` | Direct from agent list |
| `agentStatus` | `AgentStatus` | Agent object + gateway | `{ state: agent.state, uptime: Date.now() - agent.started_at, cpu: agent.cpu_millicores / 10, memory: { used: agent.memory_mib, total: tierMemoryLimit } }` |
| `agentConfig` | `AgentConfig` | `chat.config` + `chat.configSchema` | `{ model: config.llm?.model, systemPrompt: config.llm?.systemPrompt, tools: extractToolsFromSchema(configSchema) }` |
| `agentSessions` | `AgentSession[]` | `gw.sessionsList()` | Direct map from gateway response |
| `agentConnections` | `Connection[]` | `chat.channelsStatus()` | Map channel entries to `Connection` type |

---

## Tab 1: Overview — Module Wiring

### StatusCardModule
- **Data:** `agentStatus` prop (see mapping above)
- **Actions:** None (display only)
- **Gateway calls:** None — derived from agent list polling + `agent.started_at`

### AgentCardModule
- **Data:** `agentName`, `agentStatus`, `agentConfig`, `agentConnections`, `agentSessions`
- **Actions:** Expand/collapse (internal state only)
- **Gateway calls:** None — composed from other props

### ConfigModule
- **Data:** `agentConfig` prop
- **Actions:** `toggleTool(toolName)` — enable/disable a tool
- **Gateway calls:** `chat.saveConfig({ tools: { [toolName]: { enabled } } })` via `gw.configPatch()`
- **Wiring notes:** Tool list comes from `configSchema.properties` filtered by tool-type entries. The `enabled` state maps to config values.

### SessionsModule
- **Data:** `agentSessions` prop
- **Actions:** None (display only)
- **Gateway calls:** `gw.sessionsList()` — returns `{ key, clientMode, clientDisplayName, createdAt, lastMessageAt }[]`
- **Wiring notes:** Method exists in GatewayClient but is NOT called in `useGatewayChat` today. Add to `onHello` initial data load alongside `configGet`/`configSchema`.

### WorkspaceFilesModule
- **Data:** `chat.files` (from `gw.filesList()`)
- **Actions:** Open file, upload, delete
- **Gateway calls:**
  - List: `gw.filesList(agentId)` — already called on connect
  - Read: `gw.fileGet(agentId, name)` — via `chat.openFile(name)`
  - Write: `gw.fileSet(agentId, name, content)` — via `chat.saveFile(name, content)`
  - Upload (binary): `createAgentClient(token).fileWriteBytes(agentId, path, buffer)` — REST, not gateway
  - Delete: `createAgentClient(token).fileDelete(agentId, path)` — REST
- **Wiring notes:** Gateway RPC handles text files. Binary uploads go through REST agent client. Protect core agent files (config, system) from deletion — scope delete to user-created files under `.openclaw/workspace/`.

### ExamplePromptsModule
- **Data:** Static prompts (can be hardcoded or loaded from config)
- **Actions:** Click prompt → insert into chat input
- **Gateway calls:** `chat.sendMessage(promptText)` or `chat.setInput(promptText)` to pre-fill
- **Wiring notes:** Design decision — send immediately vs pre-fill input. Recommend pre-fill (`setInput`) so user can review before sending.

### WhatCanIDoPanel
- **Data:** Derived from `agentConfig` (enabled tools/integrations) + `agentConnections`
- **Actions:** Enable/disable capabilities, dismiss nudges
- **Gateway calls:** `chat.saveConfig(patch)` via `gw.configPatch()` for capability toggles
- **Wiring notes:** Capabilities list should be computed from `configSchema` — each integration/tool that has an `enabled` field becomes a toggleable capability.

### CompletenessRingModule
- **Data:** Derived from agent readiness checks
- **Actions:** None (display only)
- **Gateway calls:** None — computed client-side from: has model? has system prompt? has tools? has connections?
- **Wiring notes:** Segments: `[ { label: "Model", complete: !!config.llm?.model }, { label: "Identity", complete: !!config.llm?.systemPrompt }, { label: "Tools", complete: tools.some(t => t.enabled) }, { label: "Connections", complete: connections.some(c => c.connected) } ]`

### ModelCapsModule
- **Data:** Model capability metadata
- **Actions:** None (display only)
- **Gateway calls:** `gw.modelsList()` — available in GatewayClient
- **Wiring notes:** Match `config.llm.model` against models list to show capabilities (vision, function calling, streaming, etc.)

### QuickActionsModule
- **Data:** Static action list
- **Actions:** Button clicks → trigger specific flows
- **Gateway calls:** Depends on action (e.g., "Restart agent" → `stop()` then `start()`)
- **Wiring notes:** Actions need callback props passed down. Define an `onQuickAction(actionId)` handler.

### AgentUrlsModule
- **Data:** Derived from agent object
- **Actions:** Copy URL to clipboard
- **Gateway calls:** None
- **Wiring notes:** URLs: `{ api: agent.hostname, ws: "wss://" + agent.hostname, dashboard: window.location.href }`

### GatewayStatusModule
- **Data:** Gateway connection state
- **Actions:** None (display only)
- **Gateway calls:** `gw.status()` or derive from GatewayClient properties
- **Wiring notes:** `{ protocol: gw.protocol, version: gw.version, connected: gw.isConnected, uptime: agentStatus.uptime }`

### ToolUsageModule
- **Data:** Tool call frequency stats
- **Actions:** None (display only)
- **Gateway calls:** No dedicated endpoint — aggregate from activity/tool call events
- **Wiring notes:** Build client-side by counting tool calls from the activity feed. Future: dedicated analytics endpoint.

### LimitsModule
- **Data:** Agent resource limits
- **Actions:** None (display only)
- **Gateway calls:** None — derived from agent tier
- **Wiring notes:** Map agent `size`/tier to known limits (tokens/min, concurrent calls, etc.)

### ProvidersModule
- **Data:** Available model providers
- **Actions:** None (display only)
- **Gateway calls:** `gw.modelsList()`
- **Wiring notes:** Group models by provider from the models list response.

---

## Tab 1: Overview — Context-Filtered Modules

### Single Conversation Only

#### ExecQueueModule
- **Data:** Pending execution approvals
- **Actions:** Approve / Deny
- **Gateway calls:** `gw.execApprove(execId)`, `gw.execDeny(execId)`
- **Wiring notes:** Both methods exist in GatewayClient. No UI polling — listen for exec events via `gw.onEvent()`.

#### NudgesModule
- **Data:** Contextual suggestions based on agent performance
- **Actions:** Dismiss, act on suggestion
- **Gateway calls:** None — computed client-side
- **Wiring notes:** Future feature. Needs context-aware suggestion logic. Stub with empty state.

#### CapabilityDiffModule
- **Data:** Changes in agent capabilities since last check
- **Actions:** None (display only)
- **Gateway calls:** None — diff `configSchema` snapshots
- **Wiring notes:** Future feature. Would need config change tracking.

### Group Conversation Only

#### ChannelsModule
- **Data:** Connected messaging channels
- **Actions:** Connect new channel
- **Gateway calls:** `chat.channelsStatus(true)`, `gw.channelsLogout(channel, accountId)`
- **Wiring notes:** Channel status includes Telegram, Slack, Discord, WhatsApp. Connect action should open the Directory modal.

#### SubAgentsModule, MembersModule, AgentRosterModule, GroupActivityFeedModule, ThreadSummaryModule, MentionsTasksModule, SharedFilesModule, PinnedItemsModule, SharedWorkspaceModule
- **Status:** All use mock data. Group conversation features are **out of scope** for initial launch.
- **Wiring notes:** Skip wiring. These modules exist for future group chat functionality.

### Advanced Modules

#### AgentFocusModule, GroupPermissionsModule, AgentChangelogModule, DecisionLogModule, HandoffModule
- **Status:** All use mock data. **Out of scope** for initial launch.
- **Wiring notes:** Skip wiring. Mark as `tier: "advanced"` and hide by default.

---

## Tab 2: Activity — Wiring

### Activity Feed
- **Data:** `ActivityEntry[]` — messages, tool calls, errors, system events
- **Actions:** Filter by type
- **Gateway calls:** `gw.onEvent()` — subscribe to all events and build activity log
- **Event mapping:**
  - `chat.content` / `chat.done` → `{ type: "message", action: "Assistant responded" }`
  - `chat.tool_call` → `{ type: "tool", action: toolName, detail: args }`
  - `chat.tool_result` → update matching tool entry with result
  - `chat.error` → `{ type: "error", action: "Error", detail: errorMessage }`
  - `agent` (stream: "tool") → `{ type: "tool", action: toolName }` (low-level)
- **Wiring notes:** Store events in a `useRef<ActivityEntry[]>` or state array in the parent. Cap at ~500 entries. The `useGatewayChat` hook already processes these events for chat — add a parallel accumulator for the activity feed.

### Recent Tool Calls
- **Data:** `RecentToolCall[]`
- **Actions:** None (display only)
- **Gateway calls:** Derived from `chat.tool_call` + `chat.tool_result` events
- **Wiring notes:** Already tracked in `ChatMessage.toolCalls[]`. Extract from `chat.messages` where `role === "assistant"` and has `toolCalls`.

---

## Tab 3: Connections — Wiring

### Connected Integrations List
- **Data:** `Connection[]` from `chat.channelsStatus()`
- **Actions:** Click connection → show detail / disconnect
- **Gateway calls:**
  - Status: `chat.channelsStatus(true)` — probe all channels
  - Disconnect: `gw.channelsLogout(channelName, accountId)`
- **Wiring notes:** Map `channelsStatus` response to `Connection` interface. Each channel entry has `{ name, status, accountId }`. Icon mapping needed (channel name → LucideIcon).

### CTA — "Explore Integrations"
- **Actions:** Open Directory modal
- **Gateway calls:** None
- **Wiring notes:** Trigger the Directory modal from `feat/onboarding-integrations`. Pass `onConnect` callback that calls `chat.saveConfig()` to enable the integration.

### Empty State
- **Data:** Check if `connections.length === 0`
- **Actions:** Suggest Web Search as first integration
- **Wiring notes:** Static UI. Connect action opens Directory modal filtered to Web Search.

---

## Tab 4: Cron — Wiring

### Cron Job List
- **Data:** `CronJob[]`
- **Actions:** Toggle enabled/disabled, delete job, add new job
- **Gateway calls:**
  - List: `gw.cronList()` — returns `{ id, schedule, prompt, description, enabled, lastRun, nextRun }[]`
  - Add: `gw.cronAdd({ schedule, prompt, description })` — create new job
  - Remove: `gw.cronRemove(jobId)` — delete job
  - Run now: `gw.cronRun(jobId)` — execute immediately
- **Wiring notes:** All methods exist in `GatewayClient` but are NOT exposed in `useGatewayChat` return value. Need to:
  1. Add `cronList`, `cronAdd`, `cronRemove`, `cronRun` to `useGatewayChat` return
  2. Call `cronList()` on initial connect (add to `onHello` Promise.allSettled)
  3. Store in `cronJobs` state
  4. Toggle enabled: `cronRemove(id)` then `cronAdd({ ...job, enabled: !enabled })` (or if gateway supports `cronPatch`)

---

## Gear Dropdown — Center Panel Switching

### Logs View
- **Data:** Log lines array (max 1500)
- **Actions:** Auto-scroll, clear, reconnect
- **Source:** WebSocket to `wss://api.{domain}/ws/{agent_id}?jwt=...`
- **Setup:** `createAgentClient(token).logsConnect(agentId, { container: "reef", tailLines: 400 })`
- **Wiring notes:** Currently in page.tsx lines ~1582-1641. WebSocket auto-reconnects every 15s.

### Shell View
- **Data:** Terminal I/O stream
- **Actions:** Type commands, resize
- **Source:** WebSocket to `wss://api.{domain}/ws/shell/{agent_id}?jwt=...`
- **Setup:** `createAgentClient(token).shellConnect(agentId)` + xterm.js
- **Wiring notes:** Currently in page.tsx lines ~1642-1786. Terminal buffer persists across view switches via ref.

### OpenClaw Config (Modal)
- **Data:** `chat.config`, `chat.configSchema`
- **Actions:** Edit fields, save config
- **Gateway calls:** `gw.configGet()`, `gw.configSchema()`, `gw.configPatch(patch)`
- **Wiring notes:** Currently in page.tsx lines ~3221-3520. Complex schema-driven form renderer (`renderOpenclawField`). Keep as extracted component.

### Settings (Modal)
- **Data:** Agent name, description
- **Actions:** Rename, delete agent
- **REST calls:** `createAgentClient(token).update(id, { name })`, `.delete(id)`, `.stop(id)`
- **Wiring notes:** Currently in page.tsx lines ~3469-3596.

---

## Methods to Add to useGatewayChat

These GatewayClient methods exist but aren't exposed by the hook:

| Method | Purpose | Add to Return | Call on Connect |
|--------|---------|---------------|-----------------|
| `gw.sessionsList()` | Active sessions | `sessions: AgentSession[]` | Yes |
| `gw.cronList()` | Scheduled jobs | `cronJobs: CronJob[]` | Yes |
| `gw.cronAdd(job)` | Create cron job | `addCron(job)` | No |
| `gw.cronRemove(id)` | Delete cron job | `removeCron(id)` | No |
| `gw.cronRun(id)` | Run cron now | `runCron(id)` | No |
| `gw.execApprove(id)` | Approve exec | `approveExec(id)` | No |
| `gw.execDeny(id)` | Deny exec | `denyExec(id)` | No |
| `gw.status()` | Gateway status | `gatewayStatus` | Yes |
| `gw.modelsList()` | Available models | `models` | Yes |
| `gw.channelsLogout(ch)` | Disconnect channel | `disconnectChannel(ch)` | No |

---

## Data Flow Summary

```
REST Agent Client (createAgentClient)
├── Agent CRUD: list, get, create, start, stop, delete, resize, update
├── Files (binary): filesList, fileReadBytes, fileWriteBytes, fileDelete
├── Logs: logsConnect → WebSocket
└── Shell: shellConnect → WebSocket

Gateway Client (via useGatewayChat)
├── Config: configGet, configSchema, configPatch
├── Chat: chatSend, chatHistory, chatAbort
├── Files (text): filesList, fileGet, fileSet
├── Sessions: sessionsList (to wire)
├── Cron: cronList, cronAdd, cronRemove, cronRun (to wire)
├── Exec: execApprove, execDeny (to wire)
├── Status: status, modelsList (to wire)
├── Channels: channelsStatus, channelsLogout (partially wired)
└── Events: onEvent → activity feed (to wire)
```
