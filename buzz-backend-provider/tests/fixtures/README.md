# Stock Buzz provider protocol fixtures

These fixtures pin the one-process JSON protocol emitted by Buzz Desktop's
portable provider producer. The deploy fixture's shape is copied from the
shared producer/consumer fixture at
`crates/buzz-backend-kubernetes/tests/fixtures/provider-wire/deploy-full-launch.request.json`
in HyperCLI Buzz commit `145aa37f08d6a2044996f1b8f0fe5cb138833e40`, with public test identity,
provider configuration, and collision canaries adapted for this provider.

The fixture preserves the full `launch.command`, `launch.args`, `launch.env`,
`launch.policy_env`, and `launch.owner_pubkey` shape. Legacy top-level fields
remain because current Desktop intentionally sends them for bookkeeping; a
provider executes `launch` whenever it is present.

The `nsec` in `deploy-request.json` is deterministic test material for scalar
one. It must never be used as a real agent identity.

## Process contract

- Buzz starts a new `buzz-backend-*` process for every request.
- Stock calls pass no command-line arguments.
- Buzz writes one JSON object plus a newline to stdin and then closes stdin.
- The provider writes one JSON object plus a newline to stdout.
- Stdout must contain only protocol JSON. Diagnostics may use stderr; the
  HyperCLI provider remains silent on successful requests.
- The provider currently supports only `info` and `deploy`.
- `--dry-run` is a HyperCLI test extension, not a stock Buzz argument.

## Click-path matrix

| Buzz action | Provider call | Other behavior |
| --- | --- | --- |
| Open Create agent or enumerate Run on choices | None | Scans for executable `buzz-backend-*` files. |
| Select HyperCLI under Run on | `info` | Reads the provider schema and applies its defaults to the draft. |
| Provider-specific configuration | None | The HyperCLI providers expose no editable launch fields. |
| Create a provider agent with launch enabled | `deploy` | Persists the Buzz identity first, then stores the returned agent ID. |
| Play an undeployed provider agent | `deploy` | Rebuilds the request from saved settings. |
| Add or mention an undeployed provider agent | Conditional `deploy` | Calls Play first only while Buzz has no backend agent ID. |
| Message an already deployed agent | None | Uses the Buzz relay and running `hyper-acp` process. |
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

## Historical observed behavior

The observations below predate the provider's readiness polling and the hosted
`restart=false` lifecycle hardening. They are retained as stock Buzz protocol
evidence, not as a description of the current HyperCLI provider response or
Kubernetes restart behavior.

The live capture recorded repeated stock `info` calls and one `deploy` while
creating one agent. The probes occurred rapidly after selecting HyperCLI. The
create form probe effect updates the same draft object it depends on, so
providers must keep `info` cheap and idempotent until Buzz fixes that loop.

The historical provider returned the deployment ID at 16:52:28 UTC. Buzz immediately
showed the agent as deployed, while `hyper-acp` connected to the relay at
16:54:02 and its ten OpenCode workers became ready at 16:54:17. A provider
that does not poll readiness can therefore confirm control-plane acceptance
before harness readiness. The current HyperCLI provider waits for backend
`RUNNING`, although lazy ACP worker initialization can still happen on the
first turn.

Opening or refreshing the main Agents screen, refreshing Settings > Agents,
sending a message, and using Stop running agents produced no provider process
invocation in the same capture.

Adding the deployed agent to a channel also produced no provider invocation.
The running `hyper-acp` process learned about the membership dynamically and
subscribed to the new channel.

Profile-level Shutdown failed with `agent is not in any channel` even while the
profile displayed channel memberships. Shutdown from the channel member
controls did resolve the channel and delivered the signed shutdown command:
`hyper-acp` announced offline and exited. HyperCLI remained `RUNNING`, however,
and Kubernetes immediately restarted the container under its then-current
restart policy. Neither shutdown path invoked the provider. Stock Buzz process
shutdown is therefore not equivalent to provider infrastructure stop; current
hosted Buzz launches use `restart=false` so backend terminal cleanup can
finalize them as `STOPPED`.

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
