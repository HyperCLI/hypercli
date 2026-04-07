# CLAUDE.md

This file provides guidance to Claude Code when working with code in the `site/` directory.

## Overview

Turborepo monorepo with three Next.js 16+ apps (app directory routing) and a shared UI library.

| App | Package | Port | Purpose |
|-----|---------|------|---------|
| `apps/main/` | `@hypercli/main` | 4000 | Marketing site + ComfyUI playground |
| `apps/console/` | `@hypercli/console` | 4001 | User dashboard, GPU job management |
| `apps/claw/` | `@hypercli/claw` | 4003 | HyperClaw — agent management, chat, billing |

Shared UI in `packages/shared-ui/` (`@hypercli/shared-ui`) — 40+ Radix-based primitives, page sections, auth providers, utilities. Export new shared components from `packages/shared-ui/src/index.ts`.

## Development Commands

```bash
npm install
npm run dev                                # All apps + CORS proxy via Turborepo
npm run dev --filter=@hypercli/claw        # HyperClaw dashboard only (port 4003)
npm run dev --filter=@hypercli/main        # Marketing site only (port 4000)
npm run dev --filter=@hypercli/console     # Console only (port 4001)
npm run build                              # Build all apps
npm run lint                               # Lint all apps
npm run clean                              # Remove .next + node_modules
npm run clear-cache                        # Clear Turborepo cache
```

Environment: copy `env.sample` to each app's `.env.local`. Required vars are validated at build time in each app's `next.config.ts`.

## HyperClaw App (apps/claw/) — Primary Focus

### Page Structure

| Route | File | Purpose |
|-------|------|---------|
| `/` | `app/page.tsx` | Landing page (Hero, Features, Models, Pricing, TechSpecs) |
| `/dashboard/` | `app/dashboard/page.tsx` | Overview — agents, usage charts, plan info, onboarding |
| `/dashboard/agents/` | `app/dashboard/agents/page.tsx` | **Main agent interface** — sidebar + tabbed panels (1568 lines) |
| `/dashboard/agents/[id]/console/` | `app/dashboard/agents/[id]/console/page.tsx` | Simplified 3-panel agent console (chat/files/config) |
| `/dashboard/keys/` | `app/dashboard/keys/page.tsx` | API key management (create, rename, revoke) |
| `/plans/` | `app/plans/page.tsx` | Plan selection + checkout (Stripe + x402 USDC) |
| `/dashboard/settings/` | `app/dashboard/settings/page.tsx` | User settings |
| `/privacy/`, `/terms/` | Static legal pages | |

### Critical Files (DO NOT BREAK)

| File | Purpose |
|------|---------|
| `src/gateway-client.ts` | WebSocket RPC client for OpenClaw Gateway protocol v3 (~330 lines) |
| `src/hooks/useGatewayChat.ts` | React hook managing gateway connection + chat state (~450 lines) |
| `src/lib/api.ts` | `clawFetch()`, JWT token management, Privy exchange (~120 lines) |
| `src/components/ClawAuthProvider.tsx` | Auth context — Privy login → HyperClaw JWT exchange |

### Auth Flow

```
Privy login (email/wallet/Google)
  → POST /auth/login { privy_token }
  → Backend returns { app_token, user_id, team_id }
  → JWT stored in localStorage ("claw_auth_token")
  → All API calls use Authorization: Bearer <JWT> via clawFetch()
  → Auto-refresh: re-exchanges if expired or within 60s of expiry
```

Privy config in `ClawProviders.tsx`. Auth guard in `dashboard/layout.tsx` (redirects unauthenticated users).

### Gateway Protocol

WebSocket connection to `wss://openclaw-{agent-hostname}` using challenge-response handshake.

**Cookie auth setup** (in `useGatewayChat.ts`):
- Fetches pod JWT via `GET /agents/{id}/token`
- Sets 4 cookies: `{subdomain}-token`, `shell-{subdomain}-token`, `openclaw-{subdomain}-token`, `reef_token`
- Cookie domain from `NEXT_PUBLIC_HYPERCLAW_COOKIE_DOMAIN`
- Cross-domain check: if frontend domain doesn't match cookie domain, falls back to domain-less cookies

**RPC methods**: `configGet/Patch/Schema`, `agentsList`, `filesList/Get/Set`, `sessionsList`, `chatHistory/Send/Abort`, `cronList/Add/Remove`, `execApprove/Deny`, `modelsList`

**Streaming events**: `chat.content` (text delta), `chat.thinking` (reasoning delta), `chat.tool_call`, `chat.done`, `chat.error`, `chat` (snapshot mode)

### Agents Page Architecture (agents/page.tsx)

The largest file — manages the full agent experience:

**State**: Agent list, selected agent, budget, tabs (chat/logs/shell/files/openclaw/settings), create wizard, hatching animation

**Tabs**:
- **Chat** — Uses `useGatewayChat` hook. Messages, files, config loaded from gateway.
- **Logs** — WebSocket to `wss://api.{domain}/ws/logs/{agent_id}?jwt=...`. Backend streams from the per-agent buffer fed by Lagoon's shared ingest firehose.
- **Shell** — xterm.js terminal + WebSocket to `wss://api.{domain}/ws/shell/{agent_id}?jwt=...`. Backend proxies → Lagoon → K8s exec. Resize via `\x1b[8;{rows};{cols}t` escape.
- **Files** — Gateway RPC file operations (requires RUNNING agent).
- **OpenClaw** — JSON config editor built from gateway schema. Uses `configPatch()`.
- **Settings** — Agent name, integrations (Telegram, STT, TTS).

**Agent lifecycle**: STOPPED → PENDING → STARTING → RUNNING → STOPPING → STOPPED. Fast polling (3s) during transitions, slow polling (60s) otherwise.

### Components

| Component | File | Purpose |
|-----------|------|---------|
| `DashboardNav` | `components/dashboard/DashboardNav.tsx` | Top nav + mobile bottom tabs |
| `ChatMessage` | `components/dashboard/ChatMessage.tsx` | Message bubbles with thinking/tool-call collapsibles |
| `AgentCreationWizard` | `components/dashboard/AgentCreationWizard.tsx` | 3-step create flow (name, icon, size) |
| `AgentHatchAnimation` | `components/dashboard/AgentHatchAnimation.tsx` | Concentric rings animation on STARTING→RUNNING |
| `UsageChart` | `components/dashboard/UsageChart.tsx` | 7-day stacked bar chart |
| `KeyUsageTable` | `components/dashboard/KeyUsageTable.tsx` | Per-key usage breakdown |
| `OnboardingGuide` | `components/dashboard/OnboardingGuide.tsx` | New user cards (dismissed via localStorage) |
| `PlanCheckoutModal` | `components/PlanCheckoutModal.tsx` | Stripe + x402 USDC payment |
| `IntegrationsPage` | `components/dashboard/integrations/` | Telegram, STT, TTS panels |

### Lib Utilities

| File | Exports |
|------|---------|
| `lib/api.ts` | `CLAW_API_BASE`, `clawFetch()`, `exchangeToken()`, `getAppToken()`, token helpers |
| `lib/format.ts` | `formatTokens()`, `formatCpu()`, `formatMemory()`, `Plan` type |
| `lib/avatar.ts` | `agentAvatar(name)` → deterministic icon + hue from agent name |
| `lib/x402.ts` | `connectWallet()`, `x402Subscribe()` — MetaMask + Base chain USDC |

### API Calls Made by Frontend

**Auth**: `POST /auth/login`
**Agents**: `GET /agents`, `GET /agents/{id}`, `POST /agents`, `POST /agents/{id}/start`, `POST /agents/{id}/stop`, `DELETE /agents/{id}`, `GET /agents/{id}/token`, `POST /agents/{id}/logs/token`, `POST /agents/{id}/shell/token`
**Keys**: `GET /keys`, `POST /keys`, `PUT /keys/{ref}`, `POST /keys/{ref}/disable`
**Plans**: `GET /plans`, `GET /plans/current`
**Billing**: `POST /stripe/{plan_id}`
**Usage**: `GET /usage`, `GET /usage/history?days=7`, `GET /usage/keys?days=7`
**Models**: `GET /models` (landing page only)

## Other Apps

### Main (apps/main/) — Marketing Site

Pages: `/`, `/architecture/`, `/data-center/`, `/enterprise/`, `/gpus/`, `/models/`, `/partner/`, `/playground/`, `/playground/comfyui/[template]`, `/playground/gradio/[template]`, `/privacy/`, `/terms/`

ComfyUI content is generated — do not hand-edit `content/comfyui/`, `public/comfyui/`, `public/playground.json`. To add templates, update `scripts/templates.txt` and run `scripts/gen_template_docs.py`.

### Console (apps/console/) — GPU Dashboard

Pages: `/dashboard/`, `/jobs/`, `/job/[id]`, `/keys/`, `/history/`, `/settings/`

Uses Turnkey wallet auth (different from Claw's Privy auth).

## Shared UI (packages/shared-ui/)

40+ Radix-based components, plus sections, providers, and utilities.

**Key dependencies**: Radix UI (full suite), `@privy-io/react-auth`, `@rainbow-me/rainbowkit`, `@stripe/react-stripe-js`, `react-hook-form` + `zod`, `@tanstack/react-query`, `recharts`, `framer-motion`, `lucide-react`

**Structure**:
- `src/components/ui/` — Radix primitives (Button, Dialog, Tabs, Select, etc.)
- `src/components/sections/` — Landing page sections (Hero, Pricing, etc.)
- `src/components/` — App components (Header, Footer, Auth, Modals)
- `src/providers/` — AuthProvider, RainbowKitProvider
- `src/utils/` — API, cookies, currency, datetime, GPU info, navigation, theme

Export new components from `src/index.ts`.

## Conventions

### Styling
- **Tailwind v4** with bracketed color tokens (`bg-[#0B0D0E]`) and opacity scales (`/8`, `/15`)
- **Design tokens** (globals.css): `--background: #0a0a0b`, `--primary: #38D39F`, `--surface-low: #141416`, `--foreground: #fafafa`
- **Glass cards**: `.glass-card` class for frosted glass effect
- **Font**: Plus Jakarta Sans (Google Fonts)

### Code Patterns
- **Package manager**: npm (do not change)
- **Icons**: `lucide-react` (import directly)
- **Animations**: `framer-motion` (mirror existing easing/duration patterns)
- **Components**: `"use client"` directive for client components; all dashboard pages are client components
- **State management**: Plain React `useState`/`useCallback`/`useRef` — no Redux/Zustand
- **Data fetching**: `clawFetch()` for REST, `GatewayClient` for WebSocket RPC
- **Error handling**: try-catch with graceful fallbacks, silent retry for WebSocket reconnect

### Things to Avoid
- Do not add tests without confirmation (no test harness exists)
- Preserve server/client component boundaries
- Do not edit generated content (`content/comfyui/`, `public/comfyui/`, `public/playground.json`)
- Do not change workspace layout or package manager

## Environments & Deployment

| Env | Frontend | API | Deploys From | Env File |
|-----|----------|-----|-------------|----------|
| prod | `hypercli.com` | `api.hypercli.com` | `main` branch | `env.prod` |
| feat | `feat.hypercli.com` | `api.dev.hypercli.com` | `feat-claw` branch | `env.feat` |
| dev | `dev.hypercli.com` | `api.dev.hypercli.com` | (manual) | `env.dev` |
| local | `localhost:4003` | `localhost:8000` | — | `env.sample` |

Netlify builds via `@netlify/plugin-nextjs`. Build commands set per Netlify site (e.g., `cp env.feat apps/claw/.env.local && npm run build -- --filter=@hypercli/claw`).

**Required env vars** (validated at build time in `apps/claw/next.config.ts`):
`NEXT_PUBLIC_MAIN_SITE_URL`, `NEXT_PUBLIC_CONSOLE_URL`, `NEXT_PUBLIC_AGENTS_URL`, `NEXT_PUBLIC_PRIVY_APP_ID`

**Key insight for feat-claw**: Frontend is at `feat.hypercli.com` but backend is `api.dev.hypercli.com`. Gateway cookies need `domain=.hypercli.com` to reach `openclaw-{name}.dev.hypercli.com`. The `useGatewayChat` hook handles cross-domain cookie logic automatically.

## 📋 Plan Summary Rule

After every plan you make, you MUST add a summary to the bottom of this file under the `## Plan History` section using this format:

**_[Short Bold Italic Title]_**
- Date: YYYY-MM-DD
- What: Brief description of what the plan does
- Status: `active` | `done` | `wip`

---

## Plan History

<!-- Claude will auto-append plan summaries here -->
