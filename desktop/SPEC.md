# desktop-ng — Design & Implementation Spec

A clean-room, GrokBot-inspired desktop client for the HyperCLI platform.
Target: **absolutely clean, modern, subdued, familiar** — Linear/Things-class
tastefulness. No crazy animations; only 120–150ms color transitions.

Canonical visual reference: the single OG GrokBot screenshot from Sep 5, 2026
showing the left bot roster, central Pipeline chat, right Screen/Routines/Profile
panel, floating bottom section rail, and soft composer. The older screenshot dump
is background material only; do not average across all images. Where this spec and
the canonical reference disagree, prefer the canonical reference unless a platform
deviation is listed below.

---

## 1. Design tokens (src/index.css)

CSS vars on `:root` / `.dark`, bridged to Tailwind v4 via `@theme inline`.

| Token | Light | Dark |
|---|---|---|
| background | `#FBFAF7` | `#0F0F11` |
| surface (panes) | `#F7F6F3` | `#16171A` |
| card (raised) | `#FFFFFF` | `#1C1D20` |
| border | `#EBE9E4` | `#26262A` |
| border-strong | `#E2DFD8` | `#2E2E33` |
| foreground | `#262522` | `#ECECEC` |
| text-secondary | `#918D84` | `#9A9A9A` |
| accent (indigo) | `#5560D7` | `#6E76F5` |
| accent-tint | `#EEEDFB` | `#23253D` |
| success | `#2FA56A` | `#34C07A` |
| warning / warning-bg | `#9A6B0A` / `#FBF3DC` | `#D9A03F` / `#2E2617` |
| error / error-bg | `#B44436` / `#FBE9E7` | `#E0705F` / `#331D1A` |
| active-row | `#EFEDE9` | `#232326` |

- Font: Inter Variable (`@fontsource-variable/inter`), body 13px; mono stack for code.
- Radius: rows/buttons 6–8px, cards 8–10px, composer 12px, pills full.
- **Borders do the work; no shadows** except modals (soft large blur).
- Subtle thin scrollbars (transparent until hover), `focus-visible` ring = accent at 40%.
- All interactive elements: `transition-colors` (no transforms/springs).

## 2. Layout

- Window 1280×800 default, min 940×600, `titleBarStyle: Overlay`, `hiddenTitle`.
- Three panes: **sidebar 184px** · chat (fluid) · **context panel 240px**.
- Every pane header is exactly **44px**, `border-b border-border`, and uses the
  **drag-layer pattern**: `relative` header, `absolute inset-0` div with
  `data-tauri-drag-region`, content in a `relative` sibling. Never put
  interactive children inside a drag-region element.
- Traffic-light clearance: sidebar top content starts below ~28px.
- **Both side panels fold.** State persisted in localStorage. ⌘B folds the
  sidebar, ⌘⇧B folds the context panel. Folded = fully hidden; small ghost
  reopen buttons (`PanelLeftOpen` / `PanelRightOpen`, lucide) appear at the
  respective edges of the chat header.

## 3. Sidebar

- Top (below traffic lights): HyperCLI logo (theme-swapped SVG from
  `src/assets/`, 15px high) + caption `N running · M agents` (11px secondary).
- `AGENTS` label: 10px semibold, tracked 0.12em, secondary.
- Rows (rounded-lg, active/hover = `active-row`): 24px avatar (persona
  color/icon or backend avatar_url, else hashed color + initials), name 13px
  medium, caption 11px secondary (persona title ?? runtime label), right side:
  green 6px dot if RUNNING, pulsing amber dot if transitional.
- **Lifecycle lives here, not in the chat header**: hovering a row reveals a
  ghost icon button — play (start) when STOPPED, square (stop) when RUNNING,
  spinner while transitional, restore icon when ARCHIVED.
- `ARCHIVED (n)` fold at the bottom (chevron toggle, rows at 55% opacity).
- Bottom bar (border-t): `+ New agent` left; theme toggle (sun/moon) +
  settings gear right.

## 4. Chat pane

- **Header (exact mock row)**: 24px avatar + name semibold 13px + persona title
  11px secondary · flex space · status text 11px secondary with a 6px dot:
  green `Running — {context}` (context = latest activity action, else `Idle`),
  gray `Stopped`, amber pulsing transitional state, `Archived`.
  Reopen-fold buttons only, no other controls.
- **Messages** (flat, Design A): column max-w 640px centered, blocks separated
  by 24px. 24px avatar + name semibold 13px + timestamp 10px secondary inline.
  Body 13px/1.6, markdown (GFM) with hairline code chips and bordered `pre`.
  - Thinking: collapsed hairline card (`Brain` icon, "Thinking").
  - Tool calls: collapsed hairline rows — chevron, title 12px, duration, status
    (success green / failed red / in_progress amber).
  - Plan: checklist card with status dots.
  - "You" avatar: neutral gray from a theme token, never a hard-coded hex.
  - Autoscroll only when the user is already near the bottom.
- **Approvals**: card with hairline border (amber tint for destructive kinds),
  title from the agent, option buttons in agent order (primary = first
  allow option), Cancel resolves `cancelled`. Multiple pending approvals queue.
- **Composer** (max-w 520px, centered, 16px bottom margin): rounded-12, 1px
  border-strong, card fill; `+` left (decorative), autosizing textarea
  (Enter sends, Shift+Enter newline), mic (decorative), 30px rounded-8 accent
  send button (white up-arrow; disabled at 40% opacity). While a turn runs, the
  send button becomes a red stop-square (sends `session/cancel`).
- **Floating section rail**: bottom-right pill from the canonical reference,
  visually listing current top-level surfaces. It is a quiet orientation aid, not
  the primary navigation model.
- States: no agent → welcome empty state. Stopped/archived → centered avatar +
  Start/Restore accent button. Connecting → subtle spinner line. Error →
  error-tint card + Retry button (re-runs the connect effect).

## 5. Context panel (260px)

Tab row in the 52px header, right-aligned, text-only weight swap (active =
semibold foreground, inactive = secondary): **Agent · Routines · Settings**.
Default tab: Agent. Agent sub-tabs: **Activity · Shell · Logs · Files**.

- **Activity**: `ACTIVITY` caption + "Last updated {time}"; newest work first.
  Live feed folded from runtime session updates: tool rows (collapsible, mono
  detail, duration, status), one coalesced Thinking entry per turn, usage lines
  (mono 11px), mode notes.
- **Routines**: `0 ROUTINES` caption + `+ New routine` (disabled, ghost);
  empty-state card per mock; footer caption "Routines run in the cloud on
  schedule, even when your computer is off."
- **Profile** (editable persona form, mock-faithful): 44px avatar + caption
  "Agents read each other's descriptions to decide who to hand work to.";
  Color (12 swatches, selected = offset ring), Icon (8 grid, selected = accent
  border + tint), Title input, Description textarea + caption "This is the
  routing table for the whole team — keep it specific."; Notifications toggle
  (local pref); `Share as template` full-width outline (disabled).
  Name shown as a disabled input (backend has no rename yet).
- **Settings** (user-requested): `AGENT` section (runtime, size, host rows)
  + `DANGER ZONE` (error-tinted bordered card): Archive (enabled when STOPPED,
  confirm two-step), Restore (when ARCHIVED), Delete (STOPPED/ARCHIVED,
  two-step confirm).

## 6. Settings modal (app-level, ~480px, radius 12)

Tabs `General / Usage & billing / Updates` (text tabs, active = 2px accent
underline).
- General: profile row (avatar placeholder + "Signed in" + Sign out outline
  right), Theme select (System/Light/Dark), Backend row (mono 11px URL).
- Usage & billing: current plan via new `plan_summary` Rust command
  (rs-sdk `current_plan()`); tasteful empty state if unavailable.
- Updates: version row + "You're up to date."

## 7. New-agent modal (480px, mock step adapted)

Name card (44px live persona avatar preview + "Name it — e.g. Ops, Radar,
Penny") · Color (12 swatches) · Icon (8 grid) · Runtime chips (OpenCode,
Claude Code, Codex, Goose, Kimi Code, OpenClaw — **platform deviation**:
GrokBot hides compute, we can't) · Size segmented Small/Medium/Large ·
"Or start from a suggestion" (3 cards: Coder/Scout/Writer — sets
name+title+color+icon+runtime) · `Get started` accent button (busy spinner).
On create: backend create → wait STOPPED → start; persona persisted locally
(color/icon/title). Errors shown as friendly strings (backend errors are
mapped: 401/403 sign-in, 404 gone, 409 not-ready, 429 rate-limit, 5xx trouble).

## 8. Architecture (already standing — keep)

- **Rust** (`src-tauri`): standalone workspace, `hypercli-sdk` path dep.
  Commands: auth_status, save_api_key (validates then persists to
  `~/.hypercli/config`), logout, list_agents, start/stop (start uses stored
  launch config), create_agent (waits STOPPED then starts),
  archive/restore/delete_agent, acp_credentials (api_base + token, in-memory
  handoff), plan_summary. `AgentWatcher` subscribes `/ws/deployments`, emits
  debounced `agents-updated`. All blocking SDK calls on `spawn_blocking`.
- **Webview chat** (`src/useAgentChat.ts`): `CodingAgentAcpClient` over the
  desktop ACP WebSocket bridge (`/__desktop_ng/acp`). Session id
  persisted per agent (`acp-session:<id>`); loadSession replay with newSession
  fallback. Pure fold of `session/update` → messages (text/thought/tool/plan)
  + activity entries (tool entries tracked by toolCallId — updates patch the
  right entry with duration). Permission requests queue as approval cards.
  SDK owns reconnect; terminal `onClose` → error phase + Retry (retry nonce).
- Personas: localStorage (`desktop-ng-personas`) until the backend gains
  title/description fields.

## 9. Deliberate deviations from the mocks (do not "fix")

HyperCLI branding/logo; "agents" not "bots"; Activity tab; agent Settings tab
(danger zone); runtime/size pickers; API-key sign-in; archived fold; pod-per-
agent copy (no "shared computer" claims); start/stop in sidebar rows.

## 10. Non-goals (explicitly deferred)

Onboarding 3-step flow; screen-takeover view; GROUPS + group chats; mobile
layouts; in-chat connector/skill/quick-reply cards; delegation lines
("↩ Messaged X"); attachments/voice; noVNC embedding; updater;
window-state plugin.

## 11. Verification contract

- `npm run typecheck`, `npm run build`, `cargo check`, and
  `npm run tauri build -- --no-bundle` must all pass clean (no warnings added).
- Visual audit against the canonical OG screenshot after each milestone;
  discrepancies ranked and burned down before new features. The older screenshot
  corpus is supporting context only.
