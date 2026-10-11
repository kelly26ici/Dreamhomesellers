# LUXONN project knowledge base

This directory is the portable, repository-owned record for LUXONN. It is intended to survive a switch between Claude Code, Codex, OpenCode, and other coding agents.

## Read in this order

1. [Current state](architecture/current-state.md) — what exists today and what is transitional.
2. [Target marketplace architecture](architecture/marketplace-target.md) — the approved destination and system boundaries.
3. [Decision log](architecture/decisions.md) — durable decisions already made.
4. [Security and data boundaries](architecture/security-data-boundaries.md) — field classifications, trust rules, and the authorization model that marketplace work must preserve.
5. [Simon service boundary](agent-service/simon-boundary.md) — native chat target, agent roles, retrieval, memory, and media intelligence.
6. [Marketplace roadmap](plans/marketplace-roadmap.md) — phases and exit criteria.
7. [Implementation sequence](plans/implementation-sequence.md) — the gated build order and its first task.
8. [Open questions](plans/open-questions.md) — decisions still awaiting the owner.
9. [Handoff protocol](HANDOFF.md) — how future agents keep this record current.

## Scope and safety

- These documents record decisions and verified findings. They never contain secrets, environment values, credentials, session transcripts, or private user data.
- `../simon` is a separate Python companion repository. It is documented here as an integration boundary, not copied into this project.
- Do not treat design examples or old static marketing copy as real inventory. Supabase PostgreSQL will become the only listing source of truth.
