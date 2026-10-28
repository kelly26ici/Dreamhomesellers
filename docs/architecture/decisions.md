# Architecture decision log

This log records durable decisions. Update it when a decision is reversed or materially refined; do not silently overwrite prior rationale.

## ADR-001 — Kenya-focused premium marketplace

**Date:** 2026-10-11  
**Status:** accepted

LUXONN is a Kenya-focused premium property marketplace. The architecture should be globally extensible for geography, currency, and localization, but the product must not imply that foreign inventory or operations are live.

**Consequences**

- Kenyan listings, locations, currency conventions, and local operations drive the initial product.
- Existing global homepage examples are marketing artifacts only and must be replaced or explicitly separated from live inventory.
- The property model must avoid hardcoding Kenya where a country, currency, locale, or regional policy field belongs.

## ADR-002 — Keep Next.js and the maximal visual language

**Date:** 2026-10-11  
**Status:** accepted

Keep the Next.js/React/Tailwind frontend and its dark/gold LUXONN identity. The product should maximize premium visual expression: rich imagery, motion, 3D, glassmorphism, and editorial composition. Do not replace it with a minimalist UI approach.

**Consequences**

- Preserve and improve GSAP, Framer Motion, R3F, Three, and Lenis usage where they do not impair accessibility or browsing performance.
- The marketplace information architecture must remain usable even when motion is reduced.
- 3D and gallery experiences are product features, not substitutes for search/filter semantics.

## ADR-003 — Anonymous buyer discovery; authenticated owner management

**Date:** 2026-10-11  
**Status:** accepted

Visitors may browse, search, compare, and use the concierge without compulsory registration. Owners must authenticate before creating, editing, submitting, or managing listings.

**Consequences**

- Account-gated buyer features may include cross-device saved listings, alerts, document access, offer workflows, and viewing management.
- Owner actions require Supabase Auth, authorization, and auditable server-side commands.
- Anonymous requests must be rate-limited and have narrower permissions.

## ADR-004 — Supabase Postgres is canonical

**Date:** 2026-10-11  
**Status:** accepted

Supabase PostgreSQL is the source of truth for identities, listings, revisions, prices, availability, permissions, moderation, leads, and viewings. Supabase Storage owns media.

**Consequences**

- Qdrant is a rebuildable buyer-safe discovery projection, not a source of truth.
- Chat memory, browser state, captions, and vectors cannot authorize or publish a listing.
- The target listing model separates physical property, commercial listing, immutable listing revision, and listing media.

## ADR-005 — Revisioned, moderated publication lifecycle

**Date:** 2026-10-11  
**Status:** accepted

Owners edit drafts. A submitted revision is reviewed as a stable artifact. A public listing points to an approved, published revision rather than allowing live mutation.

**Target lifecycle**

```text
DRAFT → SUBMITTED → APPROVED → PUBLISHING → PUBLISHED
                    ↘ CHANGES_REQUESTED / REJECTED
PUBLISHED → WITHDRAWN / CLOSED
```

**Consequences**

- A price, description, or media change creates a new draft revision.
- Automation can validate and triage; publication remains human-approved at launch.
- Publication side effects use a durable outbox and idempotent workers.

## ADR-006 — Dense visual grid is primary search

**Date:** 2026-10-11  
**Status:** accepted

Primary property search uses a dense, media-forward, filter-led visual grid/list with URL-backed filters, sorting, pagination or cursors, and fast property actions. It is inspired by high-density media discovery interfaces, not by copying any third-party brand or content pattern.

**Consequences**

- Broad searches do not use the 3D circular gallery.
- Each result exposes open, save, compare, ask Simon, similar, and viewing actions.
- Search state must remain shareable and accessible.

## ADR-007 — Circular gallery is constrained and curated

**Date:** 2026-10-11  
**Status:** accepted

The circular gallery may be used for curated collections, saved shortlists, similar listings, developer portfolios, or property-detail experiences. It is not primary search.

**Consequences**

- Do not clone arbitrary result sets to fabricate infinite search navigation.
- Constrain result counts, provide explicit controls, support reduced motion, and preserve a non-3D accessible alternative.
- The current animal gallery is a demo, not marketplace functionality.

## ADR-008 — Native Simon UI, Python service backend

**Date:** 2026-10-11  
**Status:** accepted

Replace the public Chainlit iframe with native React chat inside LUXONN. Keep Simon in Python and expose typed streaming APIs, with FastAPI as the preferred service boundary.

**Consequences**

- The existing Chainlit UI remains a temporary development/debug surface until replacement is ready.
- Native UI sends typed page context directly with chat requests: route, search filters, active listing/revision, result position, visible IDs, and compare selection.
- Browser context establishes intent; server retrieval revalidates authoritative facts.

## ADR-009 — Agent roles are deliberately split

**Date:** 2026-10-11  
**Status:** accepted

Use LangChain `create_agent` for live, bounded concierge interactions. Use Deep Agents or explicit LangGraph workflows only for long-horizon owner assistance, internal research, or artifact-heavy tasks. Use deterministic workers for media processing and critical business state transitions.

**Consequences**

- “Find a two-bedroom apartment” should not invoke an autonomous multi-agent planner.
- Listing publication, moderation, and bookings cannot be delegated to an unconstrained agent.
- Agent tools must be constrained domain operations, never raw SQL or unrestricted infrastructure access.

## ADR-010 — Image intelligence runs at ingestion time

**Date:** 2026-10-11  
**Status:** accepted

Property images are analyzed once after upload, not repeatedly through screenshots in chat. The system stores per-image structured observations and a property-level visual dossier.

**Consequences**

- Persist original media, safe derivatives, caption, room classification, visual features, processing status, embedding metadata, and versioning.
- Clearly distinguish verified facts from AI-derived observations.
- Initial semantic retrieval can embed text descriptions plus generated captions. Add a separate named image/multimodal vector only after evaluating real visual-search demand.

## ADR-011 — Memory is tiered and consent-aware

**Date:** 2026-10-11  
**Status:** accepted

Use request/page context for immediate intent, persistent checkpointers for conversation state, Supabase for structured durable data, and Qdrant only for optional semantic memory/retrieval.

**Consequences**

- Do not store transactional facts or permissions in vector memory.
- Summaries must be attributable, versioned, and user-correctable/deletable where they represent user preferences.
- Move away from Simon’s current in-memory checkpointing before the native product launch.

## ADR-012 — Organization-based tenancy with solo-owner mode

**Date:** 2026-10-11  
**Status:** accepted (owner decision)

Listings are owned by organizations (agency, brokerage, developer, or a one-person solo-owner organization). RLS, moderation routing, and staff roles are written against organizations from day one, so adding agencies and multi-member teams later is a membership change, not a schema migration.

**Consequences**

- Supabase Auth users gain marketplace authority through an organization record plus membership; a solo owner is an organization with one member.
- Every listing, draft, revision, media upload, and audit record carries an `organization_id`; owner authorization resolves through membership, never a bare user id.
- Transfer of a listing between owners is an explicit, auditable organizational operation, never a silent reassignment.

## ADR-013 — Founder-led moderation with automated pre-checks

**Date:** 2026-10-11  
**Status:** accepted (owner decision)

At launch, submitted listings are reviewed by the founder/small team against a defined checklist. Deterministic pre-checks (required fields, media validity, price/consistency sanity) run before human review to reduce load. Automating approval itself is deferred until volume justifies it.

**Consequences**

- The moderation queue and decisions are built for human review first; every decision is an auditable record.
- Pre-checks are deterministic validators on revision content; they never approve or publish autonomously.
- Moderation capacity is the launch pacing constraint; queue depth is visible so submission growth is not silently throttled.

## ADR-014 — Neighbourhood plus approximate pin until a viewing is accepted

**Date:** 2026-10-11  
**Status:** accepted (owner decision)

Published listings show neighbourhood/area and an approximate map pin. The exact address is released only after an accepted viewing request (or an equivalent verified step).

**Consequences**

- Public listing revisions carry area-level location fields for display and search; the precise address is restricted operational data on the property record, never in public revisions, Qdrant projections, or Simon context.
- Property detail pages and search maps render approximate pins derived from public fields only.
- Simon may state the neighbourhood and approximate location; it must decline exact-address disclosure before an accepted viewing request.

## ADR-015 — Inherited data staged as unverified; Qdrant rebuilt from the revisioned model

**Date:** 2026-10-11  
**Status:** accepted (owner decision)

The inherited flat `properties` table (~4,259 rows) and its 4,258-point Qdrant collection are prototype material, not trusted inventory. No row is grandfathered as published. Rows migrate into the Property / Listing / ListingRevision model as unverified records requiring owner confirmation before publication, and the Qdrant projection is rebuilt from published revisions rather than patched.

**Consequences**

- Legacy tables remain untouched as a staging source during migration; no destructive change to them.
- Import is an explicit, auditable path that sets verification status; buyers never see imported rows until an owner confirms them and moderation approves.
- The legacy Qdrant collection is decommissioned once the buyer-safe projection serves discovery; it is never incrementally patched.

## ADR-016 — Anonymous usage controls: generous discovery, protected expensive actions

**Date:** 2026-10-11  
**Status:** accepted as working default (owner may revise)

Browsing, search, and comparison remain anonymous with generous rate limits (cheap, mostly cached reads). Chat turns and viewing requests are tightly limited (expensive model calls and human follow-up), with soft escalation before hard blocks. Requesting a viewing requires a verified contact step (email or phone confirmation) even without an account, so fake requests cannot reach owners unfiltered.

**Consequences**

- Rate limits live server-side with per-IP/session/day budgets; anonymous flows degrade gracefully before hard blocking.
- Viewing requests store verified contact details and a stated purpose; unverified contact cannot create owner-visible requests.
- The ADR-003 split stands: cross-device saves, alerts, appointment management, documents, and offers require an account.

## ADR-017 — The marketplace runs on the fresh dream-home-sellers Supabase project; the inherited project is an import source only

**Date:** 2026-10-12  
**Status:** accepted (owner decision, overnight handoff)

LUXONN production data lives in the new Supabase project `nokarvewyorsupraufdg` (organization "dream home sellers", region eu-west-1 Ireland), which the owner created fresh and verified empty on 2026-10-12 (REST OpenAPI: zero tables, only the platform RPC `rls_auto_enable`). The inherited project `ahylzmgsfeghojpleozg` (Samantha workspace) becomes a read-only import source per ADR-015 — its data, its unknown external writer, and its operational risk stay isolated from the marketplace database.

**Consequences**

- Phase 1 migration 0001 applies to the new project's clean schema — no additive-only constraint applies there (it exists to protect the legacy project during import, not the new one).
- Open question 9 (the unknown external writer) no longer blocks new-project migrations; it constrains only reads and the audited import path from the legacy project.
- Connection settings for the new project live in `.env.local` (gitignored). Client code uses the publishable key; server code uses the secret key; RLS remains the authorization boundary — the service-role path is for admin/import tooling only, never request-handling code.
- Direct Postgres from the current network remains impossible until a Supavisor pooler is enabled on the new project (both projects' `db.*` hosts are IPv6-only on this IPv4-only network); until then the working paths are REST, the dashboard SQL editor, and the Supabase MCP server (registered 2026-10-12, pending owner `claude /mcp` authentication).

## ADR-018 — Border radius follows an instrument-panel scale, not a soft-card scale

**Date:** 2026-10-16  
**Status:** accepted (owner decision)

The rounding system follows the reference at orbit.jfernando.dev, whose computed values were read directly from the live page rather than inferred. It is an *instrument-panel* scale, not a soft-card scale: containers sit at 8px, and interactive controls sit at a deliberately **tighter** 6px, so a control nested inside a card never reads as softer than the surface holding it. The capsule tier (999px) is reserved for genuine nav shells, status pills, dots, and avatars — never for content cards. Headings and structural wrappers stay at 0.

**Consequences**

- `--radius-*` tokens in `src/app/globals.css` pin the scale explicitly (2/4/6/8/12/16/24px) so class names carry these values regardless of Tailwind default drift.
- Mapping applied across the UI: `rounded-3xl` (24px) and `rounded-2xl` (16px) → `rounded-lg` (8px); `rounded-xl` (12px) → `rounded-lg` (8px) for cards, with `rounded-xl` retained for media surfaces; `rounded-lg` → `rounded-md` (6px) only on buttons and form controls; `rounded-full` unchanged.
- Larger 16px (`rounded-2xl`) is retained only for full-screen modal and drawer shells, where the larger radius reads as depth separation rather than decoration.
- ADR-002's maximal visual language is unaffected: this is a precision refinement within dark/gold LUXONN, not a move toward minimalism. Glassmorphism, gradients, and borders are unchanged.
- Corner-only variants (`rounded-t-*`, `rounded-b-*`, and the 2px chat-bubble tails) drop one tier with their siblings.


## ADR-019 — Sign-out belongs to the authenticated surface, not the marketing navbar

**Date:** 2026-10-16  
**Status:** accepted (owner decision)

The navbar drops its sign-out control. Sign-out lives on the owner portal — the authenticated surface — at `POST /auth/signout`, rendered as a form button beside the `+ New listing` CTA.

**Why:** the navbar is not rendered on `/owner` (`src/app/page.tsx` is its only call site, and the root layout does not mount it). A sign-out control in a component that is absent from the route where a signed-in owner actually works gives that owner no way to end a session. Removing it from the navbar without adding it to the portal would have left zero sign-out affordance site-wide. Sign-out is also not a discovery action: it is a session-management action, and it belongs beside the other management controls.

**Consequences**

- `POST /auth/signout` clears the session through the cookie-aware server client (the same one `/auth/callback` uses) rather than a browser-side `supabase.auth.signOut()`. In SSR mode the session cookies are written through Next's cookie store and a server component cannot mutate cookies during render, so clearing only the browser copy would leave the server-side refresh token alive — the mechanism behind "I signed out but the portal still shows my listings".
- POST only. Sign-out is state-changing; a GET would let a prefetch, crawler, or any stray `<link>`/`<img>` silently end a visitor's session. `src/proxy.ts` already enforces same-origin on POSTs carrying cookies, and the guard deliberately permits a no-Origin HTML form post, so a real form reaches the handler while a forged cross-site POST does not.
- The route takes `?next=` under the same open-redirect guard as `/auth/callback` (same-site paths only, defaulting to `/`), and responds 303 so the browser follows with GET.
- The mobile drawer keeps a pointer ("SIGN OUT — FROM THE OWNER PORTAL") rather than dropping the affordance silently; the drawer has the vertical room and the owner needs to know where the action moved.
- `handleSignOut` and the `LogOut` icon import were deleted from `Navbar.tsx` with the control. The `onAuthStateChange` subscription stays — it drives `OWNER PORTAL` / `LIST RESIDENCE` / the signed-out branch, not sign-out.

## ADR-020 — Buyer discovery and owner listing creation are the two nav intents; BUY/RENT query filtering lives on /properties

**Date:** 2026-10-16  
**Status:** accepted (owner decision)

The navbar drops BUY and RENT. Primary navigation returns to the marketing sections — HOME, PROPERTIES, ABOUT, SERVICES — and PROPERTIES scrolls to the featured-listings rail rather than navigating, as the first commits did. The two top-right actions are the two owner intents, deliberately opposite: `+ LIST RESIDENCE` (create) and `SEARCH` (discover). Kind filtering is a property of the /properties grid, not of the shell.

**Why:** BUY and RENT were routed correctly all along (19 sale listings vs 10 rent), but both rendered with byte-identical styling and the page heading was hardcoded "Properties" in every state, so the pair read as duplicates. Kind is also not a primary intent for a premium marketplace buyer — price, area, and specification are — and the grid's filter bar already owns it with URL-backed state.

**Consequences**

- BUY/RENT, their `useSearchParams`-derived active state, and the `aria-current` attributes are gone. With the hook gone, the `<Suspense>` fence the nav required around the root layout is retired — the nav is back in the prerendered shell.
- `id="services"` replaces the stale `id="what-we-do"` on the Services section; the old anchor survives as `data-legacy-anchor` so existing deep links do not 404. `id="home"`, `id="properties"`, and `id="about"` already existed.
- Section scrolling routes through Lenis, which owns the scroll position once SmoothScroll mounts; native `scrollIntoView`/`window.scrollBy` are ignored and the scroll silently does nothing without it. Native scrolling is the fallback when Lenis is absent, and `prefers-reduced-motion` produces an instant jump (Lenis is JS-driven, so the global reduced-motion CSS block does not cover it).
- The hero's "Book a Private Viewing" — a label promising what the link did not deliver — becomes "List Your Residence" pointing at the listing-creation route. "Explore the Collection" keeps `/properties`, so something gold still reaches the full search surface.
- Supersedes ADR-019's drawer pointer: sign-out still lives at POST /auth/signout on the owner portal, and the portal keeps its nav entry for signed-in users so that route stays reachable.

