-- Migration 0010: outbox backoff + dead letters, search_path hardening,
-- health-RPC grant narrowing, purge cascade completion.
--
-- Source: security/database audit 2026-10-15 (audit-findings/).
-- Conventions follow migrations 0001-0007 (search_path = pg_catalog, public).

-- ============================================================================
-- 1. OUTBOX: exponential backoff via scheduled_for + dead-letter table
-- ============================================================================

ALTER TABLE public.outbox_events
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz NOT NULL DEFAULT now();

-- The poll path now orders by scheduled_for; keep the original poll index
-- for the pre-backoff shape and add the new ordering index.
CREATE INDEX IF NOT EXISTS outbox_scheduled_pending
  ON public.outbox_events (scheduled_for)
  WHERE delivery_state = 'pending';

-- Dead letters: terminal failures land here for manual inspection/replay.
CREATE TABLE IF NOT EXISTS public.outbox_dead_letters (
  dead_letter_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         uuid NOT NULL,
  occurred_at      timestamptz NOT NULL,
  organization_id  uuid,
  event_type       text NOT NULL,
  aggregate_type   text NOT NULL DEFAULT '',
  aggregate_id     text NOT NULL DEFAULT '',
  correlation_id   text,
  payload          jsonb NOT NULL,
  delivery_attempts integer NOT NULL,
  last_error       text,
  dead_lettered_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.outbox_dead_letters IS
  'Terminal outbox failures (>= 3 attempts) for manual inspection and replay. Payload inherits the buyer-safety backstop from outbox_events. Service-lane only: RLS on, no client policies.';

ALTER TABLE public.outbox_dead_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbox_dead_letters FORCE ROW LEVEL SECURITY;

-- Backstop: dead-letter payloads must satisfy the same restricted-key ban
-- the outbox enforces at write time (a failed event never had the chance
-- to be delivered; its copy must not leak either).
ALTER TABLE public.outbox_dead_letters
  ADD CONSTRAINT outbox_dead_letters_payload_check
  CHECK (NOT (payload ?| ARRAY['exact_address','latitude','longitude',
                                'contact','consent','reporter_contact','original_path']));

-- ============================================================================
-- 2. OUTBOX RPCs: search_path hardening + backoff + dead-lettering
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claim_outbox_events(
  p_batch_size integer DEFAULT 10
)
RETURNS SETOF public.outbox_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.outbox_events
  SET delivery_state = 'processing',
      delivery_attempts = delivery_attempts + 1
  WHERE event_id IN (
    SELECT o.event_id
    FROM public.outbox_events o
    WHERE o.delivery_state = 'pending'
      AND o.scheduled_for <= now()
    ORDER BY o.scheduled_for ASC, o.occurred_at ASC
    LIMIT LEAST(COALESCE(p_batch_size, 10), 100)
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_outbox_event_delivered(
  p_event_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.outbox_events
  SET delivery_state = 'delivered',
      scheduled_for = now()
  WHERE event_id = p_event_id;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_outbox_event_failed(
  p_event_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_attempts integer;
  v_org uuid;
  v_event record;
  v_error_text text := 'delivery failed after retry budget';
BEGIN
  SELECT * INTO v_event FROM public.outbox_events WHERE event_id = p_event_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  v_attempts := v_event.delivery_attempts;
  v_org := v_event.organization_id;

  IF v_attempts >= 3 THEN
    -- Terminal: copy to dead letters, then mark the original failed.
    INSERT INTO public.outbox_dead_letters (
      event_id, occurred_at, organization_id, event_type,
      aggregate_type, aggregate_id, correlation_id, payload,
      delivery_attempts, last_error
    ) VALUES (
      p_event_id, v_event.occurred_at, v_org, v_event.event_type,
      v_event.aggregate_type, v_event.aggregate_id, v_event.correlation_id,
      v_event.payload, v_attempts, v_error_text
    )
    ON CONFLICT DO NOTHING;

    UPDATE public.outbox_events
    SET delivery_state = 'failed',
        scheduled_for = now()
    WHERE event_id = p_event_id;
  ELSE
    -- Exponential backoff: 2^attempts minutes (2, 4 minutes).
    UPDATE public.outbox_events
    SET delivery_state = 'pending',
        scheduled_for = now() + power(2, v_attempts) * interval '1 minute'
    WHERE event_id = p_event_id;
  END IF;

  RETURN true;
END;
$$;

-- Re-assert privileges (CREATE OR REPLACE preserves them, but be explicit).
REVOKE ALL ON FUNCTION public.claim_outbox_events(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_outbox_event_delivered(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_outbox_event_failed(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_outbox_events(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_outbox_event_delivered(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_outbox_event_failed(uuid) TO service_role;

-- ============================================================================
-- 3. HEALTH RPC: narrow grant from anon to authenticated-only
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.get_platform_operational_health FROM anon;
GRANT EXECUTE ON FUNCTION public.get_platform_operational_health TO authenticated, service_role;

-- Statement-timeout guard: five count(*) scans must not hang the pool.
-- Response shape preserved from 0009 (status/timestamp/metrics wrapper);
-- column names corrected to the real ones (case_state, request_state) and
-- dead_letters added to the metrics object.
CREATE OR REPLACE FUNCTION public.get_platform_operational_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '10s'
AS $$
DECLARE
  v_published_count integer;
  v_pending_outbox integer;
  v_failed_outbox integer;
  v_pending_moderation integer;
  v_open_viewings integer;
BEGIN
  SELECT count(*) INTO v_published_count FROM public.listings WHERE lifecycle_state = 'published';
  SELECT count(*) INTO v_pending_outbox FROM public.outbox_events WHERE delivery_state = 'pending';
  SELECT count(*) INTO v_failed_outbox FROM public.outbox_events WHERE delivery_state = 'failed';
  SELECT count(*) INTO v_pending_moderation FROM public.moderation_cases WHERE case_state IN ('pending', 'under_review');
  SELECT count(*) INTO v_open_viewings FROM public.viewing_requests WHERE request_state IN ('open', 'pending_contact_verification');

  RETURN jsonb_build_object(
    'status', 'healthy',
    'timestamp', now(),
    'metrics', jsonb_build_object(
      'published_listings', v_published_count,
      'pending_outbox_events', v_pending_outbox,
      'failed_outbox_events', v_failed_outbox,
      'dead_letter_events', (SELECT count(*) FROM public.outbox_dead_letters),
      'pending_moderation_cases', v_pending_moderation,
      'open_viewing_requests', v_open_viewings
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_platform_operational_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_platform_operational_health() TO authenticated, service_role;

-- ============================================================================
-- 4. PURGE CASCADE: viewing requests + handoffs
-- ============================================================================

CREATE OR REPLACE FUNCTION public.purge_buyer_personal_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_threads_deleted integer := 0;
  v_prefs_deleted integer := 0;
  v_viewings_deleted integer := 0;
  v_handoffs_deleted integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authenticated');
  END IF;

  -- Buyer preferences
  DELETE FROM public.buyer_preferences WHERE user_id = v_uid;
  GET DIAGNOSTICS v_prefs_deleted = ROW_COUNT;

  -- Conversation threads and cascading messages
  DELETE FROM public.conversation_threads WHERE user_id = v_uid;
  GET DIAGNOSTICS v_threads_deleted = ROW_COUNT;

  -- Viewing requests created by this buyer (VerifiedContact JSONB holds
  -- personal contact data — Kenya DPA/GDPR-regulated).
  DELETE FROM public.viewing_requests WHERE requester_user_id = v_uid;
  GET DIAGNOSTICS v_viewings_deleted = ROW_COUNT;

  -- Handoffs raised for this buyer.
  DELETE FROM public.handoffs WHERE requester_user_id = v_uid;
  GET DIAGNOSTICS v_handoffs_deleted = ROW_COUNT;

  -- Audit trail (audit_records is append-only; the purge itself must leave
  -- evidence — this is the intended exception to full erasure).
  INSERT INTO public.audit_records (
    actor_type, actor_id, organization_id, action,
    resource_type, resource_id, request_id, outcome, reason_code
  ) VALUES (
    'buyer', v_uid, NULL, 'privacy.purge_personal_data',
    'buyer_account', v_uid::text, 'req_' || encode(gen_random_bytes(4), 'hex'),
    'accepted', 'purged_by_request'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'preferences_deleted', v_prefs_deleted,
    'threads_deleted', v_threads_deleted,
    'viewings_deleted', v_viewings_deleted,
    'handoffs_deleted', v_handoffs_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_buyer_personal_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_buyer_personal_data() TO authenticated;
