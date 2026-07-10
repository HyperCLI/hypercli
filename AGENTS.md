# AGENTS.md

## Purpose
This file explains how to run the HyperCLI repo locally and how to work safely
and efficiently in the codebase.

## Repo map
- `site/`: Turbo monorepo (Next.js apps + shared UI)
  - `apps/main`: Marketing site (port 4000)
  - `apps/console`: User console/dashboard (port 4001)
  - `apps/chat`: Chat UI (port 4002)
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
   - `cp env.sample apps/chat/.env.local`
5. Edit each `.env.local` with your values. Most `NEXT_PUBLIC_*` values can
   stay as defaults for basic local rendering, but auth/payment features need
   real keys and working backend URLs.
6. Start all apps:
   - `npm run dev`
7. Visit:
   - `http://localhost:4000` (main)
   - `http://localhost:4001` (console)
   - `http://localhost:4002` (chat)

Tip: If you run commands from the repo root, use `npm --prefix site <script>`.

## Environment variables (local)
These are referenced by Turbo and the apps (see `site/turbo.json`):
- `NEXT_PUBLIC_MAIN_SITE_URL`, `NEXT_PUBLIC_CONSOLE_URL`, `NEXT_PUBLIC_CHAT_URL`
- `NEXT_PUBLIC_COOKIE_DOMAIN`, `NEXT_PUBLIC_COOKIE_VALIDITY`
- `NEXT_PUBLIC_ORGANIZATION_ID`, `NEXT_PUBLIC_AUTH_PROXY_CONFIG_ID`
- `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID`
- `NEXT_PUBLIC_INSTANCES_API_URL`, `NEXT_PUBLIC_WS_URL`, `NEXT_PUBLIC_LLM_API_URL`
- `NEXT_PUBLIC_AUTH_BACKEND`, `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_AUTH_PROXY_URL`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
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

## Frontend E2E debugging
The agents E2E flow intentionally covers Stripe checkout, entitlement/slot
propagation, agent launch, and gateway readiness. Do not skip checkout in this
spec: the critical regression surface is Stripe redirect back to `/plans`,
slot count increasing, and the purchased slot being usable to launch an agent.
Cleanup at the end should be best-effort only.

Build the local E2E image:

```bash
cd ~/dev/hypercli
IMAGE_TAG=local-agents-debug .github/scripts/build_e2e_image.sh
```

Start a persistent agents E2E container:

```bash
cd ~/dev/hypercli
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

Notes:
- Do not use `--rm` while debugging if you want to inspect the failed container
  after the first run.
- `E2E_KEEP_ALIVE_ON_FAILURE=1` leaves the Next servers and container running
  after a failure.
- CI failure notifications should prefer the Playwright `video.webm` converted
  to MP4. Screenshots are only a fallback when no video artifact exists.
- If agents E2E hits `NXDOMAIN` or cannot resolve an agent hostname shortly
  after launch, do not skip tests or bypass gateway readiness. Agent hostnames
  can take time to propagate through DNS; keep polling the real hostname with a
  bounded readiness wait and inspect the gateway/route state before changing
  test coverage.
- `TEST_CLAW_ADMIN_LOGIN_SHORTCUT=1` uses the backend admin login path instead
  of OTP when `BACKEND_API_KEY` or `AGENTS_BACKEND_API_KEY` is present.
- Keep secrets in `.env.agents` or CI secrets. Do not pass secret values with
  `docker run -e KEY=value`, because those values can leak through process
  listings and shell history.
- The E2E image contains a copied workspace. After editing tests or fixtures,
  either rebuild the image or bind-mount the specific file you are changing,
  for example
  `-v "$PWD/site/tests/claw/fixtures/auth.ts:/workspace/site/tests/claw/fixtures/auth.ts:ro"`.

Rerun the failing test inside the live container:

```bash
docker exec -it hypercli-e2e-agents-debug bash
cd /workspace/site
npx playwright test \
  --config tests/claw/playwright.config.ts \
  tests/claw/agents-subscription.spec.ts
```

Inspect artifacts from the host:

```bash
find .e2e-artifacts-local-live -maxdepth 5 -type f | sort
```

When the container is no longer needed:

```bash
docker rm -f hypercli-e2e-agents-debug
```

## Claw Files UI
The canonical Claw file-browser components live under
`site/apps/claw/src/components/dashboard/files` and the agent page composes them
through `AgentFilesPanel`. Do not reintroduce the deleted
`site/apps/claw/src/components/dashboard/files-panel` tree; it was a stale
duplicate of the file browser.

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
  checkout via `npm run sdk:use-checkout`. CI build/publish containers also
  install the sibling checkout so site builds exercise the current SDK source
  instead of waiting for a published package.
- Frontend CI deploys `dev` branch pushes to the dev Netlify sites with
  `site/env.dev`, and `main` branch pushes to the feat Netlify sites with
  `site/env.feat`, which points at the prod backend. Production Netlify publishing is manual through the
  `Publish Sites` workflow with `deploy_environment=prod`.
- For OpenClaw or other app-specific gateway features, frontend code may call
  app-level WebSocket/gateway methods exposed by the SDK. Do not add frontend
  connection management, reconnect logic, session lifecycle management, or
  other transport state machines when that behavior already exists in the SDK.
  The frontend should compose SDK primitives and render SDK state, not recreate
  connection/session authority locally.
- For Claw agent chat, use
  `site/apps/claw/src/lib/openclaw-session-key.ts:resolveOpenClawSessionKey()`.
  HyperCLI deployments already connect to separate OpenClaw gateways, so the
  gateway-local `"main"` session is the correct workspace. Do not pass
  deployment UUIDs into gateway session keys such as `agent:<agentId>:main`;
  that can make OpenClaw create `/workspace/<uuid>` and hide the real workspace
  from the agent.
- Claw plans/billing data should come from the SDK (`HyperAgent.currentPlan()`,
  `subscriptionSummary()`, `plans()`, `agentTypes()`), not ad hoc frontend
  fetches or duplicated plan state.
- Do not expose implementation terms such as "SDK" in user-visible UI copy.
  This includes headings, labels, helper text, empty states, button text,
  modal titles/descriptions, toast messages, and similar visual elements.
  Prefer product-facing language such as "plan catalog", "billing data",
  "workspace", or "account" depending on context.

## Troubleshooting
- Node version mismatches: use Node 22 (recommended) or Node 20+.
- Port conflicts: edit `site/apps/*/package.json` dev/start scripts.
- Build cache issues: run `npm run clean` from `site/`.

## SDK Releases
- Use the `Publish SDKs` GitHub Actions workflow for npm/PyPI releases.
- Calver rule:
  - first release on a new date: `YYYY.M.D`
  - only use `YYYY.M.D-N` for additional same-day rereleases
- Python packages map npm-style suffixes to PEP 440 automatically:
  - `2026.4.17` -> `2026.4.17`
  - `2026.4.17-2` -> `2026.4.17.post2`
- Do not start a new day with `-1`; that should be a plain date release.

## Agents Billing Contract
- `client.agent.purchaseEntitlementFromBalance(planId, { duration, tags?, extendExisting? })`
  maps to `POST /agents/billing/balance/{plan_id}`
- `client.agent.redeemGrantCode(code, { extendExisting? })`
  maps to `POST /agents/billing/grants/redeem`
- unactivated codes are `grants`, not entitlements
- `duration` is in seconds
- grants create new entitlements by default
- matching entitlements are extended in place only when `extend_existing` is explicit
