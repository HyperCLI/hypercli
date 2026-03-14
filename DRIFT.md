# SDK Drift

## Live API vs SDK behavior

### Account API shape drift

- `GET /api/user` returns numeric Unix timestamps for `created_at` and `updated_at`, but both SDKs type those fields as strings.
- `GET /api/user` returns `wallet_address` and `login_type`, but neither SDK exposes them on the user model.
- `GET /api/keys` returns a `capabilities` object, but both SDKs drop it from the key model entirely.
- `GET /api/balance` returns unit fields like `*_units` plus `currency` and `decimals`; the Python SDK drops most of that richer response while the TS SDK only exposes a subset.

### Endpoint/documentation drift

- The live instances endpoints are `https://api.hypercli.com/instances/*`, not `https://api.hypercli.com/api/instances/*`.
- The requested flow listing endpoint `GET /api/flows` returns `404` on the live API. The current SDKs only expose render listing via `GET /api/renders`.

### Agents / HyperAgent auth drift

- The account-level `hyper_api_*` key works for the account API (`/api/user`, `/api/keys`, `/api/jobs`, `/api/balance`) but does not authenticate against the OpenAI-style agent API, which expects an `sk-*` virtual key.
- TS and Python deployments clients are inconsistent about their default base URL resolution:
  - TS resolves the production base to `https://api.hypercli.com/agents`
  - Python defaults to `https://api.hypercli.com`
- The live `https://api.hypercli.com/agents/deployments` endpoint rejects the account-level bearer key with `401 Invalid token: Not enough segments`, so agent integration coverage currently requires a separate `TEST_AGENT_API_KEY`.
