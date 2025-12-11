# HyperCLI Monorepo

This monorepo contains all the web applications and shared packages for HyperCLI.

## Structure

```
site/
├── apps/
│   ├── main/       # Main marketing site (port 4000)
│   ├── console/    # User console/dashboard (port 4001)
│   └── chat/       # AI chat interface (port 4002)
├── packages/
│   └── shared-ui/  # Shared UI components and styles
├── package.json
└── turbo.json
```

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10+

### Installation

```bash
cd site
npm install
```

### Environment Setup

Each app requires its own `.env.local` file. Copy `env.sample` to each app directory:

```bash
cp env.sample apps/main/.env.local
cp env.sample apps/console/.env.local
cp env.sample apps/chat/.env.local
```

Then edit each `.env.local` with your actual values.

### Development

Run all apps in development mode:

```bash
npm run dev
```

Or run individual apps:

```bash
# Main site
npm run dev --filter=@hypercli/main

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

Build individual apps:

```bash
npm run build --filter=@hypercli/main
npm run build --filter=@hypercli/console
npm run build --filter=@hypercli/chat
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

### Main Site (@hypercli/main)

Marketing and landing pages for HyperCLI.

- Port: 4000
- Features: Hero section, pricing, GPU fleet, models, playground

### Console (@hypercli/console)

User dashboard for managing GPU instances and jobs.

- Port: 4001
- Features: Dashboard, jobs, history, API keys, billing

### Chat (@hypercli/chat)

Interactive chat interface for AI models.

- Port: 4002
- Features: Model selection, chat history, real-time messaging

## Deployment

This project is configured for Netlify deployment. See `netlify.toml` for configuration.

Each app should be deployed as a separate Netlify site with:
- Base directory: `site`
- Build command: `npm run build -- --filter=@hypercli/<app-name>`
- Publish directory: `apps/<app-name>/.next`
- Package directory: `apps/<app-name>`
