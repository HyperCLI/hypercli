# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

HyperCLI is a GPU orchestration and LLM API platform. This monorepo contains:

- **`sdk/`** - Python SDK (`hypercli-sdk` on PyPI) - type-safe client library
- **`cli/`** - Command-line interface (`hypercli-cli` on PyPI) - Typer-based CLI with Rich output
- **`site/`** - Turborepo monorepo with Next.js web applications
- **`docs/`** - Documentation source files (Mintlify format)
- **`scripts/`** - Python tooling for ComfyUI template docs generation

## Development Commands

### Python SDK
```bash
cd sdk
pip install -e ".[dev]"
pytest                              # Run all tests
pytest tests/test_apply_params.py   # Run single test file
ruff check .                        # Lint
```

### Python CLI
```bash
cd cli
pip install -e ".[dev]"
# CLI entry point is `hyper` command
```

### Web Applications (site/)
```bash
cd site
npm install
npm run dev        # Runs all apps via Turborepo (main:4000, console:4001, chat:4002)
npm run build      # Build all apps
npm run lint       # Lint all apps
npm run clear-cache  # Clear Turborepo cache
```

To run a single app:
```bash
npm run dev --filter=@hypercli/main     # Marketing site on port 4000
npm run dev --filter=@hypercli/console  # User dashboard on port 4001
npm run dev --filter=@hypercli/chat     # LLM chat interface on port 4002
```

### ComfyUI Template Content Generation
```bash
cd scripts
pip install -r requirements.txt
python gen_template_docs.py \
  -o ../site/apps/main/content/comfyui \
  --public ../site/apps/main/public/comfyui \
  --playground-json ../site/apps/main/public/playground.json
```

Generated content (do not hand-edit):
- `site/apps/main/content/comfyui/` - MDX files per template
- `site/apps/main/public/comfyui/` - Thumbnails
- `site/apps/main/public/playground.json` - Template index

To add templates, update `scripts/templates.txt` and re-run the generator.

## Architecture

### SDK Structure (`sdk/hypercli/`)
The SDK uses a namespace pattern where `HyperCLI` client exposes API modules as attributes:
- `client.billing` - Billing/balance operations
- `client.jobs` - GPU job management
- `client.instances` - Instance lifecycle
- `client.renders` - ComfyUI render API
- `client.files` - File operations
- `client.user` - User info

All modules use `HTTPClient` from `http.py` for API communication. Config is loaded from `HYPERCLI_API_KEY` env var or `~/.hypercli/config`.

### CLI Structure (`cli/hypercli_cli/`)
Built with Typer. Main entry point is `cli.py` which registers subcommand modules (billing, comfyui, instances, jobs, llm, renders, user). The `tui/` subdirectory contains Rich-based interactive components like the job monitor.

### Web Apps (`site/`)
Turborepo monorepo with three Next.js 16+ apps using app directory routing:
- **main** (`@hypercli/main`) - Marketing site with playground (port 4000)
- **console** (`@hypercli/console`) - User dashboard, job management (port 4001)
- **chat** (`@hypercli/chat`) - LLM chat interface (port 4002)

Shared code lives in `site/packages/shared-ui/` (`@hypercli/shared-ui`):
- `components/ui/` - Radix-based primitives (button, dialog, tabs, etc.)
- `components/sections/` - Page sections (hero, pricing, etc.)
- `components/` - App components (Header, Footer, Auth, etc.)
- `providers/` - Auth, RainbowKit (wallet) providers
- `contexts/` - React contexts
- `utils/` - Shared utilities (cookies, api, badges, gpu info, navigation)

### Playground Template System
The `/playground/` routes in the main site use a data-driven pattern:
- `site/apps/main/src/content/comfyui/index.json` - Template metadata (generated)
- `site/apps/main/src/content/comfyui/[template_id]/index.mdx` - Template detail pages (generated)
- `site/apps/main/src/app/playground/page.tsx` - Playground index with category tiles
- `site/apps/main/src/app/playground/comfyui/page.tsx` - Template grid grouped by output type
- `site/apps/main/src/app/playground/comfyui/[template]/page.tsx` - Dynamic template detail pages

## Conventions

### Python
- Line length: 100 (configured in pyproject.toml)
- Uses `httpx` for HTTP, `websockets` for realtime
- Python 3.10+ required

### Web
- **Styling**: Tailwind v4 with bracketed color tokens (e.g., `bg-[#0B0D0E]`) and opacity scales (`/8`, `/15`)
- **Design tokens**: Dark theme with `--background: #0B0D0E`, `--primary: #38D39F`, `--surface-low: #161819`
- **Icons**: `lucide-react` - import directly
- **Animations**: `framer-motion` - use motion primitives and mirror existing easing/duration patterns
- **Components**: Use `"use client"` directive for client components
- Add new shared components to `site/packages/shared-ui/src/index.ts` for workspace access
- Environment: Copy `site/env.sample` to each app's `.env.local`

### Things to Avoid
- Do not change package manager (npm) or workspace layout
- No global test harness exists for web apps - don't add tests without confirmation
- Preserve Next.js server/client component boundaries
- Avoid editing generated content directly (`content/comfyui/`, `public/comfyui/`, `public/playground.json`)

## Environment Setup

For web development, required env vars are listed in `site/env.sample` and `site/turbo.json`. Key variables:
- `NEXT_PUBLIC_*_URL` - Various API endpoints (main site, console, chat, instances API, LLM API)
- `NEXT_PUBLIC_COOKIE_DOMAIN` - Cookie domain for auth
- Turnkey, Google OAuth, and Stripe keys for full functionality

Most features are frontend-only, but auth, billing, and chat require live API endpoints. There is no backend service in this repo.
