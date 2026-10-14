-- Migration 0008: Transactional Outbox Worker Pipeline
-- Implements Phase 6 Step 4: CRM / integration / notification consumers from outbox.
-- Provides atomic claim-and-process using SELECT FOR UPDATE SKIP LOCKED
-- against the existing partial index outbox_pending.

-- ============================================================================
-- 0. WIDEN delivery_state CHECK TO INCLUDE 'processing'
-- ============================================================================

ALTER TABLE public.outbox_events DROP CONSTRAINT IF EXISTS outbox_events_delivery_state_check;
ALTER TABLE public.outbox_events ADD CONSTRAINT outbox_events_delivery_state_check
  CHECK (delivery_state = ANY (ARRAY['pending'::text, 'processing'::text, 'delivered'::text, 'failed'::text]));

-- ============================================================================
-- 1. ATOMIC QUEUE CLAIM RPC (SKIP LOCKED)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claim_outbox_events(
  p_batch_size integer DEFAULT 10
)
RETURNS SETOF public.outbox_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
    ORDER BY o.occurred_at ASC
    LIMIT LEAST(p_batch_size, 100)
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

-- ============================================================================
-- 2. COMPLETION & RETRY RPCS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mark_outbox_event_delivered(
  p_event_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.outbox_events
  SET delivery_state = 'delivered'
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
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Re-queue if attempts < 3, otherwise transition to terminal failed
  UPDATE public.outbox_events
  SET delivery_state = CASE WHEN delivery_attempts >= 3 THEN 'failed' ELSE 'pending' END
  WHERE event_id = p_event_id;

  RETURN FOUND;
END;
$$;

-- ============================================================================
-- 3. PRIVILEGES
-- ============================================================================

REVOKE ALL ON FUNCTION public.claim_outbox_events(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_outbox_event_delivered(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_outbox_event_failed(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_outbox_events(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_outbox_event_delivered(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_outbox_event_failed(uuid) TO service_role;
