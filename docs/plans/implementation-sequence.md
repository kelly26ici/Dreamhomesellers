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

1. Add Supabase Auth and server-side role checks.
2. Implement owner-scoped draft creation and revision editing.
3. Implement moderator review and auditable decision commands.
4. Create published-revision pointer and immutable historical revisions.
5. Add outbox records for all publish/withdraw/revision transitions.
6. Add Row Level Security and authorization tests.

**Gate:** a buyer cannot read a draft or submitted listing, and an owner cannot access another owner’s records.

## 3. Establish media ingestion before marketing it

1. Design signed/direct upload authorization.
2. Store originals privately.
3. Add validation, metadata treatment, moderation checks, derivative creation, and job retry/idempotency.
4. Persist per-image structured observations and a revision-level visual dossier.
5. Publish only approved derivatives attached to a published revision.

**Gate:** uploaded media can be safely retried, moderated, and withdrawn without orphaning buyer-visible assets.

## 4. Build real buyer discovery

1. Build the published listing read model and property detail route.
2. Build dense, URL-backed search with structured filters and cursor/page semantics.
3. Add save, compare, similar, inquiry, and viewing interactions with appropriate identity gating.
4. Replace hardcoded/global sample inventory with database-backed Kenyan inventory or explicitly non-inventory editorial material.
5. Add a constrained circular-gallery experience only for curated/small property sets.

**Gate:** every buyer-facing card and detail view resolves from a current published revision, not an old static object or vector payload.

## 5. Add retrieval quality and native Simon

1. Build a Kenya-focused labeled search/retrieval evaluation dataset.
2. Evaluate existing/free-tier text embedding and model options against it.
3. Implement buyer-safe Qdrant projection and Postgres hydration.
4. Add FastAPI streaming boundary and native React Simon UI.
5. Send typed page context with every relevant turn.
6. Add persistent conversation state, consent, constrained tools, and audit records.
7. Retain Chainlit only as a temporary debug interface until the native path passes parity checks.

**Gate:** Simon cannot answer from stale, unpublished, browser-supplied, or ungrounded facts.

## 6. Add advanced workflows only after the foundation

1. Add owner drafting help using a Deep Agent or explicit LangGraph workflow.
2. Add internal/buyer research workflows where citations and artifacts justify longer agent work.
3. Add controlled durable preferences, summaries, and optional semantic recall.
4. Add CRM/calendar/integration consumers from the outbox.
5. Add operational monitoring, incident response, and retention/deletion procedures.

**Gate:** every automated action remains less authoritative than the domain service and is reversible/auditable where business policy requires it.

## First implementation task when this plan is approved

Start with a schema and authorization discovery brief, not a visual redesign. It should inventory the inherited Supabase objects, existing RLS, current property record fields, media storage state, and migration constraints without exposing credentials or production data in documentation.
