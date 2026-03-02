# HyperClaw Dashboard Redesign — Design Document

**Date:** 2026-03-02
**Status:** Approved
**Scope:** Color system overhaul, agent creation wizard, dashboard polish, auth UX, agent settings

---

## 1. Color & Design System Overhaul

### Problem
Brand green (`#38D39F`) appears on ~40-50% of the UI surface — buttons, nav, status badges, chart colors, glows, borders, card accents, icons, focus rings. This creates the "AI generated" aesthetic. Top platforms (Vercel, Linear, Supabase) use brand color at 5-10%.

### Solution: Neutral-first palette with 10% green accent

**Updated CSS custom properties:**

| Token | Current | New |
|---|---|---|
| `--background` | `#0b0d0e` | `#0a0a0b` |
| `--surface-low` | `#161819` | `#141416` |
| `--surface-high` | `#1d1f21` | `#1c1c1f` |
| `--border` | `#1f2122` | `rgba(255,255,255,0.08)` |
| `--foreground` | `#fff` | `#fafafa` |
| `--text-secondary` | `#d4d6d7` | `#a1a1a6` |
| `--text-tertiary` | `#9ba0a2` | `#6b6b70` |
| `--text-muted` | `#6e7375` | `#48484d` |

**Green (10%) usage — ONLY on:**
- Primary CTA buttons (`.btn-primary`)
- Active nav indicator (dot or underline, NOT background tint)
- Success/running status dots
- Logo: "Claw" text stays green (brand identity)

**Green removal list:**
- `.glass-card` border: `border-[#38D39F]/10` → `rgba(255,255,255,0.06)`
- `.glow-green` class → removed
- `.animate-pulse-green` → neutral or removed
- `.gradient-text-primary` → white or removed
- Chart colors → neutral grays (white primary, muted secondary) with one green accent max
- Nav active state → white text + subtle indicator, no green background tint
- Icon accents → monochrome white/gray
- Focus rings → `rgba(255,255,255,0.2)` instead of green
- Card hover borders → `rgba(255,255,255,0.12)` instead of green

**New additions:**
- Opacity-based borders for natural layering
- Elevation through lightness shifts (surface-low → surface-high)
- Subtle background noise/grain texture (2-3% opacity) for depth

---

## 2. Agent Creation Flow — Full Persona Builder

### Problem
Agent creation is currently a basic modal with a form. For a platform centered on agents, this should be a memorable, polished experience.

### Solution: 3-step full-screen wizard overlay

**Step 1 — Identity & Personality**
- **Name input** — large, centered, with character count hint
- **Avatar selection** — two modes:
  - Pick from curated set: 12-16 icons (animals, abstract shapes, geometric patterns — not generic robot/CPU icons), each with a unique harmonious color
  - Upload custom: drag-drop zone with circular crop preview (max 2MB, client-side resize)
- **Personality/role description** — textarea ("What does this agent do?"), optional
- Live preview: mini agent card showing name + avatar + description as user fills in

**Step 2 — Configuration**
- **Model** — card picker or dropdown, with "Recommended" badge on default option
- **Region** — if applicable, with "Recommended" default pre-selected
- Every config option has a smart default pre-selected so users can skip through
- Tooltip/help text for each option

**Step 3 — Review & Launch**
- Summary card showing the agent exactly as it will appear in the dashboard
- Single green CTA: "Create Agent"
- On creation → transition into the existing AgentHatchAnimation
- Success state links to the agent's chat/console view

**UX details:**
- Step indicator dots at top
- Back/Next navigation (keyboard: Enter to advance, Escape to go back)
- Framer Motion slide transitions between steps
- Spacious layout — generous padding, not cramped
- Neutral palette throughout — only the final CTA is green

---

## 3. Dashboard Overview Polish

### Problem
The dashboard overview has the right information architecture but the wrong cosmetics — too many green accents, glowing glass cards, green icons.

### Changes (cosmetic, not structural):

**Welcome header:**
- User name/email + plan badge (neutral style, no green glow)
- Expiry date as muted secondary text

**Stats bar (4 cards):**
- Numbers in tabular font (`font-variant-numeric: tabular-nums`)
- No glass-card effect — subtle surface elevation with neutral borders
- Icons become monochrome (white/gray, not green)
- Labels in `--text-secondary`, values in `--foreground`

**Agent cards:**
- Keep per-agent avatar colors (deterministic system) — this IS good identity
- Card borders go neutral (`rgba(255,255,255,0.06)`)
- Quick action buttons become subtle icon buttons (not colored text links)
- Status dots keep semantic colors (green=running, red=failed, yellow=pending, gray=stopped)

**Charts:**
- Token usage: primary bar in `#fafafa` (white), secondary in `#48484d` (muted). One green accent line for the "current" bar if needed.
- Key usage: neutral gradient bars
- Chart axis labels in `--text-muted`

**Quick actions section:**
- Remove the 4-button grid
- Instead: contextual CTAs in empty states, inline actions in each section

**Onboarding guide:**
- Keep the two-track (API vs Agents) approach
- Restyle with neutral palette — step numbers and progress use white, not green

---

## 4. Auth UX — Landing Page + Profile Dropdown

### Problem
No sign-in/sign-out visibility on the landing page. Dashboard sign-out buried in settings.

### Landing page header (ClawHeader.tsx):

**Not signed in:**
- Nav links: Features, Pricing, Docs
- Right side: "Sign In" (ghost/text button) + "Get Started" (green primary CTA)

**Signed in:**
- Nav links: Features, Pricing, Docs
- Right side: "Dashboard" (green primary CTA) + user avatar/initial circle
- Click avatar → small dropdown: email, divider, "Sign Out"

### Dashboard header (DashboardNav.tsx):

- Replace email text display with a clickable avatar circle (user initial)
- Click → dropdown: email, current plan badge, divider, "Settings", "Sign Out"
- Remove sign-out from settings page danger zone (or keep as redundant option)
- Dropdown uses neutral styling with surface-high background

---

## 5. Agent Settings (Scoped to Claw App)

### Problem
No way to edit agent identity or basic config after creation.

### Solution: Settings tab in agent detail view

Add a "Settings" tab alongside Chat, Logs, Shell, Files, Config in the agent detail page.

**Settings tab contents:**
- **Name** — inline editable text field
- **Avatar** — change button, opens same picker as creation flow
- **Description** — editable textarea
- **Danger zone** — section with red border:
  - Stop agent (if running)
  - Delete agent (uses existing ConfirmDialog)

**Scope note:** This does NOT include the deeper gateway-powered settings (models, providers, sessions, files) from the feat-settings branch. That's a future integration.

---

## Technical Notes

- **Framework:** Next.js 16+ with App Router, client components
- **Animation:** Framer Motion (already in use)
- **Icons:** Lucide React (already in use)
- **No new dependencies** unless avatar upload requires a crop library
- **feat-settings branch:** NOT merged. Postponed for future integration.
- **Breaking changes:** CSS custom properties change, so all pages update simultaneously. The color overhaul is a single coordinated change.

---

## Execution Order

1. **Color system overhaul** (globals.css + all affected components) — foundation for everything else
2. **Dashboard nav + auth UX** (DashboardNav.tsx + ClawHeader.tsx) — profile dropdown
3. **Dashboard overview polish** (dashboard/page.tsx) — apply new palette
4. **Agent creation wizard** (new component + agents/page.tsx) — the big feature
5. **Agent settings tab** (agents/page.tsx) — post-creation identity editing
6. **Final sweep** — keys page, plans page, remaining pages get palette treatment
