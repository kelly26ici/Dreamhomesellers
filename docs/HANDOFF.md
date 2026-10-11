# Portable project handoff protocol

## Why this exists

LUXONN may be continued in Claude Code CLI, Codex, OpenCode, or another coding environment. Agent-specific session memory is not a reliable project archive. The version-controlled documents in this repository are the canonical continuation record.

## What is committed here

- Product direction and constraints.
- Current-state facts that affect implementation decisions.
- Architecture decisions and reversals.
- Service boundaries and data authority rules.
- A phased delivery roadmap and completion criteria.
- Cross-agent working instructions in root `AGENTS.md` and `CLAUDE.md`.

## What is intentionally not copied here

Do not copy any of the following into this repository or its documentation:

- Global `~/.claude`, Codex, OpenCode, or gstack configuration.
- Desktop session transcripts, worktree metadata, caches, agent task logs, or generated session state.
- `.claude/worktrees`, `.gstack` runtime files, `.next`, `node_modules`, or other generated output.
- `Simon.env`, `.env*`, API keys, database credentials, tokens, or private URLs.
- Private customer, owner, buyer, or conversation data.

Those artifacts are either machine-specific, secret-bearing, or unsuitable as a durable product record.

## Continuation procedure

Before changing a major marketplace capability:

1. Read [Current state](architecture/current-state.md), [Target marketplace architecture](architecture/marketplace-target.md), and [Decision log](architecture/decisions.md).
2. Read the matching roadmap phase in [Marketplace roadmap](plans/marketplace-roadmap.md).
3. Inspect the relevant code and service boundary before proposing implementation.
4. Keep factual listing authority in Postgres and never trust browser context, vector search, chat memory, or generated captions as canonical facts.
5. Add a dated decision-log entry when a durable architecture, scope, provider, or data-model decision changes.
6. Update the roadmap after completing or materially replanning a phase.

## Agent compatibility

- Claude Code reads root `CLAUDE.md` and repository-local instructions.
- Codex and OpenCode use root `AGENTS.md` as their project instruction file.
- Other agents should start from this `docs/README.md` index.

The shared instruction files deliberately link to deeper documentation rather than duplicating all design decisions.
