# Onboarding & Integrations Redesign

**Date:** 2026-04-10
**Branch:** `feat/onboarding-integrations` (from `feat-agents`)
**Status:** Design approved, pending implementation

## Problem

OpenClaw is powerful but complex. A freshly launched agent is a running container with a gateway — but it can't search the web, isn't reachable on any messaging platform, and its built-in capabilities require HyperClaw balance. There is no guidance bridging the gap between "agent is running" and "agent is useful."

The current right sidebar (`AgentView`, 3816 lines) displays mock data with decorative widgets. The Integrations tab exists but is buried among 7+ tabs and doesn't communicate what matters or why. Users overlook critical setup steps like enabling web search or installing a browser.

## Solution

Two new components that work together:

1. **Readiness Sidebar** — replaces the right-panel AgentView with a live capability status view. Always visible, shows what's configured and what's missing with contextual recommendations.
2. **Directory Modal** — a full-screen overlay for browsing, understanding, and connecting integrations. Triggered from the sidebar. Inspired by modern modal-and-linear-flow patterns for integration management.

The existing Integrations tab is removed. The sidebar is the status view; the modal is the action view.

## Design Principles

- **Onboarding is not a separate feature.** The sidebar in its unconfigured state IS the onboarding. As the user connects things, it becomes a status dashboard. Same component, different data.
- **The modal is a reference, not a cage.** Users pop in to read explanations and start setup, pop out to do the work (chat with agent, open Shell, go to Telegram), and see the sidebar update.
- **Plain language over technical jargon.** "Intelligence" not "Inference." "Your agent can't search the internet without this" not "No search provider configured."
- **HyperClaw is the default.** The Intelligence section shows plan status, not a provider picker. Adding external providers is available but not promoted.

## Scope (This Push)

- ReadinessSidebar with mock data (all 5 categories)
- DirectoryModal with all 5 categories, grid views, detail views, search
- Existing wizards (Telegram, Discord, Slack, TokenSetup, QrLogin) render inside detail views with mock callbacks
- IntelligencePanel as a status page
- Media section as info cards
- Wired into agents page (replaces AgentView, removes Integrations tab)
- Rich descriptions for top ~15-20 integrations, registry descriptions for the rest
- No live API dependency — all mock data, components accept real data through props

---

## Component 1: ReadinessSidebar

**Replaces:** `AgentView` component in the right panel of `/dashboard/agents/`
**File:** `src/components/dashboard/ReadinessSidebar.tsx`
**Width:** w-80 (320px), same as current sidebar

### Layout (top to bottom)

**Agent Header**
- Agent avatar (from `agentAvatar()`) + name + state badge (RUNNING / STOPPED / etc.)
- "+" button to open Directory modal at no specific category

**Readiness Categories**
Five sections, each showing status at a glance:

| Category | Icon | Shows When Configured | Shows When Not |
|----------|------|----------------------|----------------|
| Intelligence | Sparkles | Plan name, model (Kimi K2.5), balance | "No active plan" with link |
| Web | Globe | Active tools (e.g., "Brave Search") | "Recommended" amber badge, "Your agent can't search the internet" + `[Set up]` |
| Channels | MessageSquare | Connected platforms with count | "Not connected" gray, `[Connect]` |
| Tools | Wrench | Active count + names | Minimal tools listed, `[Browse more]` |
| Media | Palette | "Available with HyperClaw balance" | Same — these are always "available" |

**Visual Treatment**
- Configured: solid `#38D39F` (primary green) dot, normal text
- Recommended (essential but missing): amber `#f0c56c` dot, one-line explanation of why it matters, `[Set up]` link
- Not connected (optional, unconfigured): gray dot, dimmed text, `[Connect]` link
- Each `[Set up]` / `[Connect]` / `[Browse more]` link opens the Directory modal to that category

**Agent Info (collapsed by default)**
- Agent ID, resources (vCPU/memory), hostname, created date
- Same data as current Settings tab info section

### Props

```typescript
interface ReadinessSidebarProps {
  agent: {
    id: string;
    name: string;
    pod_name?: string;
    state: string;
    cpu_millicores?: number;
    memory_mib?: number;
    hostname?: string;
    started_at?: string;
    created_at?: string;
  };
  // From gateway (null when not connected)
  config: Record<string, unknown> | null;
  channelsStatus: Record<string, any> | null;
  connected: boolean;
  // Callbacks
  onOpenDirectory: (category?: DirectoryCategory) => void;
  onStartAgent?: () => void;
  onStopAgent?: () => void;
}
```

Mock data provides realistic defaults when `config` / `channelsStatus` are null.

---

## Component 2: DirectoryModal

**File:** `src/components/dashboard/DirectoryModal.tsx` (shell + routing)
**File:** `src/components/dashboard/directory/DirectoryGrid.tsx` (card grid)
**File:** `src/components/dashboard/directory/DirectoryDetail.tsx` (detail page + wizard host)
**File:** `src/components/dashboard/directory/IntelligencePanel.tsx` (status page)

### Modal Shell

- Full-screen overlay with dark backdrop
- Close via X button or clicking backdrop
- Left nav with 5 categories (icons + labels)
- Main content area (grid or detail view)
- Remembers last category + item on close/reopen within session

### Left Navigation

```
Intelligence    (Sparkles icon)
Web             (Globe icon)
Channels        (MessageSquare icon)
Tools           (Wrench icon)
Media           (Palette icon)
```

Active category highlighted with primary color left border (matching existing claw design patterns).

### Props

```typescript
interface DirectoryModalProps {
  open: boolean;
  onClose: () => void;
  initialCategory?: DirectoryCategory;
  initialItemId?: string;
  // Gateway data (null = use mocks)
  config: Record<string, unknown> | null;
  channelsStatus: Record<string, any> | null;
  connected: boolean;
  // Callbacks
  onSaveConfig: (patch: Record<string, unknown>) => Promise<void>;
  onChannelProbe: () => Promise<Record<string, any>>;
  onOpenShell: () => void;
}

type DirectoryCategory = "intelligence" | "web" | "channels" | "tools" | "media";
```

---

## Component 3: DirectoryGrid

**Renders when:** A category is selected but no specific item is selected.

### Layout

- Search bar at top (filters by name + description)
- Grid of cards (responsive: 2-3 columns depending on modal width)
- Each card: icon, display name, short description, status badge

### Status Badges

- **Connected** — green dot + "Connected"
- **Available** — no badge, default state
- **Recommended** — amber "Recommended" pill (for essential unconfigured items)
- **Coming Soon** — dimmed card with "Coming Soon" badge

### Card Interaction

Click a card → transition to DirectoryDetail for that item.

### Data Source

Cards are generated from `plugin-registry.ts` filtered by the active category mapping:

| Directory Category | Registry Categories | Additional Filtering |
|---|---|---|
| Intelligence | — | Not a grid; renders IntelligencePanel instead |
| Web | `tools` | Only search/browse tools: brave, duckduckgo, exa, tavily, firecrawl |
| Channels | `chat` | All 22 messaging integrations |
| Tools | `tools` | Everything except search/browse tools (memory, openshell, diagnostics, etc.) |
| Media | `built-in` | All 6 built-in capabilities |

---

## Component 4: DirectoryDetail

**Renders when:** A specific item is selected from the grid.

### Layout (top to bottom)

**Header**
- Back arrow (returns to grid)
- Large icon + display name + one-line tagline
- Status badge (Connected / Available)
- For connected items: "Disconnect" option

**Description Section**
- 2-3 sentences explaining what this integration does in plain language
- Focused on *why you want this* for your agent, not technical specs
- Example: "Lets your agent search the web for real-time information. Without this, your agent can only answer from what it already knows. DuckDuckGo requires no API key — just enable it."

**Setup Section**
- Renders the appropriate wizard/form inline based on the integration type:
  - **Simple enable** (DuckDuckGo, Memory Core): single "Enable" button
  - **Token-based** (Telegram, Discord, Slack): existing wizard component
  - **Token field** (Teams, LINE, etc.): existing TokenSetupWizard
  - **QR-based** (WhatsApp, Signal): existing QrLoginWizard
  - **API key** (Brave, Tavily, Exa): API key input + link to get key
  - **AI provider** (advanced, in Intelligence): existing AiProviderPanel
  - **Info only** (Media built-ins): no setup, just explanation + usage examples

**Info Footer**
- Config path (for power users)
- Documentation link (if available)

### Wizard Integration

Existing wizards render inside DirectoryDetail with these prop mappings:

| Wizard | Rendered For | Props Source |
|--------|-------------|-------------|
| `TelegramWizard` | Telegram | `onConnect` → `onSaveConfig`, `onChannelProbe` → passed through, `onClose` → back to grid |
| `DiscordWizard` | Discord | Same pattern |
| `SlackWizard` | Slack | Same pattern |
| `TokenSetupWizard` | Teams, Google Chat, LINE, Mattermost, IRC, Twitch | `fields` from registry `setupFields`, same callbacks |
| `QrLoginWizard` | WhatsApp, Signal, Zalo Personal | `onOpenShell` → closes modal + switches to Shell tab |
| `PluginConfigPanel` | Tools with config schemas | Rendered for complex tools |
| `TtsPanel` | Voice (Media) | Speaker selector, voice preview |

For mock mode, `onSaveConfig` simulates success after 500ms delay. `onChannelProbe` returns mock "connected" status.

---

## Component 5: IntelligencePanel

**Renders instead of DirectoryGrid when Intelligence category is selected.**

### Layout

**Status Card**
- HyperClaw logo/branding
- Plan name (e.g., "1 AIU Plan") or "No active plan"
- Models available: Kimi K2.5, GLM-5
- Token balance / tokens per day
- Billing reset date
- If no plan: CTA to plans page

**Model Cards**
- One card per available model showing: name, context window, capabilities (reasoning, vision, etc.)
- Not selectable — informational

**Advanced Section (collapsed by default)**
- "Add External Provider" expandable
- Renders AiProviderPanel for adding Anthropic, OpenAI, etc.
- Tone: "HyperClaw provides all the intelligence your agent needs. Add external providers if you have specific model requirements."

---

## Category: Media

**Renders DirectoryGrid but with info cards instead of setup cards.**

Each of the 6 built-in capabilities gets a card. Clicking opens a detail view that shows:

- What it does (plain language)
- Example usage ("Send your agent an image and ask 'what's in this picture?' — it uses Vision automatically")
- For Voice: the TtsPanel with speaker selector and preview
- For others: informational only
- Note at bottom: "Included with your HyperClaw plan. Uses pooled inference tokens."

---

## Integration Descriptions

Rich "why you want this" descriptions for high-priority integrations. These live in a new data file alongside the registry.

### Web (Priority)

| Integration | Description |
|---|---|
| **DuckDuckGo** | Search the web without needing an API key. Your agent can look up current information, find answers, and research topics in real time. The simplest way to give your agent web access — just enable it. |
| **Brave Search** | Fast, privacy-focused web search with an API. Returns rich results including summaries and news. Requires a free API key from Brave. |
| **Tavily** | AI-optimized search built for agents. Returns clean, relevant results with extracted content — less noise than traditional search. Great for research-heavy workflows. |
| **Exa** | Semantic search that understands meaning, not just keywords. Best for finding specific types of content like research papers, documentation, or niche topics. |
| **Firecrawl** | Reads and extracts content from any web page. While search finds pages, Firecrawl reads them deeply — pulling text, markdown, and structured data. Pair with a search tool for full web access. |

### Channels (Priority)

| Integration | Description |
|---|---|
| **Telegram** | Connect your agent to Telegram. Users can DM your agent or add it to group chats. One of the easiest channels to set up — create a bot with BotFather and paste the token. |
| **Discord** | Bring your agent into Discord servers. It can respond to messages, join conversations, and help your community. Set up a Discord bot and invite it to your server. |
| **Slack** | Add your agent to your Slack workspace. It can respond in channels and DMs, making it accessible to your whole team without leaving the tools they already use. |
| **WhatsApp** | Connect your agent to WhatsApp. Requires scanning a QR code through the Shell tab — your agent gets its own WhatsApp session. |

### Tools (Priority)

| Integration | Description |
|---|---|
| **Memory (Core)** | Gives your agent persistent memory across conversations. It remembers context, preferences, and past interactions. Built-in and ready to go — just enable it. |
| **Memory (LanceDB)** | Vector-powered memory for smarter recall. Your agent can search through past conversations by meaning, not just keywords. Upgrade from Core memory for agents that handle complex, ongoing work. |
| **OpenShell** | Lets your agent execute shell commands in a sandboxed environment. Essential for agents that need to run code, install packages, or automate system tasks. |

Remaining integrations use their `description` field from `plugin-registry.ts` as-is.

---

## Changes to Existing Files

### `agents/page.tsx`

- Remove `"integrations"` from the tab list
- Remove IntegrationsPage import and rendering
- Replace AgentView with ReadinessSidebar in the right panel
- Add DirectoryModal state (`directoryOpen`, `directoryCategory`, `directoryItemId`)
- Pass modal callbacks through (mock or real depending on gateway connection)

### `AgentView.tsx`

- **Not modified or deleted.** Still used by `/dashboard/dev/chat/` page for variant testing.
- The real agents page simply stops importing it.

### `plugin-registry.ts`

- **Not modified.** DirectoryGrid reads from it and applies category mapping.
- A new companion file `directory-descriptions.ts` holds the rich descriptions.

### `IntegrationsPage.tsx` and sub-components

- **Not modified or deleted.** Wizards are imported directly by DirectoryDetail.
- IntegrationsPage itself is no longer rendered on the agents page but remains in the codebase.

---

## New Files

```
src/components/dashboard/
  ReadinessSidebar.tsx              (~250 lines)
  DirectoryModal.tsx                (~200 lines)
  directory/
    DirectoryGrid.tsx               (~150 lines)
    DirectoryDetail.tsx             (~200 lines)
    IntelligencePanel.tsx           (~150 lines)
    directory-descriptions.ts       (~150 lines, rich copy for top integrations)
    directory-utils.ts              (~50 lines, category mapping helpers)
```

Total new code: ~1150 lines across 7 files.

---

## Mock Data Strategy

All new components accept real data through props but provide mock defaults:

```typescript
// ReadinessSidebar: when config is null, show mock state
const MOCK_READINESS = {
  intelligence: { active: true, plan: "1 AIU", model: "Kimi K2.5", balance: "142K tokens/day" },
  web: { active: false, tools: [] },
  channels: { active: false, connected: [] },
  tools: { active: true, enabled: ["Memory (Core)"] },
  media: { active: true, note: "Available with HyperClaw balance" },
};

// DirectoryModal: onSaveConfig simulates success
const mockSaveConfig = async () => { await new Promise(r => setTimeout(r, 500)); };
const mockChannelProbe = async () => ({ channels: { telegram: { configured: true, running: true } } });
```

When the gateway is available, swap mocks for real `configGet()` / `channelsStatus()` / `configPatch()` calls.

---

## Visual Design

Follows existing Claw design system:

- **Glass cards:** `.glass-card` for sidebar sections
- **Colors:** `#38D39F` (primary/active), `#f0c56c` (amber/recommended), `#d05f5f` (error), `text-text-muted` (gray/inactive)
- **Typography:** Plus Jakarta Sans, `text-xs` uppercase tracking for labels, `text-sm` for body
- **Animations:** `framer-motion` for modal enter/exit, card hover states
- **Dark theme:** `bg-[#0a0a0b]` base, `bg-surface-low` for cards, `border-border` for dividers
- **Modal:** `fixed inset-0 z-50` with dark backdrop, centered content panel with rounded corners
