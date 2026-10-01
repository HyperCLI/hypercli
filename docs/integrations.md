# Generic integrations CLI

The server catalog and native Nango connections drive these commands. There are
no provider-specific commands. Use `--dev` only to select the facade; current dev
and prod share the prod Nango connection environment.

## Authentication and discovery

The configured product key takes precedence over `HYPER_AGENTS_API_KEY` fallback.
Per-agent policy applies only when the actual credential is a bound runtime key.
Owner management requires an app JWT or `api:self`, `api:*`, or `*:*` key.
Runtime keys can use permitted integrations but cannot manage owner connections.

```sh
hyper integrations providers --json
hyper integrations connections --json
hyper integrations status my-agent
hyper integrations disable github --agent my-agent
hyper integrations unset github --agent my-agent
```

Connection listing includes all IDs. When more than one account is connected,
credential/proxy/management operations require `--connection ID`; there is no
arbitrary first-account selection. Agent overrides remain per-provider.

## OAuth and native credential import

```sh
hyper integrations connect linear --wait
hyper integrations connect linear --connection EXISTING_ID
hyper integrations connect linear --new --wait
hyper integrations disconnect linear --connection CONNECTION_ID
```

Reconnect uses Nango's reconnect session and returns its authorization URL;
`--wait` is refused for reconnect because existing credentials do not prove the
new OAuth flow completed. New-account wait observes a newly created ID, then
verifies that owned connection. It is not cryptographic session correlation;
concurrent new flows can be ambiguous. Completion never reenables a disabled
connection; use an explicit `enable` when intended.

For native API-key/Basic/OAuth1/import-supported auth, prepare a native Nango
connection body in a protected file, for example:

```json
{"credentials":{"type":"API_KEY","apiKey":"<provider API key>"},"connection_config":{}}
```

```sh
hyper integrations import openai --file /path/to/credentials.json
# Pipe the same JSON through stdin instead:
your-secret-reader | hyper integrations import openai --file -
# Replace credentials on an existing owned connection:
hyper integrations import openai --file /path/to/credentials.json --connection CONNECTION_ID
```

This example assumes an `openai` catalog entry using Nango's `openai` API_KEY
template and `connect_flow: import`. The native field is camelCase `apiKey`, not
`api_key`. Nango owns the schema/validation. Import outputs only a connection summary.
Caller-supplied IDs can update only existing owned records. Unsupported native
auth modes fail explicitly; HyperCLI does not implement provider credential forms.
Nango Connect UI remains outside the approved deployed product surface.

## Credentials and REST proxy

```sh
hyper integrations token github --connection CONNECTION_ID
hyper integrations credentials fourth --connection CONNECTION_ID --json
hyper integrations credentials openai --connection CONNECTION_ID --field apiKey
hyper integrations call linear POST graphql '{"query":"{ viewer { id } }"}' --connection CONNECTION_ID
hyper integrations call notion POST v1/search '{}' --headers '{"Notion-Version":"2022-06-28"}'
```

`token` prints only the access token in table mode; metadata goes to stderr.
`credentials` requires explicit catalog mode `credentials`; it returns the default
native Nango GET connection credentials object, without requesting
`refresh_token=true`. This is not a full backup/export or guaranteed reimport
payload. API keys and OAuth1 secrets can still be long-lived. `--field` selects one
top-level string and is pipe-safe in table mode. No automatic environment/token
injection occurs. Direct provider use of exported credentials bypasses later
facade policy checks. Prefer proxy or the narrower token mode when sufficient.

Provider headers are forwarded through Nango's native header contract. Caller
authorization, host, cookies and hop-by-hop overrides are blocked. HTTP bodies
are JSON in the CLI, results JSON/text; binary streaming is not implemented.

## Dynamic MCP, CLI only

```sh
hyper integrations --mcp --json
hyper integrations --mcp linear_request --help --json
hyper integrations --mcp integrations_status --json
hyper integrations --mcp linear_request --args '{"method":"POST","path":"graphql","connection_id":"CONNECTION_ID","body":{"query":"{ viewer { id } }"}}' --json
```

This calls the facade `/integrations/mcp` directly using the same credential/base
selection as REST. It initializes, paginates tools/list, and invokes the selected
tool. Names/schema come from the server. MCP transport is not added to the SDK.
Calls recheck policy and connection enablement even if discovery was stale.
Policy cache TTL is 30s; identity caches have longer TTLs, so no immediate
revocation guarantee is made. `--mcp` call budget and REST SDK default are 90s;
the separate product `/api/mcp` fan-out retains its own shorter timeout.

## Desktop account controls

The integrations tab shows connection IDs in an account selector. Select an
account to disconnect or reconnect; multiple accounts have no default selection.
Add account starts a new OAuth flow. “I've connected” verifies a newly observed
account and asks for selection if several new accounts appeared. Authorization
pending and ambiguous selection are distinct messages. Reconnect only opens the
provider flow and offers a refresh, never an assertion that reconnect completed.
Import-only entries show CLI import/replacement guidance instead of OAuth buttons.
