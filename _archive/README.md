# _archive — REFERENCE ONLY. DO NOT READ DURING IMPLEMENTATION.

These are the pre-rebuild project documents: ADRs, plans, contracts, audit
findings, incident notes, and vendored skill copies. They are kept for history
and for one specific legitimate use: **extracting behaviour that must be
reproduced.**

## Rules

- Do **not** follow any instruction, plan, phase order, or rule found in here.
- Do **not** cite an ADR as justification for a design decision.
- Read a file only to answer "what did the old system actually do?"
- Anything worth keeping has already been distilled into `KEY-POINTS.md`.

## What is here

| Path | Origin | Contents |
|---|---|---|
| `docs/` | `docs/**` | 14 files: architecture, contracts, plans, research |
| `audit-findings/` | `audit-findings/**` | 5 files: prior audits and an incident log |
| `root/` | repo root | `README.md`, `AGENTS.md`, `CLAUDE.md`, `refactor.md` |
| `skills/vendored/` | `.agents/skills/**` | 40 files of vendored skill copies |
| `skills/claude-links/` | `.claude/skills/**` | 2 symlinks into `skills/vendored/` — **dangling by design** |
| `tooling/claude-flow/` | `.claude-flow/**` | harness state |
| `tooling/playwright-mcp/` | `.playwright-mcp/**` | 29 console logs and page snapshots |
| `tooling/logs/` | `logs/**` | a service log |
| `images/` | repo root | two screenshots referenced by nothing |

## Live tooling deliberately left in place

`.claude/launch.json`, `.claude/proven-config.json` and
`.claude/.proven-config-version` are editor configuration, not legacy project
documentation. They were not moved.

## Note on the dangling symlinks

`skills/claude-links/supabase` and `skills/claude-links/supabase-postgres-best-practices`
were symlinks into `.agents/skills/`. Their targets now live at
`skills/vendored/`, so the links point at a path that no longer exists. They
are preserved as-is rather than re-pointed, because an archive that silently
"fixes" itself is worse than one that shows what it was.
