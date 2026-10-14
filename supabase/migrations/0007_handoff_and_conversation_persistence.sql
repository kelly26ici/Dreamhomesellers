-- Migration 0007: Handoff and Native Simon Conversation Persistence
-- Implements Phase 5 Step 6 of the LUXONN marketplace implementation sequence.
-- Provides persistent conversation thread and turn storage in Postgres,
-- and creates the create_handoff domain RPC with audit and outbox integration.

-- ============================================================================
-- 1. CONVERSATION THREADS & MESSAGES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.conversation_threads (
  thread_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id text NOT NULL,
  page_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversation_threads_user_id 
  ON public.conversation_threads(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_threads_session_id 
  ON public.conversation_threads(session_id);

ALTER TABLE public.conversation_threads ENABLE ROW LEVEL SECURITY;

-- Anonymous users may not select arbitrary rows directly; reads occur via security definer RPC
DROP POLICY IF EXISTS thread_authenticated_read ON public.conversation_threads;
CREATE POLICY thread_authenticated_read ON public.conversation_threads
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE TABLE IF NOT EXISTS public.conversation_messages (
  message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.conversation_threads(thread_id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content text NOT NULL,
  referenced_listing_ids uuid[] DEFAULT '{}'::uuid[],
  suggested_follow_ups text[] DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_thread_id 
  ON public.conversation_messages(thread_id, created_at ASC);

ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS message_authenticated_read ON public.conversation_messages;
CREATE POLICY message_authenticated_read ON public.conversation_messages
  FOR SELECT TO authenticated
  USING (
    thread_id IN (
      SELECT t.thread_id 
      FROM public.conversation_threads t 
      WHERE t.user_id = (SELECT auth.uid())
    )
  );

-- ============================================================================
-- 2. CONVERSATION DOMAIN RPCS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.save_conversation_turn(
  p_thread_id uuid,
  p_session_id text,
  p_user_content text,
  p_assistant_content text,
  p_page_context jsonb DEFAULT '{}'::jsonb,
  p_referenced_listing_ids uuid[] DEFAULT '{}'::uuid[],
  p_suggested_follow_ups text[] DEFAULT '{}'::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_user_msg_id uuid := gen_random_uuid();
  v_assistant_msg_id uuid := gen_random_uuid();
BEGIN
  IF p_thread_id IS NULL OR p_session_id IS NULL OR btrim(p_session_id) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_thread_input', 'message', 'thread_id and session_id are required.');
  END IF;

  -- Upsert thread record
  INSERT INTO public.conversation_threads (
    thread_id, user_id, session_id, page_context, updated_at
  ) VALUES (
    p_thread_id, v_uid, p_session_id, COALESCE(p_page_context, '{}'::jsonb), now()
  )
  ON CONFLICT (thread_id) DO UPDATE SET
    user_id = COALESCE(v_uid, public.conversation_threads.user_id),
    page_context = CASE WHEN p_page_context IS NOT NULL AND p_page_context <> '{}'::jsonb THEN p_page_context ELSE public.conversation_threads.page_context END,
    updated_at = now();

  -- Insert user turn if content provided
  IF p_user_content IS NOT NULL AND btrim(p_user_content) <> '' THEN
    INSERT INTO public.conversation_messages (
      message_id, thread_id, role, content, created_at
    ) VALUES (
      v_user_msg_id, p_thread_id, 'user', btrim(p_user_content), now()
    );
  END IF;

  -- Insert assistant turn if content provided
  IF p_assistant_content IS NOT NULL AND btrim(p_assistant_content) <> '' THEN
    INSERT INTO public.conversation_messages (
      message_id, thread_id, role, content, referenced_listing_ids, suggested_follow_ups, created_at
    ) VALUES (
      v_assistant_msg_id,
      p_thread_id,
      'assistant',
      btrim(p_assistant_content),
      COALESCE(p_referenced_listing_ids, '{}'::uuid[]),
      COALESCE(p_suggested_follow_ups, '{}'::text[]),
      now() + interval '1 millisecond'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'thread_id', p_thread_id,
    'user_message_id', v_user_msg_id,
    'assistant_message_id', v_assistant_msg_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_conversation_history(
  p_thread_id uuid,
  p_session_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_thread public.conversation_threads%ROWTYPE;
  v_messages jsonb;
BEGIN
  SELECT * INTO v_thread FROM public.conversation_threads WHERE thread_id = p_thread_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'thread_id', p_thread_id, 'messages', '[]'::jsonb);
  END IF;

  -- Verify session or user authority
  IF v_thread.user_id IS NOT NULL AND v_uid IS NOT NULL AND v_thread.user_id <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'forbidden', 'message', 'Access denied.');
  END IF;

  IF v_thread.user_id IS NULL AND p_session_id IS NOT NULL AND v_thread.session_id <> p_session_id THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'forbidden', 'message', 'Access denied.');
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', m.message_id,
      'role', m.role,
      'content', m.content,
      'referenced_listing_ids', m.referenced_listing_ids,
      'suggested_follow_ups', m.suggested_follow_ups,
      'created_at', m.created_at
    ) ORDER BY m.created_at ASC
  ) INTO v_messages
  FROM public.conversation_messages m
  WHERE m.thread_id = p_thread_id;

  RETURN jsonb_build_object(
    'ok', true,
    'thread_id', p_thread_id,
    'messages', COALESCE(v_messages, '[]'::jsonb)
  );
END;
$$;

-- ============================================================================
-- 3. HANDOFF DOMAIN RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_handoff(
  p_listing_id uuid DEFAULT NULL,
  p_viewing_request_id uuid DEFAULT NULL,
  p_handoff_kind text DEFAULT 'general',
  p_contact jsonb DEFAULT NULL,
  p_consent jsonb DEFAULT NULL,
  p_message text DEFAULT NULL,
  p_session_id text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_org_id uuid := NULL;
  v_channel text;
  v_contact_value text;
  v_display_name text;
  v_verified_at timestamptz := NULL;
  v_state public.handoff_state;
  v_handoff_id uuid;
  v_reference text;
  v_recent_count integer;
  v_correlation text := 'ho_' || encode(extensions.gen_random_bytes(8), 'hex');
BEGIN
  -- Idempotency replay check
  IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
    SELECT h.handoff_id, h.reference, h.handoff_state INTO v_handoff_id, v_reference, v_state
    FROM public.handoffs h
    WHERE h.idempotency_key = btrim(p_idempotency_key);
    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok', true,
        'idempotent_replay', true,
        'handoff_id', v_handoff_id,
        'reference', v_reference,
        'handoff_state', v_state::text
      );
    END IF;
  END IF;

  -- Validate handoff kind
  IF p_handoff_kind NOT IN ('general', 'viewing', 'listing') THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_handoff_kind', 'message', 'handoff_kind must be general, viewing, or listing.');
  END IF;

  -- Resolve organization if listing_id provided
  IF p_listing_id IS NOT NULL THEN
    SELECT l.organization_id INTO v_org_id
    FROM public.listings l
    WHERE l.listing_id = p_listing_id AND l.lifecycle_state = 'published';
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'listing_not_available', 'message', 'Listing is not available.');
    END IF;
  END IF;

  -- Contact validation
  v_channel := p_contact ->> 'channel';
  v_contact_value := btrim(COALESCE(p_contact ->> 'value', ''));
  v_display_name := p_contact ->> 'display_name';

  IF v_channel NOT IN ('email', 'phone') OR v_contact_value = '' OR length(v_contact_value) > 320 THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_contact', 'message', 'Valid email or phone required.');
  END IF;

  -- In-band verification check for authenticated user
  IF v_uid IS NOT NULL AND v_channel = 'email' THEN
    IF EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = v_uid AND u.email_confirmed_at IS NOT NULL AND lower(u.email) = lower(v_contact_value)
    ) THEN
      v_verified_at := now();
    END IF;
  END IF;

  v_state := CASE 
    WHEN v_verified_at IS NOT NULL THEN 'routed'::public.handoff_state
    ELSE 'pending_contact_verification'::public.handoff_state
  END;

  -- Consent validation
  IF p_consent ->> 'provenance' IS DISTINCT FROM 'native' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_consent', 'message', 'Consent must be native.');
  END IF;

  -- Rate limit check (5 handoffs / 24h per identity)
  SELECT count(*) INTO v_recent_count
  FROM public.handoffs h
  WHERE h.created_at > now() - interval '24 hours'
    AND (
      (v_uid IS NOT NULL AND h.requester_user_id = v_uid)
      OR (v_uid IS NULL AND h.contact ->> 'value' = v_contact_value)
    );

  IF v_recent_count >= 5 THEN
    INSERT INTO public.audit_records (
      actor_type, actor_id, organization_id, action,
      resource_type, resource_id, request_id, outcome, reason_code
    ) VALUES (
      CASE WHEN v_uid IS NOT NULL THEN 'buyer' ELSE 'anonymous' END,
      v_uid, v_org_id, 'handoff.create',
      'handoff', COALESCE(p_listing_id::text, 'platform'), v_correlation,
      'rejected', 'rate_limited'
    );

    RETURN jsonb_build_object('ok', false, 'reason_code', 'rate_limited', 'message', 'Too many handoff requests in the last 24 hours.');
  END IF;

  -- Generate ID & reference
  v_handoff_id := gen_random_uuid();
  v_reference := 'HO-' || upper(substring(encode(extensions.gen_random_bytes(4), 'hex'), 1, 8));

  -- Insert handoff
  INSERT INTO public.handoffs (
    handoff_id, listing_id, viewing_request_id, organization_id,
    actor_type, requester_user_id, requester_session_id,
    handoff_kind, message, contact, consent, handoff_state,
    reference, idempotency_key
  ) VALUES (
    v_handoff_id, p_listing_id, p_viewing_request_id, v_org_id,
    CASE WHEN v_uid IS NOT NULL THEN 'buyer' ELSE 'anonymous' END,
    v_uid, p_session_id,
    p_handoff_kind, btrim(COALESCE(p_message, '')),
    jsonb_build_object(
      'contact_id', gen_random_uuid(),
      'channel', v_channel,
      'value', v_contact_value,
      'verified_at', v_verified_at,
      'display_name', v_display_name
    ),
    jsonb_build_object(
      'consent_id', gen_random_uuid(),
      'purpose', p_consent ->> 'purpose',
      'consented_at', now(),
      'provenance', 'native'
    ),
    v_state,
    v_reference,
    NULLIF(p_idempotency_key, '')
  );

  -- Audit record
  INSERT INTO public.audit_records (
    actor_type, actor_id, organization_id, action,
    resource_type, resource_id, request_id, outcome, reason_code
  ) VALUES (
    CASE WHEN v_uid IS NOT NULL THEN 'buyer' ELSE 'anonymous' END,
    v_uid, v_org_id, 'handoff.create',
    'handoff', v_handoff_id::text, v_correlation,
    'accepted', 'created_' || v_state::text
  );

  -- Outbox event (Strictly buyer-safe payload, no contact/consent details)
  INSERT INTO public.outbox_events (
    organization_id, event_type, aggregate_type, aggregate_id,
    correlation_id, payload
  ) VALUES (
    v_org_id, 'handoff.created',
    'handoff', v_handoff_id::text, v_correlation,
    jsonb_build_object(
      'handoff_id', v_handoff_id,
      'reference', v_reference,
      'listing_id', p_listing_id,
      'organization_id', v_org_id,
      'handoff_kind', p_handoff_kind,
      'handoff_state', v_state::text
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'handoff_id', v_handoff_id,
    'reference', v_reference,
    'handoff_state', v_state::text
  );
END;
$$;

-- ============================================================================
-- 4. GRANTS
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.save_conversation_turn TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_conversation_history TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_handoff TO anon, authenticated;
