# Desktop NG Feature Guardrails

This file is the persistent scope checklist for the desktop agent client. Check it before and after UI/runtime changes.

## Runtime Families

- OpenClaw: use OpenClaw SDK/runtime APIs and OpenClaw-specific UI surfaces.
- Hermes: use Hermes SDK/runtime APIs and Hermes-specific UI surfaces.
- ACP runtimes: use ACP SDK APIs only for OpenCode, Codex, Claude Code, Goose, Kimi Code, and Buzz Agent.
- Do not initialize ACP for OpenClaw or Hermes.
- Chat sends must use streaming/session-adapter APIs. Do not add completion-only request/response chat paths.
- Tool calls must flow through the shared chat trace folder so OpenClaw, Hermes, and ACP render the same inline trace UI.

## Right Panel

- Top-level tabs: Agent, Routines, Settings.
- Agent sub-tabs: Screen, Shell, Logs, Files.
- Screen is OpenClaw-specific until another runtime exposes an equivalent screen/session surface.
- Shell should attach to the agent shell API, not ACP.
- Logs should use the SDK/backed logs URL/token flow and must not reconnect on ordinary roster refresh.
- Files should use the agent files/reef API from the SDK.

## Settings

- Settings owns persona fields, agent metadata, notifications, and destructive controls.
- Danger zone must remain visible without hunting: sticky at the bottom or otherwise immediately reachable.
- Archive/delete are enabled only when the agent is stopped or archived.

## Creation Flow

- Onboarding should not block on full provisioning or boot.
- Close quickly after create is accepted and upsert the new agent into the sidebar.
- Sidebar/main panel own progress states: creating, booting, preparing, ready, failed.
- Backend validation errors should be expanded and readable.

## Audits

- Before handing work back, run a subagent audit for runtime-family assumptions when touching agent lifecycle, chat, logs, shell, files, onboarding, or settings.
