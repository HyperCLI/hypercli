# Chat Trigger Reference

The mock gateway supports keyword-based triggers that produce different response types for testing the chat UI. Type any of these keywords in a chat message (case-insensitive, matched as substring) to trigger the corresponding behavior.

## 📋 Trigger Table

| # | Trigger | Event(s) Emitted | Description |
|---|---------|-----------------|-------------|
| 1 | `/help` | `chat.content` → `chat.done` | List all available triggers |
| 2 | `/think` | `chat.thinking` ×N → `chat.content` → `chat.done` | Reasoning/thinking display. **Supports duration** (see below) |
| 3 | `/tool` | `chat.tool_call` → `chat.tool_result` → `chat.content` → `chat.done` | Single tool call (standard format) |
| 4 | `/tools` | Multiple `chat.tool_call`/`chat.tool_result` → `chat.done` | Sequential multi-tool calls |
| 5 | `/agent_tool` | `agent` (stream:tool, phase:start) → `agent` (phase:result) → `chat.content` → `chat.done` | HYP-27 agent stream tool format |
| 6 | `/agent_tool_error` | `agent` (isError:true) → `chat.content` → `chat.done` | Tool error via agent stream |
| 7 | `/snapshot` | `chat` (state:partial) → `chat` (state:final) | Snapshot mode — full message, not streamed |
| 8 | `/error` | `chat.content` → `chat.error` | Simulated chat error |
| 9 | `/long` | 11× `chat.content` → `chat.done` | Long streaming response |
| 10 | `/markdown` | `chat.content` → `chat.done` | Markdown (headers, bold, code, tables, quotes) |
| 11 | `/code` | `chat.content` → `chat.done` | Python code block |
| 12 | `/slow` | 5s delay → `chat.content` → `chat.done` | Slow response (tests loading state) |
| 13 | `/image` | `chat.content` + mediaUrls → `chat.done` | Response with image URL |
| 14 | `/max_tokens` | `chat.content` → `chat.done` (stop: `max_tokens`) | Token limit stop reason |
| 15 | `/refuse` | `chat.content` → `chat.done` (stop: `refusal`) | Refusal stop reason |
| — | _(anything else)_ | 2× `chat.content` → `chat.done` | Default echo response |

## ⏱️ Thinking Duration

The `/think` trigger accepts an optional duration parameter. Thinking chunks are distributed evenly across the specified duration, followed by the final content response.

| Input | Duration |
|-------|----------|
| `/think` | 2 seconds (default) |
| `/think 5` | 5 seconds |
| `/think 5s` | 5 seconds |
| `/think 30sec` | 30 seconds |
| `/think 500ms` | 500 milliseconds |
| `/think 1m` | 1 minute |
| `/think 2min` | 2 minutes |

**Constraints:** Duration is clamped between 100 ms and 10 minutes.

**Syntax:** `/think [<number>[ms|s|sec|seconds|m|min|minutes]]`

## 🎯 Event Type Coverage

All SDK-recognized gateway events are covered by at least one trigger:

| Event | Handled at | Triggered by |
|-------|-----------|--------------|
| `connect.challenge` | `ts-sdk/src/openclaw/gateway.ts:1829` | Auto on WebSocket connect |
| `chat` (snapshot) | `useGatewayChat.ts:393` | `/snapshot` |
| `chat.content` | `useGatewayChat.ts:403` | Most triggers |
| `chat.thinking` | `useGatewayChat.ts:413` | `/think` |
| `chat.tool_call` | `useGatewayChat.ts:424` | `/tool`, `/tools` |
| `chat.tool_result` | `useGatewayChat.ts:433` | `/tool`, `/tools` |
| `chat.done` | `useGatewayChat.ts:442` | All triggers |
| `chat.error` | `useGatewayChat.ts:444` | `/error` |
| `agent` (stream:tool) | `useGatewayChat.ts:363` | `/agent_tool`, `/agent_tool_error` |

## 📦 Message Envelopes

### Server → Client Event

```json
{
  "type": "event",
  "event": "chat.content",
  "payload": { "text": "Hello" },
  "seq": 42
}
```

### Client → Server Request

```json
{
  "type": "req",
  "id": "<uuid>",
  "method": "chat.send",
  "params": { "text": "Hello" }
}
```

### Server → Client Response

```json
{
  "type": "res",
  "id": "<uuid>",
  "ok": true,
  "payload": { "ok": true }
}
```

### Server → Client Error Response

```json
{
  "type": "res",
  "id": "<uuid>",
  "ok": false,
  "error": {
    "code": "MOCK_ERROR",
    "message": "rate limit exceeded"
  }
}
```

## 📨 Complete RPC Method List

All methods use dot-notation (e.g., `config.get`, not `configGet`).

### Chat
- `chat.send` — Send a chat message
- `chat.history` — Get conversation history
- `chat.abort` — Abort current chat generation

### Config
- `config.get` — Get current config
- `config.patch` — Patch config (partial update)
- `config.apply` — Apply config changes
- `config.set` — Set full config
- `config.schema` — Get config JSON schema

### Sessions
- `sessions.list` — List sessions
- `sessions.preview` — Preview session content
- `sessions.patch` — Update session
- `sessions.reset` — Reset session

### Files
- `agents.files.list` — List agent files
- `agents.files.get` — Get file content
- `agents.files.set` — Set/create file

### Agents
- `agents.list` — List sub-agents
- `agents.get` — Get agent details

### Models
- `models.list` — List available models

### Channels
- `channels.status` — Get channel status
- `channels.logout` — Logout from channel

### Web Auth
- `web.login.start` — Start web login flow
- `web.login.wait` — Wait for web login

### Cron
- `cron.list` — List scheduled jobs
- `cron.add` — Add a job
- `cron.remove` — Remove a job
- `cron.run` — Run a job immediately

### Execution
- `exec.approve` — Approve execution
- `exec.deny` — Deny execution

### Status
- `status` — Get gateway status

## 💡 Testing Tips

- **Partial matching**: `let's try /tool in the middle of a sentence` still triggers `/tool`
- **Priority**: First matching trigger in the list wins
- **Combine tests**: Send multiple messages to see rendering of different types in the same conversation
- **Reset state**: Restart mock server to clear mock data
- **Add triggers**: Edit the `CHAT_TRIGGERS` array in `server.js` to add custom triggers

## 🔧 Implementation

Trigger handlers live in [`server.js`](./server.js) in the `CHAT_TRIGGERS` array. Each entry has:

```javascript
{
  keyword: '/trigger_name',
  description: 'What this trigger does',
  handler: (ws, userContent) => {
    // userContent is the raw message text (useful for parsing arguments)
    // Use gwEvent(ws, eventName, payload) to send events
    // Use gwResponse(ws, id, payload) to send RPC responses
  },
}
```

See [README.md](./README.md) for general mock server documentation and setup instructions.
