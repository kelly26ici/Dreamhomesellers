-- Migration 0012: conversation-write ownership check + search_path hardening
-- for the conversation persistence pair (0007 RPCs).
--
-- Source: skill-conformance audit 2026-10-15 (audit-findings/skill-conformance.md):
--   Finding 1 (REQUIRED): save_conversation_turn had no in-body ownership
--     check on p_thread_id — any caller who learned another user's thread_id
--     could append messages into that thread. The read path checked
--     ownership; the write path did not.
--   Finding 3 (SOFT): the conversation RPCs pinned search_path public-first
--     (shadowing risk). Project convention is pg_catalog-first (0001, 0010).
--     Scoped here to the conversation pair; the remaining public-first pins
--     (0007 create_handoff, 0009 preferences pair) ride in a later pass.

-- ============================================================================
-- 1. save_conversation_turn: ownership check + pg_catalog-first search_path
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
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_user_msg_id uuid := gen_random_uuid();
  v_assistant_msg_id uuid := gen_random_uuid();
  v_existing_user_id uuid;
BEGIN
  IF p_thread_id IS NULL OR p_session_id IS NULL OR btrim(p_session_id) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_thread_input', 'message', 'thread_id and session_id are required.');
  END IF;

  -- Ownership gate (mirrors get_conversation_history): a thread with an
  -- owner may only be written by that owner; an anonymous thread may only
  -- be written by its original session. Threads are created here, so the
  -- first write claims the thread.
  SELECT user_id INTO v_existing_user_id
  FROM public.conversation_threads
  WHERE thread_id = p_thread_id;

  IF v_existing_user_id IS NOT NULL THEN
    IF v_uid IS NULL OR v_existing_user_id <> v_uid THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'forbidden', 'message', 'Access denied.');
    END IF;
  ELSE
    -- Thread exists but was created anonymously (user_id NULL): only the
    -- same session may write. A brand-new thread passes this gate trivially.
    IF EXISTS (
      SELECT 1 FROM public.conversation_threads
      WHERE thread_id = p_thread_id AND session_id IS DISTINCT FROM p_session_id
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'forbidden', 'message', 'Access denied.');
    END IF;
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

-- ============================================================================
-- 2. get_conversation_history: pg_catalog-first search_path (body unchanged)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_conversation_history(
  p_thread_id uuid,
  p_session_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
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
