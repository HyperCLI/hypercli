# OpenClaw onboarding

The Claw launcher prepares a real OpenClaw workspace before the agent handles its first turn.

## Bootstrap pack

The onboarding pack contains:

- `AGENTS.md` — mission, operating rules, autonomy, escalation, trusted sources, memory guidance, and environment-specific tool notes
- `SOUL.md` — purpose, voice, behavior, and boundaries
- `USER.md` — respectful user context and response preferences
- `MEMORY.md` — optional curated durable context, created only when the user opts in and supplies content

These are exact workspace-root filenames recognized by the OpenClaw runtime. Tool notes belong in the `## Tools` section of `AGENTS.md`. The launcher does not create retired tool/heartbeat files, transient first-run ritual files, or app-specific pseudo-runtime configuration.

`IDENTITY.md` remains owned by OpenClaw's structured identity handling. The launcher does not synthesize a second freeform identity source.

## User flow

1. The user selects the agent's name and runtime features.
2. The workspace step collects structured purpose, tone, user, timezone, work-context, response-style, tool, and optional memory fields.
3. File generation is shown as a short per-file animation.
4. The complete file pack is retained in the session draft. Every file has a raw editor/preview, and edited content is the content that will be staged.
5. The user chooses launch capacity.
6. Claw creates the agent with `start: false` and OpenClaw's real `agents.defaults.skipBootstrap` option, because the workspace is already configured.
7. Claw writes the canonical files to `.openclaw/workspace/` through the agent file API with the S3/backup destination.
8. Claw starts the same agent. Reef restores the backup into `/home/node` before OpenClaw starts, so the first turn sees the prepared files.

If file staging or start fails, the session draft retains the stopped agent ID and whether staging completed. Retry continues the same agent instead of creating a duplicate.

## Deterministic generation

`src/lib/openclaw-bootstrap-pack.ts` is the source of truth for the versioned, deterministic pack. It validates the exact allowlist, required files, uniqueness, non-empty content, and size limits. This path requires no model and is always available.

Structured fields are deliberately kept separate from generated Markdown. Regenerating rebuilds the files from those fields; direct editor changes otherwise remain intact.

## Model-assisted generation

When a signed-in app token is available, the workspace step calls `POST /agents/bootstrap`. The browser sends an OpenAI-style `messages` array plus a strict `json_schema` response format; prompt and schema construction remain in `src/lib/openclaw-bootstrap-pack.ts`, so onboarding copy can evolve with the frontend. The schema requests concise complete files rather than relying on an output-token cutoff.

The endpoint accepts signed-in browser JWTs only, fixes the model to `kimi-k2.6`, and calls LiteLLM through the OpenAI Python client. Moonshot-compatible request settings are server-owned: temperature is `1`, and neither `max_tokens` nor `max_completion_tokens` is sent. It makes one bounded attempt so a slow model response cannot turn into a second retry at the public gateway timeout. Dev and prod require separate `bootstrap_litellm_api_key` Pulumi secrets. The backend fails closed when the dedicated key is absent and never exposes it to the browser.

The browser parses and validates the returned JSON with the same canonical filename, required-file, uniqueness, memory-selection, content, and size checks used by the deterministic path. If the endpoint or model is unavailable or its result is invalid, the existing deterministic pack remains in the editor and launch can continue.

Do not forward a LiteLLM key to the browser, use an agent-access JWT for this endpoint, or make model availability a prerequisite for onboarding.

## Runtime updates after launch

The files are ordinary canonical workspace files. Editing them later through the running gateway is supported and OpenClaw reads the updated content on the next turn; no invented reload or setup state is required.
