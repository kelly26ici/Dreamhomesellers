<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# LUXONN agent guide

Read [docs/README.md](docs/README.md) before planning or implementing marketplace work. It is the repository's portable source of product direction, architectural decisions, current-state facts, and the roadmap.

## Product rules

- LUXONN is a Kenya-focused premium marketplace. Build globally extensible primitives, but do not imply that global inventory is live.
- Preserve the maximal dark/gold LUXONN language: high media density, glassmorphism, motion, 3D, and editorial drama. Do not turn it into a minimalist product.
- Anonymous buyers can browse, search, compare, and use Simon. Owners must authenticate before creating, editing, submitting, or managing listings.
- Postgres is canonical. Storage owns media. Qdrant is a derived, buyer-safe discovery index. Models and chat never decide publication, authorization, price, or availability.
- The native React Simon experience plus Python API is the target. The Chainlit iframe is transitional.
- Use dense, URL-backed property search. The circular gallery belongs only to small curated/shortlist/similar-property surfaces, never broad search results.

## Repository boundaries

- This repository owns the LUXONN frontend, portable plans, architectural records, and the future native chat experience.
- `../simon` is the separate Python companion service. Do not merge, copy, delete, or rewrite it unless a documented migration plan explicitly authorizes that work.
- Do not inspect, expose, commit, or replicate `Simon.env`, `.env*`, API keys, session files, global agent settings, or generated worktrees.

## Before modifying code

1. Read the relevant document under `docs/architecture/` and `docs/plans/`.
2. Check the existing component style and preserve the visual system outside the scoped change.
3. For a durable decision, update `docs/architecture/decisions.md` in the same change.
4. For a multi-phase delivery change, update `docs/plans/marketplace-roadmap.md`.
5. Verify with focused checks. Do not alter generated `.next/` output or unrelated untracked files.
