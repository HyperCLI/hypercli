# AGENTS.md

## Purpose
This file explains how to run the HyperCLI repo locally and how to work safely
and efficiently in the codebase.

## Repo map
- `site/`: Turbo monorepo (Next.js apps + shared UI)
  - `apps/main`: Marketing site (port 4000)
  - `apps/console`: User console/dashboard (port 4001)
  - `packages/shared-ui`: Shared components/styles
- `scripts/`: Python tooling for ComfyUI template docs
- `site/env.sample`: Local env template
- `site/netlify.toml`: Production env defaults

## Local setup (run the full repo)
1. Install Node 22 (recommended, matches Netlify) or Node 20+.
2. Ensure npm 10+ (repo uses `npm@10.0.0`).
3. From repo root:
   - `cd site`
   - `npm install`
4. Create env files for each app:
   - `cp env.sample apps/main/.env.local`
   - `cp env.sample apps/console/.env.local`
5. Edit each `.env.local` with your values. Most `NEXT_PUBLIC_*` values can
   stay as defaults for basic local rendering, but auth/payment features need
   real keys and working backend URLs.
6. Start all apps:
   - `npm run dev`
7. Visit:
   - `http://localhost:4000` (main)
   - `http://localhost:4001` (console)

Tip: If you run commands from the repo root, use `npm --prefix site <script>`.

## Environment variables (local)
These are referenced by Turbo and the apps (see `site/turbo.json`):
- `NEXT_PUBLIC_MAIN_SITE_URL`, `NEXT_PUBLIC_CONSOLE_URL`
- `NEXT_PUBLIC_COOKIE_DOMAIN`, `NEXT_PUBLIC_COOKIE_VALIDITY`
- `NEXT_PUBLIC_ORGANIZATION_ID`, `NEXT_PUBLIC_AUTH_PROXY_CONFIG_ID`
- `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID`
- `NEXT_PUBLIC_INSTANCES_API_URL`, `NEXT_PUBLIC_WS_URL`, `NEXT_PUBLIC_LLM_API_URL`
- `NEXT_PUBLIC_AUTH_BACKEND`, `NEXT_PUBLIC_API_BASE`
- `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_AUTH_PROXY_URL`
- `NEXT_PUBLIC_STRIPE_PK_CLI`, `NEXT_PUBLIC_STRIPE_PK_CLAW`
- `NEXT_PUBLIC_AUTH_DEBUG`
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`

Most features are frontend-only, but auth, billing, and chat require live API
endpoints. There is no backend service in this repo.

## Common commands (from `site/`)
- `npm run dev`: Start all apps (Turbo)
- `npm run dev --filter=@hypercli/main`: Start one app
- `npm run build`: Build all apps
- `npm run lint`: Lint all apps
- `npm run clean`: Clear .next + node_modules

Ports can be changed in `site/apps/*/package.json` if needed.

## Content generation (ComfyUI templates)
The marketing site includes generated MDX content and thumbnails.

Source list:
- `scripts/templates.txt`

Generator:
- `scripts/gen_template_docs.py`
- Python deps in `scripts/requirements.txt`

Typical flow:
1. `python -m venv .venv`
2. `pip install -r scripts/requirements.txt`
3. Run (from `scripts/` or repo root):
   - `python scripts/gen_template_docs.py -o site/apps/main/content/comfyui \
     --public site/apps/main/public/comfyui \
     --playground-json site/apps/main/public/playground.json`

Generated paths (do not hand-edit):
- `site/apps/main/content/comfyui`
- `site/apps/main/public/comfyui`
- `site/apps/main/public/playground.json`

If you add templates, update `scripts/templates.txt` and re-run the generator.

## Code conventions and agent workflow
- Tech stack: Next.js 16, React 19, TypeScript, Tailwind v4, Turbo monorepo.
- Shared UI lives in `site/packages/shared-ui`; prefer editing there when a
  change impacts multiple apps.
- App-specific UI lives under `site/apps/<app>/src`.
- When adding new env vars, update `site/env.sample` and `site/turbo.json`
  (globalEnv list) to keep Turbo aware of changes.
- Avoid editing generated content directly; use the Python generator.

## Troubleshooting
- Node version mismatches: use Node 22 (recommended) or Node 20+.
- Port conflicts: edit `site/apps/*/package.json` dev/start scripts.
- Build cache issues: run `npm run clean` from `site/`.
