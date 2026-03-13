# Flow 03: Launch Agent

Creates and launches an agent via the dashboard wizard. Captures full browser network logs.

## Steps

1. **Login** via Privy (reuses Flow 01 helper)
2. Navigate to **Dashboard → Agents**
3. Click **New Agent** / create button
4. Walk through creation wizard (Identity → Size → Create)
5. Wait for agent to reach **RUNNING** state
6. Verify agent appears with green status indicator

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
- `03-01-agents-page.png` — agents list before creation
- `03-02-wizard-step1.png` — identity (name + icon)
- `03-03-wizard-step2.png` — size selection
- `03-04-wizard-step3.png` — review / confirm
- `03-05-creating.png` — agent being created
- `03-06-agent-running.png` — agent running with green status

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

## Key Files

- `03-launch-agent.spec.ts` — test spec
- `helpers.ts` — shared login helper

## Notes

- Agent typically reaches RUNNING in 5-15s on dev (pod scheduling + OpenClaw boot)
- The test polls every 3s for up to 3 minutes, refreshing the page every 5th attempt
- Network log includes all requests (Privy auth, API calls, static assets)
- Filter by `/api/` or `/deployments` for relevant API traffic
- Typical runtime: ~30s (login ~20s + agent launch ~10s)
