# Claw Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Authenticated individuals and teams that launch, operate, and supply durable context to managed AI agents. They need to understand what knowledge exists, who can access it, and whether source material is ready for agent use.

## Product Purpose

Claw provides a hosted operating environment for persistent agents. Users manage agent lifecycle, conversations, private agent files, integrations, billing, and durable shared knowledge from one product.

Knowledge Hub is the account-level catalog for reusable knowledge. It presents backend Workspaces as product-facing Domains containing assigned agents, source files, and generated Markdown projections.

## Positioning

Claw combines managed agent runtimes with durable private workspaces and separately governed Knowledge Domains. Shared source material is converted into agent-readable Markdown and can be granted to agents without becoming part of an agent's private editable memory.

## Operating Context

Users work with an account-level agent roster and one or more Knowledge Domains such as Finance, Sales, Engineering, or Marketing. A Domain groups one business area's durable knowledge and assigned agents behind one grant boundary. Users upload documents, review conversion health, inspect source or generated content, edit metadata, and assign agents. OpenClaw agents can materialize accessible projections under `/home/node/workspaces` during startup while retaining private files under `/home/node/.openclaw/workspace`.

Home is the account-level operating brief. It joins deployment state with recent conversations from reachable OpenClaw gateways, known direct Domain access, and the next occurrence of configured scheduled jobs. It is not a persistent audit log.

## Capabilities and Constraints

- The Workspaces service is the current authority for Domains, files, generated Markdown, metadata, search, and direct user or agent grants.
- Every account keeps a protected Domain named General. The app provisions it whenever it is absent, and the UI never permits deleting it.
- Knowledge Hub is an authenticated account-level section at `/dashboard/agents?section=knowledge-hub`. It keeps the existing agent roster mounted and does not depend on the currently selected Workspace.
- Home and Shared Knowledge remain available while Knowledge Hub is marked Preview. Home uses the canonical `overview` route value.
- Home queries running OpenClaw agents on demand. Stopped, unsupported, restricted, and unreachable agents remain visible as explicit states, and partial gateway coverage must not be presented as complete account history.
- Domain access shown beside an agent describes known direct grants only. It does not claim that a conversation synchronized, searched, or used a Domain or source.
- The Home agenda shows configured jobs and their next reported or UTC-projected occurrence. Cron execution history, results, and meeting data are not currently available.
- Current search covers names, paths, summaries, and keywords. The product must not claim semantic indexing until an authoritative indexing contract exists.
- Active direct grants define Domain assignment. Knowledge Hub can assign or remove agents and creates `viewer` grants; human access and role selection are not exposed here yet.
- Domain assignment, runtime synchronization, indexing, and observed usage are separate states. Current UI must not claim that an assigned agent has synchronized or used an item.
- Agent creation never infers Domain access from ambient dashboard selection. Users explicitly choose an initial Domain or launch without one.
- Uploads are the available source type. External connectors may be previewed as Coming Soon without fabricated health or item data.
- Projects, departments, persistent activity history, meetings, common questions, and cross-resource usage references are future capabilities, not current facts.

## Brand Commitments

- Product name: HyperCLI Claw.
- Feature name: Knowledge Hub; page heading: Knowledge.
- Preserve the established Claw navigation, typography, theme tokens, dark and light modes, and restrained green selection accent.
- User-visible copy must use product language and must not mention implementation terms such as SDK.

## Evidence on Hand

- Workspace contracts: `../../../docs/agents/workspaces.mdx`
- TypeScript Workspace client: `../../../ts-sdk/src/workspaces.ts`
- Current knowledge operations: `src/components/dashboard/knowledge/SharedKnowledgePanel.tsx`
- Current navigation: `src/components/dashboard/AgentsChannelsSidebar.tsx`
- Backend implementation: sibling repository `hyperclaw-backend/workspaces`
- No production connector, central semantic index, project hierarchy, or knowledge-usage telemetry is available and none may be fabricated.

## Product Principles

- Show operational truth rather than inferred intelligence.
- Keep shared knowledge separate from private agent files and memory.
- Make processing failures and recovery actions more visible than vanity metrics.
- Use progressive disclosure so the catalog remains useful for both small personal accounts and larger Domains.
- Preview future capabilities only where users can understand or act on their availability.

## Accessibility & Inclusion

Knowledge Hub must support keyboard navigation, visible focus, text alternatives for status color, reduced motion, responsive mobile drawers, and readable contrast in both Claw themes.
