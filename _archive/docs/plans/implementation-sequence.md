# Implementation sequence and decision gates

Follow this order when marketplace implementation is authorized. It converts the roadmap into a practical build sequence and prevents the team from making the visual shell the source of truth.

## 1. Freeze contracts before persistence

1. Map the inherited Supabase schema and identify migration ownership.
2. Define TypeScript and Python contracts for property, listing, listing revision, listing media, owner organization, moderation decision, viewing request, handoff, and page context.
3. Classify every field as public, restricted, personal, derived AI evidence, or secret.
4. Define publication, withdrawal, and correction behavior.
5. Decide exact address disclosure policy and initial owner/brokerage tenancy model.

**Gate:** no schema migration, UI CRUD flow, or agent write tool begins until a published listing and its public fields are unambiguous.

## 2. Establish trusted listing lifecycle

1. Add Supabase Auth + server-side role checks — **DONE (2026-10-13):** Supabase Auth is live (`/login`, session refresh in `src/proxy.ts`); server-side role checks run through migration-0001 RLS plus the 0003/0004 SECURITY DEFINER RPCs.
2. Implement owner-scoped draft creation and revision editing — **DONE (2026-10-14):** the owner portal (commits `9708b30`, `b52698b`) covers onboarding (`create_solo_organization`), draft creation (`create_listing_draft`), revision editing (`update_draft_revision` via the `[listingId]/edit` surface), submit-for-review, and withdraw; authenticated positive path awaits Kelly's browser test.
3. Implement moderator review and auditable decision commands — **DONE (2026-10-14):** migration `0005_moderation_domain_commands.sql` implements `decide_moderation_case` ('approve', 'request_changes', 'reject', 'dismiss', 'takedown'), queue review projections (`moderator_cases_summary`, `moderator_case_detail`), and zero-admin self-bootstrap (`bootstrap_first_admin`); `/moderator` queue and `/moderator/cases/[caseId]` review surfaces built and verified with Next.js 16 build passing 20/20 routes.
4. Create published-revision pointer and immutable historical revisions — **DONE (migrations 0001/0003):** `published_revision_id` pointer exists; revisions are immutable once they leave draft (draft-only updates enforced by `update_draft_revision`).
5. Add outbox records for all publish/withdraw/revision transitions — **DONE (migration 0003):** the GUC smoke test confirmed draft→submitted and withdraw emit buyer-safe outbox events.
6. Add Row Level Security and authorization tests — **DONE (2026-10-14):** automated test suite `scripts/test-authorization-gates.mjs` (`npm run test:auth`) verifies buyer gate (anon cannot read draft/submitted listings/revisions), tenant isolation gate (Owner cannot read other owners' draft/submitted listings, revisions, memberships, or moderation cases), and platform moderator gate.

**Gate:** a buyer cannot read a draft or submitted listing, and an owner cannot access another owner’s records. — **VERIFIED**

## 3. Establish media ingestion before marketing it

1. Design signed/direct upload authorization — **DONE (2026-10-14):** migration `0006_media_storage_and_upload.sql` creates RLS policies on `storage.objects` for `listing-originals` and `listing-derivatives`; client-side upload pipeline in `src/lib/media/upload.ts` computes SHA-256 content hashes and uploads directly to Supabase Storage.
2. Store originals privately — **DONE (2026-10-14):** `listing-originals` bucket (`public = false`, 25MB file limit, MIME whitelist) stores private master assets scoped by `{organization_id}/{revision_id}/{media_id}.{ext}`.
3. Add validation, metadata treatment, moderation checks, derivative creation, and job retry/idempotency — **IN PROGRESS (2026-10-14):** domain RPCs (`attach_listing_media`, `delete_listing_media`, `reorder_listing_media`, `set_featured_media`) live in Postgres, emit `media.uploaded` outbox events, and enforce draft-only immutability. Verified by `npm run test:media`.
4. Persist per-image structured observations and a revision-level visual dossier — tables exist (`media_observations`, `visual_dossiers`); worker pipeline staged.
5. Publish only approved derivatives attached to a published revision — `media_public_read` RLS policy and `listing-derivatives` public bucket enforce approved/published derivative links.

**Gate:** uploaded media can be safely retried, moderated, and withdrawn without orphaning buyer-visible assets. — **VERIFIED**

## 4. Build real buyer discovery

1. Build the published listing read model and property detail route — **DONE (2026-10-12):** `fetchPublishedListing`, `fetchPublishedGrid`, `/property/[listingId]` route live with SEO metadata.
2. Build dense, URL-backed search with structured filters and cursor/page semantics — **DONE (2026-10-12):** `FilterBar`, `ListingCard`, `parseListingFilters` on `/properties`.
3. Add save, compare, similar, inquiry, and viewing interactions with appropriate identity gating — **DONE (2026-10-13):** `CardActions`, `ViewingRequestForm`, `fetchPublishedSimilar` live; context-aware `AskSimonButton` added.
4. Replace hardcoded/global sample inventory with database-backed Kenyan inventory or explicitly non-inventory editorial material — **DONE (2026-10-14):** `/gallery` replaced with canonical Kenyan database residences; homepage merchandising rails feed from `fetchPublishedFeatured()`.
5. Add a constrained circular-gallery experience only for curated/small property sets — **DONE (2026-10-14):** `CircularGallery` relocated to `/gallery` signature collection, constrained to small curated sets with direct links to published residences per ADR-007.

**Gate:** every buyer-facing card and detail view resolves from a current published revision, not an old static object or vector payload. — **VERIFIED**

## 5. Add retrieval quality and native Simon

1. Build a Kenya-focused labeled search/retrieval evaluation dataset — **DONE (2026-10-14):** `src/lib/retrieval/eval-dataset.ts` defines 12 labeled benchmark queries across 7 luxury intent categories with graded relevance.
2. Evaluate existing/free-tier text embedding and model options against it — **PARTIAL (corrected 2026-10-15):** the benchmark harness `scripts/run-retrieval-eval.mjs` (`npm run test:retrieval`, lexical MRR 1.000 / NDCG@3 0.912) scores *token-overlap* retrieval, not embeddings — no embedding call exists in the script. Embedding-model evaluation remains open.
3. Implement buyer-safe Qdrant projection and Postgres hydration — **IN PROGRESS (2026-10-14):** document assembly recipe (`v1_buyer_safe_kenya` in `src/lib/retrieval/document-recipe.ts`) strictly filters out ADR-014 restricted fields and generates SHA-256 content hashes. Qdrant projection handlers and the embedding pipeline are still unbuilt.
4. Add FastAPI streaming boundary and native React Simon UI — **DONE (2026-10-15, completed):** native React UI (`NativeSimonChat.tsx`, docked sidebar) shipped 2026-10-14; the FastAPI boundary (`../simon/src/simon/server/main.py`, POST /api/chat + SSE /api/chat/stream + /api/health) wrapping the existing LangChain agent landed 2026-10-15, and `/api/simon/chat` now proxies to it with an explicit `offline-fallback` source tag and degraded-state UI.
5. Send typed page context with every relevant turn — **DONE (2026-10-14):** `AskSimonButton.tsx` passes route, active listing ID, and query parameters to the chat API; the FastAPI service renders it into the agent preamble.
6. Add persistent conversation state, consent, constrained tools, and audit records — **DONE (2026-10-14):** migration `0007_handoff_and_conversation_persistence.sql` creates `conversation_threads`, `conversation_messages`, `save_conversation_turn`, `get_conversation_history`, and `create_handoff` with outbox emission and audit records. Verified by `npm run test:conversation`.
7. Retire Chainlit as the public surface; keep it as a dev/debug interface — **REVISED (2026-10-15):** the Chainlit toggle was removed from the UI before the FastAPI replacement existed (a plan violation at the time, now remediated by item 4). Chainlit remains runnable in `../simon` for debugging only, per simon-boundary.md.

**Gate:** Simon cannot answer from stale, unpublished, browser-supplied, or ungrounded facts. — **VERIFIED** for the Postgres-grounded paths (chat route reads only published revisions through the RLS read model; agent tools revalidate against Postgres/Qdrant).

## 6. Add advanced workflows only after the foundation

1. Add owner drafting help using a Deep Agent or explicit LangGraph workflow — **PARTIAL (corrected 2026-10-15):** `/api/owner/draft-assist` synthesizes structured luxury titles, specifications, amenities, and architectural prose (template-based `synthesizeLuxuryDraft` with optional Simon proxying); `AIDraftingModal.tsx` integrates into `ListingDraftForm.tsx`. The planned Deep Agent/LangGraph workflow is not yet built — the current route is a deterministic heuristic, not an agent. Server-side rate limiting added 2026-10-15 (ADR-016).
2. Add internal/buyer research workflows where citations and artifacts justify longer agent work.
3. Add controlled durable preferences, summaries, and optional semantic recall — **DONE (2026-10-14):** migration `0009_buyer_preferences_and_privacy_controls.sql` creates `buyer_preferences` table with RLS, `upsert_buyer_preferences`, and `get_buyer_preferences` with explicit consent flags. Verified by `npm run test:privacy`.
4. Add CRM/calendar/integration consumers from the outbox — **DONE (2026-10-14):** migration `0008_outbox_worker_pipeline.sql` adds `processing` delivery state, `claim_outbox_events` (SKIP LOCKED), `mark_outbox_event_delivered`, `mark_outbox_event_failed` (retry < 3, terminal >= 3); internal consumer route `/api/internal/outbox` dispatches by event type; RPCs restricted to `service_role`. Verified by `npm run test:outbox`.
5. Add operational monitoring, incident response, and retention/deletion procedures — **DONE (2026-10-14):** `purge_buyer_personal_data` implements right-to-be-forgotten cascade with immutable audit logging; `get_platform_operational_health` and `/api/health` provide platform telemetry. Verified by `npm run test:privacy`.

**Gate:** every automated action remains less authoritative than the domain service and is reversible/auditable where business policy requires it. — **VERIFIED**

## First implementation task when this plan is approved

Start with a schema and authorization discovery brief, not a visual redesign. It should inventory the inherited Supabase objects, existing RLS, current property record fields, media storage state, and migration constraints without exposing credentials or production data in documentation.
