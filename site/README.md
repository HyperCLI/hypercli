# HyperCLI Monorepo

This monorepo contains all the web applications and shared packages for HyperCLI.

## Structure

```
hyperstack/
├── apps/
│   ├── main/       # Main marketing site (port 3000)
│   ├── console/    # User console/dashboard (port 3001)
│   └── chat/       # AI chat interface (port 3002)
├── packages/
│   └── shared-ui/  # Shared UI components and styles
├── package.json
└── turbo.json
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm 10+

### Installation

```bash
cd hyperstack
npm install
```

### Development

Run all apps in development mode:

```bash
npm run dev
```

Or run individual apps:

```bash
# Main site
npm run dev --filter=@hypercli/main-site

# Console
npm run dev --filter=@hypercli/console

# Chat
npm run dev --filter=@hypercli/chat
```

### Build

Build all apps:

```bash
npm run build
```

## Design System

The HyperCLI design system is defined in `packages/shared-ui`. Key features:

- **Dark theme by default** - Dark background (#0B0D0E) with the HyperCLI green accent (#38D39F)
- **Plus Jakarta Sans** - Primary font family
- **CSS Variables** - All colors, spacing, and typography are defined as CSS custom properties
- **Tailwind CSS v4** - Using the latest Tailwind with CSS-first configuration

### Color Palette

| Token | Value | Usage |
|-------|-------|-------|
| `--background` | #0B0D0E | Main background |
| `--primary` | #38D39F | Primary green accent |
| `--surface-low` | #161819 | Cards, panels |
| `--surface-high` | #1D1F21 | Elevated surfaces |
| `--foreground` | #FFFFFF | Primary text |
| `--muted-foreground` | #9BA0A2 | Secondary text |

## Apps

### Main Site (@hypercli/main-site)

Marketing and landing pages for HyperCLI.

- Port: 3000
- Features: Hero section, pricing, documentation links

### Console (@hypercli/console)

User dashboard for managing AI deployments.

- Port: 3001
- Features: Dashboard, deployments, billing, settings

### Chat (@hypercli/chat)

Interactive chat interface for AI models.

- Port: 3002
- Features: Model selection, chat history, real-time messaging
