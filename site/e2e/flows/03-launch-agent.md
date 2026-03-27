# Flow 03: Launch Agent

Creates and launches an agent via the dashboard wizard, then performs a real chat roundtrip. Captures full browser network logs.

## Steps

1. **Login** via Privy (reuses Flow 01 helper)
2. Navigate to **Dashboard → Agents**
3. Click **New Agent** / create button
4. Walk through creation wizard (Identity → Size → Create)
5. Wait for agent to reach **RUNNING** state
6. Send a real chat message through the dashboard
7. Verify the agent replies with the expected token

## Network Logging

Full request/response logging is enabled:
- Every request: method, URL, timestamp
- Every response: status code, duration
- Failed requests: error text
- Saved to `e2e/screenshots/03-network.json`
- API calls summarized in console output

## Prerequisites

- Same as Flow 01 (Privy login)
- User must have an active plan with available agent slots
- Lagoon (claw cluster) must be running to schedule pods

## Environment Variables

Same as Flow 01 — no additional variables needed.

## Usage

```bash
# Run headless
IMAP_PASS=xxx npx playwright test e2e/flows/03-launch-agent.spec.ts

# Run headed (watch the wizard)
IMAP_PASS=xxx npx playwright test e2e/flows/03-launch-agent.spec.ts --headed
```

## Screenshots

Saved to `e2e/screenshots/`:
- `03-06-agent-running.png` — agent running with green status
- `03-07-chat-send-ok.png` — dashboard `chat.send` returned `E2E_CHAT_OK`

## Network Log

`e2e/screenshots/03-network.json` contains all browser network activity:

```json
[
  {
    "timestamp": "2026-03-13T01:50:00.000Z",
    "method": "POST",
    "url": "https://api.dev.hypercli.com/agents/deployments",
    "status": 200,
    "duration": 260
  }
]
```

Key API calls to watch:
- `POST /agents/deployments` — creates the agent (should return 200)
- `GET /agents/deployments` — polls for state updates
- `GET /deployments/{id}/token` — fetches reef auth token
- gateway websocket `chat.send` — real assistant roundtrip after launch

## Key Files

- `03-launch-agent.spec.ts` — test spec
- `helpers.ts` — shared login helper

## Notes

- Agent typically reaches RUNNING in 5-15s on dev (pod scheduling + OpenClaw boot)
- The launch helper asserts the browser create payload stays flat (`image/env/routes` at top level)
- The test polls every 3s for up to 3 minutes, refreshing the page every 5th attempt
- Network log includes all requests (Privy auth, API calls, static assets)
- Filter by `/api/` or `/deployments` for relevant API traffic
- Typical runtime: ~45s (login + launch + one real chat roundtrip)
