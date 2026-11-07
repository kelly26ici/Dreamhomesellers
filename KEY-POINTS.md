# KEY-POINTS

The product spec. Everything here is true regardless of what the archived
documents said. Where an archived ADR disagrees with this file, this file
wins; where this file is silent, decide and record the decision here.

## The product

A premium Kenyan property marketplace. Owners publish listings; buyers browse
published inventory, ask a concierge questions about it, and request viewings.
Moderation is **after the fact only** — there is no pre-publication review,
because the owner does not have time to review and a listing goes live when
its owner publishes it.

## Domain vocabulary

| Term | Meaning |
|---|---|
| Listing | The durable thing a buyer sees. Owns the lifecycle pointer. |
| Revision | Immutable content snapshot. A listing's public surface is exactly one published revision. |
| `published_revision_id` | The listing's pointer to its published revision. Unforgeable by construction — see Invariants. |
| Media | Original (private) + derivatives (public). |
| Viewing request | A buyer asks to see a property. |
| Handoff | A conversation escalated to a human. |
| Outbox | Durable event queue; every state change emits one. |
| Simon | The concierge agent service, a separate repo. |

## Invariants — these are not negotiable

1. **Buyers only ever see published content.** Drafts, withdrawn listings,
   unpinned revisions, and unprocessed media never reach a buyer route, a
   public vector payload, or a Simon answer. Enforced by
   `listings.lifecycle_state = 'published'` plus the revision pointer, and
   re-checked at every read site.
2. **The location-disclosure rule.** `exact_address`, `latitude`, and
   `longitude` are released only after a viewing is accepted, never before.
   Currently enforced at four layers: column grants withhold them from
   `anon`, `listing_public_read` scopes rows, the owner write model has no
   field that could carry them, and the agent tool layer redacts contact
   data. Verified live 2026-11-07: all four are `400`/`401` to `anon`.
3. **The published pointer cannot be poisoned.**
   `listing_revisions.published_ref_revision_id` is generated as
   `CASE WHEN revision_state = 'published' THEN revision_id END`, and
   `listings.published_revision_id` is an FK onto it. A listing therefore
   physically cannot point at an unpublished revision.
4. **Money is a decimal string with an explicit currency at every boundary.**
   Never a float. Never a bare number.
5. **Consequential commands are auditable and idempotent**: actor, object,
   outcome, reason code, request id.
6. **The browser supplies intent, never authority.** The server resolves the
   listing, the actor, and the published revision independently. A
   browser-supplied price, owner, status, address, or availability is a lie
   until the server checks it.
7. **EXIF is stripped before any public derivative exists.** This is the
   location-disclosure rule again, at the file layer.

## Deployment topology

- `dreamhomesellers.onrender.com` — this repo, Render free tier, auto-deploys
  on push to `main`.
- `dreamhomesellers-simon.onrender.com` — the Python service, Render free
  tier, auto-deploys on push to `main`.
- Both stay warm by **cross-pinging each other's `/api/health` every 5
  minutes** from inside the deployment (`src/instrumentation.ts` here,
  `src/simon/keepalive.py` there). Render free spins down after ~15 minutes
  without *inbound* traffic, and a service cannot keep itself warm — outbound
  pings do not count. Known limit: if both are cold at once, neither loop is
  running to wake the other; one visit to either URL recovers the pair.
- Supabase project `nokarvewyorsupraufdg` (eu-west-1) is canonical.
  `ahylzmgsfeghojpleozg` is a read-only legacy import source.
- **This machine cannot reach the database directly.** The direct and pooler
  hostnames return no A record here and there is no IPv6 stack, so every
  DSN in `.env.local` fails at DNS. The Cloudflare-fronted REST endpoint
  *is* reachable, which is how production is verified. The hosted Supabase
  MCP would work but its bridge cannot pass arguments. Apply migrations from
  the Supabase dashboard.

## Verification (what "done" means)

Nothing is done because a test passed. A slice is done when production
behaves correctly:

- `GET /` and `/properties` return 200; `/properties` paginates.
- Anonymous catalog read via the anon key: **30 published listings, 0 drafts,
  0 withdrawn.** If a draft leaks, the slice is not done.
- Restricted columns (`exact_address`, `latitude`, `longitude`,
  `owner_phone`, `status_token_hash`, media `original_path`) are refused to
  `anon` — `400`/`401`, never `200`.
- Both services answer `/api/health` in under ~1s when warm.

## Owner decisions already made (do not re-litigate)

| # | Decision |
|---|---|
| 1 | No pre-publication review. A listing goes live when its owner publishes it. |
| 2 | Moderation survives as a takedown/report surface, never a gate. |
| 3 | Palette: **Ink + Verdigris**, both light and dark, one token set, with a toggle. Type: **Oswald** display + **Source Sans 3** body. One accent. No glow. WCAG 2.1 AA is the bar for every surface. |
| 4 | Simon is a **full-page route only**. No dock, so the chat runtime never enters a marketing bundle. |
| 5 | Design tokens are a first-class module, not CSS globals. |
| 6 | One palette everywhere; density and motion vary per surface. |
| 7 | Render free tier only, zero spend. No paid cron. |
| 8 | The rebuild **replaces**, it does not repair. No patches, no fast fixes. |
| 9 | Simon authenticates with a shared-secret header that only the Next.js relay sends. |
| 10 | The viewing state machine lives in SQL (`SECURITY DEFINER`), so no client can forge a transition. |
| 11 | Semantic search is visitor-facing *and* available to Simon, over one projection. |
| 12 | Media processing runs in the Simon service; captions are generated once per image at publish. |
| 13 | Debug and verify in production. |

## Live production facts worth knowing

At the time of writing, `GET /api/health` on the website reports
`dead_letter_events: 3`, `failed_outbox_events: 10`,
`open_viewing_requests: 2`, `pending_moderation_cases: 0`. Simon reports
`tools: 6` and is currently serving `openai/gpt-oss-120b`, which is the
**third** provider in its fallback chain — the first two are failing.
