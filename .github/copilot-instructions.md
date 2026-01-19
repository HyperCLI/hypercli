<!-- .github/copilot-instructions.md - guidance for AI coding agents -->
# HyperCLI — Copilot Instructions

Purpose: give an AI coding agent immediate, actionable context for working in this monorepo.

- Repo type: Turborepo monorepo with multiple Next.js `app`-dir apps and shared packages. See [site/package.json](site/package.json) and [site/turbo.json](site/turbo.json).
- Package manager: `npm` (see `packageManager` in [site/package.json](site/package.json)). Use workspace scripts (root `npm run dev` runs `turbo run dev`).

Quick overview
- Apps: `site/apps/*` — each app is a Next 13+ app using the app directory (e.g. [site/apps/main/src/app](site/apps/main/src/app)).
- Shared UI: `site/packages/shared-ui` — shared React components and utilities used by apps.
- Infrastructure: `site/env.sample` lists required environment variables; `site/netlify.toml` indicates Netlify usage for deployment.

How to run locally (discoverable):
- Install: `npm install` at `site` (the monorepo root under `site`).
- Dev: `npm run dev` (runs Turborepo dev across workspaces). If editing a single app, prefer running that app's `dev` script in `site/apps/<app>` only when necessary.
- Build: `npm run build` (turbo run build).

Conventions & patterns to follow (project-specific)
- UI components live in `site/packages/shared-ui/src/components`. Reuse these rather than duplicating styles.
- Apps use the Next `app` directory and `use client` directive at the top of client components. Preserve `use client` when adding hooks or browser-only behavior.
- Styling: Tailwind v4 utility classes are used heavily — you'll see bracketed color tokens like `bg-[#0B0D0E]` and opacity scales (e.g. `/8`, `/15`). Follow existing class patterns; prefer utilities over new CSS files for small tweaks.
- Motion & interactivity: `framer-motion` is used for animations (e.g. `why-fast-section.tsx`). Use motion primitives when adding animated elements and mirror the project’s easing/duration patterns.
- Icons: `lucide-react` is used for icons. Import icons directly (`import { Cloud } from 'lucide-react'`).

Code patterns & examples
- Feature components are small, stateless, and often accept props. Example: [site/packages/shared-ui/src/components/sections/why-fast-section.tsx](site/packages/shared-ui/src/components/sections/why-fast-section.tsx).
- Shared exports: add new shared components to `site/packages/shared-ui/src/index.ts` so other workspaces can import them via the workspace package.

Env & secret handling
- Copy `site/env.sample` → `.env.local` for local development. `turbo.json` lists global env names that must be present for builds/dev runs.

Build / CI hints
- Turborepo caching is used; CI and local scripts use `turbo` commands defined in [site/turbo.json](site/turbo.json).
- Deploy config for the public site exists in `site/netlify.toml`; follow that when adjusting build outputs.

When making changes
- For UI changes, update `site/packages/shared-ui` and apps referencing it; run `npm run dev` to validate.
- Preserve Next app routing structure and server/client boundaries. If you convert server components to client, add `use client` and move browser-only logic into client components.

Things AI agents should NOT assume
- No global testing harness is present — do not add tests without checking with maintainers.
- Do not change package manager or workspace layout without explicit instructions.

If unsure, check these files first:
- [site/package.json](site/package.json)
- [site/turbo.json](site/turbo.json)
- [site/env.sample](site/env.sample)
- [site/packages/shared-ui/src](site/packages/shared-ui/src)
- An example component: [site/packages/shared-ui/src/components/sections/why-fast-section.tsx](site/packages/shared-ui/src/components/sections/why-fast-section.tsx)

Ask the user if any of these are ambiguous: preferred branch name, CI workflow edits, or intended deployment target (Netlify vs other).
