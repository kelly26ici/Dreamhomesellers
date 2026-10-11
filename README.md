# LUXONN

LUXONN is a Kenya-focused premium property marketplace. It is evolving from a visual real-estate showcase into a trusted marketplace where authenticated owners submit listings, buyers discover published inventory, and Simon helps people make grounded property decisions.

The product is intentionally not minimal: its dark/gold visual system, rich motion, 3D, and editorial property experience remain part of the product direction. The marketplace must pair that visual ambition with trustworthy publication, permissions, and property data.

## Current state

The Next.js application currently provides the LUXONN marketing experience and a transitional Chainlit-based Simon integration. It does **not** yet include marketplace authentication, listing lifecycle management, canonical buyer search, native Simon chat, media processing, or moderation.

Read the portable project knowledge base before making product or architecture changes:

- [Current state](docs/architecture/current-state.md)
- [Target marketplace architecture](docs/architecture/marketplace-target.md)
- [Decision log](docs/architecture/decisions.md)
- [Marketplace roadmap](docs/plans/marketplace-roadmap.md)
- [Simon service boundary](docs/agent-service/simon-boundary.md)
- [Cross-agent handoff protocol](docs/HANDOFF.md)

## Repository layout

```text
src/                 Next.js application and LUXONN UI
public/              static public assets
docs/                portable architecture, decisions, plans, and handoff record
.claude/launch.json  local Claude Code preview configuration
```

The current Python Simon prototype is a **separate sibling project** at `../simon`. It is not vendored here. The target keeps Simon in Python while replacing the public Chainlit iframe with native LUXONN UI backed by a typed Python service boundary.

## Local development

Install dependencies, then run the development server:

```bash
npm install
```

```bash
npm run dev
```

Build the production application:

```bash
npm run build
```

Run linting:

```bash
npm run lint
```

## Configuration and secrets

`Simon.env`, `.env*`, API keys, database credentials, and private service URLs are intentionally ignored and must never be committed, copied into documentation, or printed. The legacy Simon embed reads its service URL from server-side configuration; the eventual native Simon integration will use authenticated, typed API calls instead.

## Product invariants

- LUXONN is Kenya-first. Existing international showcase material is not real marketplace inventory.
- Anonymous visitors may browse, search, compare, and use Simon. Owners must authenticate to create or manage listings.
- Supabase Postgres is the canonical record for listing visibility, price, availability, moderation, identity, and permissions.
- Supabase Storage owns property media. Qdrant is a buyer-safe derived discovery index, never canonical truth.
- An AI model, browser state, vector result, or generated image caption cannot publish a listing, disclose restricted data, or decide a commercial fact.

## Working with agents

- Start with [`AGENTS.md`](AGENTS.md) for project-wide instructions used by Codex, OpenCode, and other compatible agents.
- Claude Code should also read [`CLAUDE.md`](CLAUDE.md).
- All agents should begin architecture work from [`docs/README.md`](docs/README.md).
- Do not copy global machine configuration, desktop session state, generated worktrees, or secrets into this repository.
