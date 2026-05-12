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

## Agents E2E debugging
The Claw agents E2E flow must cover auth, Stripe checkout, entitlement/slot
polling, agent launch, and gateway readiness. Do not skip checkout in this
spec: the critical contract is that Stripe redirects back to `/plans`, slots
increase, and the purchased slot can launch an agent. Cleanup is best-effort.

From the repo root:

```bash
IMAGE_TAG=local-agents-debug .github/scripts/build_e2e_image.sh
mkdir -p .e2e-artifacts-local-live
docker run --init --name hypercli-e2e-agents-debug \
  --env-file .env.agents \
  -e TEST_CLAW_ADMIN_LOGIN_SHORTCUT=1 \
  -e E2E_KEEP_ALIVE_ON_FAILURE=1 \
  -e E2E_ARTIFACTS_DIR=/artifacts \
  -v "$PWD/.e2e-artifacts-local-live:/artifacts" \
  hypercli-e2e:local-agents-debug \
  bash -lc 'cd /workspace && ./.github/scripts/run_e2e_agents.sh'
```

Then rerun the Playwright spec without rebuilding or reauthenticating from
scratch:

```bash
docker exec -it hypercli-e2e-agents-debug bash
cd /workspace/site
npx playwright test \
  --config tests/claw/playwright.config.ts \
  tests/claw/agents-subscription.spec.ts
```

Rules for this mode:
- Keep secrets in `.env.agents`; do not pass secret values with `docker run -e`.
- Do not use `--rm` if you need to inspect the container after a failure.
- `E2E_KEEP_ALIVE_ON_FAILURE=1` is local-debug only; CI should fail and exit.
- The E2E image contains a copied workspace. Rebuild after editing source, or
  bind-mount the specific file under test, for example
  `-v "$PWD/site/tests/claw/agents-subscription.spec.ts:/workspace/site/tests/claw/agents-subscription.spec.ts:ro"`.
- Remove the container with `docker rm -f hypercli-e2e-agents-debug` when done.

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
- For frontend testing against local SDK work, use the on-disk `ts-sdk/`
  checkout via `npm run sdk:use-checkout`. CI build/publish containers also use
  the sibling checkout so the sites exercise current SDK source instead of a
  separately published package.
- For `@hypercli.com/sdk` releases, do not trust source changes alone. Always:
  - run `npm --prefix ts-sdk run build`
  - run `npm --prefix ts-sdk pack`
  - inspect the packed `dist/*.js` for the intended runtime behavior before `npm publish`
- Netlify should only receive artifacts from CI. Do not rely on Netlify to build
  this monorepo or resolve the sibling `ts-sdk/` checkout.
- For Claw agent chat, do not hardcode the bare gateway session key `"main"`
  for agent-scoped pages. Use
  `site/apps/claw/src/lib/openclaw-session.ts:resolveOpenClawSessionKey()` so
  agent dashboards use `agent:<agentId>:main` and only fall back to `"main"`
  for the default/root agent session.
- Claw plans/billing views should come from the SDK (`HyperAgent.currentPlan()`,
  `subscriptionSummary()`, `plans()`, `agentTypes()`), not ad hoc frontend
  plan state.

## Troubleshooting
- Node version mismatches: use Node 22 (recommended) or Node 20+.
- Port conflicts: edit `site/apps/*/package.json` dev/start scripts.
- Build cache issues: run `npm run clean` from `site/`.
