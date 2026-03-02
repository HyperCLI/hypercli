# Dashboard Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the HyperClaw dashboard from "AI-generated" aesthetic to a polished, neutral-first design with 10% green accent, add a full agent creation wizard, improve auth UX, and add basic agent settings.

**Architecture:** CSS custom properties drive the entire color system — changing `globals.css` propagates everywhere. New components (agent wizard, profile dropdown on landing) are added as separate files. The agents page gets a wizard overlay replacing the simple modal.

**Tech Stack:** Next.js 16+ App Router, Tailwind v4, Framer Motion, Lucide React, CSS custom properties. No new dependencies.

---

## Phase 1: Color System & Design Token Overhaul

### Task 1: Update CSS custom properties in globals.css

**Files:**
- Modify: `site/apps/claw/src/app/globals.css:8-64`

**Step 1: Update dark theme CSS variables**

Replace the `:root, [data-theme="dark"]` block (lines 8-64) with the new neutral-first palette:

```css
:root,
[data-theme="dark"] {
  --font-size: 16px;
  --background: #0a0a0b;
  --background-secondary: #101012;
  --surface-low: #141416;
  --surface-high: #1c1c1f;
  --foreground: #fafafa;
  --text-secondary: #a1a1a6;
  --text-tertiary: #6b6b70;
  --text-muted: #48484d;
  --card: #141416;
  --card-foreground: #fafafa;
  --popover: #1c1c1f;
  --popover-foreground: #fafafa;
  --primary: #38d39f;
  --primary-foreground: #0a0a0b;
  --primary-hover: #45e4ae;
  --primary-pressed: #2db789;
  --secondary: #1c1c1f;
  --secondary-foreground: #a1a1a6;
  --muted: #141416;
  --muted-foreground: #6b6b70;
  --accent: #38d39f;
  --accent-foreground: #0a0a0b;
  --accent-hover: #45e4ae;
  --accent-pressed: #2db789;
  --accent-subtle: #1a3f30;
  --destructive: #d05f5f;
  --destructive-foreground: #fff;
  --success: #3ad8a0;
  --warning: #e0a85f;
  --error: #d05f5f;
  --border: rgba(255, 255, 255, 0.08);
  --border-medium: rgba(255, 255, 255, 0.12);
  --border-strong: rgba(255, 255, 255, 0.18);
  --input: transparent;
  --input-background: #141416;
  --switch-background: #1c1c1f;
  --font-weight-medium: 500;
  --font-weight-normal: 400;
  --ring: rgba(255, 255, 255, 0.2);
  --chart-1: #fafafa;
  --chart-2: #a1a1a6;
  --chart-3: #6b6b70;
  --chart-4: #48484d;
  --chart-5: #38d39f;
  --radius: 0.5rem;
  --sidebar: #0a0a0b;
  --sidebar-foreground: #fafafa;
  --sidebar-primary: #fafafa;
  --sidebar-primary-foreground: #0a0a0b;
  --sidebar-accent: #141416;
  --sidebar-accent-foreground: #fafafa;
  --sidebar-border: rgba(255, 255, 255, 0.08);
  --sidebar-ring: rgba(255, 255, 255, 0.2);
}
```

Key changes:
- Borders are now opacity-based (`rgba(255,255,255,0.08)`) instead of hex
- Chart colors are neutrals with green only on chart-5
- Ring/focus is neutral white instead of green
- Sidebar primary is white (not green)
- Text hierarchy has bigger steps between levels
- Background is slightly warmer

**Step 2: Update utility classes in globals.css**

Replace `.btn-secondary:hover` border color (line 201):
```css
.btn-secondary:hover {
  background-color: var(--surface-low);
  border-color: var(--border-strong);
}
```

Replace `.card:hover` (lines 210-213):
```css
.card:hover {
  border-color: var(--border-medium);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
}
```

Replace `.gradient-text-primary` (lines 222-227):
```css
.gradient-text-primary {
  background: linear-gradient(to right, #fafafa, #a1a1a6);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
```

Replace `.glow-green` (lines 244-246):
```css
.glow-green {
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
}
```

Replace `.glow-green-subtle` (lines 248-250):
```css
.glow-green-subtle {
  box-shadow: 0 4px 40px rgba(0, 0, 0, 0.2);
}
```

Replace `.bg-radial-green` (lines 256-258):
```css
.bg-radial-green {
  background-image: radial-gradient(ellipse at center, rgba(255, 255, 255, 0.02) 0%, #0a0a0b 60%);
}
```

Replace `.glass-card` (lines 261-272):
```css
.glass-card {
  background: rgba(20, 20, 22, 0.7);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: var(--radius);
  transition: all 0.3s ease;
}
.glass-card:hover {
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
}
```

Replace `.animate-pulse-green` (lines 320-322):
```css
.animate-pulse-green {
  animation: pulse-green 2s ease-in-out infinite;
}
```

Update `@keyframes pulse-green` (lines 307-314) to use neutral:
```css
@keyframes pulse-green {
  0%, 100% {
    box-shadow: 0 0 20px rgba(255, 255, 255, 0.08);
  }
  50% {
    box-shadow: 0 0 40px rgba(255, 255, 255, 0.15);
  }
}
```

Update `::selection` (lines 359-362):
```css
::selection {
  background-color: rgba(56, 211, 159, 0.3);
  color: var(--foreground);
}
```
(Keep selection green — it's subtle and intentional.)

Update `*:focus-visible` (lines 379-382):
```css
*:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.3);
  outline-offset: 2px;
}
```

**Step 3: Verify the build compiles**

Run: `cd site && npx turbo build --filter=@hypercli/claw 2>&1 | tail -20`
Expected: Build succeeds (CSS changes are non-breaking)

**Step 4: Commit**

```bash
git add site/apps/claw/src/app/globals.css
git commit -m "style: neutral-first design token overhaul — 10% green accent"
```

---

### Task 2: Update DashboardNav to neutral palette

**Files:**
- Modify: `site/apps/claw/src/components/dashboard/DashboardNav.tsx`

**Step 1: Update nav active state (line 73)**

Change the active state from green background to white text with subtle indicator:
```tsx
// Old:
"text-primary bg-[#38D39F]/10"
// New:
"text-foreground bg-surface-low"
```

**Step 2: Update avatar circle (line 90)**

Change from green tint to neutral:
```tsx
// Old:
className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center text-xs font-bold text-primary"
// New:
className="w-7 h-7 rounded-full bg-surface-high flex items-center justify-center text-xs font-bold text-foreground"
```

**Step 3: Update mobile avatar (line 160)**

Same change:
```tsx
// Old:
className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center text-sm font-bold text-primary"
// New:
className="w-8 h-8 rounded-full bg-surface-high flex items-center justify-center text-sm font-bold text-foreground"
```

**Step 4: Update mobile bottom tab active state (line 196)**

```tsx
// Old:
active ? "text-primary" : "text-text-tertiary"
// New:
active ? "text-foreground" : "text-text-tertiary"
```

**Step 5: Commit**

```bash
git add site/apps/claw/src/components/dashboard/DashboardNav.tsx
git commit -m "style: neutralize dashboard nav — remove green from active states"
```

---

### Task 3: Update dashboard overview page to neutral palette

**Files:**
- Modify: `site/apps/claw/src/app/dashboard/page.tsx`

**Step 1: Neutralize plan badge (line 199)**

```tsx
// Old:
className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium"
// New:
className="text-xs bg-surface-high text-text-secondary px-2 py-0.5 rounded-full font-medium"
```

**Step 2: Neutralize stat card icons (lines 342, 352, 362, 372)**

Change all 4 icons from `text-primary` to `text-text-tertiary`:
```tsx
// Old: text-primary (4 occurrences)
// New: text-text-tertiary
```

Specific lines:
- Line 342: `<Activity className="w-4 h-4 text-primary" />` → `text-text-tertiary`
- Line 352: `<Hash className="w-4 h-4 text-primary" />` → `text-text-tertiary`
- Line 362: `<Key className="w-4 h-4 text-primary" />` → `text-text-tertiary`
- Line 372: `<Zap className="w-4 h-4 text-primary" />` → `text-text-tertiary`

**Step 3: Neutralize agent card actions (line 294)**

```tsx
// Old:
className="px-2.5 py-1 rounded text-xs border border-[#38D39F]/30 text-primary hover:bg-[#38D39F]/10 ..."
// New:
className="px-2.5 py-1 rounded text-xs border border-border-medium text-foreground hover:bg-surface-low ..."
```

**Step 4: Neutralize running status badge (line 271)**

```tsx
// Old:
isRunning ? "bg-[#38D39F]/10 text-primary" :
// New:
isRunning ? "bg-[#38D39F]/10 text-[#38D39F]" :
```
(Keep running green — this IS a semantic status indicator, within the 10% budget.)

**Step 5: Neutralize quick action icons (lines 396-421)**

Change all 4 icons from `text-primary` to `text-text-secondary`:
```tsx
<Bot className="w-5 h-5 text-text-secondary" />
<Key className="w-5 h-5 text-text-secondary" />
<Gauge className="w-5 h-5 text-text-secondary" />
<Activity className="w-5 h-5 text-text-secondary" />
```

**Step 6: Add tabular nums to stat values**

Add `tabular-nums` to each stat value `<p>` tag (lines 345, 355, 365, 375):
```tsx
className="text-xl font-bold text-foreground tabular-nums"
```

**Step 7: Commit**

```bash
git add site/apps/claw/src/app/dashboard/page.tsx
git commit -m "style: neutralize dashboard overview — icons, badges, stat cards"
```

---

### Task 4: Update agents page green references

**Files:**
- Modify: `site/apps/claw/src/app/dashboard/agents/page.tsx`

**Step 1: Find and replace green-specific classes**

Search for these patterns and replace:
- `text-primary` on non-CTA elements → `text-foreground` or `text-text-secondary`
- `bg-[#38D39F]` decorative usage → neutral equivalents
- `border-primary` on non-selected states → `border-border-medium`
- `bg-primary/10` on hover states → `bg-surface-low`
- `focus:border-primary` on inputs → `focus:border-border-strong`

Keep green ONLY on:
- "Create Agent" CTA button (the `btn-primary`)
- Running status dots (semantic)
- Selected size card border in creation dialog (intentional accent)

**Step 2: Commit**

```bash
git add site/apps/claw/src/app/dashboard/agents/page.tsx
git commit -m "style: neutralize agents page — remove decorative green"
```

---

### Task 5: Update keys page and plans page

**Files:**
- Modify: `site/apps/claw/src/app/dashboard/keys/page.tsx`
- Modify: `site/apps/claw/src/app/dashboard/plans/page.tsx`

**Step 1: Keys page**

- Active key status badge: keep green (semantic) → `bg-[#38D39F]/10 text-[#38D39F]`
- "Create Key" button: keep green (primary CTA)
- Focus rings on inputs: change to `focus:border-border-strong`
- Any decorative green icons → `text-text-tertiary`

**Step 2: Plans page**

- Current plan border glow: change from `border-[#38D39F]/40` + `shadow-[0_0_40px_rgba(56,211,159,0.12)]` to `border-border-medium` + subtle neutral shadow
- Plan feature check icons: change from green to `text-text-secondary`
- "Active" badge: keep green (semantic status)
- Upgrade/Subscribe buttons: keep green (primary CTAs)

**Step 3: Commit**

```bash
git add site/apps/claw/src/app/dashboard/keys/page.tsx site/apps/claw/src/app/dashboard/plans/page.tsx
git commit -m "style: neutralize keys and plans pages"
```

---

## Phase 2: Landing Page Auth UX

### Task 6: Add auth-aware header to landing page

**Files:**
- Modify: `site/apps/claw/src/components/landing/ClawHeader.tsx`

**Step 1: Add logout and profile dropdown for signed-in users**

When `isAuthenticated` is true, the desktop auth section (lines 75-100) should show:
- User avatar circle (initial) with dropdown containing email + "Sign Out"
- "Dashboard" green CTA button

Replace the authenticated desktop block (lines 78-84):
```tsx
isAuthenticated ? (
  <div className="flex items-center gap-3">
    <button
      onClick={() => router.push("/dashboard")}
      className="btn-primary px-4 py-2 rounded-lg text-sm font-medium"
    >
      Dashboard
    </button>
    <div className="relative" ref={userMenuRef}>
      <button
        onClick={() => setUserMenuOpen(!userMenuOpen)}
        className="w-8 h-8 rounded-full bg-surface-high flex items-center justify-center text-sm font-bold text-foreground hover:bg-surface-low transition-colors"
      >
        {emailInitial}
      </button>
      <AnimatePresence>
        {userMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-10 w-48 glass-card p-1 shadow-xl z-50"
          >
            <div className="px-3 py-2 border-b border-border mb-1">
              <p className="text-sm text-foreground font-medium truncate">{user?.email || "User"}</p>
            </div>
            <button
              onClick={() => { setUserMenuOpen(false); logout(); }}
              className="flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-foreground hover:bg-surface-low rounded-md transition-colors w-full text-left"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  </div>
)
```

**Step 2: Add required state and imports**

Add to imports: `LogOut` from lucide-react, `AnimatePresence, motion` from framer-motion.

Add state:
```tsx
const [userMenuOpen, setUserMenuOpen] = useState(false);
const userMenuRef = useRef<HTMLDivElement>(null);
const { isAuthenticated, isLoading, login, logout, user } = useClawAuth();
const emailInitial = user?.email ? user.email[0].toUpperCase() : "?";
```

Add click-outside handler (same pattern as DashboardNav).

**Step 3: Update mobile menu for signed-in users**

When authenticated on mobile (lines 135-154), show both "Dashboard" and "Sign Out":
```tsx
isAuthenticated ? (
  <>
    <button
      onClick={() => { setMobileOpen(false); router.push("/dashboard"); }}
      className="btn-primary px-4 py-2 rounded-lg text-sm font-medium w-full"
    >
      Dashboard
    </button>
    <button
      onClick={() => { setMobileOpen(false); logout(); }}
      className="btn-secondary px-4 py-2 rounded-lg text-sm font-medium w-full"
    >
      Sign Out
    </button>
  </>
)
```

**Step 4: Commit**

```bash
git add site/apps/claw/src/components/landing/ClawHeader.tsx
git commit -m "feat: auth-aware landing page header with profile dropdown"
```

---

## Phase 3: Agent Creation Wizard

### Task 7: Create the AgentCreationWizard component

**Files:**
- Create: `site/apps/claw/src/components/dashboard/AgentCreationWizard.tsx`

**Step 1: Build the 3-step wizard component**

This is a full-screen overlay with 3 steps:
1. Identity & Personality (name, avatar, description)
2. Configuration (size/resources with "Recommended" defaults)
3. Review & Launch

The component receives props:
```tsx
interface AgentCreationWizardProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void; // callback to refresh agent list
  budget?: { max_agents: number; total_cpu: number; total_memory: number; used_agents: number; used_cpu: number; used_memory: number } | null;
}
```

Key implementation details:
- Full-screen overlay (`fixed inset-0 z-50`)
- 3-step navigation with step indicator dots
- Step transitions via Framer Motion (slide left/right)
- Avatar picker: grid of 16 curated icons with harmonious colors
- Avatar upload: drag-drop zone with FileReader, circular preview
- Name input: prominent, centered
- Description textarea: optional
- Size picker: 3 preset cards with "Recommended" badge on medium, same as current
- Advanced toggle for custom CPU/memory
- Review step: mini agent card preview with all chosen details
- Create button: the one green CTA
- Keyboard nav: Enter to advance, Escape to close

Avatar icons for the picker (expand beyond current 8):
```tsx
import { Bot, Brain, Cat, Crown, Dog, Eye, Flame, Globe, Heart, Leaf, Moon, Rocket, Shield, Sparkles, Star, Sun, Terminal, Zap } from "lucide-react";
```

Pick 16 with unique harmonious hues.

**Step 2: Commit**

```bash
git add site/apps/claw/src/components/dashboard/AgentCreationWizard.tsx
git commit -m "feat: agent creation wizard — 3-step persona builder"
```

---

### Task 8: Integrate wizard into agents page

**Files:**
- Modify: `site/apps/claw/src/app/dashboard/agents/page.tsx`

**Step 1: Replace the create dialog with the wizard**

1. Import `AgentCreationWizard`
2. Replace the `showCreateDialog` state and the inline create dialog (lines 664-757) with:
```tsx
<AgentCreationWizard
  open={showCreateDialog}
  onClose={() => setShowCreateDialog(false)}
  onCreated={() => { setShowCreateDialog(false); fetchAgents(); }}
  budget={budget}
/>
```
3. Remove the inline creation modal JSX and its associated state (`newName`, `selectedSize`, `showAdvanced`, `customCpu`, `customMem`, `startImmediately`, `creating`) — move them into the wizard component
4. Move `handleCreate` logic into the wizard component

**Step 2: Commit**

```bash
git add site/apps/claw/src/app/dashboard/agents/page.tsx site/apps/claw/src/components/dashboard/AgentCreationWizard.tsx
git commit -m "feat: integrate agent creation wizard into agents page"
```

---

## Phase 4: Agent Settings Tab

### Task 9: Add Settings tab to agent detail view

**Files:**
- Modify: `site/apps/claw/src/app/dashboard/agents/page.tsx`

**Step 1: Add "settings" to the MainTab type**

```tsx
type MainTab = "chat" | "logs" | "shell" | "files" | "settings";
```

**Step 2: Add Settings tab button in the tab bar**

Add after the existing tabs:
```tsx
<button
  onClick={() => setMainTab("settings")}
  className={`... ${mainTab === "settings" ? "text-foreground border-b-2 border-foreground" : "text-text-tertiary"}`}
>
  <Settings className="w-4 h-4" />
  Settings
</button>
```

**Step 3: Add settings panel content**

When `mainTab === "settings"`, render:
- Agent name (inline editable)
- Agent description (editable textarea — stored client-side for now, or via config if API supports it)
- Danger zone: Stop agent (if running), Delete agent (with ConfirmDialog)

Use existing ConfirmDialog component for the delete confirmation.

**Step 4: Commit**

```bash
git add site/apps/claw/src/app/dashboard/agents/page.tsx
git commit -m "feat: add settings tab to agent detail view"
```

---

## Phase 5: Final Polish Sweep

### Task 10: Update remaining components

**Files:**
- Modify: `site/apps/claw/src/components/dashboard/OnboardingGuide.tsx`
- Modify: `site/apps/claw/src/components/dashboard/UsageChart.tsx` (if it uses green)
- Modify: `site/apps/claw/src/components/dashboard/KeyUsageTable.tsx` (if it uses green)

**Step 1: Audit and neutralize remaining green in components**

Search all dashboard components for `#38D39F`, `text-primary`, `bg-primary`, `border-primary` and replace decorative usage with neutrals. Keep semantic usage (success states, running indicators, primary CTAs).

**Step 2: Commit**

```bash
git add -A site/apps/claw/src/components/dashboard/
git commit -m "style: final polish sweep — neutralize remaining components"
```

---

### Task 11: Build verification and visual QA

**Step 1: Run full build**

```bash
cd site && npx turbo build --filter=@hypercli/claw
```
Expected: Build succeeds with zero errors.

**Step 2: Run dev server and visual check**

```bash
cd site && npm run dev --filter=@hypercli/claw
```

Check each page:
- Landing page: header auth states
- Dashboard overview: neutral stat cards, agent cards, charts
- Agents page: creation wizard, settings tab, neutral sidebar
- Keys page: neutral table, green only on active status
- Plans page: neutral cards, green only on CTAs and active badge
- Settings page: neutral layout

**Step 3: Final commit if any fixes needed**

```bash
git add -A site/apps/claw/
git commit -m "fix: visual QA adjustments"
```
