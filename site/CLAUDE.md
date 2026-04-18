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
npm run mock-server:all                    # Start all mock servers (agents + chat)
npm run dev:with-mock                      # Start all apps + mock servers together
```

Environment: copy `env.sample` to each app's `.env.local`. Required vars are validated at build time in each app's `next.config.ts`.

## Mock Servers for Local Development

Mock API servers are available for local development without hitting real endpoints.

### Quick Start

**Start mock servers (Agents API + Chat):**
```bash
npm run mock-server:all
# Agents API: http://localhost:8000
# Chat: http://localhost:4002
```

**Start all apps + mock servers together:**
```bash
npm run dev:with-mock
```

### Using Mock Servers with Claw

**Start claw with mock servers:**
```bash
cd apps/claw
npm run dev:mock
```

**Switch to real API (dev environment):**
```bash
npm run dev:real
```

**Just switch endpoints (without restarting dev):**
```bash
npm run switch:mock    # Switch to mock servers
npm run switch:real    # Switch to real API
npm run switch:mock status  # Check current configuration
```

### Mock Server Features

| Feature | Details |
|---------|---------|
| **Agents API** | 60+ endpoints — agents, billing, files, models, usage |
| **Chat Service** | Conversations, messages, WebSocket real-time support |
| **Realistic Data** | @faker-js/faker for all responses |
| **State Transitions** | Agents transition STARTING → RUNNING with delays |
| **Persistence** | Data stored in-memory across requests |

### Environment Files

| File | Endpoints |
|------|-----------|
| `apps/claw/.env.mock` | `http://localhost:8000` (agents), `http://localhost:4002` (chat) |
| `apps/claw/.env.real` | `https://api.dev.hypercli.com` (agents), `https://chat.dev.hypercli.com` (chat) |

See [mock-server/README.md](./mock-server/README.md) and [apps/claw/API-SWITCHING.md](./apps/claw/API-SWITCHING.md) for complete documentation.

## HyperClaw App (apps/claw/) — Primary Focus

### Page Structure

| Route | File | Purpose |
|-------|------|---------|
| `/` | `app/page.tsx` | Landing page (Hero, Features, Models, Pricing, TechSpecs) |
| `/dashboard/` | `app/dashboard/page.tsx` | Overview — agents, usage charts, plan info, onboarding |
| `/dashboard/agents/` | `app/dashboard/agents/page.tsx` | **Main agent interface** — sidebar + tabbed panels (1568 lines) |
| `/dashboard/agents/[id]/console/` | `app/dashboard/agents/[id]/console/page.tsx` | Simplified 3-panel agent console (chat/files/config) |
| `/dashboard/keys/` | `app/dashboard/keys/page.tsx` | API key management (create, rename, revoke) |
| `/dashboard/plans/` | `app/dashboard/plans/page.tsx` | Plan selection + checkout (Stripe + x402 USDC) |
| `/dashboard/settings/` | `app/dashboard/settings/page.tsx` | User settings |
| `/privacy/`, `/terms/` | Static legal pages | |

### Critical Files (DO NOT BREAK)

| File | Purpose |
|------|---------|
| `src/gateway-client.ts` | WebSocket RPC client for OpenClaw Gateway protocol v3 (~330 lines) |
| `src/hooks/useGatewayChat.ts` | React hook managing gateway connection + chat state (~450 lines) |
| `src/lib/api.ts` | `clawFetch()`, JWT token management, Privy exchange (~120 lines) |
| `src/components/ClawAuthProvider.tsx` | Auth context — Privy login → HyperClaw JWT exchange |

### Local Development with Mock APIs

For testing without hitting real endpoints:

- **`.env.mock`** — Pre-configured for mock servers (localhost:8000, localhost:4002)
- **`.env.real`** — Pre-configured for real API (api.dev.hypercli.com)
- **`switch-api.sh`** / **`switch-api.bat`** — Quick scripts to switch between environments
- **`npm run dev:mock`** — Start claw with mock servers
- **`npm run dev:real`** — Start claw with real API

See [API-SWITCHING.md](./API-SWITCHING.md) for detailed usage and troubleshooting.

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
- **Logs** — WebSocket to `wss://api.{domain}/ws/{agent_id}?jwt=...`. Backend streams from in-memory buffer (fed by Lagoon ingest).
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

### Data Layer (hooks + providers)

Hook-based data layer using `@tanstack/react-query` that wraps the `@hypercli.com/sdk`. **Not yet wired into pages** — created for incremental adoption. See `src/hooks/DATA_LAYER_PLAN.md` for the full migration plan.

**Providers** (in `src/providers/`, wire into dashboard layout when ready):
- `QueryProvider` — TanStack Query client (30s stale time, 1 retry)
- `HyperCLIProvider` — creates `Deployments` + `HyperAgent` SDK clients from auth token

**Hooks** (in `src/hooks/`):

| Hook | SDK Class | Purpose |
|------|-----------|---------|
| `useHyperCLI` | Context | Access `deployments`, `hyperAgent`, `token` from provider |
| `useAgents` | `Deployments` | Agent list + create/start/stop/delete mutations, adaptive polling |
| `useAgent` | `Deployments.get` | Single agent detail, token refresh, env, metrics |
| `useAgentFiles` | `Deployments.files*` | File list, upload, download, delete for an agent |
| `useAgentLogs` | `Deployments.logsConnect` | WebSocket log streaming with auto-reconnect |
| `useAgentShell` | `Deployments.shellConnect` | WebSocket shell with send/resize |
| `usePlans` | `HyperAgent` | Plans catalog, current plan, type catalog |
| `useUsage` | `clawFetch` | Usage stats, 7-day history, per-key breakdown |
| `useBilling` | `clawFetch` | Payments, billing profile, update profile |

**Shared types** in `src/types/index.ts` — re-exports SDK types + frontend-specific shapes (`AgentState`, `UsageInfo`, `DayData`, etc.)

**Browser safety**: All SDK imports use subpath exports (`/agents`, `/agent`, `/http`, `/gateway`). Never import from the main `@hypercli.com/sdk` entry (pulls in Node `dns`).

### Lib Utilities

| File | Exports |
|------|---------|
| `lib/api.ts` | `CLAW_API_BASE`, `clawFetch()`, `exchangeToken()`, `getAppToken()`, token helpers |
| `lib/format.ts` | `formatTokens()`, `formatCpu()`, `formatMemory()`, `Plan` type |
| `lib/avatar.ts` | `agentAvatar(name)` → deterministic icon + hue from agent name |
| `lib/x402.ts` | `connectWallet()`, `x402Subscribe()` — MetaMask + Base chain USDC |
| `lib/billing.ts` | `getAgentPayments()`, `getAgentBillingProfile()`, `updateAgentBillingProfile()` |

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

