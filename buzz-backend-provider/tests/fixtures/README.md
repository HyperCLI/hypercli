# Stock Buzz provider protocol fixtures

These fixtures pin the one-process JSON protocol emitted by an unmodified
Buzz Desktop build. They were derived from a local protocol trace on
2026-07-30 and checked against Buzz commit
`73589408db6fd96b87ac570935d414ecc4120f53`.

The raw trace is intentionally not committed. It contains the agent private
key, relay authorization, user configuration, and environment values. The
deploy fixture preserves field names, nesting, JSON types, nulls, empty
strings, empty arrays, and defaults while replacing all identities and
credentials with public test values.

The `nsec` in `deploy-request.json` is deterministic test material for scalar
one. It must never be used as a real agent identity.

## Process contract

- Buzz starts a new `buzz-backend-*` process for every request.
- Stock calls pass no command-line arguments.
- Buzz writes one JSON object plus a newline to stdin and then closes stdin.
- The provider writes one JSON object plus a newline to stdout.
- Protocol logs must stay off stdout and stderr.
- The provider currently supports only `info` and `deploy`.
- `--dry-run` is a HyperCLI test extension, not a stock Buzz argument.

## Click-path matrix

| Buzz action | Provider call | Other behavior |
| --- | --- | --- |
| Open Create agent or enumerate Run on choices | None | Scans for executable `buzz-backend-*` files. |
| Select HyperCLI under Run on | `info` | Reads the provider schema and applies its defaults to the draft. |
| Change Runtime, Size, Image, or Workspace | None | Updates the local create draft. |
| Create a provider agent with launch enabled | `deploy` | Persists the Buzz identity first, then stores the returned agent ID. |
| Play an undeployed provider agent | `deploy` | Rebuilds the request from saved settings. |
| Add or mention an undeployed provider agent | Conditional `deploy` | Calls Play first only while Buzz has no backend agent ID. |
| Message an already deployed agent | None | Uses the Buzz relay and running `buzz-acp` process. |
| Save agent edits or change its model | None | Persists local/relay state; the provider is not notified. |
| Shutdown, Stop running agents, or sidebar Stop all | None | Sends a signed `!shutdown` relay message when channel resolution succeeds. |
| Delete an agent or persona | None | Deletes local/relay state and can orphan provider infrastructure. |
| Add/remove channels, copy runtime fields, or navigate profile tabs | None | Local, clipboard, or relay-only behavior. |
| Settings > Agents runtime refresh/install/login | None | Manages local ACP harness discovery, not backend providers. |
| Application launch/quit restoration | None | Provider agents are excluded from local runtime restore/stop. |

After a successful deploy, Buzz treats the presence of `backend_agent_id` as
permanently `deployed`, independent of relay presence or HyperCLI state. Normal
Play/redeploy becomes unreachable, and Save, Stop, and Delete do not invoke the
provider.

## Observed behavior

The live capture recorded 67 stock `info` calls and one `deploy` while creating
one agent. The repeated probes occurred within four seconds after selecting
HyperCLI. The create form probe effect updates the same draft object it depends
on, so providers must keep `info` cheap and idempotent until Buzz fixes that
loop.

The provider returned the deployment ID at 16:52:28 UTC. Buzz immediately
showed the agent as deployed, while `buzz-acp` connected to the relay at
16:54:02 and its ten OpenCode workers became ready at 16:54:17. A provider
deploy response therefore confirms control-plane acceptance, not harness
readiness.

Opening or refreshing the main Agents screen, refreshing Settings > Agents,
sending a message, and using Stop running agents produced no provider process
invocation in the same capture.

Adding the deployed agent to a channel also produced no provider invocation.
The running `buzz-acp` process learned about the membership dynamically and
subscribed to the new channel.

Profile-level Shutdown failed with `agent is not in any channel` even while the
profile displayed channel memberships. Shutdown from the channel member
controls did resolve the channel and delivered the signed shutdown command:
`buzz-acp` announced offline and exited. HyperCLI remained `RUNNING`, however,
and Kubernetes immediately restarted the container. Neither shutdown path
invoked the provider. Buzz process shutdown is therefore not equivalent to
provider infrastructure stop.

The Agents-page bulk Stop action selected two provider records and reported
`2 of 2 stops failed`; it made no provider invocation and left the HyperCLI
deployment running. Deleting the persona was blocked while a linked
provider-deployed instance existed. Deleting that instance through its Profile
settings succeeded, removed the local managed-agent record, and still made no
provider invocation. Deleting the persona then succeeded, but the remote
deployment remained `RUNNING`. Buzz warns that it requests remote deletion,
but the stock provider protocol has no delete operation. This routing failure
is tracked upstream as `block/buzz#3771`.

The captured OpenCode session used the requested
`hypercli/kimi-k2.6-anthropic` model and completed with `finish=stop`. Its
prompt mentioned `buzz messages send` eight times, but the stored session
contained no tool parts and therefore produced no channel reply. Direct
pod-to-Buzz publishing worked. This distinguishes a runtime that declines to
invoke the send tool from provider deployment or relay-publishing failure; the
one-shot provider protocol is not involved in message turns.
