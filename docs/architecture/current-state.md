# Current state — 2026-10-13

## Repository ownership

`dreamhomesellers/` is a Next.js 16.4.0, React 19.3.0, TypeScript, Tailwind CSS 4 frontend. It currently owns the LUXONN visual experience and portable product documentation.

`../simon` is a separate Python 3.13 service repository. It contains the current LangChain/Chainlit Simon prototype and shares the intended Supabase/Qdrant property infrastructure. It is not yet a native LUXONN backend API.

## Production database (ADR-017, 2026-10-12)

LUXONN marketplace data lives in the fresh Supabase project `nokarvewyorsupraufdg` (dream-home-sellers organization, eu-west-1). The inherited project `ahylzmgsfeghojpleozg` (Samantha workspace) is a read-only import source per ADR-015. The Supabase MCP server is registered for the new project; connection settings are in `.env.local` (gitignored).

**Phase 1 schema is APPLIED and verified (2026-10-12).** Migration `0001_tenancy_and_lifecycle` went live through the Supabase MCP `apply_migration` after the owner confirmed IPv4 direct-DB access is a paid pooler feature: 18/18 tables, 18/18 RLS-enabled, 18/18 FORCE RLS, and the `anon`/`authenticated` runtime smoke test passes. Post-apply hardening (trigger-function `search_path` pins; the `is_org_internal` SECURITY DEFINER helper replacing an inline subquery in `listing_public_read` that broke anonymous reads under the column grants) is applied, mirrored into the migration file, and committed. Remaining security-lint findings are intentional: five service-lane tables are default-deny (RLS on, zero policies), and the RLS helper functions must keep client EXECUTE because policies evaluate with the caller's privileges. The application narrative and verification queries are in the [Phase 1 migration runbook](../plans/phase1-migration-runbook.md).

**Curated legacy import seed is APPLIED (2026-10-13).** Seed `supabase/seeds/0002_legacy_import_curated.sql` imported 20 curated Kenyan rows from the ADR-015 read-only legacy pool under a non-internal "LUXONN Heritage Portfolio" organization (no membership rows; revisions carry `created_by NULL`, `created_via='import'`, `verification_status='unverified'`). The transaction was applied in a single statement batch, verified (20 published revisions, 20 published listings with pointers, 61 pending inherited_external media rows, 30 anon-visible published listings total, zero ADR-014 restricted leaks, zero pointer mismatches), committed as `adcf16a`, and confirmed end-to-end on the buyer surfaces: the `/properties` grid paginates 12+12+6, imported detail pages render with the imagery-pending placeholder, and the homepage featured rail still excludes unverified imports. Imported rows enter exclusively through the real tables — the frontend cannot distinguish seed from real inventory. Lossy mappings are documented in the seed header (6 rent `per_month` inferences, 2 acre→m² conversions, 3 land-row bed/bath/year NULLed, 9 city normalizations).

## What works now

- Dark/gold LUXONN visual system using Bebas Neue and Inter.
- GSAP, Framer Motion, Lenis, React Three Fiber, Drei, and Three.js are available for high-motion and 3D surfaces.
- A homepage with luxury marketing sections.
- A floating Simon launcher and direct `/simon` route that embed the Chainlit service through a server-configured URL.
- A native horizontally scrollable `PropertyShowcase`; the previous scroll-pinned implementation was removed because it blocked lower-page scrolling.
- A published-listings read model (`src/lib/marketplace/read-model.ts`): the buyer grid with URL-backed filters, facets, and pagination on `/properties`, and the `/property/[listingId]` detail page — all anonymous-safe by RLS construction.
- The existing Python Simon prototype can search the existing Supabase-backed Kenyan property pool, compare properties, book viewings, and create listing/lead records through authored tools.

- A homepage whose merchandising rails (Featured Properties grid and the
  horizontal collection strip) read verified published listings from the
  buyer read model via `fetchPublishedFeatured`, each rail wrapped in its
  own Suspense boundary; hero floating facts mirror the verified Karen
  record. Metadata is Kenya-framed.
- A shared ADR-001 money formatter (`src/lib/marketplace/format-money.ts`)
  used by the grid, detail, and homepage surfaces.
- Anonymous buyer save and compare on `/saved` (commit `eb073c4`): localStorage
  stores hold only listing IDs; facts re-fetch RLS-governed from the published
  record so unpublished rows drop out automatically.
- The similar-residences circular strip on the property detail page (commit
  `2b70e47`): same-county+type neighbors in a drag-to-rotate 3D ring, honest
  empty state, never bound to page scroll.
- The OAuth 2.1 consent surface (2026-10-13): `/oauth/consent` renders the
  authorization UI for the Supabase OAuth Server (`authorization_url_path`),
  and `POST /api/oauth/decision` completes approve/deny server-side with the
  user's session cookies via `src/lib/auth/supabase-server.ts` and
  `@supabase/ssr`. `@supabase/ssr` is now a dependency.
- Working sign-in (2026-10-13): `/login` authenticates with Supabase Auth
  (`signInWithPassword` through a browser cookie client in
  `src/lib/auth/supabase-browser.ts`, session refresh in `src/proxy.ts` —
  Next.js 16's middleware successor). Unsigned-in consent visitors are sent
  to `/login?next=…` carrying their `authorization_id` so the authorization
  resumes after sign-in.
- The viewing-request surface (2026-10-13): the property detail page renders
  `ViewingRequestForm`, which calls the applied `create_viewing_request`
  ADR-016 domain command through the browser Supabase client (the only
  client write path), maps its typed rejection reason codes to
  buyer-facing copy, and shows the returned `VR-` reference. Authenticated
  buyers with a Supabase-verified email get in-band verification (`open`
  state directly); anonymous or unverified contact lands in
  `pending_contact_verification`.

## What is provisional or incomplete

### Frontend

- Property cards in the About/testimonials sections remain editorial marketing content, not inventory from a canonical catalog.
- The homepage About section and hero are Kenya-framed; the testimonials keep one fictional "Private Client, Dubai" byline (editorial social proof, decided exception).
- Root metadata is Kenya-framed. Map experience, owner portal, and moderator portal do not exist yet.
- The login page is functional for email/password sign-in, and the whole
  sign-in → consent → viewing-request chain is runtime-verified (2026-10-13,
  live dev-server session): PKCE authorize, consent UI, approve decision,
  token exchange, and the persisted consent row all confirmed end to end.
  Both viewing-request paths confirmed live: an authenticated buyer's
  verified email lands the request in `open` (VR-A7FD19A8), an anonymous
  private-window submission lands in `pending_contact_verification`
  (VR-55C72218) — states verified against `viewing_requests` and
  `audit_records` server-side.
- Saved/compare and the similar-residences strip are implemented; the strip
  was exercised during the 2026-10-13 live session without errors. Formal
  runtime verification (save → /saved shows the card, compare renders) is
  the last remaining check on the client-side phase.
- The circular gallery is an unrelated animal-photo demo on `/gallery`. It is not property data and must not be used as broad search results.
- There are no application tests, retrieval evaluations, or CI checks beyond ad hoc local lint/build verification.

### Simon service

- Simon currently uses LangChain `create_agent` and authored async tools. This remains suitable for short live buyer-concierge turns.
- Its public UI is Chainlit inside an iframe. This is transitional and will be replaced by native React chat backed by Python streaming APIs.
- Conversation state uses `InMemorySaver`, so state is lost across process restarts.
- The agent is Kenya/Nairobi/KES oriented, unlike old global marketing copy in the frontend.
- The current Supabase REST catalog and Qdrant text search are working prototype integrations, but they are not yet a revisioned, moderated marketplace architecture.
- The current Cloudflare embedding path is text-only. It cannot directly embed raw property images.

## Current technical facts

| Area | Current state | Target direction |
| --- | --- | --- |
| Frontend | Next.js App Router, static marketing content | Keep framework and visual system; replace static property data with marketplace data |
| Auth | No functional authentication | Supabase Auth; owner-only listing management; anonymous buyer discovery |
| Catalog authority | Existing Supabase prototype data | Revisioned Supabase Postgres marketplace domain model |
| Media | No website upload/processing lifecycle | Private Storage uploads, async enrichment, moderated public derivatives |
| Search | Static cards and prototype Simon tools | Dense URL-backed search grid, Postgres hydration, Qdrant projection |
| Simon UI | Chainlit iframe | Native React surface + Python streaming API |
| Agent persistence | In-memory checkpoints | Persistent Postgres checkpointer, optional Redis cache |
| Circular gallery | Animal demo only | Curated collections, shortlists, similar-property surfaces |

The verified inventory of the inherited Supabase schema, key posture, Storage, and Qdrant state — the factual baseline for all migration and contract work — is in the [schema and authorization discovery brief](../plans/schema-discovery-brief.md).

## Files that remain intentionally untouched

- `Simon.env` is local secret material and is ignored. Never inspect or copy it.
- `.claude-flow/` and `prompt.txt` are unrelated untracked local artifacts. Do not stage or modify them as part of marketplace work.
- The old sibling projects `../Simon` and `../Simon-Langchain` remain outside this project and are not sources for the new architecture.
