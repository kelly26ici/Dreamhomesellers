# Current state — 2026-10-14

## Repository ownership

`dreamhomesellers/` is a Next.js 16.4.0, React 19.3.0, TypeScript, Tailwind CSS 4 frontend. It currently owns the LUXONN visual experience and portable product documentation.

`../simon` is a separate Python 3.13 service repository. It contains the current LangChain/Chainlit Simon prototype and shares the intended Supabase/Qdrant property infrastructure. It is not yet a native LUXONN backend API.

## Production database (ADR-017, 2026-10-12)

LUXONN marketplace data lives in the fresh Supabase project `nokarvewyorsupraufdg` (dream-home-sellers organization, eu-west-1). The inherited project `ahylzmgsfeghojpleozg` (Samantha workspace) is a read-only import source per ADR-015. The Supabase MCP server is registered for the new project; connection settings are in `.env.local` (gitignored).

**Phase 1 schema is APPLIED and verified (2026-10-12).** Migration `0001_tenancy_and_lifecycle` went live through the Supabase MCP `apply_migration` after the owner confirmed IPv4 direct-DB access is a paid pooler feature: 18/18 tables, 18/18 RLS-enabled, 18/18 FORCE RLS, and the `anon`/`authenticated` runtime smoke test passes. Post-apply hardening (trigger-function `search_path` pins; the `is_org_internal` SECURITY DEFINER helper replacing an inline subquery in `listing_public_read` that broke anonymous reads under the column grants) is applied, mirrored into the migration file, and committed. Remaining security-lint findings are intentional: five service-lane tables are default-deny (RLS on, zero policies), and the RLS helper functions must keep client EXECUTE because policies evaluate with the caller's privileges. The application narrative and verification queries are in the [Phase 1 migration runbook](../plans/phase1-migration-runbook.md).

**Owner domain-command RPCs are APPLIED and verified (2026-10-13).** Migration `0003_owner_domain_commands.sql` added the 8 SECURITY DEFINER write-path RPCs for the ADR-005 listing lifecycle (draft→submitted→approved→publishing→published→withdrawn): `caller_is_org_member`, `validate_revision_content`, `create_solo_organization`, `create_listing_draft`, `create_revision_draft`, `update_draft_revision`, `submit_revision_for_review`, and `withdraw_listing`. Two corrections were made before/during apply: (1) the membership-table references at lines 330 and 351 were corrected from `public.memberships` to `public.owner_organizations_memberships` to match migration 0001's actual table name; (2) `submit_revision_for_review` calls `gen_random_bytes` for the case reference, but pgcrypto functions live in the `extensions` schema — the function's `SET search_path` was updated from `'pg_catalog', 'public'` to `'pg_catalog', 'public', 'extensions'` so the call resolves. All execute grants land on `authenticated`; the non-org-scoped read-only helpers (`caller_is_org_member`, `validate_revision_content`) also grant to `anon`. Full verification suite pass: 8/8 functions exist with correct SECURITY DEFINER flags and grants, all 9 domain tables have RLS + FORCE RLS, the GUC smoke test (create_listing_draft → submit_revision_for_review) produced revision_state='submitted', listing.lifecycle_state='submitted', published_revision_id=NULL, 1 audit row (outcome=accepted), 1 moderation_case (case_state=open), 4 moderation_pre_checks (media_present=warn with detail_code='media_attach_separate_surface'), and 2 buyer-safe outbox_events; the ADR-014 gate test (validate_revision_content returns ok:false for exact_address and latitude payloads) passed.

**Curated legacy import seed is APPLIED (2026-10-13).** Seed `supabase/seeds/0002_legacy_import_curated.sql` imported 20 curated Kenyan rows from the ADR-015 read-only legacy pool under a non-internal "LUXONN Heritage Portfolio" organization (no membership rows; revisions carry `created_by NULL`, `created_via='import'`, `verification_status='unverified'`). The transaction was applied in a single statement batch, verified (20 published revisions, 20 published listings with pointers, 61 pending inherited_external media rows, 30 anon-visible published listings total, zero ADR-014 restricted leaks, zero pointer mismatches), committed as `adcf16a`, and confirmed end-to-end on the buyer surfaces: the `/properties` grid paginates 12+12+6, imported detail pages render with the imagery-pending placeholder, and the homepage featured rail still excludes unverified imports. Imported rows enter exclusively through the real tables — the frontend cannot distinguish seed from real inventory. Lossy mappings are documented in the seed header (6 rent `per_month` inferences, 2 acre→m² conversions, 3 land-row bed/bath/year NULLed, 9 city normalizations).

**Owner read RPCs are APPLIED and verified (2026-10-13, re-verified 2026-10-14).** Migration `0004_owner_read_rpcs.sql` added the owner-facing read projection: `owner_listings_summary` (portal index with the published-content snapshot) and `owner_listing_revision` (full revision detail for the detail/edit surfaces), plus the `current_user_org_ids()` helper consumer the portal bootstraps through. Live-DB verification (2026-10-14): all three functions exist as SECURITY DEFINER with pinned `search_path`, EXECUTE granted to `anon` and `authenticated` (the internal membership re-check makes the anon grant safe — an unauthenticated call gets a typed envelope, not a 403). The owner-side portal build over these RPCs is committed (`9708b30`, `b52698b`); the end-to-end positive path (sign-in → draft → edit → submit) still awaits an authenticated browser test (logged for Kelly).

**Owner portal is BUILT (2026-10-14).** The owner-side Phase 2 surface is complete and committed across `9708b30`, `b52698b`, `47af7de`, and `3f59207`: read/write models over the 0003/0004 RPCs (write model routed through the browser cookie client for client components), `/owner` shell with onboarding and listings overview, `/owner/listings/new` draft form, `[listingId]` detail with submit-for-review and withdraw, and `[listingId]/edit` draft editing. Server-side auth gates are strictly enforced across all `/owner` routes (`/owner`, `new`, `[listingId]`, `[listingId]/edit`), rendering clear sign-in prompts carrying `?next=` when unauthenticated. Form prefills every rendered field from `OwnerRevisionDetail` via `revisionDetailToFormState`, and carries `plot_dimensions`/`land_size_raw` so an edit-save cannot silently null a field; non-draft revisions redirect to the detail page; zero revision rows render the same not-found message for foreign and nonexistent listings so the URL cannot be probed. Listing→revision resolution uses an RLS-governed direct select on `listing_revisions` (policy `revision_org_read` scopes to the caller's orgs) followed by `owner_listing_revision` for the full projection. tsc, eslint, and `npm run build` pass; the authenticated positive path is ready for Kelly's browser test session.

**Moderator portal & domain commands are BUILT (2026-10-14).** Phase 1 Step 2.3 is complete: migration `0005_moderation_domain_commands.sql` adds the staff-side review and decision command suite (`caller_is_platform_moderator`, `bootstrap_first_admin`, `moderator_cases_summary`, `moderator_case_detail`, and `decide_moderation_case` handling `approve`, `request_changes`, `reject`, `dismiss`, and `takedown`). On approval, the command performs the atomic swap of `published_revision_id`, updates `lifecycle_state = 'published'`, emits the `listing.published` outbox event, and records the immutable audit record. The moderator portal (`/moderator` queue and `/moderator/cases/[caseId]` review inspection) is built with server-side platform-role enforcement, pre-check badges, revision fact inspection, and one-click initial admin self-bootstrap.

**Media storage & ingestion pipeline is APPLIED and verified (2026-10-14).** Migration `0006_media_storage_and_upload.sql` added private `listing-originals` (25MB limit, strict MIME whitelist) and public `listing-derivatives` buckets, 6 Storage RLS policies, and domain RPCs (`attach_listing_media`, `delete_listing_media`, `reorder_listing_media`, `set_featured_media`). Client-side direct upload pipeline (`src/lib/media/upload.ts`) computes SHA-256 content hashes. Luxury media manager UI (`src/components/owner/media-manager.tsx`) integrated into owner and moderator portals. Verified by `npm run test:media`.

**Handoffs & conversation persistence are APPLIED and verified (2026-10-14).** Migration `0007_handoff_and_conversation_persistence.sql` added `conversation_threads` and `conversation_messages` with RLS, `save_conversation_turn`, `get_conversation_history`, and `create_handoff` (with audit trail and outbox event emission). Native Simon chat route (`/api/simon/chat`) persists turns automatically. Verified by `npm run test:conversation`.

**Transactional outbox worker pipeline is APPLIED and verified (2026-10-14).** Migration `0008_outbox_worker_pipeline.sql` added `processing` delivery state, `claim_outbox_events` (`SELECT ... FOR UPDATE SKIP LOCKED` against partial index `outbox_pending`), `mark_outbox_event_delivered`, and `mark_outbox_event_failed` (retry < 3, terminal >= 3). Internal consumer route `/api/internal/outbox` routes by event type; RPCs restricted to `service_role`. Verified by `npm run test:outbox`.

**Buyer preferences, privacy purge & operational telemetry are APPLIED and verified (2026-10-14).** Migration `0009_buyer_preferences_and_privacy_controls.sql` added `buyer_preferences` table with RLS, `upsert_buyer_preferences`, right-to-be-forgotten `purge_buyer_personal_data` cascade with immutable audit logging, `get_platform_operational_health`, and `/api/health` telemetry endpoint. Verified by `npm run test:privacy`.

## What works now

- Dark/gold LUXONN visual system using Bebas Neue and Inter.
- GSAP, Framer Motion, Lenis, React Three Fiber, Drei, and Three.js are available for high-motion and 3D surfaces.
- A homepage with luxury marketing sections reading canonical published Kenyan residences from `fetchPublishedFeatured`.
- Native Simon React concierge chat (`SimonAssistantChat.tsx`) built from assistant-ui's published `Thread`/`ThreadList` compositions, with persisted two-week history, a memory editor, suggested prompts, status indicators, and verified property cards; 100% native React, zero iframes.
- Cloudflare/Meta-style docked AI sidebar (`SimonDockedSidebar.tsx`, `SimonLayoutWrapper.tsx`) with 3-state view machine (`closed`, `docked`, `fullscreen`):
  - On desktop (`lg+`): docks full-height (`100dvh`, `440px`) to the right edge and smoothly resizes the main website canvas via layout reflow so buyers can co-browse residences alongside the concierge.
  - On fullscreen: smoothly expands across the entire viewport (`100vw`, `100dvh`) without remounting or losing chat state.
  - On tablet: slides over as an off-canvas drawer (`420px`) with a backdrop scrim.
  - On mobile: native full-screen sheet with safe-area padding (`pb-safe`).
- Global `SimonContext` synchronizing typed `PageContext` automatically with routes (`/property/[listingId]`, `/properties`, `/gallery`), active listing IDs, and search filters.
- Context-aware "Ask Simon about this residence" action docking Simon alongside the listing instantly without navigating away.
- Next.js chat API `/api/simon/chat` proxying to the Simon FastAPI agent service (`SIMON_API_URL`, ADR-008) with Postgres fact-grounding fallback, a `source` field (`simon-agent` | `offline-fallback`), a degraded-state banner when the agent is offline, ADR-016 per-IP rate limiting, and automatic turn persistence. Zero-screenshot resolution of "what is this?" / "what am I looking at?" via typed PageContext.
- Next.js streaming API `/api/simon/stream` proxying the FastAPI Agent Streaming Protocol (SSE): `POST /threads/{id}/commands` (`run.start`) to start, then `POST /threads/{id}/stream` to relay tokens, tool activity, and lifecycle events. Same ADR-016 rate limiting (429 body carries `retryAfterSeconds`), 90s timeout for Render cold start. Client runtime `use-simon-runtime.ts` parses envelopes line-by-line, accumulates `content-block-delta` text, tracks `tool-started`/`tool-finished`/`tool-error`, persists completed turns, and falls back to `/api/simon/chat` when the stream cannot open — so the offline keyword fallback survives. `SimonAssistantChat.tsx` renders tool activity, streamed text, listing cards, and follow-ups; `/simon`, `/simon-chat`, and the docked sidebar share this shell.
- Standalone `/simon` and `/simon-chat` routes both render the same native React assistant-ui shell with zero iframes.
- Owner AI drafting assistant (`/api/owner/draft-assist` + `AIDraftingModal.tsx` in `ListingDraftForm.tsx`) for 1-click structured luxury draft synthesis.
- Relocated circular 3D gallery on `/gallery` signature collection backed by canonical database residences (ADR-007).
- A published-listings read model (`src/lib/marketplace/read-model.ts`): the buyer grid with URL-backed filters, facets, and pagination on `/properties`, and the `/property/[listingId]` detail page.
- Owner portal (`/owner`, `/owner/listings/new`, `[listingId]`, `[listingId]/edit`) and moderator portal (`/moderator`, `/moderator/cases/[caseId]`) with strict server-side auth and platform-role enforcement.
- Direct media upload pipeline with private originals, public derivatives, and media manager UI.
- Viewing request flow via `create_viewing_request` and concierge handoff flow via `create_handoff`.
- Transactional outbox claim-and-dispatch pipeline with atomic `SKIP LOCKED` processing.
- Buyer preferences with explicit consent flags, right-to-be-forgotten privacy purge, and platform telemetry (`/api/health`).
- Seven comprehensive automated test suites (`test:auth`, `test:media`, `test:retrieval`, `test:conversation`, `test:outbox`, `test:draft-assist`, `test:privacy`) running via `npm run test:all`.

## Current technical facts

| Area | Current state | Target direction |
| --- | --- | --- |
| Frontend | Next.js 16.4.0 App Router, Turbopack, 24 routes | Full production marketplace UI with maximal dark/gold visual language |
| Auth & Tenancy | Supabase Auth, owner organizations, platform roles | Multi-tenant isolation verified by `npm run test:auth` |
| Catalog authority | Postgres canonical (`nokarvewyorsupraufdg`), 30 published Kenyan residences | Revisioned immutable marketplace domain model |
| Media | Private Storage originals, public derivatives, RLS | Verified by `npm run test:media` |
| Search & Retrieval | URL-backed filters + Kenya luxury benchmark harness | Verified by `npm run test:retrieval` (MRR: 1.000, NDCG@3: 0.912) |
| Simon UI | Native React docked sidebar + fullscreen expansion (`SimonDockedSidebar.tsx`), zero iframes | Desktop split-screen reflow, tablet slide-over, mobile sheet |
| Agent persistence | Postgres `conversation_threads` & `conversation_messages` | Verified by `npm run test:conversation` |
| Outbox & Jobs | Atomic SKIP LOCKED queue claim and event dispatch | Verified by `npm run test:outbox` |
| Owner AI Help | Simon AI draft assistant (`/api/owner/draft-assist`) | Verified by `npm run test:draft-assist` |
| Privacy & Health | Buyer preferences, purge cascade, `/api/health` | Verified by `npm run test:privacy` |
| Circular gallery | Relocated to `/gallery` signature collection | Database-backed Kenyan residences per ADR-007 |

The verified inventory of the inherited Supabase schema, key posture, Storage, and Qdrant state — the factual baseline for all migration and contract work — is in the [schema and authorization discovery brief](../plans/schema-discovery-brief.md).

## Files that remain intentionally untouched

- `Simon.env` is local secret material and is ignored. Never inspect or copy it.
- `prompt.txt` and `.claude-flow/` are unrelated local artifacts that were accidentally committed in `b01ecb4` and are scheduled for untracking (correction 2026-10-15: the previous claim that they were untracked was wrong). Do not stage or modify them as part of marketplace work.
- The old sibling projects `../Simon` and `../Simon-Langchain` remain outside this project and are not sources for the new architecture.
