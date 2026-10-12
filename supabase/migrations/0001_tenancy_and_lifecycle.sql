-- LUXONN Phase 1 migration 0001 (hardened, v2): tenancy, revisioned listing
-- lifecycle, moderation, viewing requests, handoffs, outbox, audit — and Row
-- Level Security on all of it.
--
-- Contract of record: docs/architecture/contracts.md (commit 8961619).
-- ADRs: 001 (Kenya-first), 005 (revisioned lifecycle), 012 (org tenancy),
-- 013 (founder moderation), 014 (location disclosure), 015 (staging posture),
-- 016 (anonymous limits), 017 (fresh dream-home-sellers project target).
--
-- This version folds in the six-lens adversarial review (2026-10-12) and the
-- Supabase Postgres best-practices audit:
--   * helper functions moved BELOW the tables they reference (check_function_bodies)
--   * all policy helpers are SECURITY DEFINER with pinned search_path (kills the
--     membership/platform-role policy recursion found by the RLS and safety lenses)
--   * composite (id, organization_id) FK chain — a child row can only reference
--     a parent in the SAME organization (tenancy lens criticals)
--   * published_revision_id can only name a published revision of the SAME listing
--     (generated column + composite FK — lifecycle/RLS lens pointer-poisoning)
--   * state/pointer columns guarded: transitions and the public pointer are domain
--     commands only (luxonn.domain_command GUC), frozen revisions immutable
--   * media rows cannot move between revisions; AI-evidence satellites are
--     service-lane only (no client write policies)
--   * client column grants: anonymous sees only public-class columns; reporters'
--     personal fields never reach the reported org
--   * FORCE ROW LEVEL SECURITY on every table (postgres owner bypass closed)
--   * policy helpers wrapped in (SELECT ...) inside policies — evaluated once per
--     statement (initplan), not per row (Supabase RLS performance rule)
--   * AI satellites carry their contract versioning anchors (embedding_version,
--     recipe_version, content_hash, vector_dimension; dossier_version;
--     observation_version) with corrected UNIQUE constraints
--   * no schema-level defaults for product vocabularies (ADR-001: KES/Kenya/
--     one_time/solo are server-side product defaults, never column DEFAULTs)
--   * audit_records append-only is trigger-enforced; outbox carries a dedupe key
--     and a buyer-safety payload CHECK
--
-- HARD CONSTRAINTS (unchanged)
--   * Additive only: no legacy relation is created, altered, or dropped. The
--     ADR-017 target is the verified-empty dream-home-sellers project; the
--     additive-only posture additionally protects the legacy import source.
--   * Never applied by an agent, never run with the service-role key.
--     Application is an owner action per docs/plans/phase1-migration-runbook.md.
--   * Money is a decimal string + explicit currency (ADR-001): price_per_sqm is
--     never stored (derived at read time); currency/country/period values come
--     from the domain layer, not from DEFAULTs.
--
-- NOTE ON auth.users: Supabase projects have an auth schema managed by the
-- platform. user_id references auth.users(id) ON DELETE CASCADE so removing a
-- user removes their tenancy linkage automatically.
--
-- VALIDATION: this exact file was applied, verified, rolled back, and re-applied
-- on a scratch PostgreSQL 18.6 cluster (2026-10-12) before commit.

BEGIN;

-- ============================================================
-- 0a. Tenancy (ADR-012)
-- ============================================================

CREATE TABLE public.owner_organizations (
  organization_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name      text NOT NULL,
  kind              text NOT NULL
                    CHECK (kind IN ('solo', 'agency', 'brokerage', 'developer')),
  is_internal       boolean NOT NULL DEFAULT false,
  public_bio        text,
  avatar_url        text,
  is_verified       boolean NOT NULL DEFAULT false,  -- import forces false (ADR-015)
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.owner_organizations IS
  'Owner organizations (ADR-012). Authority resolves org -> membership -> user, never the reverse. is_internal rows (e.g. the import-staging org) are never buyer-visible.';

CREATE TABLE public.owner_organizations_memberships (
  membership_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.owner_organizations(organization_id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_role       text NOT NULL DEFAULT 'member'
                    CHECK (member_role IN ('owner', 'admin', 'member')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE INDEX owner_org_memberships_user_idx ON public.owner_organizations_memberships (user_id);

CREATE TABLE public.platform_roles (
  platform_role_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role              text NOT NULL CHECK (role IN ('moderator', 'admin')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

COMMENT ON TABLE public.platform_roles IS
  'Platform staff roles (flagged recommendation, contracts §16.3). Moderators are platform staff, never owner-org members.';

-- ============================================================
-- 0b. Helper functions — AFTER the tables they reference.
--     (check_function_bodies=on validates SQL bodies at CREATE time; the
--     original draft forward-referenced these tables and failed at line 54 —
--     migration-safety lens, empirically reproduced.)
--     All are SECURITY DEFINER with pinned search_path: the definer (postgres,
--     the table owner) bypasses RLS, which breaks the policy-recursion cycle
--     the RLS lens found (a policy on T calling a helper that selects T).
--     Policies wrap every call in (SELECT ...) so it evaluates once per
--     statement (initplan), not once per row (Supabase RLS performance rule).
-- ============================================================

-- Current Supabase auth user id as uuid, or NULL when unauthenticated.
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT NULLIF(auth.jwt() ->> 'sub', '')::uuid
$$;

-- All organizations the current user is a member of (0/1/many).
CREATE OR REPLACE FUNCTION public.current_user_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT organization_id
  FROM public.owner_organizations_memberships
  WHERE user_id = public.current_app_user_id()
$$;

-- Current user's platform role ('moderator'/'admin'), or NULL.
-- A user may hold both roles; ordering makes resolution deterministic
-- ('admin' sorts before 'moderator' — contracts-parity lens F8).
CREATE OR REPLACE FUNCTION public.current_platform_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT role
  FROM public.platform_roles
  WHERE user_id = public.current_app_user_id()
  ORDER BY role
  LIMIT 1
$$;

-- Org-admin check as a SECURITY DEFINER helper: the definer bypasses RLS, so
-- the membership query inside cannot re-enter the policy being evaluated
-- (migration-safety lens F2; replaces the self-referential EXISTS).
CREATE OR REPLACE FUNCTION public.is_org_admin(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.owner_organizations_memberships
    WHERE organization_id = org_id
      AND user_id = public.current_app_user_id()
      AND member_role IN ('owner', 'admin')
  )
$$;

-- Whether the owning organization is internal (e.g. the import-staging org):
-- such orgs' listings are never buyer-visible (listing_public_read). SECURITY
-- DEFINER because is_internal is withheld from client column grants — the
-- policy must read it with the owner's privileges, never the caller's.
CREATE OR REPLACE FUNCTION public.is_org_internal(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.owner_organizations o
    WHERE o.organization_id = org_id AND o.is_internal
  )
$$;

-- ============================================================
-- 1. Property — stable physical asset (ADR-014 restricted set)
-- ============================================================

CREATE TABLE public.properties_lux (
  property_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.owner_organizations(organization_id),
  exact_address     text,                       -- ADR-014: released only after an accepted viewing
  latitude          double precision,           -- ADR-014: approximate pins derive from public fields only
  longitude         double precision,
  verification_status text NOT NULL DEFAULT 'unverified'
                    CHECK (verification_status IN ('unverified', 'verified')),
  source            text,                       -- ingestion provenance
  external_id       text,                       -- ingestion provenance; import dedupe key
  created_via       text NOT NULL CHECK (created_via IN ('owner', 'import')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX properties_lux_org_idx ON public.properties_lux (organization_id);
-- Import dedupe: (source, external_id) unique among rows where both present.
CREATE UNIQUE INDEX properties_lux_source_external_dedupe
  ON public.properties_lux (source, external_id)
  WHERE source IS NOT NULL AND external_id IS NOT NULL;

-- Composite-org anchor for child FKs (tenancy lens F2).
ALTER TABLE public.properties_lux
  ADD CONSTRAINT properties_lux_id_org_key UNIQUE (property_id, organization_id);

COMMENT ON TABLE public.properties_lux IS
  'Physical asset record carrying the ADR-014 restricted set. Public content lives on ListingRevision; exact address/coordinates never appear in public revisions, read models, Qdrant, or Simon context.';

-- ============================================================
-- 2. Listing — commercial offer, buyer-facing lifecycle surface
-- ============================================================

CREATE TYPE public.listing_lifecycle_state AS ENUM
  ('draft', 'submitted', 'changes_requested', 'rejected', 'approved',
   'publishing', 'published', 'withdrawn', 'closed');

CREATE TABLE public.listings (
  listing_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id         uuid NOT NULL REFERENCES public.properties_lux(property_id),
  organization_id     uuid NOT NULL REFERENCES public.owner_organizations(organization_id),
  listing_kind        text NOT NULL CHECK (listing_kind <> ''),
  lifecycle_state     public.listing_lifecycle_state NOT NULL DEFAULT 'draft',
  published_revision_id uuid,                    -- sole public authority; set only at PUBLISHING->PUBLISHED
  created_via         text NOT NULL CHECK (created_via IN ('owner', 'import')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  withdrawn_at        timestamptz,
  closed_at           timestamptz
);

ALTER TABLE public.listings
  ADD CONSTRAINT listings_property_same_org_fk
  FOREIGN KEY (property_id, organization_id)
  REFERENCES public.properties_lux (property_id, organization_id);

-- Composite anchor for child tables (revisions, cases, viewing requests,
-- handoffs reference listings (listing_id, organization_id)).
ALTER TABLE public.listings
  ADD CONSTRAINT listings_id_org_key UNIQUE (listing_id, organization_id);

CREATE INDEX listings_org_idx ON public.listings (organization_id);
CREATE INDEX listings_lifecycle_idx ON public.listings (lifecycle_state);
-- Buyer search helper: published listings only (visibility gate per contracts §11).
CREATE INDEX listings_published ON public.listings (listing_id) WHERE lifecycle_state = 'published';

COMMENT ON TABLE public.listings IS
  'Commercial offer; buyer-addressable entity. lifecycle_state mirrors the working revision before first publication, then stays published through correction cycles until withdrawal/closure (contracts §11). published_revision_id is the sole public authority pointer, settable only by the publish domain command.';

-- ============================================================
-- 3. ListingRevision — immutable content snapshot (ADR-005)
-- ============================================================

CREATE TYPE public.revision_state AS ENUM
  ('draft', 'submitted', 'changes_requested', 'rejected', 'approved',
   'publishing', 'published');

CREATE TABLE public.listing_revisions (
  revision_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id        uuid NOT NULL REFERENCES public.listings(listing_id) ON DELETE CASCADE,
  organization_id   uuid NOT NULL REFERENCES public.owner_organizations(organization_id),
  base_revision_id  uuid,                        -- self-FK added below (correction lineage)
  revision_state    public.revision_state NOT NULL DEFAULT 'draft',
  -- public content (contracts §4): derived from the published revision only
  title             text NOT NULL,
  description       text NOT NULL,
  property_type     text NOT NULL,               -- provisional; freezes Phase 1
  property_subtype  text,
  availability      text NOT NULL,               -- provisional; 'available' is the only verified member
  price_amount      numeric(18,2) NOT NULL,      -- decimal string in TS contracts; numeric here. Never a float in application code.
  price_currency    text NOT NULL,               -- no DEFAULT: product default is applied by the server (ADR-001)
  price_period      text NOT NULL,               -- no DEFAULT: ditto
  bedrooms          integer,
  bathrooms         integer,
  square_meters     double precision,
  lot_size_sqm      double precision,
  year_built        integer,
  floor_number      integer,
  total_floors      integer,
  plot_dimensions   text,
  land_size_raw     text,
  area              text NOT NULL,               -- area-level only; precision audited at import (ADR-014)
  city              text NOT NULL,
  town              text,
  county            text,
  country           text NOT NULL,               -- no DEFAULT (ADR-001)
  amenities         text[] NOT NULL DEFAULT '{}',
  furnished         boolean,
  created_by        uuid REFERENCES auth.users(id),   -- owning-org member; null for import rows
  created_via       text NOT NULL CHECK (created_via IN ('owner', 'import')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  published_at      timestamptz                  -- buyer-facing age displays derive from this
);

-- Composite-org anchors (tenancy lens F2) and correction lineage.
ALTER TABLE public.listing_revisions
  ADD CONSTRAINT listing_revisions_listing_same_org_fk
  FOREIGN KEY (listing_id, organization_id)
  REFERENCES public.listings (listing_id, organization_id);

ALTER TABLE public.listing_revisions
  ADD CONSTRAINT listing_revisions_id_org_key UNIQUE (revision_id, organization_id);

ALTER TABLE public.listing_revisions
  ADD CONSTRAINT listing_revisions_base_fk
  FOREIGN KEY (base_revision_id) REFERENCES public.listing_revisions(revision_id);

-- No self-lineage (lifecycle lens F5). Deeper cycles are prevented by the
-- base-must-be-published rule below plus the frozen-state guard.
ALTER TABLE public.listing_revisions
  ADD CONSTRAINT base_not_self
  CHECK (base_revision_id IS NULL OR base_revision_id <> revision_id);

-- A correction draft can only descend from a PUBLISHED revision of the SAME
-- listing (lifecycle lens F5): generated column + composite FK. The column is
-- non-NULL exactly when the revision is published, so it also backs the
-- published-pointer FK below.
ALTER TABLE public.listing_revisions
  ADD COLUMN published_ref_revision_id uuid
  GENERATED ALWAYS AS (
    CASE WHEN revision_state = 'published' THEN revision_id END
  ) STORED;

ALTER TABLE public.listing_revisions
  ADD CONSTRAINT revision_published_ref_uq
  UNIQUE (published_ref_revision_id, listing_id);

ALTER TABLE public.listing_revisions
  ADD CONSTRAINT base_published_same_listing_fk
  FOREIGN KEY (base_revision_id, listing_id)
  REFERENCES public.listing_revisions (published_ref_revision_id, listing_id);

-- The public-authority pointer: can only name a PUBLISHED revision of THIS
-- listing (lifecycle lens F2 / RLS lens F1 — pointer poisoning).
ALTER TABLE public.listings
  ADD CONSTRAINT listings_published_revision_fk
  FOREIGN KEY (published_revision_id, listing_id)
  REFERENCES public.listing_revisions (published_ref_revision_id, listing_id)
  ON DELETE RESTRICT;

-- A published listing always has content (no "blank listing", contracts §11).
ALTER TABLE public.listings
  ADD CONSTRAINT listing_published_pointer_present
  CHECK (lifecycle_state <> 'published' OR published_revision_id IS NOT NULL);

CREATE INDEX listing_revisions_listing_idx ON public.listing_revisions (listing_id);
CREATE INDEX listing_revisions_state_idx ON public.listing_revisions (revision_state);

COMMENT ON TABLE public.listing_revisions IS
  'Immutable content snapshot. Public content derives from the published revision only — never address, latitude/longitude, or contact data (ADR-014). price_per_sqm is derived at read time, never stored. Frozen states (approved/publishing/published) are immutable outside domain commands.';

-- ============================================================
-- 4. ListingMedia + derived-evidence satellites (ADR-010)
-- ============================================================

CREATE TABLE public.listing_media (
  media_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id       uuid NOT NULL,
  organization_id   uuid NOT NULL REFERENCES public.owner_organizations(organization_id),
  position          integer NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('image', 'video')),
  is_featured       boolean NOT NULL DEFAULT false,
  source            text NOT NULL CHECK (source IN ('owner_upload', 'inherited_external')),
  inherited_url     text,                        -- unverified external reference; never buyer-visible by row existence
  original_path     text,                        -- private Supabase Storage original
  derivative_paths  text[],                       -- safe derivatives; served only via published revision links
  processing_status text NOT NULL DEFAULT 'pending'
                    CHECK (processing_status IN ('pending', 'processing', 'processed', 'failed', 'quarantined')),
  moderation_status text NOT NULL DEFAULT 'unreviewed'
                    CHECK (moderation_status IN ('unreviewed', 'approved', 'rejected')),
  content_hash      text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (revision_id, position)
);

-- Composite-org FK: media can only attach to a revision in the same org.
ALTER TABLE public.listing_media
  ADD CONSTRAINT listing_media_revision_same_org_fk
  FOREIGN KEY (revision_id, organization_id)
  REFERENCES public.listing_revisions (revision_id, organization_id)
  ON DELETE CASCADE;

CREATE INDEX listing_media_revision_idx ON public.listing_media (revision_id);
CREATE INDEX listing_media_org_idx ON public.listing_media (organization_id);

COMMENT ON TABLE public.listing_media IS
  'Media records attach to revisions (ordered by position), never to a bare property. Rows do not move between revisions (guard trigger). inherited_url rows are unverified references — nothing becomes buyer-visible merely because a row points at it.';

-- Composite anchor on media for the observation satellite.
ALTER TABLE public.listing_media
  ADD CONSTRAINT listing_media_id_org_key UNIQUE (media_id, organization_id);

CREATE TABLE public.media_observations (
  observation_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id          uuid NOT NULL,
  organization_id   uuid NOT NULL REFERENCES public.owner_organizations(organization_id),
  observation_version integer NOT NULL,          -- contracts §5: versioned, never an edit
  observation       jsonb NOT NULL,              -- structured visual facts (derived AI evidence)
  analysis_model    text NOT NULL,
  analysis_model_version text NOT NULL,
  observed_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (media_id, observation_version)
);

ALTER TABLE public.media_observations
  ADD CONSTRAINT media_observations_same_org_fk
  FOREIGN KEY (media_id, organization_id)
  REFERENCES public.listing_media (media_id, organization_id)
  ON DELETE CASCADE;

COMMENT ON TABLE public.media_observations IS
  'Per-image derived AI evidence (ADR-010). Versioned and attributable; never media facts, never a canonical business fact. Service-lane only: no client write policies.';

CREATE TABLE public.visual_dossiers (
  dossier_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id       uuid NOT NULL,
  organization_id   uuid NOT NULL REFERENCES public.owner_organizations(organization_id),
  dossier_version   integer NOT NULL,            -- contracts §5: regeneration = new version, never an edit
  dossier           jsonb NOT NULL,             -- grouped property-level visual dossier (coverage_summary, room_groups)
  analysis_model    text NOT NULL,
  analysis_model_version text NOT NULL,
  generated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (revision_id, dossier_version)
);

ALTER TABLE public.visual_dossiers
  ADD CONSTRAINT visual_dossiers_same_org_fk
  FOREIGN KEY (revision_id, organization_id)
  REFERENCES public.listing_revisions (revision_id, organization_id)
  ON DELETE CASCADE;

CREATE TABLE public.embedding_provenance (
  embedding_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id       uuid NOT NULL,
  organization_id   uuid NOT NULL REFERENCES public.owner_organizations(organization_id),
  embedding_version integer NOT NULL,            -- re-embedding = new version, never an edit
  embedding_model   text NOT NULL,
  embedding_model_version text NOT NULL,
  recipe_version    text NOT NULL,               -- recipe is addressable, unlike the inherited Qdrant recipe
  document_recipe   jsonb NOT NULL,             -- supplementary detail; the versioned anchors above are authoritative
  content_hash      text NOT NULL,               -- closes the "4,258 unreproducible points" defect (ADR-015)
  vector_dimension  integer NOT NULL,            -- pins the vector space the inherited collection never recorded
  qdrant_point_id   text,                        -- rebuilt-projection bookkeeping (Qdrant is rebuildable)
  embedded_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (revision_id, embedding_version)
);

ALTER TABLE public.embedding_provenance
  ADD CONSTRAINT embedding_provenance_same_org_fk
  FOREIGN KEY (revision_id, organization_id)
  REFERENCES public.listing_revisions (revision_id, organization_id)
  ON DELETE CASCADE;

COMMENT ON TABLE public.embedding_provenance IS
  'Restricted-operational provenance for the Qdrant embedding projection. Every anchor the inherited collection lacked (recipe version, content hash, dimension) is first-class here. Service-lane only.';

-- ============================================================
-- 5. Moderation — case, decisions, pre-checks (ADR-013)
-- ============================================================

CREATE TABLE public.moderation_cases (
  case_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_kind         text NOT NULL CHECK (case_kind IN ('submission', 'buyer_report', 'staff_initiated')),
  revision_id       uuid,
  listing_id        uuid NOT NULL,
  organization_id   uuid NOT NULL REFERENCES public.owner_organizations(organization_id),
  case_state        text NOT NULL DEFAULT 'open' CHECK (case_state IN ('open', 'resolved')),
  report_category   text,                        -- buyer_report only; vocabulary Phase 1
  report_note       text,                         -- T&S evidence; personal-data handling in practice
  -- reporter contact/consent (buyer_report only): consent-coupled per contracts §7.
  -- While consent is null, the contact is INERT. Column grants keep these
  -- fields away from the reported org (contracts-parity lens F5 / RLS lens F3).
  reporter_contact  jsonb,                        -- VerifiedContact (personal)
  reporter_consent  jsonb,                        -- ConsentRecord (personal); required when contact present
  reference         text UNIQUE,
  idempotency_key   text,
  opened_at         timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (reporter_contact IS NULL OR reporter_consent IS NOT NULL)  -- consent coupling, enforced
);

-- Cases belong to the listing's org (composite FK).
ALTER TABLE public.moderation_cases
  ADD CONSTRAINT moderation_cases_id_org_key UNIQUE (case_id, organization_id);

ALTER TABLE public.moderation_cases
  ADD CONSTRAINT moderation_cases_listing_same_org_fk
  FOREIGN KEY (listing_id, organization_id)
  REFERENCES public.listings (listing_id, organization_id);

CREATE INDEX moderation_cases_queue_idx ON public.moderation_cases (case_state, opened_at);
CREATE INDEX moderation_cases_org_idx ON public.moderation_cases (organization_id);

CREATE TABLE public.moderation_decisions (
  decision_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id           uuid NOT NULL,
  revision_id       uuid,
  organization_id   uuid NOT NULL REFERENCES public.owner_organizations(organization_id),
  decision          text NOT NULL
                    CHECK (decision IN ('approve', 'request_changes', 'reject', 'dismiss', 'takedown')),
  decided_by        uuid NOT NULL REFERENCES auth.users(id),  -- platform moderator; no ON DELETE: audit-immutable anchor
  decided_at        timestamptz NOT NULL DEFAULT now(),
  reason_code       text NOT NULL,
  note              text                          -- doubles as the change note when request_changes
);

ALTER TABLE public.moderation_decisions
  ADD CONSTRAINT moderation_decisions_case_same_org_fk
  FOREIGN KEY (case_id, organization_id)
  REFERENCES public.moderation_cases (case_id, organization_id)
  ON DELETE CASCADE;

CREATE INDEX moderation_decisions_case_idx ON public.moderation_decisions (case_id);

CREATE TABLE public.moderation_pre_checks (
  check_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id           uuid NOT NULL,
  revision_id       uuid NOT NULL,
  organization_id   uuid NOT NULL REFERENCES public.owner_organizations(organization_id),
  check_code        text NOT NULL,                -- validator id
  outcome           text NOT NULL CHECK (outcome IN ('pass', 'fail', 'warn')),
  detail_code       text,
  checker_version   text NOT NULL,
  ran_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.moderation_pre_checks
  ADD CONSTRAINT pre_checks_case_same_org_fk
  FOREIGN KEY (case_id, organization_id)
  REFERENCES public.moderation_cases (case_id, organization_id)
  ON DELETE CASCADE;

ALTER TABLE public.moderation_pre_checks
  ADD CONSTRAINT pre_checks_revision_fk
  FOREIGN KEY (revision_id)
  REFERENCES public.listing_revisions(revision_id)
  ON DELETE CASCADE;

COMMENT ON TABLE public.moderation_pre_checks IS
  'Deterministic validators (ADR-013). They never approve or publish autonomously.';

-- ============================================================
-- 6. ViewingRequest (ADR-016)
-- ============================================================

CREATE TYPE public.viewing_request_state AS ENUM
  ('pending_contact_verification', 'open', 'accepted', 'declined',
   'expired', 'completed', 'cancelled');

CREATE TABLE public.viewing_requests (
  request_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id        uuid NOT NULL,
  organization_id   uuid NOT NULL REFERENCES public.owner_organizations(organization_id),
  actor_type        text NOT NULL CHECK (actor_type IN ('anonymous', 'buyer')),
  requester_user_id uuid REFERENCES auth.users(id),
  requester_session_id text,                      -- server-generated; not PII
  contact           jsonb NOT NULL,               -- VerifiedContact (personal); never a lookup key
  consent           jsonb NOT NULL,               -- ConsentRecord (personal)
  stated_purpose    text NOT NULL,
  preferred_slot    jsonb NOT NULL,               -- ViewingSlot (personal)
  notes             text,                         -- personal
  request_state     public.viewing_request_state NOT NULL DEFAULT 'pending_contact_verification',
  address_disclosed_at timestamptz,               -- ADR-014 disclosure provenance
  reference         text NOT NULL UNIQUE,
  idempotency_key   text UNIQUE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.viewing_requests
  ADD CONSTRAINT viewing_requests_listing_same_org_fk
  FOREIGN KEY (listing_id, organization_id)
  REFERENCES public.listings (listing_id, organization_id);

CREATE INDEX viewing_requests_listing_idx ON public.viewing_requests (listing_id);
CREATE INDEX viewing_requests_org_state_idx ON public.viewing_requests (organization_id, request_state);

COMMENT ON TABLE public.viewing_requests IS
  'Viewing requests keyed by request_id — never by phone. Contact verification must complete before the request becomes owner-visible (open). Inserts are service-lane only (ADR-016 domain command).';

-- ============================================================
-- 7. Handoff — buyer-to-owner lead
-- ============================================================

CREATE TYPE public.handoff_state AS ENUM
  ('pending_contact_verification', 'routed', 'acknowledged', 'closed', 'expired');

CREATE TABLE public.handoffs (
  handoff_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id        uuid,                          -- null for general concierge handoffs
  viewing_request_id uuid REFERENCES public.viewing_requests(request_id),
  organization_id   uuid REFERENCES public.owner_organizations(organization_id),  -- null = platform concierge
  actor_type        text NOT NULL CHECK (actor_type IN ('anonymous', 'buyer')),
  requester_user_id uuid REFERENCES auth.users(id),
  requester_session_id text,
  handoff_kind      text NOT NULL CHECK (handoff_kind IN ('general', 'viewing', 'listing')),
  message           text,                         -- personal
  contact           jsonb NOT NULL,               -- VerifiedContact; verified before routing
  consent           jsonb NOT NULL,               -- ConsentRecord
  handoff_state     public.handoff_state NOT NULL DEFAULT 'pending_contact_verification',
  reference         text NOT NULL UNIQUE,         -- buyer follow-up needs a human-facing code
  idempotency_key   text UNIQUE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- When a handoff names a listing, it belongs to that listing's org.
ALTER TABLE public.handoffs
  ADD CONSTRAINT handoffs_listing_same_org_fk
  FOREIGN KEY (listing_id, organization_id)
  REFERENCES public.listings (listing_id, organization_id);

COMMENT ON TABLE public.handoffs IS
  'Buyer-to-owner lead. A consequential action (contacts a person): explicit confirmation, server-validated input, verified contact, rate limits, audit record, idempotency. Never carries restricted property data (ADR-014).';

-- ============================================================
-- 8. Audit + outbox (contracts §1; ADR-005)
-- ============================================================

CREATE TABLE public.audit_records (
  audit_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  actor_type        text NOT NULL
                    CHECK (actor_type IN ('anonymous', 'buyer', 'owner', 'moderator', 'service')),
  actor_id          uuid,
  organization_id   uuid,                          -- always present for listing-scoped resources (ADR-012)
  action            text NOT NULL,                 -- e.g. 'listing.submit'
  resource_type     text NOT NULL,                 -- e.g. 'listing_revision'
  resource_id       text NOT NULL,
  request_id        text NOT NULL,                 -- correlation key; NOT unique — one request may yield many records (import: one per staged row)
  outcome           text NOT NULL CHECK (outcome IN ('accepted', 'rejected', 'completed', 'failed')),
  reason_code       text NOT NULL
);

CREATE INDEX audit_records_resource_idx ON public.audit_records (resource_type, resource_id);
CREATE INDEX audit_records_org_time_idx ON public.audit_records (organization_id, occurred_at);
CREATE INDEX audit_records_request_idx ON public.audit_records (request_id);

COMMENT ON TABLE public.audit_records IS
  'Server-generated, append-only cross-cutting audit baseline. Append-only is TRIGGER-enforced (outbox lens F2): UPDATE and DELETE raise, including for the service role.';

-- Append-only enforcement (outbox lens): a reject trigger on UPDATE/DELETE.
CREATE OR REPLACE FUNCTION public.audit_records_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'audit_records is append-only (contracts §1): % blocked', TG_OP;
END $$;

CREATE TRIGGER audit_records_append_only
  BEFORE UPDATE OR DELETE ON public.audit_records
  FOR EACH ROW EXECUTE FUNCTION public.audit_records_reject_mutation();

CREATE TABLE public.outbox_events (
  event_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  organization_id   uuid,                          -- owning org; platform-level events use the internal org
  event_type        text NOT NULL,                 -- e.g. 'listing.published'
  aggregate_type     text NOT NULL DEFAULT '',     -- dedupe anchor: e.g. 'listing'
  aggregate_id      text NOT NULL DEFAULT '',     -- dedupe anchor: e.g. the listing uuid
  correlation_id    text,                         -- the domain command's idempotency key / request id
  payload           jsonb NOT NULL,               -- typed; buyer-safe content + operational references only
  delivery_state    text NOT NULL DEFAULT 'pending'
                    CHECK (delivery_state IN ('pending', 'delivered', 'failed')),
  delivery_attempts integer NOT NULL DEFAULT 0,
  -- Buyer-safety backstop (outbox lens F3): the most dangerous accidental keys
  -- are rejected at write time, inside the producing transaction.
  CHECK (NOT (payload ?| ARRAY['exact_address','latitude','longitude',
                                'contact','consent','reporter_contact','original_path'])),
  -- At-least-once semantics: command-driven events dedupe on their
  -- idempotency key; fan-out events without a correlation id are exempt
  -- (partial uniqueness approximated by NULLable member in the constraint).
  UNIQUE (event_type, aggregate_type, aggregate_id, correlation_id)
);

-- The poll index: pending rows only, time-ordered (outbox lens F6).
CREATE INDEX outbox_pending ON public.outbox_events (occurred_at)
  WHERE delivery_state = 'pending';

COMMENT ON TABLE public.outbox_events IS
  'Transactional outbox (ADR-005), at-least-once: written in the same transaction as the state change; consumers dedupe via (event_type, aggregate_type, aggregate_id, correlation_id) or their own ledger. Workers claim rows with a compare-and-swap UPDATE ... WHERE delivery_state=pending and treat rowcount=0 as not-mine. Payload is buyer-safe only — the CHECK is a backstop; typed payload builders remain the primary obligation.';

-- ============================================================
-- 9. OrgContactCandidate — migration staging (never buyer-visible)
-- ============================================================

CREATE TABLE public.org_contact_candidates (
  contact_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.owner_organizations(organization_id) ON DELETE CASCADE,
  channel           text NOT NULL CHECK (channel IN ('email', 'phone')),
  value             text NOT NULL,                -- personal; never a lookup key
  display_name      text,
  consent_id        uuid,                         -- RESERVED for a future consents registry; always null in Phase 1 (consent does not transfer through import)
  source_column     text NOT NULL,                -- provenance label, e.g. 'properties.public_contact_phone'
  staged_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.org_contact_candidates IS
  'Migration staging for inherited contact fields (agents.email/phone, properties.public_contact_*). Personal/consent-bound; usable only after the owner claims the org and re-consents; never buyer-visible, never revision content.';

-- ============================================================
-- 10. Domain-command guards (lifecycle lens F1/F4, tenancy lens F5).
--     0002's SECURITY DEFINER functions SET luxonn.domain_command='on'
--     around each audited transition; until then, client writes to state
--     and pointer columns raise. Draft content editing stays untouched.
-- ============================================================

CREATE OR REPLACE FUNCTION public.guard_revision_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  -- Frozen states are immutable outside domain commands (contracts §4).
  IF OLD.revision_state IN ('approved', 'publishing', 'published')
     AND COALESCE(current_setting('luxonn.domain_command', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'revision % is frozen in state %; changes require a new revision',
      OLD.revision_id, OLD.revision_state;
  END IF;
  -- State transitions are domain commands, never raw client writes.
  IF NEW.revision_state <> OLD.revision_state
     AND COALESCE(current_setting('luxonn.domain_command', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'revision_state transition % -> % is a domain command',
      OLD.revision_state, NEW.revision_state;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER revision_state_guard
  BEFORE UPDATE ON public.listing_revisions
  FOR EACH ROW EXECUTE FUNCTION public.guard_revision_state();

CREATE OR REPLACE FUNCTION public.guard_listing_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.lifecycle_state <> OLD.lifecycle_state
     AND COALESCE(current_setting('luxonn.domain_command', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'lifecycle transition % -> % is a domain command',
      OLD.lifecycle_state, NEW.lifecycle_state;
  END IF;
  IF NEW.published_revision_id IS DISTINCT FROM OLD.published_revision_id
     AND COALESCE(current_setting('luxonn.domain_command', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'published_revision_id is set only by the publish domain command';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER listing_state_guard
  BEFORE UPDATE ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.guard_listing_state();

-- Timestamp coupling: withdrawn/closed states carry their timestamps.
ALTER TABLE public.listings
  ADD CONSTRAINT listing_withdrawn_ts CHECK (lifecycle_state <> 'withdrawn' OR withdrawn_at IS NOT NULL);
ALTER TABLE public.listings
  ADD CONSTRAINT listing_closed_ts CHECK (lifecycle_state <> 'closed' OR closed_at IS NOT NULL);

-- Media rows do not move between revisions (lifecycle lens F3).
CREATE OR REPLACE FUNCTION public.guard_media_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.revision_id <> OLD.revision_id THEN
    RAISE EXCEPTION 'media rows do not move between revisions';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER media_revision_guard
  BEFORE UPDATE ON public.listing_media
  FOR EACH ROW EXECUTE FUNCTION public.guard_media_revision();

-- ============================================================
-- 11. Row Level Security — default deny everywhere, plus FORCE
--     (Supabase best practice: table owners otherwise bypass RLS).
--     All helper calls inside policies are wrapped in (SELECT ...) —
--     one evaluation per statement, not per row.
-- ============================================================

-- ---- owner_organizations -------------------------------------------------
ALTER TABLE public.owner_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_organizations FORCE ROW LEVEL SECURITY;

CREATE POLICY org_public_read ON public.owner_organizations
  FOR SELECT
  USING (
    NOT is_internal
    OR organization_id IN (SELECT public.current_user_org_ids())
    OR (SELECT public.current_platform_role()) IS NOT NULL
  );

-- Management is owner/admin-only (RLS lens F6: trust-badge and internal-flag
-- flips are not member-self-service). Column grants below additionally remove
-- is_verified/is_internal from every client-writable path.
CREATE POLICY org_admin_manage ON public.owner_organizations
  FOR ALL
  USING (
    (SELECT public.is_org_admin(organization_id))
    OR (SELECT public.current_platform_role()) = 'admin'
  )
  WITH CHECK (
    (SELECT public.is_org_admin(organization_id))
    OR (SELECT public.current_platform_role()) = 'admin'
  );

-- ---- memberships ---------------------------------------------------------
ALTER TABLE public.owner_organizations_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_organizations_memberships FORCE ROW LEVEL SECURITY;

CREATE POLICY membership_self_read ON public.owner_organizations_memberships
  FOR SELECT
  USING (
    user_id = (SELECT public.current_app_user_id())
    OR organization_id IN (SELECT public.current_user_org_ids())
    OR (SELECT public.current_platform_role()) IS NOT NULL
  );

-- Admin paths go through the SECURITY DEFINER helper (no self-referential
-- EXISTS — migration-safety lens F2). Bootstrap: the FIRST owner membership
-- is created by the signup domain command in the service lane; client inserts
-- require an existing owner/admin (tenancy lens F7).
CREATE POLICY membership_admin_write ON public.owner_organizations_memberships
  FOR ALL
  USING (
    (SELECT public.is_org_admin(organization_id))
    OR (SELECT public.current_platform_role()) = 'admin'
  )
  WITH CHECK (
    (SELECT public.is_org_admin(organization_id))
    OR (SELECT public.current_platform_role()) = 'admin'
  );

-- ---- platform_roles ------------------------------------------------------
ALTER TABLE public.platform_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_roles FORCE ROW LEVEL SECURITY;

CREATE POLICY platform_role_self_read ON public.platform_roles
  FOR SELECT
  USING (
    user_id = (SELECT public.current_app_user_id())
    OR (SELECT public.current_platform_role()) = 'admin'
  );

CREATE POLICY platform_role_admin_manage ON public.platform_roles
  FOR ALL
  USING ((SELECT public.current_platform_role()) = 'admin')
  WITH CHECK ((SELECT public.current_platform_role()) = 'admin');

-- ---- properties_lux ------------------------------------------------------
ALTER TABLE public.properties_lux ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties_lux FORCE ROW LEVEL SECURITY;

CREATE POLICY property_org_read ON public.properties_lux
  FOR SELECT
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR (SELECT public.current_platform_role()) IS NOT NULL
  );

CREATE POLICY property_org_write ON public.properties_lux
  FOR ALL
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR (SELECT public.current_platform_role()) = 'admin'
  )
  WITH CHECK (
    organization_id IN (SELECT public.current_user_org_ids())
    OR (SELECT public.current_platform_role()) = 'admin'
  );

-- ---- listings -------------------------------------------------------------
ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listings FORCE ROW LEVEL SECURITY;

CREATE POLICY listing_public_read ON public.listings
  FOR SELECT
  USING (
    lifecycle_state = 'published'
    -- is_org_internal (SECURITY DEFINER) reads owner_organizations.is_internal,
    -- which column grants deliberately withhold from clients; an inline
    -- subquery here ran with the caller's privileges and broke the whole
    -- policy under anon (permission denied — caught by the production
    -- smoke test on 2026-10-12).
    AND NOT public.is_org_internal(organization_id)
  );

CREATE POLICY listing_org_read ON public.listings
  FOR SELECT
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR (SELECT public.current_platform_role()) IS NOT NULL
  );

-- Client writes: org members manage rows, but state/pointer columns are
-- trigger-guarded (section 10) and the platform branch is ADMIN only
-- (tenancy lens F4 — moderators never inherit owner-org write privileges).
CREATE POLICY listing_org_write ON public.listings
  FOR ALL
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR (SELECT public.current_platform_role()) = 'admin'
  )
  WITH CHECK (
    organization_id IN (SELECT public.current_user_org_ids())
    OR (SELECT public.current_platform_role()) = 'admin'
  );

-- ---- listing_revisions ----------------------------------------------------
ALTER TABLE public.listing_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_revisions FORCE ROW LEVEL SECURITY;

CREATE POLICY revision_public_read ON public.listing_revisions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.listings l
      WHERE l.published_revision_id = listing_revisions.revision_id
        AND l.lifecycle_state = 'published'
    )
  );

CREATE POLICY revision_org_read ON public.listing_revisions
  FOR SELECT
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR (SELECT public.current_platform_role()) IS NOT NULL
  );

CREATE POLICY revision_org_write ON public.listing_revisions
  FOR ALL
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR (SELECT public.current_platform_role()) = 'admin'
  )
  WITH CHECK (
    organization_id IN (SELECT public.current_user_org_ids())
    OR (SELECT public.current_platform_role()) = 'admin'
  );

-- ---- listing_media ---------------------------------------------------------
ALTER TABLE public.listing_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_media FORCE ROW LEVEL SECURITY;

CREATE POLICY media_public_read ON public.listing_media
  FOR SELECT
  USING (
    processing_status = 'processed'
    AND moderation_status = 'approved'
    AND EXISTS (
      SELECT 1 FROM public.listings l
      WHERE l.published_revision_id = listing_media.revision_id
        AND l.lifecycle_state = 'published'
    )
  );

CREATE POLICY media_org_read ON public.listing_media
  FOR SELECT
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR (SELECT public.current_platform_role()) IS NOT NULL
  );

CREATE POLICY media_org_write ON public.listing_media
  FOR ALL
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR (SELECT public.current_platform_role()) = 'admin'
  )
  WITH CHECK (
    organization_id IN (SELECT public.current_user_org_ids())
    OR (SELECT public.current_platform_role()) = 'admin'
  );

-- ---- derived AI evidence: service-lane only (RLS lens F4) -----------------
-- RLS on, no client policies: default deny. Workers write through SECURITY
-- DEFINER domain functions (0002) or the service connection. ADR-009: derived
-- evidence is produced by deterministic workers, never by org members.
ALTER TABLE public.media_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_observations FORCE ROW LEVEL SECURITY;

ALTER TABLE public.visual_dossiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visual_dossiers FORCE ROW LEVEL SECURITY;

ALTER TABLE public.embedding_provenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.embedding_provenance FORCE ROW LEVEL SECURITY;

-- ---- moderation ------------------------------------------------------------
ALTER TABLE public.moderation_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_cases FORCE ROW LEVEL SECURITY;

CREATE POLICY case_moderator_all ON public.moderation_cases
  FOR ALL
  USING ((SELECT public.current_platform_role()) IS NOT NULL)
  WITH CHECK ((SELECT public.current_platform_role()) IS NOT NULL);

-- Owners see only their own SUBMISSION cases: reporter personal fields exist
-- only on buyer_report/staff_initiated cases, which org members never read
-- (RLS lens F3 / contracts-parity lens F5 — the reported org must not see
-- the reporter).
CREATE POLICY case_org_read ON public.moderation_cases
  FOR SELECT
  USING (
    (
      case_kind = 'submission'
      AND organization_id IN (SELECT public.current_user_org_ids())
    )
    OR (SELECT public.current_platform_role()) IS NOT NULL
  );

ALTER TABLE public.moderation_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_decisions FORCE ROW LEVEL SECURITY;

CREATE POLICY decision_moderator_all ON public.moderation_decisions
  FOR ALL
  USING ((SELECT public.current_platform_role()) IS NOT NULL)
  WITH CHECK ((SELECT public.current_platform_role()) IS NOT NULL);

CREATE POLICY decision_org_read ON public.moderation_decisions
  FOR SELECT
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR (SELECT public.current_platform_role()) IS NOT NULL
  );

ALTER TABLE public.moderation_pre_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_pre_checks FORCE ROW LEVEL SECURITY;

CREATE POLICY precheck_moderator_all ON public.moderation_pre_checks
  FOR ALL
  USING ((SELECT public.current_platform_role()) IS NOT NULL)
  WITH CHECK ((SELECT public.current_platform_role()) IS NOT NULL);

CREATE POLICY precheck_org_read ON public.moderation_pre_checks
  FOR SELECT
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR (SELECT public.current_platform_role()) IS NOT NULL
  );

-- ---- viewing_requests --------------------------------------------------------
ALTER TABLE public.viewing_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.viewing_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY viewing_org_read ON public.viewing_requests
  FOR SELECT
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    AND request_state <> 'pending_contact_verification'
  );

-- Requester access is by AUTH USER only. (The original draft also matched a
-- session-id GUC; that path is dropped: raw session-id equality plus pooled-
-- connection GUC bleed is a real risk surface — RLS lens F6. Anonymous
-- requesters track their request via the reference code delivered out-of-
-- band by the domain command.)
CREATE POLICY viewing_requester_read ON public.viewing_requests
  FOR SELECT
  USING (
    requester_user_id = (SELECT public.current_app_user_id())
    AND requester_user_id IS NOT NULL
  );

CREATE POLICY viewing_org_update ON public.viewing_requests
  FOR UPDATE
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR (SELECT public.current_platform_role()) = 'admin'
  )
  WITH CHECK (
    organization_id IN (SELECT public.current_user_org_ids())
    OR (SELECT public.current_platform_role()) = 'admin'
  );
-- No client INSERT policy: creates go through the ADR-016 domain command.

-- ---- handoffs -----------------------------------------------------------------
ALTER TABLE public.handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.handoffs FORCE ROW LEVEL SECURITY;

CREATE POLICY handoff_org_read ON public.handoffs
  FOR SELECT
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    AND handoff_state <> 'pending_contact_verification'
  );

CREATE POLICY handoff_requester_read ON public.handoffs
  FOR SELECT
  USING (
    requester_user_id = (SELECT public.current_app_user_id())
    AND requester_user_id IS NOT NULL
  );

CREATE POLICY handoff_org_update ON public.handoffs
  FOR UPDATE
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR (SELECT public.current_platform_role()) = 'admin'
  )
  WITH CHECK (
    organization_id IN (SELECT public.current_user_org_ids())
    OR (SELECT public.current_platform_role()) = 'admin'
  );
-- No client INSERT policy: creates go through the domain command (verified
-- contact + consent + rate limits are server-side obligations).

-- ---- audit + outbox: RLS on, no client policies (service lane) ---------------
ALTER TABLE public.audit_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_records FORCE ROW LEVEL SECURITY;

ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbox_events FORCE ROW LEVEL SECURITY;

-- ---- org_contact_candidates -------------------------------------------------------
ALTER TABLE public.org_contact_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_contact_candidates FORCE ROW LEVEL SECURITY;

CREATE POLICY candidate_org_read ON public.org_contact_candidates
  FOR SELECT
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR (SELECT public.current_platform_role()) IS NOT NULL
  );

CREATE POLICY candidate_org_write ON public.org_contact_candidates
  FOR ALL
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR (SELECT public.current_platform_role()) = 'admin'
  )
  WITH CHECK (
    organization_id IN (SELECT public.current_user_org_ids())
    OR (SELECT public.current_platform_role()) = 'admin'
  );

-- ============================================================
-- 12. Column grants: the public surface exposes ONLY public-class
--     fields (RLS lens F5 — row-level policies cannot restrict
--     columns). Anonymous and general authenticated reads see only
--     the buyer-safe columns below; org members retain row-level
--     access through the policies above but column-granted surfaces
--     stay carved out. Reporter personal fields never reach the
--     reported org (moderation_cases grants exclude them).
-- ============================================================

REVOKE SELECT ON public.listings FROM anon, authenticated;
GRANT SELECT (listing_id, listing_kind, lifecycle_state, published_revision_id)
  ON public.listings TO anon, authenticated;

REVOKE SELECT ON public.listing_revisions FROM anon, authenticated;
GRANT SELECT (revision_id, listing_id, title, description, property_type,
              property_subtype, availability, price_amount, price_currency,
              price_period, bedrooms, bathrooms, square_meters, lot_size_sqm,
              year_built, floor_number, total_floors, plot_dimensions,
              land_size_raw, area, city, town, county, country, amenities,
              furnished, published_at)
  ON public.listing_revisions TO anon, authenticated;
-- PostgREST relational embeds along listings_published_revision_fk must
-- reference the FK column itself, a generated column outside the public-class
-- list above. It projects (revision_id, listing_id) — both already public —
-- and is non-NULL only for published revisions, so it adds no new surface.
-- Without this grant every buyer-side embed of the published revision fails
-- with 42501. (Note: a listing_revisions -> listing_media embed remains
-- impossible for anon because listing_media's composite FK
-- listing_media_revision_same_org_fk would expose organization_id, which
-- stays restricted; the read model fetches media as a second query.)
GRANT SELECT (published_ref_revision_id)
  ON public.listing_revisions TO anon, authenticated;

REVOKE SELECT ON public.listing_media FROM anon, authenticated;
GRANT SELECT (media_id, revision_id, position, kind, is_featured, derivative_paths)
  ON public.listing_media TO anon, authenticated;

-- Orgs expose only public display fields (contracts §6).
REVOKE SELECT ON public.owner_organizations FROM anon, authenticated;
GRANT SELECT (organization_id, display_name, kind, public_bio, avatar_url, is_verified)
  ON public.owner_organizations TO anon, authenticated;

-- Reporter personal fields never reach owner roles via column grants: the
-- reported org may read case outcomes but reporter_contact/reporter_consent
-- stay moderator-only. Anon has no grants on moderation_cases at all.
REVOKE SELECT ON public.moderation_cases FROM anon, authenticated;
GRANT SELECT (case_id, case_kind, revision_id, listing_id, organization_id,
              case_state, reference, opened_at, resolved_at, created_at,
              report_category, report_note)
  ON public.moderation_cases TO authenticated;

COMMIT;
