# SDK Drift

## Live API vs SDK behavior

### Account API shape drift

- `GET /api/user` returns numeric Unix timestamps for `created_at` and `updated_at`, but both SDKs type those fields as strings.
- `GET /api/user` returns `wallet_address` and `login_type`, but neither SDK exposes them on the user model.
- `GET /api/keys` returns a `capabilities` field. Both SDK key models now carry `capabilities` (Python `ApiKey.capabilities: list[str]`, TS `ApiKey.capabilities?: string[]`), though the live payload shape is an object, so the list conversion only captures its keys/array form.
- `GET /api/balance` returns unit fields like `*_units` plus `currency` and `decimals`. Both SDKs now expose `currency` and `decimals` on `Balance`; the `*_units` fields are still dropped by both.

### Endpoint/documentation drift

- The requested flow listing endpoint `GET /api/flows` returns `404` on the live API. The current SDKs only expose render listing via `GET /api/renders`.

### Agents / HyperAgent auth drift

- The account-level `hyper_api_*` key works for the account API (`/api/user`, `/api/keys`, `/api/jobs`, `/api/balance`) but does not authenticate against the OpenAI-style agent API, which expects an `sk-*` virtual key.
- The live `https://api.hypercli.com/agents/deployments` endpoint rejects the account-level bearer key with `401 Invalid token: Not enough segments`, so agent integration coverage currently requires a separate `TEST_AGENT_API_KEY`.

## Documented deliberate differences

These are intentional per-SDK behaviors, not bugs to fix:

- `rs-sdk` reads the legacy `~/.hypercli/agent-key.json` credential as a last resort (after env vars and `~/.hypercli/config`) and deletes it on config migration. This is deliberate backward compatibility for older provider installs.
- `rs-sdk` supports `HYPER_HTTP_TRACE_FILE` (env or config) for redacted JSONL HTTP tracing. This is a deliberate provider-debugging feature not mirrored in the Python or TS SDKs.
- `rs-sdk` is deliberately deployments-scoped: it covers the agents/deployments surface needed by the buzz backend provider and does not aim for full parity with the Python/TS SDKs.
