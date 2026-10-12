-- LUXONN Phase 1 migration 0001: tenancy, revisioned listing lifecycle, moderation,
-- viewing requests, handoffs, outbox, audit — and Row Level Security on all of it.
--
-- Contract of record: docs/architecture/contracts.md (commit 8961619).
-- ADRs: 001 (Kenya-first), 005 (revisioned lifecycle), 012 (org tenancy),
-- 013 (founder moderation), 014 (location disclosure), 015 (additive-only import),
-- 016 (anonymous limits).
--
-- HARD CONSTRAINTS
--   * Additive only: no legacy table (properties, property_images, agents,
--     scheduled_viewings, property_inquiries, property_submissions,
--     property_moderation_events, property_reports, conversation_*,
--     customer_profiles, bot_settings, request_outbox, mpesa_transactions,
--     schema_migrations) is created, altered, dropped, or named by a policy.
--     Rationale: the discovery brief found six legacy relations with rows
--     written by an unknown external component (open question 9); touching
--     them risks breaking a live integration nobody has audited.
--   * Never applied by an agent, never run with the service-role key.
--     Application is an owner action per the runbook.
--   * Every table below enables RLS and carries at least one policy; the
--     default posture is deny (RLS on, no policy = no rows).
--   * Money is a decimal string + explicit currency (ADR-001): numeric columns
--     never exist without their currency column, and price_per_sqm is never
--     stored (derived at read time).
--
-- NOTE ON auth.users: Supabase projects have an auth schema managed by the
-- platform. Membership.user_id references auth.users(id) with ON DELETE
-- CASCADE so removing a user removes their tenancy linkage automatically.

BEGIN;

-- ============================================================
-- Shared helpers
-- ============================================================

-- Current Supabase auth user id as uuid, or NULL when unauthenticated.
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(auth.jwt() ->> 'sub', '')::uuid
$$;

-- All organizations the current user is a member of (0/1/many).
CREATE OR REPLACE FUNCTION public.current_user_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
AS $$
  SELECT organization_id
  FROM public.owner_organizations_memberships
  WHERE user_id = public.current_app_user_id()
$$;

-- Current user's platform role ('moderator'/'admin'), or NULL.
CREATE OR REPLACE FUNCTION public.current_platform_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT role
  FROM public.platform_roles
  WHERE user_id = public.current_app_user_id()
  LIMIT 1
$$;

-- ============================================================
-- 0. Tenancy (ADR-012)
-- ============================================================

CREATE TABLE public.owner_organizations (
  organization_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name      text NOT NULL,
  kind              text NOT NULL DEFAULT 'solo'
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

CREATE INDEX ON public.owner_organizations_memberships (user_id);

CREATE TABLE public.platform_roles (
  platform_role_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role              text NOT NULL CHECK (role IN ('moderator', 'admin')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

COMMENT ON TABLE public.platform_roles IS
  'Platform staff roles (flagged recommendation, contracts §16.3). Moderators are platform staff, never owner-org members; this is the recommended shape so moderation cannot inherit owner-org privileges.';

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

CREATE INDEX ON public.properties_lux (organization_id);
-- Import dedupe: (source, external_id) unique among rows where both present.
CREATE UNIQUE INDEX properties_lux_source_external_dedupe
  ON public.properties_lux (source, external_id)
  WHERE source IS NOT NULL AND external_id IS NOT NULL;

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
  listing_kind        text NOT NULL,             -- provisional: sale/rent/shortlet; freezes Phase 1 via pg_enum audit
  lifecycle_state     public.listing_lifecycle_state NOT NULL DEFAULT 'draft',
  published_revision_id uuid,                    -- sole public authority; set only at PUBLISHING->PUBLISHED
  created_via         text NOT NULL CHECK (created_via IN ('owner', 'import')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  withdrawn_at        timestamptz,
  closed_at           timestamptz,
  CHECK (listing_kind <> '')
);

CREATE INDEX ON public.listings (organization_id);
CREATE INDEX ON public.listings (lifecycle_state);
-- Buyer search helper: published listings only (visibility gate per contracts §11).
CREATE INDEX listings_published ON public.listings (listing_id) WHERE lifecycle_state = 'published';

COMMENT ON TABLE public.listings IS
  'Commercial offer; buyer-addressable entity. lifecycle_state mirrors the working revision before first publication, then stays published through correction cycles until withdrawal/closure (contracts §11). published_revision_id is the sole public authority pointer.';

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
  base_revision_id  uuid,                        -- self-FK added below (forward reference)
  revision_state    public.revision_state NOT NULL DEFAULT 'draft',
  -- public content (contracts §4): derived from the published revision only
  title             text NOT NULL,
  description       text NOT NULL,
  property_type     text NOT NULL,               -- provisional; freezes Phase 1
  property_subtype  text,
  availability      text NOT NULL,               -- provisional; 'available' is the only verified member
  price_amount      numeric(18,2) NOT NULL,      -- decimal string in TS contracts; numeric here. Never a float in application code.
  price_currency    text NOT NULL DEFAULT 'KES', -- product default, not schema constant; never hardcoded in queries
  price_period      text NOT NULL DEFAULT 'one_time',  -- provisional; freezes Phase 1
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
  country           text NOT NULL DEFAULT 'Kenya',
  amenities         text[] NOT NULL DEFAULT '{}',
  furnished         boolean,
  created_by        uuid REFERENCES auth.users(id),   -- owning-org member; null for import rows
  created_via       text NOT NULL CHECK (created_via IN ('owner', 'import')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  published_at      timestamptz                  -- buyer-facing age displays derive from this
);

-- Self-reference (correction lineage: base_revision_id -> published revision).
ALTER TABLE public.listing_revisions
  ADD CONSTRAINT listing_revisions_base_fk
  FOREIGN KEY (base_revision_id) REFERENCES public.listing_revisions(revision_id);

-- The public-authority pointer, added after both tables exist.
ALTER TABLE public.listings
  ADD CONSTRAINT listings_published_revision_fk
  FOREIGN KEY (published_revision_id)
  REFERENCES public.listing_revisions(revision_id) ON DELETE RESTRICT;

CREATE INDEX ON public.listing_revisions (listing_id);
CREATE INDEX ON public.listing_revisions (revision_state);

COMMENT ON TABLE public.listing_revisions IS
  'Immutable content snapshot. Public content derives from the published revision only — never address, latitude/longitude, or contact data (ADR-014). price_per_sqm is derived at read time, never stored.';

-- ============================================================
-- 4. ListingMedia + derived-evidence satellites (ADR-010)
-- ============================================================

CREATE TABLE public.listing_media (
  media_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id       uuid NOT NULL REFERENCES public.listing_revisions(revision_id) ON DELETE CASCADE,
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

CREATE INDEX ON public.listing_media (revision_id);

COMMENT ON TABLE public.listing_media IS
  'Media records attach to revisions (ordered by position), never to a bare property. inherited_url rows are unverified references — nothing becomes buyer-visible merely because a row points at it.';

CREATE TABLE public.media_observations (
  observation_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id          uuid NOT NULL REFERENCES public.listing_media(media_id) ON DELETE CASCADE,
  organization_id   uuid NOT NULL REFERENCES public.owner_organizations(organization_id),
  observation       jsonb NOT NULL,              -- structured visual facts (derived AI evidence)
  model_id          text NOT NULL,
  model_version     text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.media_observations IS
  'Per-image derived AI evidence (ADR-010). Versioned and attributable; never media facts, never mixed into verified fact shapes, never a canonical business fact.';

CREATE TABLE public.visual_dossiers (
  dossier_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id       uuid NOT NULL REFERENCES public.listing_revisions(revision_id) ON DELETE CASCADE,
  organization_id   uuid NOT NULL REFERENCES public.owner_organizations(organization_id),
  dossier           jsonb NOT NULL,               -- grouped property-level visual dossier
  model_id          text NOT NULL,
  model_version     text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (revision_id, model_id, model_version)
);

CREATE TABLE public.embedding_provenance (
  provenance_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id       uuid NOT NULL REFERENCES public.listing_revisions(revision_id) ON DELETE CASCADE,
  organization_id   uuid NOT NULL REFERENCES public.owner_organizations(organization_id),
  embedding_model   text NOT NULL,
  embedding_model_version text NOT NULL,
  document_recipe   jsonb NOT NULL,               -- exact fields and text assembled for the vector
  qdrant_point_id   text,                         -- rebuilt-projection bookkeeping (Qdrant is rebuildable)
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.embedding_provenance IS
  'Restricted-operational provenance for the Qdrant embedding projection. The inherited 4,258-point collection recipe is unrecorded (ADR-015); this table makes every future projection reproducible.';

-- ============================================================
-- 5. Moderation — case, decisions, pre-checks (ADR-013)
-- ============================================================

CREATE TABLE public.moderation_cases (
  case_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_kind         text NOT NULL CHECK (case_kind IN ('submission', 'buyer_report', 'staff_initiated')),
  revision_id       uuid REFERENCES public.listing_revisions(revision_id),
  listing_id        uuid NOT NULL REFERENCES public.listings(listing_id),
  organization_id   uuid NOT NULL REFERENCES public.owner_organizations(organization_id),
  case_state        text NOT NULL DEFAULT 'open' CHECK (case_state IN ('open', 'resolved')),
  report_category   text,                        -- buyer_report only; vocabulary Phase 1
  report_note       text,                         -- T&S evidence; personal-data handling in practice
  -- reporter contact/consent (buyer_report only): consent-coupled per contracts §7.
  -- While consent is null, the contact is INERT: no moderator reply or contact attempt may use it.
  reporter_contact  jsonb,                        -- VerifiedContact (personal)
  reporter_consent  jsonb,                        -- ConsentRecord (personal); required when contact present
  reference         text UNIQUE,
  idempotency_key   text,
  opened_at         timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (reporter_contact IS NULL OR reporter_consent IS NOT NULL)  -- consent coupling, enforced
);

CREATE INDEX ON public.moderation_cases (case_state, opened_at);
CREATE INDEX ON public.moderation_cases (organization_id);

CREATE TABLE public.moderation_decisions (
  decision_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id           uuid NOT NULL REFERENCES public.moderation_cases(case_id) ON DELETE CASCADE,
  revision_id       uuid REFERENCES public.listing_revisions(revision_id),
  organization_id   uuid NOT NULL REFERENCES public.owner_organizations(organization_id),
  decision          text NOT NULL
                    CHECK (decision IN ('approve', 'request_changes', 'reject', 'dismiss', 'takedown')),
  decided_by        uuid NOT NULL REFERENCES auth.users(id),  -- platform moderator; fixes the inherited reviewer FK gap
  decided_at        timestamptz NOT NULL DEFAULT now(),
  reason_code       text NOT NULL,
  note              text                          -- doubles as the change note when request_changes
);

CREATE INDEX ON public.moderation_decisions (case_id);

CREATE TABLE public.moderation_pre_checks (
  check_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id           uuid NOT NULL REFERENCES public.moderation_cases(case_id) ON DELETE CASCADE,
  revision_id       uuid NOT NULL REFERENCES public.listing_revisions(revision_id),
  organization_id   uuid NOT NULL REFERENCES public.owner_organizations(organization_id),
  check_code        text NOT NULL,                -- validator id
  outcome           text NOT NULL CHECK (outcome IN ('pass', 'fail', 'warn')),
  detail_code       text,
  checker_version   text NOT NULL,
  ran_at            timestamptz NOT NULL DEFAULT now()
);

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
  listing_id        uuid NOT NULL REFERENCES public.listings(listing_id),
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

CREATE INDEX ON public.viewing_requests (listing_id);
CREATE INDEX ON public.viewing_requests (organization_id, request_state);

COMMENT ON TABLE public.viewing_requests IS
  'Viewing requests keyed by request_id — never by phone (the inherited phone-keyed lookups are abolished). Contact verification must complete before the request becomes owner-visible (open).';

-- ============================================================
-- 7. Handoff — buyer-to-owner lead
-- ============================================================

CREATE TYPE public.handoff_state AS ENUM
  ('pending_contact_verification', 'routed', 'acknowledged', 'closed', 'expired');

CREATE TABLE public.handoffs (
  handoff_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id        uuid REFERENCES public.listings(listing_id),  -- null for general concierge handoffs
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
  request_id        text NOT NULL,                 -- idempotency/correlation
  outcome           text NOT NULL CHECK (outcome IN ('accepted', 'rejected', 'completed', 'failed')),
  reason_code       text NOT NULL
);

CREATE INDEX ON public.audit_records (resource_type, resource_id);
CREATE INDEX ON public.audit_records (organization_id, occurred_at);
CREATE INDEX ON public.audit_records (request_id);

COMMENT ON TABLE public.audit_records IS
  'Server-generated, append-only cross-cutting audit baseline. No UPDATE/DELETE policy exists; application code treats it as append-only.';

CREATE TABLE public.outbox_events (
  event_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  organization_id   uuid,                          -- owning org; platform-level events use the internal org
  event_type        text NOT NULL,                 -- e.g. 'listing.published'
  payload           jsonb NOT NULL,                -- typed; buyer-safe content + operational references only — never restricted fields
  delivery_state    text NOT NULL DEFAULT 'pending'
                    CHECK (delivery_state IN ('pending', 'delivered', 'failed')),
  delivery_attempts integer NOT NULL DEFAULT 0
);

CREATE INDEX ON public.outbox_events (delivery_state, occurred_at);

COMMENT ON TABLE public.outbox_events IS
  'Transactional outbox (ADR-005). Written in the same transaction as the state change; consumed idempotently. The inherited request_outbox rows are legacy-only; the unknown writer of that table must not gain a second owner of this ledger.';

-- ============================================================
-- 9. OrgContactCandidate — migration staging (never buyer-visible)
-- ============================================================

CREATE TABLE public.org_contact_candidates (
  contact_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.owner_organizations(organization_id) ON DELETE CASCADE,
  channel           text NOT NULL CHECK (channel IN ('email', 'phone')),
  value             text NOT NULL,                -- personal; never a lookup key
  display_name      text,
  consent_id        uuid,                          -- null: consent does not transfer through import
  source_column     text NOT NULL,                -- provenance label, e.g. 'properties.public_contact_phone'
  staged_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.org_contact_candidates IS
  'Migration staging for inherited contact fields (agents.email/phone, properties.public_contact_*). Personal/consent-bound; usable only after the owner claims the org and re-consents; never buyer-visible, never revision content.';

-- ============================================================
-- 10. Row Level Security — default deny everywhere
-- ============================================================

-- ---- owner_organizations -------------------------------------------------
ALTER TABLE public.owner_organizations ENABLE ROW LEVEL SECURITY;
-- Buyers may see public org display fields of any org (public_bio etc. per
-- contracts §6). Internal orgs are invisible to non-members.
CREATE POLICY org_public_read ON public.owner_organizations
  FOR SELECT
  USING (
    NOT is_internal
    OR organization_id IN (SELECT public.current_user_org_ids())
    OR public.current_platform_role() IS NOT NULL
  );
CREATE POLICY org_member_manage ON public.owner_organizations
  FOR ALL
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR public.current_platform_role() IS NOT NULL
  )
  WITH CHECK (
    organization_id IN (SELECT public.current_user_org_ids())
    OR public.current_platform_role() IS NOT NULL
  );

-- ---- memberships ---------------------------------------------------------
ALTER TABLE public.owner_organizations_memberships ENABLE ROW LEVEL SECURITY;
-- A user may read their own memberships; org admins manage their org's.
CREATE POLICY membership_self_read ON public.owner_organizations_memberships
  FOR SELECT
  USING (
    user_id = public.current_app_user_id()
    OR organization_id IN (SELECT public.current_user_org_ids())
    OR public.current_platform_role() IS NOT NULL
  );
CREATE POLICY membership_admin_write ON public.owner_organizations_memberships
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.owner_organizations_memberships m
      WHERE m.organization_id = owner_organizations_memberships.organization_id
        AND m.user_id = public.current_app_user_id()
        AND m.member_role IN ('owner', 'admin')
    )
    OR public.current_platform_role() IS NOT NULL
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.owner_organizations_memberships m
      WHERE m.organization_id = owner_organizations_memberships.organization_id
        AND m.user_id = public.current_app_user_id()
        AND m.member_role IN ('owner', 'admin')
    )
    OR public.current_platform_role() IS NOT NULL
  );

-- ---- platform_roles ------------------------------------------------------
ALTER TABLE public.platform_roles ENABLE ROW LEVEL SECURITY;
-- Admin-only management; users may see their own roles.
CREATE POLICY platform_role_self_read ON public.platform_roles
  FOR SELECT
  USING (
    user_id = public.current_app_user_id()
    OR public.current_platform_role() = 'admin'
  );
CREATE POLICY platform_role_admin_manage ON public.platform_roles
  FOR ALL
  USING (public.current_platform_role() = 'admin')
  WITH CHECK (public.current_platform_role() = 'admin');

-- ---- properties_lux ------------------------------------------------------
ALTER TABLE public.properties_lux ENABLE ROW LEVEL SECURITY;
-- Owners see their own org's assets (including restricted address/coords for
-- viewings). Buyers never read properties directly: buyer surfaces resolve
-- through the listing's published revision only (ADR-014).
CREATE POLICY property_org_read ON public.properties_lux
  FOR SELECT
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR public.current_platform_role() IS NOT NULL
  );
CREATE POLICY property_org_write ON public.properties_lux
  FOR ALL
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR public.current_platform_role() IS NOT NULL
  )
  WITH CHECK (
    organization_id IN (SELECT public.current_user_org_ids())
    OR public.current_platform_role() IS NOT NULL
  );

-- ---- listings -------------------------------------------------------------
ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;
-- The buyer-facing public surface: only PUBLISHED listings are readable by
-- anyone (anonymous included). published_revision_id is the sole public
-- authority; all other fields are internal linkage (org/property ids are
-- opaque uuids and reveal nothing).
CREATE POLICY listing_public_read ON public.listings
  FOR SELECT
  USING (lifecycle_state = 'published');
-- Org members read+write their own listings (all states).
CREATE POLICY listing_org_read ON public.listings
  FOR SELECT
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR public.current_platform_role() IS NOT NULL
  );
CREATE POLICY listing_org_write ON public.listings
  FOR ALL
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR public.current_platform_role() IS NOT NULL
  )
  WITH CHECK (
    organization_id IN (SELECT public.current_user_org_ids())
    OR public.current_platform_role() IS NOT NULL
  );

-- ---- listing_revisions ----------------------------------------------------
ALTER TABLE public.listing_revisions ENABLE ROW LEVEL SECURITY;
-- The public content gate: a revision is public content only when it is the
-- published_revision_id of a PUBLISHED listing. Everything else (drafts,
-- pipeline states) is org-private.
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
    OR public.current_platform_role() IS NOT NULL
  );
CREATE POLICY revision_org_write ON public.listing_revisions
  FOR ALL
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR public.current_platform_role() IS NOT NULL
  )
  WITH CHECK (
    organization_id IN (SELECT public.current_user_org_ids())
    OR public.current_platform_role() IS NOT NULL
  );

-- ---- listing_media ---------------------------------------------------------
ALTER TABLE public.listing_media ENABLE ROW LEVEL SECURITY;
-- Public read: media of the published revision of a published listing, and
-- only when processing + moderation gates both pass (processed + approved).
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
    OR public.current_platform_role() IS NOT NULL
  );
CREATE POLICY media_org_write ON public.listing_media
  FOR ALL
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR public.current_platform_role() IS NOT NULL
  )
  WITH CHECK (
    organization_id IN (SELECT public.current_user_org_ids())
    OR public.current_platform_role() IS NOT NULL
  );

-- ---- media_observations / visual_dossiers / embedding_provenance -----------
-- Derived AI evidence: never public. Org members + platform staff only.
ALTER TABLE public.media_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY observation_org_all ON public.media_observations
  FOR ALL
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR public.current_platform_role() IS NOT NULL
  )
  WITH CHECK (
    organization_id IN (SELECT public.current_user_org_ids())
    OR public.current_platform_role() IS NOT NULL
  );

ALTER TABLE public.visual_dossiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY dossier_org_all ON public.visual_dossiers
  FOR ALL
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR public.current_platform_role() IS NOT NULL
  )
  WITH CHECK (
    organization_id IN (SELECT public.current_user_org_ids())
    OR public.current_platform_role() IS NOT NULL
  );

ALTER TABLE public.embedding_provenance ENABLE ROW LEVEL SECURITY;
CREATE POLICY provenance_org_all ON public.embedding_provenance
  FOR ALL
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR public.current_platform_role() IS NOT NULL
  )
  WITH CHECK (
    organization_id IN (SELECT public.current_user_org_ids())
    OR public.current_platform_role() IS NOT NULL
  );

-- ---- moderation ------------------------------------------------------------
ALTER TABLE public.moderation_cases ENABLE ROW LEVEL SECURITY;
-- Moderators see all cases. Owners see their org's cases (outcomes + change
-- notes, never other orgs'). Buyers never see cases.
CREATE POLICY case_moderator_all ON public.moderation_cases
  FOR ALL
  USING (public.current_platform_role() IS NOT NULL)
  WITH CHECK (public.current_platform_role() IS NOT NULL);
CREATE POLICY case_org_read ON public.moderation_cases
  FOR SELECT
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR public.current_platform_role() IS NOT NULL
  );

ALTER TABLE public.moderation_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY decision_moderator_all ON public.moderation_decisions
  FOR ALL
  USING (public.current_platform_role() IS NOT NULL)
  WITH CHECK (public.current_platform_role() IS NOT NULL);
CREATE POLICY decision_org_read ON public.moderation_decisions
  FOR SELECT
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR public.current_platform_role() IS NOT NULL
  );

ALTER TABLE public.moderation_pre_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY precheck_moderator_all ON public.moderation_pre_checks
  FOR ALL
  USING (public.current_platform_role() IS NOT NULL)
  WITH CHECK (public.current_platform_role() IS NOT NULL);
CREATE POLICY precheck_org_read ON public.moderation_pre_checks
  FOR SELECT
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR public.current_platform_role() IS NOT NULL
  );

-- ---- viewing_requests --------------------------------------------------------
ALTER TABLE public.viewing_requests ENABLE ROW LEVEL SECURITY;
-- Owning org sees only OPEN-or-later requests (verified contact) plus their
-- outcomes; unverified (pending_contact_verification) rows stay sealed in the
-- service worker lane. Requesters see their own requests via user id or the
-- opaque session id + request_id pair. Never a phone-scan surface.
CREATE POLICY viewing_org_read ON public.viewing_requests
  FOR SELECT
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    AND request_state <> 'pending_contact_verification'
  );
CREATE POLICY viewing_requester_read ON public.viewing_requests
  FOR SELECT
  USING (
    (requester_user_id = public.current_app_user_id() AND requester_user_id IS NOT NULL)
    OR (
      requester_session_id IS NOT NULL
      AND requester_session_id::text = current_setting('request.session_id', true)
    )
  );
CREATE POLICY viewing_org_update ON public.viewing_requests
  FOR UPDATE
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR public.current_platform_role() IS NOT NULL
  )
  WITH CHECK (
    organization_id IN (SELECT public.current_user_org_ids())
    OR public.current_platform_role() IS NOT NULL
  );
-- Inserts are service-lane only (server worker with per-request verification
-- writes); no anonymous direct INSERT policy exists by design (ADR-016:
-- the create flow is a domain command through an authorized endpoint).

-- ---- handoffs -----------------------------------------------------------------
ALTER TABLE public.handoffs ENABLE ROW LEVEL SECURITY;
-- Owning org sees routed-or-later handoffs; requesters see their own.
CREATE POLICY handoff_org_read ON public.handoffs
  FOR SELECT
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    AND handoff_state <> 'pending_contact_verification'
  );
CREATE POLICY handoff_requester_read ON public.handoffs
  FOR SELECT
  USING (
    (requester_user_id = public.current_app_user_id() AND requester_user_id IS NOT NULL)
    OR (
      requester_session_id IS NOT NULL
      AND requester_session_id::text = current_setting('request.session_id', true)
    )
  );
CREATE POLICY handoff_org_update ON public.handoffs
  FOR UPDATE
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR public.current_platform_role() IS NOT NULL
  )
  WITH CHECK (
    organization_id IN (SELECT public.current_user_org_ids())
    OR public.current_platform_role() IS NOT NULL
  );

-- ---- audit + outbox -------------------------------------------------------------
-- Append-only, service-lane only. No client policies at all: the default is
-- deny for anon/authenticated/auth.roles(). Workers operate inside
-- transactional server code (SECURITY DEFINER domain functions, added in a
-- later migration alongside the domain commands) or via the service
-- connection from server runtime.
ALTER TABLE public.audit_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY;

-- ---- org_contact_candidates -------------------------------------------------------
ALTER TABLE public.org_contact_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY candidate_org_read ON public.org_contact_candidates
  FOR SELECT
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR public.current_platform_role() IS NOT NULL
  );
CREATE POLICY candidate_org_write ON public.org_contact_candidates
  FOR ALL
  USING (
    organization_id IN (SELECT public.current_user_org_ids())
    OR public.current_platform_role() IS NOT NULL
  )
  WITH CHECK (
    organization_id IN (SELECT public.current_user_org_ids())
    OR public.current_platform_role() IS NOT NULL
  );

COMMIT;
