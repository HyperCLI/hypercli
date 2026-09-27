# CORS on Agent Runtimes — the Hermes SSE failure

Status: diagnosed 2026-08-22, validated live on dev01. The API-server lane
described below is the legacy image mode (`gateway run`); the managed Hermes
runtime is ACP-native now and the SDK launch helpers seed no API-server env
at all. CORS for browser callers is configured at the route plane
(`cors.allowed_origins`, via the SDK's `corsOrigins`), not through pod env.

## The exact failure

Hermes's legacy API server mode exposes an HTTP/SSE API
(`/api/sessions/*/chat/stream`, `/v1/runs/*/events`) on the agent's public
hostname. Browsers enforce CORS on these calls; WebSocket (the OpenClaw
gateway) is not CORS-bound, which is why OpenClaw agents never hit this.

The API server's CORS middleware (`gateway/platforms/api_server.py`,
`cors_middleware`) computes allowed-origin headers and applies them like
this:

```python
response = await handler(request)
if cors_headers is not None:
    response.headers.update(cors_headers)
return response
```

That works for normal JSON responses. It **cannot work for SSE**: aiohttp
`StreamResponse` sends its headers at `prepare()`, which the handler calls
*before* returning — so the middleware's header update happens after the
headers are already on the wire. Result:

- `OPTIONS` preflight: 200 with `Access-Control-Allow-Origin` (handled separately, works).
- `GET /health`, `GET /v1/*` (JSON): ACAO present (works).
- `POST .../chat/stream` (SSE): **no ACAO on the wire** → the browser blocks the
  response → `TypeError: Failed to fetch` in the dashboard, with the server
  logging `ClientConnectionResetError: Cannot write to closing transport` as it
  keeps writing to the dead socket.

Verified with a scratch agent: `STREAM STATUS: 200`,
`content-type: text/event-stream`, `access-control-allow-origin: null`, while
the same pod's JSON endpoints returned ACAO correctly.

A second, independent gate existed in the same file: `_origin_allowed()`
rejected any request carrying an `Origin` header with **403** when the pod's
allowed-origins env was empty. Requests with no `Origin` (curl, server to
server) always passed.

Post-strip, neither gate is seeded by the launcher: `corsOrigins` maps to the
route-plane `cors.allowed_origins` and nothing more. An explicit legacy-mode
(`gateway run`) launch can still configure the in-pod middleware through its
own env, but that is caller-managed configuration on an opt-in path.

## The validated fix

A Traefik `Headers` middleware on the agent runtime `IngressRoute`:

```yaml
apiVersion: traefik.containo.us/v1alpha1
kind: Middleware
metadata:
  name: agent-cors
spec:
  headers:
    accessControlAllowCredentials: true
    accessControlAllowHeaders: [Authorization, Content-Type, Idempotency-Key]
    accessControlAllowMethods: [GET, POST, PATCH, DELETE, OPTIONS]
    accessControlAllowOriginList:
      - https://<dashboard-origin>
    accessControlMaxAge: 600
    addVaryHeader: true
```

Traefik answers preflight itself and stamps headers on every response it
forwards — including SSE, because it adds headers when it forwards the response
head, not after the body. Validated live on dev01 (2026-08-22): with the
middleware attached, `chat/stream` returned `ACAO: <origin>`, `Vary: Origin`,
and the chat turn completed in the dashboard.

## Does it interfere with OpenClaw?

No. OpenClaw's dashboard path is `wss://` — WebSocket upgrades are not CORS
preflighted, and extra CORS response headers on the upgrade are inert. Traefik
does not reject disallowed origins; it simply withholds CORS headers, so
enforcement stays at the app layer (OpenClaw's token auth, or the legacy
Hermes API server's own origin gate when that mode is explicitly enabled).
The `/_reef/` route (priority 2000) is a separate route entry and can carry or
skip the middleware independently. Attaching the middleware to an OpenClaw
runtime route would be a no-op for its WS traffic.

## Where the fix lands (decision pending)

- **Durable/infra:** Lagoon mints the middleware + attaches it to each agent
  runtime IngressRoute it creates. Fixes SSE for every current and future
  runtime with an HTTP API. This is the recommended home.
- **Upstream:** fix `cors_middleware` in NousResearch/hermes-agent to stamp
  CORS headers in an `app.on_response_prepare` hook (fires before headers are
  written, streaming included) instead of post-handler header mutation.
  ~15 lines; correct at the source; ships on upstream's cadence.
- **Image:** hypercli-agent-images could carry a build-time patch until the
  upstream fix lands. Workable but diverges from upstream.

## Repro / verification recipe

```bash
# preflight (works even when broken, do not trust it alone)
curl -X OPTIONS -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type" \
  -D - -o /dev/null "https://$AGENT_HOST/api/sessions/$SID/chat/stream"

# the actual SSE response — this is the one that matters; supply whatever
# inbound credential the explicitly-launched legacy API server was given
curl -N -D - -H "Origin: $ORIGIN" -H "Authorization: Bearer $AGENT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"ping"}' \
  "https://$AGENT_HOST/api/sessions/$SID/chat/stream" | head -5
# broken: no access-control-allow-origin in the response headers
# fixed:  access-control-allow-origin: $ORIGIN (+ vary: Origin)
```

The historical full-lifecycle regression (fresh identity → trial → launch
hermes → Ready → chat round-trip → stop → delete) lived in
`site/tests/claw/agents-hermes-e2e.spec.ts`; that Playwright suite was removed
with the retired `site/apps/claw` dashboard.
