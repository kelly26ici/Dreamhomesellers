-- ============================================================================
-- Migration 0011: Hot-path indexes + updated_at touch triggers
--
-- Closes audit gaps (audit-findings/plans-compliance.md):
--   1. handoffs.listing_id — FK column, hot buyer/owner lookup path (no index).
--   2. audit_records.actor_id — actor-filtered audit queries (no index).
--   3. Mutable tables' updated_at not auto-maintained: listings,
--      listing_revisions, buyer_preferences, conversation_threads. Domain
--      commands set updated_at manually; direct UPDATEs would leave stale
--      values. Guarded touch triggers fix this without fighting explicit sets.
--   4. viewing_requests.requester_user_id and handoffs.requester_user_id are
--      queried by purge_buyer_personal_data (migration 0010) — index them.
--
-- Idempotent: IF NOT EXISTS on every object.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Indexes (only where not already covered)
-- ----------------------------------------------------------------------------

-- Gap 1: handoffs.listing_id (FK, hot lookup). No existing index covers it.
CREATE INDEX IF NOT EXISTS handoffs_listing_idx
  ON public.handoffs (listing_id);

-- Gap 4a: handoffs.requester_user_id (purge_buyer_personal_data lookup path).
CREATE INDEX IF NOT EXISTS handoffs_requester_user_idx
  ON public.handoffs (requester_user_id);

-- Gap 4b: viewing_requests.requester_user_id (purge path). Existing
-- viewing_requests_listing_idx / org_state_idx do not cover this column.
CREATE INDEX IF NOT EXISTS viewing_requests_requester_user_idx
  ON public.viewing_requests (requester_user_id);

-- Gap 2: audit_records.actor_id, most recent first. Existing indexes cover
-- resource/org/request — not actor-filtered queries.
CREATE INDEX IF NOT EXISTS audit_records_actor_time_idx
  ON public.audit_records (actor_id, occurred_at DESC);

-- ----------------------------------------------------------------------------
-- 2. updated_at touch triggers
-- ----------------------------------------------------------------------------

-- Generic guard: only touch updated_at when the UPDATE did not set it
-- explicitly (OLD.updated_at IS NOT DISTINCT FROM NEW.updated_at means the
-- statement left the column unchanged). Domain commands that set it explicitly
-- are not fought; direct UPDATEs get a fresh timestamp.
--
-- SECURITY-safe: plain LANGUAGE plpgsql, search_path pinned to pg_catalog,
-- no dynamic SQL, no external calls.
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF OLD.updated_at IS NOT DISTINCT FROM NEW.updated_at THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.touch_updated_at() IS
  'BEFORE UPDATE trigger body: sets updated_at = now() only when the UPDATE did not already set it explicitly (OLD.updated_at IS NOT DISTINCT FROM NEW.updated_at), so domain commands that set the column are not overridden.';

-- listings
DROP TRIGGER IF EXISTS listings_touch_updated_at ON public.listings;
CREATE TRIGGER listings_touch_updated_at
  BEFORE UPDATE ON public.listings
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

-- listing_revisions
DROP TRIGGER IF EXISTS listing_revisions_touch_updated_at ON public.listing_revisions;
CREATE TRIGGER listing_revisions_touch_updated_at
  BEFORE UPDATE ON public.listing_revisions
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

-- buyer_preferences
DROP TRIGGER IF EXISTS buyer_preferences_touch_updated_at ON public.buyer_preferences;
CREATE TRIGGER buyer_preferences_touch_updated_at
  BEFORE UPDATE ON public.buyer_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

-- conversation_threads
DROP TRIGGER IF EXISTS conversation_threads_touch_updated_at ON public.conversation_threads;
CREATE TRIGGER conversation_threads_touch_updated_at
  BEFORE UPDATE ON public.conversation_threads
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();
