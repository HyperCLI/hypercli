# Backend Requirements: OpenClaw Sessions And Channels

Date: 2026-06-03

This document captures backend and SDK gaps discovered while implementing Recent sessions in the Claw agent workspace. The reference surface for current capability is `ts-sdk/src/openclaw/gateway.ts`.

## Current SDK Surface

The TypeScript SDK currently exposes these relevant gateway methods:

- `sessionsList()` maps to `sessions.list`.
- `sessionsPreview(sessionKey, limit)` maps to `sessions.preview`.
- `sessionsPatch(patch)` maps to `sessions.patch`.
- `sessionsReset(sessionKey, reason)` maps to `sessions.reset`.
- `chatHistory(sessionKey, limit)` maps to `chat.history`.
- `chatSend(message, sessionKey, attachments)` maps to streaming `chat.send`.
- `sendChat(message, sessionKey, agentId, attachments)` maps to legacy `chat.send`.
- `channelsStatus()` and `channelsLogout()` are for external integrations, not user-created chat channels.

## Frontend Stopgaps

The Claw frontend currently uses these stopgaps because backend capabilities are missing:

- Session rename is local-only, stored in browser `localStorage` per agent.
- Session delete uses `sessions.reset(sessionKey, "reset")` plus local removal.
- `Move to channels` is visible but disabled.
- Session previews load in the background so preview RPC latency cannot block gateway readiness.

## P0: Durable Session Rename

Problem:

- `sessions.patch({ key, title })` fails with `unexpected property 'title'`.
- `sessions.patch({ key, displayName })` fails with `unexpected property 'displayName'`.
- The current accepted `sessions.patch` schema appears to support runtime settings such as `model` and `thinkingLevel`, not user-visible labels.

Requirement:

- Add a durable user-visible session label field to the gateway/backend session model.
- Accept a documented patch property for that label, for example `name` or `displayName`.
- Return the label from `sessions.list` and `sessions.updated` events.
- Preserve the label across gateway reconnects, agent restarts, and browser sessions.

SDK requirement:

- Add a typed method such as `GatewayClient.sessionsRename(sessionKey, name)` after the backend field is finalized.
- Do not require frontend code to construct raw `sessions.patch` params for rename.

Acceptance criteria:

- Renaming a session updates the sidebar immediately and remains after page reload.
- `sessions.list` includes the renamed label.
- Invalid labels return a structured validation error with a stable code and message.
- Rename emits `sessions.updated` or a specific session update event.

## P0: True Session Delete

Problem:

- The SDK only exposes `sessionsReset(sessionKey, reason)`.
- Reset is not a durable delete contract and may allow reset sessions to reappear from `sessions.list`.

Requirement:

- Add a durable delete/archive operation for sessions.
- Deleted sessions should not appear in `sessions.list` by default.
- Deletion should remove or hide associated previews and list metadata.
- Define behavior for deleting the active session.

SDK requirement:

- Add `GatewayClient.sessionsDelete(sessionKey)` or equivalent.
- Keep `sessionsReset()` separate from delete semantics.

Acceptance criteria:

- Deleting a session removes it from `sessions.list` after reload and reconnect.
- Deleting an active session produces a clear fallback session contract, preferably defaulting to `main` or returning the next active session key.
- Delete emits `sessions.updated` or a specific session deleted event.

## P1: User-Created Channels

Problem:

- Current SDK `channels.*` methods are external integration status/logout methods.
- There is no SDK/backend concept for user-created workspace chat channels.
- The Claw UI has `Move to channels` disabled because there is no destination model or API.

Requirement:

- Define a user-created channel model distinct from external integration channels.
- Support channel create, list, rename, delete/archive, and membership metadata.
- Support moving or associating an existing session with a channel.
- Define whether a channel maps to a session key, contains multiple session keys, or owns its own chat route.

SDK requirement:

- Add typed methods for user-created channels, separate from integration methods.
- Avoid overloading existing `channelsStatus()` and `channelsLogout()`.

Suggested method names:

- `workspaceChannelsList()`
- `workspaceChannelsCreate(input)`
- `workspaceChannelsRename(channelId, name)`
- `workspaceChannelsDelete(channelId)`
- `workspaceChannelsMoveSession(channelId, sessionKey)`

Acceptance criteria:

- `Move to channels` can show real channel destinations.
- Moving a session persists across reloads.
- Channel list and session associations are available on first hydration.
- Channel operations emit update events so the UI does not require polling.

## P1: Session Metadata Contract

Problem:

- The frontend currently normalizes many possible field names because `sessions.list` shape is not strongly documented in the SDK.
- Sorting and display rely on best-effort fields like `lastMessageAt`, `updatedAt`, `displayName`, and `title`.

Requirement:

- Document and stabilize the `sessions.list` response shape.
- Include at least `key`, `createdAt`, `lastMessageAt`, `messageCount`, and user-visible `name` once rename is supported.
- Define whether timestamps are milliseconds, seconds, or ISO strings.
- Define whether `main` is always present and whether empty sessions should be returned.

SDK requirement:

- Export a typed `GatewaySession` interface.
- Make `sessionsList()` return `Promise<GatewaySession[]>` rather than `Promise<any[]>`.

Acceptance criteria:

- Frontend no longer needs broad field-name normalization for session records.
- Recent sessions sort consistently by backend-provided timestamps.
- Empty or reset sessions have documented visibility semantics.

## P1: Bulk Session Previews

Problem:

- The gateway RPC supports `sessions.preview` with `keys`, but the current SDK helper accepts one `sessionKey` and returns one item list.
- The frontend calls previews in the background to avoid blocking readiness.

Requirement:

- Provide an SDK helper for bulk previews.
- Preserve input order or return keyed preview results.
- Document preview item shape.

SDK requirement:

- Add `sessionsPreviewMany(sessionKeys, limit)` returning a keyed map or typed array.

Acceptance criteria:

- Sidebar previews can be fetched with one RPC for the visible Recent list.
- Preview failures for one session do not fail all preview loading.

## P2: Event Contract

Problem:

- The frontend listens for `sessions.updated` and chat events, but session mutation event details are not strongly typed.

Requirement:

- Emit typed events for session created, renamed, deleted/archived, reset, and channel move.
- Include affected `sessionKey` and enough metadata to update local UI state without relisting.

SDK requirement:

- Export typed event payloads for session events.

Acceptance criteria:

- Frontend can update Recent sessions without polling after session mutations.
- Event payloads include stable operation names and affected keys.

## Open Questions For Backend

- What field name should be the canonical durable session label: `name`, `displayName`, or another key?
- Should delete be hard delete, soft archive, or reset-plus-hide?
- Should `main` be deletable or only resettable?
- Are user-created channels global per account, per agent, or per gateway workspace?
- Should channels own chat history directly, or only group existing session keys?
- Should session/channel metadata be multi-user visible or local to the authenticated account?

## Frontend Removal Plan

When backend and SDK support lands:

- Replace local-only rename storage with `GatewayClient.sessionsRename()`.
- Replace delete fallback with `GatewayClient.sessionsDelete()`.
- Enable `Move to channels` and wire it to typed workspace channel methods.
- Remove broad session field normalization once `GatewaySession` is stable.
- Replace per-session preview calls with a bulk preview SDK method if available.
