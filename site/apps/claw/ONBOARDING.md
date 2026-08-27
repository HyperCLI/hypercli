# OpenClaw onboarding

The Claw launcher prepares a real OpenClaw workspace before the agent handles its first turn.

## Bootstrap pack

The onboarding pack contains:

- `AGENTS.md` — mission, operating rules, autonomy, escalation, trusted sources, memory guidance, and environment-specific tool notes
- `SOUL.md` — purpose, voice, behavior, and boundaries
- `IDENTITY.md` — the structured starting name and identity fields OpenClaw reads
- `USER.md` — respectful user context and response preferences
- `BOOTSTRAP.md` — the structured onboarding ritual for identity, user context, research, preferences, and relevant next steps; it is deleted after its completion criteria are met
- `MEMORY.md` — optional curated durable context, created only when the user opts in and supplies content

These are exact workspace-root filenames recognized by the OpenClaw runtime. Tool notes belong in the `## Tools` section of `AGENTS.md`. The launcher does not create retired tool/heartbeat files or app-specific pseudo-runtime files.

## User flow

1. The user selects the agent's name and runtime features.
2. The workspace step collects structured purpose, tone, user, timezone, work-context, response-style, tool, and optional memory fields.
3. The browser queues one generation task per model-assisted file and processes them in order with one Kimi request active at a time. `IDENTITY.md` and `BOOTSTRAP.md` stay deterministic so their structured fields and one-time lifecycle cannot drift. A client-side finite-state machine tracks each generated file as `queued`, `generating`, `ready`, or `fallback`; the UI reflects the real request state rather than a timer animation.
4. Generation continues in the wizard while the user moves to the plan step. The complete pack, task state, and completed model results remain in client-side wizard state. Every file has a raw editor/preview, and edited content is the content that will be staged.
5. The user chooses launch capacity.
6. Claw validates the complete canonical draft, then creates the agent with `start: false`. At the launch boundary, it quotes the reviewed `SOUL.md`, `IDENTITY.md`, `USER.md`, and optional `MEMORY.md` drafts into an `Unconfirmed setup hints` section in `BOOTSTRAP.md`. These hints remain subject to confirmation during native onboarding.
7. While the agent is `STOPPED`, Claw writes only `AGENTS.md` and the augmented `BOOTSTRAP.md` to `.openclaw/workspace/` through the agent file API. It reads every write back and requires exact byte equality. Immediately before the first start or setup retry, it removes setup-owned `.openclaw/openclaw.json` state and any stale `SOUL.md`, `IDENTITY.md`, `USER.md`, or `MEMORY.md` drafts from an older staging attempt.
8. Only after every required write and cleanup is verified does Claw start the same agent. The managed runtime restores the retained volume into `/home/node`, installs its complete version-specific configuration, and leaves the missing profile files for native OpenClaw workspace initialization.

On the first primary user turn, OpenClaw creates its stock `SOUL.md`, `IDENTITY.md`, and `USER.md` templates. Because those files still match the stock templates and no memory file exists, OpenClaw does not infer that onboarding is complete. The existing `BOOTSTRAP.md`, including the unconfirmed wizard hints, remains in the model's system-prompt Project Context. Its compatibility sequencing keeps intermediate answers in conversation state; the final onboarding turn writes the confirmed profile and memory details and deletes `BOOTSTRAP.md` together.

After the initial REST load, Claw subscribes through
`client.deployments.subscribe()`. Lifecycle invalidations are coalesced and
trigger a fresh REST roster read. The SDK owns authentication, ready/resync,
and reconnect; the page does not run a deployment-state interval.

If file staging or start fails, the backend leaves the agent stopped rather than launching it with a partial workspace. That stopped agent remains recoverable through the normal agent and file APIs; the launcher does not claim an automatic resume protocol it does not implement.

## Deterministic generation

`src/lib/openclaw-bootstrap-pack.ts` is the source of truth for the versioned, deterministic draft and its launch materialization. It validates the exact allowlists, required files, uniqueness, non-empty content, and size limits. This path requires no model and is always available.

Structured fields are deliberately kept separate from generated Markdown. Regenerating rebuilds the files from those fields; direct editor changes otherwise remain intact.

## Model-assisted generation

When a signed-in app token is available, the workspace step calls `POST /agents/bootstrap` separately for each model-assisted file. Each browser request sends an OpenAI-style `messages` array plus a file-specific strict `json_schema` response format; prompt and schema construction remain in `src/lib/openclaw-bootstrap-pack.ts`, so onboarding copy can evolve with the frontend. The system prompt gives each file an explicit approximate word/character range and the schema supplies a hard character ceiling. It does not rely on an output-token cutoff.

The endpoint accepts signed-in browser JWTs only, fixes the model to `kimi-k2.6`, and calls LiteLLM through the OpenAI Python client. Moonshot-compatible request settings are server-owned: temperature is `1`, and neither `max_tokens` nor `max_completion_tokens` is sent. It makes one request with retries disabled and allows up to five minutes for Kimi to complete, avoiding both truncation and duplicate generations. Dev and prod require separate `bootstrap_litellm_api_key` Pulumi secrets. The backend fails closed when the dedicated key is absent and never exposes it to the browser.

The browser parses and validates each returned JSON object against the requested canonical filename and its content limit. Successful files replace their deterministic counterparts independently. A failed or incomplete task leaves that file's deterministic template in place, so one slow Kimi response cannot discard the other completed files or block launch. Editing structured inputs or raw Markdown invalidates the active generation run; late results from that superseded run are ignored.

Do not forward a LiteLLM key to the browser, use an agent-access JWT for this endpoint, or make model availability a prerequisite for onboarding.

## Runtime updates after launch

The files are ordinary canonical workspace files. Editing them later through the running gateway is supported and OpenClaw reads the updated content on the next turn; no invented reload or setup state is required.
