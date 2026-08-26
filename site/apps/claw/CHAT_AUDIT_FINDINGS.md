# Claw Chat Audit Findings

Last updated: 2026-08-26

Status values: `OPEN`, `IN PROGRESS`, `BLOCKED`, `DONE`

Release status: `BLOCKED` until every P0 release gate passes.

## P0 - Critical

### P0-1 Repeated tool execution within one run

Status: `IN PROGRESS`

Observed contract failure:

- One `chat.send` run executed 27 tool cycles after the prompt requested one.
- The run emitted 27 tool starts, 27 tool results, 27 command completions,
  135 commentary frames, one lifecycle start, and no terminal event in 90
  seconds.
- The run remained active until the user-facing stop action was used.
- A tool with side effects could repeat those side effects.

Work remaining:

- [ ] Prevent repeat execution before tool dispatch in the OpenClaw runtime.
- [x] Deduplicate repeated delivery of the same tool-call ID in the SDK.
- [x] Correlate each tool result to exactly one outstanding call when calls are
      pending and fail closed on mismatches or ambiguity, while preserving
      legacy result-only events when no call is pending.
- [x] Detect a repeated successful tool signature within one run and abort the
      run under a documented policy that still permits intentional polling.
- [x] Emit one terminal SDK error and clear local sending state when the guard
      trips, even if the abort RPC fails.
- [x] Add an absolute run-duration or event budget that cannot be extended by
      nonterminal activity.
- [ ] Add idempotency keys or approval requirements for mutating tools at the
      execution boundary.
- [x] Add deterministic SDK coverage for duplicate IDs, repeated signatures,
      abort races, abort failure, missing IDs, and natural terminal races.
- [ ] Add a trusted live contract proving a one-tool prompt executes once and
      reaches one terminal event.

Ownership:

- OpenClaw runtime or `hyperclaw-backend`: pre-dispatch prevention and mutating
  tool idempotency.
- `ts-sdk`: stream correlation, duplicate delivery handling, loop containment,
  abort, and terminal error behavior.
- Claw frontend: render the SDK terminal state; do not create another transport
  or execution authority.

Release gates:

- [ ] One requested tool call produces exactly one start and one result.
- [ ] A repeated call is stopped before a second side effect is dispatched.
- [ ] One run produces exactly one terminal outcome.
- [x] Continuous nonterminal traffic cannot keep a run alive indefinitely.
- [ ] Stop and guard-triggered aborts leave no active SDK handler or UI sending
      state.

SDK containment policy:

- Exact tool-call and tool-result IDs are emitted once per run.
- Results with an ID must match that outstanding call. Results without an ID
  are accepted only when zero calls are outstanding for legacy result-only
  events or exactly one outstanding call can be identified.
- The third consecutive successful cycle with the same canonical tool name,
  arguments, and result triggers `chat.abort` and one terminal
  `CHAT_REPEATED_TOOL_CALL_LIMIT` error. A changed result or failed cycle resets
  the counter so progressing polls remain valid.
- A result-correlation failure triggers one terminal
  `CHAT_TOOL_RESULT_CORRELATION_FAILED` error. Both guard paths detach stream
  handlers before requesting abort, and abort failure does not suppress the
  terminal error.
- The 15-minute run deadline is fixed before `chat.send` and is never refreshed
  by stream activity. Expiry requests `chat.abort` and emits one terminal
  `CHAT_RUN_DURATION_LIMIT` error; a natural terminal already received at the
  deadline takes precedence.

Primary source references:

- `ts-sdk/src/openclaw/gateway.ts:1438`
- `ts-sdk/src/openclaw/gateway.ts:5364`
- `ts-sdk/src/openclaw/gateway.ts:5385`
- `ts-sdk/src/openclaw/gateway.ts:5633`
- `ts-sdk/src/openclaw/gateway.ts:5664`
- `ts-sdk/src/openclaw/gateway.ts:6120`
- `ts-sdk/tests/gateway.test.ts:4641`
- `ts-sdk/tests/gateway.test.ts:5007`

## P1 - High

### P1-1 Cumulative stream content duplicates across tool rounds

Status: `OPEN`

- [ ] Consume canonical normalized stream text instead of reseeding each round
      from the full cumulative raw `payload.message`.
- [ ] Preserve explicit round boundaries without reinserting prior content.
- [ ] Add a multi-tool regression fixture with cumulative mirrored chat text.
- [ ] Assert transcript growth is linear and the final answer contains no
      duplicated commentary prefix.

Evidence: The probe produced 27 current progress rows, and the trailing 8,000
transcript characters contained 186 copies of the same marker.

Primary source references:

- `site/apps/claw/src/lib/openclaw-session.ts:260`
- `site/apps/claw/src/lib/openclaw-chat.ts:1459`
- `ts-sdk/src/openclaw/gateway.ts:5779`

### P1-2 Multiple active live status regions

Status: `OPEN`

- [ ] Settle the prior progress round when a new tool or assistant round begins.
- [ ] Expose at most one active `role="status"` per run.
- [ ] Keep historical working notes available without keeping them live.
- [ ] Add component and browser assertions for one active status region.

Evidence: A successful control turn accumulated three simultaneous `Working`
statuses; the runaway probe accumulated 27 current progress rows.

Primary source reference:

- `site/apps/claw/src/components/dashboard/ChatMessage.tsx:1125`

## P2 - Medium

### P2-1 Nested interactive controls in the agent roster

Status: `OPEN`

- [ ] Replace the interactive row wrapper with a noninteractive list item.
- [ ] Use one primary selection button and sibling action controls.
- [ ] Clear the axe `nested-interactive` violations for populated rosters.

Primary source reference:

- `site/apps/claw/src/components/dashboard/AgentsChannelsSidebar.tsx:532`

### P2-2 Light and dark theme contrast failures

Status: `OPEN`

- [ ] Raise message timestamp contrast from the observed `1.97:1` in light
      mode to at least `4.5:1`.
- [ ] Raise roster status and time metadata contrast to at least `4.5:1`.
- [ ] Raise the model label and Ready status contrast to at least `4.5:1`.
- [ ] Add light and dark axe and visual coverage for the affected states.

Primary source references:

- `site/apps/claw/src/components/dashboard/chat/TimestampDisplay.tsx:19`
- `site/apps/claw/src/components/dashboard/AgentsChannelsSidebar.tsx:632`
- `site/apps/claw/src/components/dashboard/agents/OpenClawModelMenu.tsx:217`
- `site/apps/claw/src/components/dashboard/agents/page-helpers.tsx:149`

### P2-3 Crowded mobile composer

Status: `OPEN`

- [ ] Increase important mobile composer controls toward the 44 CSS pixel
      platform recommendation.
- [ ] Keep every line of a long draft reachable and unobscured by the action
      row.
- [ ] Add narrow mobile, multiline, sending, and 200 percent text snapshots.

Primary source references:

- `site/apps/claw/src/components/dashboard/agents/AgentChatPanel.tsx:482`
- `site/apps/claw/src/components/dashboard/agents/AgentChatPanel.tsx:1133`
- `site/apps/claw/src/components/dashboard/agents/AgentChatComposerShell.tsx:23`

## P3 - Follow-up

### P3-1 Offline state may remain visibly Ready

Status: `OPEN`

- [ ] Run a longer deterministic disconnect test.
- [ ] Replace Ready with a reconnecting or disconnected state within a bounded
      interval.
- [ ] Disable sending or surface queued/failure behavior while disconnected.

Primary source reference:

- `site/apps/claw/src/components/dashboard/agents/page-helpers.tsx:74`

### P3-2 Mobile Safari auxiliary request failures

Status: `OPEN`

- [ ] Reproduce plan and subscription CORS failures in real Safari.
- [ ] Confirm the observed Privy iframe CSP errors do not affect authentication
      or embedded-wallet behavior.
- [ ] Keep the critical mobile WebKit smoke free of unexpected app errors.

### P3-3 Minor command and ARIA semantics

Status: `OPEN`

- [ ] Hide or disable `/stop` when no reply is active instead of offering an
      action that can only report `No reply is currently running.`
- [ ] Give the focusable Ready status chip valid semantics or remove it from the
      tab order.
- [ ] Recheck closed model-popover `aria-controls` behavior in real browsers.

Primary source references:

- `site/apps/claw/src/components/dashboard/agents/AgentSlashCommandMenu.tsx:360`
- `site/apps/claw/src/components/dashboard/agents/page-helpers.tsx:149`

## Verified Strengths

- [x] No horizontal overflow at desktop, tablet, narrow mobile, or simulated
      200 percent text.
- [x] Reduced-motion mode had no running or infinite animations.
- [x] Slash and model menus were keyboard operable.
- [x] Cross-session marker isolation passed.
- [x] Correct Aurora Light persistence passed.
- [x] Firefox and mobile WebKit rendered the chat route.
- [x] Manual Stop reply ended the reproduced runaway turn.
