# LUXONN project instructions

Read [AGENTS.md](AGENTS.md) first, then [docs/README.md](docs/README.md) before planning or changing marketplace behavior.

This repository is the canonical home for LUXONN product decisions, architecture, plans, and frontend code. The current Python Simon prototype remains a separate companion repository at `../simon`; do not move, delete, or merge it without an explicit migration decision.

## Non-negotiable product direction

- LUXONN is a Kenya-focused premium property marketplace, designed to become globally extensible without claiming unsupported markets.
- Keep the maximal LUXONN visual language: dark/gold, high-media density, animation, 3D, and glassmorphism. Do not replace it with a minimalist design system.
- Anonymous buyers may browse, search, compare, and use Simon without compulsory sign-in. Authenticated owners are required to create or manage listings.
- Supabase PostgreSQL is the source of truth. Supabase Storage owns media. Qdrant is a rebuildable, buyer-safe search projection.
- Simon must become a native LUXONN UI backed by Python APIs. The existing Chainlit iframe is transitional, not the target architecture.
- Do not let an agent, vector index, browser state, or generated caption become the authority for listing price, availability, visibility, ownership, or moderation.

## Working rules

- Read the relevant architecture and planning documents before making a related change.
- Treat `Simon.env`, `.env*`, keys, tokens, and any environment file as secrets. Never read, copy, print, commit, or summarize their values.
- Preserve the separation between verified listing facts and AI-derived visual observations.
- Use URL-backed search state and accessible dense result views. Do not use the circular gallery as primary search results.
- For current Next.js APIs, consult installed Next.js documentation as required by `AGENTS.md` before implementation.
- Update the relevant decision, plan, or current-state document when a durable architectural decision changes.
