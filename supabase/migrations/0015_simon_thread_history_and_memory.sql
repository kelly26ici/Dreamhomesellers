-- Migration 0015: Simon two-week thread history and long-term memory
--
-- Reuses the dormant 0007 conversation tables rather than creating a parallel
-- Simon schema. Rows written by the legacy `save_conversation_turn` path are
-- marked `history_source = 'legacy'` and expired immediately: only threads
-- created through the new device-scoped `simon_*` RPCs are listed, and only
-- for 14 days after their last activity.
--
-- Ownership model:
--   authenticated  user_id = auth.uid()
--   anonymous      user_id IS NULL AND device_id = <signed device cookie>
-- On sign-in the device rows are claimed for the account. Ownership is checked
-- *inside* every function; the legacy 0007 read RPC's skip-on-null hole is
-- closed here as well.
--
-- All new functions are SECURITY DEFINER with pg_catalog-first search_path so
-- PostgREST can call them as anon/authenticated without granting table writes.

-- ============================================================================
-- 1. THREAD + MESSAGE COLUMNS
-- ============================================================================

ALTER TABLE public.conversation_threads
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS title_source text NOT NULL DEFAULT 'snippet',
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS summary_facts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS device_id text,
  ADD COLUMN IF NOT EXISTS history_source text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.conversation_threads'::regclass
      AND conname = 'conversation_threads_title_source_check'
  ) THEN
    ALTER TABLE public.conversation_threads
      ADD CONSTRAINT conversation_threads_title_source_check
      CHECK (title_source IN ('snippet', 'llm', 'user'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.conversation_threads'::regclass
      AND conname = 'conversation_threads_history_source_check'
  ) THEN
    ALTER TABLE public.conversation_threads
      ADD CONSTRAINT conversation_threads_history_source_check
      CHECK (history_source IN ('legacy', 'simon'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.conversation_threads'::regclass
      AND conname = 'conversation_threads_summary_facts_check'
  ) THEN
    ALTER TABLE public.conversation_threads
      ADD CONSTRAINT conversation_threads_summary_facts_check
      CHECK (jsonb_typeof(summary_facts) = 'array');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.conversation_threads'::regclass
      AND conname = 'conversation_threads_device_id_check'
  ) THEN
    ALTER TABLE public.conversation_threads
      ADD CONSTRAINT conversation_threads_device_id_check
      CHECK (
        device_id IS NULL
        OR device_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      );
  END IF;
END;
$$;

ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS client_message_id text;

CREATE UNIQUE INDEX IF NOT EXISTS conversation_messages_thread_client_id_key
  ON public.conversation_messages (thread_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS conversation_threads_device_recent_idx
  ON public.conversation_threads (device_id, last_message_at DESC)
  WHERE device_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS conversation_threads_user_recent_idx
  ON public.conversation_threads (user_id, last_message_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS conversation_threads_expires_idx
  ON public.conversation_threads (expires_at);

-- Backfill activity, then retire every pre-device thread. The legacy docked
-- concierge wrote these; they have no device identity, so the history rail
-- must not show them. Expiring them makes them purgeable immediately.
UPDATE public.conversation_threads
SET last_message_at = COALESCE(updated_at, created_at),
    expires_at = now()
WHERE device_id IS NULL;

-- ============================================================================
-- 2. LONG-TERM MEMORY TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.simon_memory (
  memory_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id text,
  kind text NOT NULL CHECK (kind IN ('preference', 'fact')),
  key text NOT NULL CHECK (char_length(key) BETWEEN 1 AND 80),
  value text NOT NULL CHECK (char_length(value) BETWEEN 1 AND 500),
  source_thread_id uuid REFERENCES public.conversation_threads(thread_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  CONSTRAINT simon_memory_identity_check CHECK (
    (user_id IS NOT NULL AND device_id IS NULL)
    OR (user_id IS NULL AND device_id IS NOT NULL)
  ),
  CONSTRAINT simon_memory_device_id_check CHECK (
    device_id IS NULL
    OR device_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS simon_memory_user_key_key
  ON public.simon_memory (user_id, kind, key)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS simon_memory_device_key_key
  ON public.simon_memory (device_id, kind, key)
  WHERE device_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS simon_memory_expires_idx
  ON public.simon_memory (expires_at);

ALTER TABLE public.simon_memory ENABLE ROW LEVEL SECURITY;
-- No policies: only the SECURITY DEFINER RPCs below touch this table.
REVOKE ALL ON TABLE public.simon_memory FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.simon_memory TO service_role;

-- Direct writes to the conversation tables now go through the RPCs only.
-- SELECT stays available for the existing authenticated-owner RLS policy.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.conversation_threads FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.conversation_messages FROM anon, authenticated;

-- ============================================================================
-- 3. IDENTITY HELPERS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.simon_normalize_device_id(p_device_id text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN p_device_id IS NULL THEN NULL
    WHEN btrim(p_device_id) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN lower(btrim(p_device_id))
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.simon_thread_owned(p_thread_id uuid, p_device_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_threads t
    WHERE t.thread_id = p_thread_id
      AND t.history_source = 'simon'
      AND (
        (
          (SELECT auth.uid()) IS NOT NULL
          AND t.user_id = (SELECT auth.uid())
        )
        OR (
          (SELECT auth.uid()) IS NULL
          AND t.user_id IS NULL
          AND t.device_id IS NOT NULL
          AND t.device_id = public.simon_normalize_device_id(p_device_id)
        )
      )
  );
$$;

-- Move everything this browser created anonymously onto the signed-in account.
-- Idempotent: the second call finds no device-owned rows.
CREATE OR REPLACE FUNCTION public.simon_claim_device_data(p_device_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_device text := public.simon_normalize_device_id(p_device_id);
  v_threads integer := 0;
  v_memories integer := 0;
BEGIN
  IF v_uid IS NULL OR v_device IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'claimed_threads', 0, 'claimed_memories', 0);
  END IF;

  UPDATE public.conversation_threads
  SET user_id = v_uid,
      device_id = NULL,
      updated_at = now()
  WHERE user_id IS NULL
    AND device_id = v_device
    AND history_source = 'simon';
  GET DIAGNOSTICS v_threads = ROW_COUNT;

  -- Drop anonymous duplicates of an explicit account preference/fact before
  -- promoting the rest, otherwise the partial unique index rejects the update.
  DELETE FROM public.simon_memory d
  USING public.simon_memory u
  WHERE d.user_id IS NULL
    AND d.device_id = v_device
    AND u.user_id = v_uid
    AND u.kind = d.kind
    AND u.key = d.key;

  UPDATE public.simon_memory
  SET user_id = v_uid,
      device_id = NULL,
      updated_at = now()
  WHERE user_id IS NULL
    AND device_id = v_device;
  GET DIAGNOSTICS v_memories = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'claimed_threads', v_threads,
    'claimed_memories', v_memories
  );
END;
$$;

-- ============================================================================
-- 4. THREAD RPCS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.simon_thread_list(
  p_device_id text,
  p_limit integer DEFAULT 80
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_device text := public.simon_normalize_device_id(p_device_id);
  v_limit integer := greatest(1, least(coalesce(p_limit, 80), 200));
  v_threads jsonb;
BEGIN
  IF v_uid IS NOT NULL THEN
    PERFORM public.simon_claim_device_data(p_device_id);
  ELSIF v_device IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'identity_required', 'threads', '[]'::jsonb);
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.last_message_at DESC), '[]'::jsonb)
  INTO v_threads
  FROM (
    SELECT
      ct.thread_id AS id,
      COALESCE(ct.title, 'New conversation') AS title,
      ct.title_source,
      ct.last_message_at,
      ct.created_at
    FROM public.conversation_threads ct
    WHERE ct.history_source = 'simon'
      AND ct.expires_at > now()
      AND (
        (v_uid IS NOT NULL AND ct.user_id = v_uid)
        OR (v_uid IS NULL AND ct.user_id IS NULL AND ct.device_id = v_device)
      )
    ORDER BY ct.last_message_at DESC
    LIMIT v_limit
  ) t;

  RETURN jsonb_build_object('ok', true, 'threads', v_threads);
END;
$$;

CREATE OR REPLACE FUNCTION public.simon_thread_get(
  p_thread_id uuid,
  p_device_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_thread public.conversation_threads%ROWTYPE;
  v_messages jsonb;
BEGIN
  IF p_thread_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_thread_input');
  END IF;

  IF (SELECT auth.uid()) IS NOT NULL THEN
    PERFORM public.simon_claim_device_data(p_device_id);
  END IF;

  IF NOT public.simon_thread_owned(p_thread_id, p_device_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'forbidden');
  END IF;

  SELECT * INTO v_thread
  FROM public.conversation_threads
  WHERE thread_id = p_thread_id;

  IF NOT FOUND OR v_thread.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_found');
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(m)::jsonb ORDER BY m.created_at ASC, m.id ASC), '[]'::jsonb)
  INTO v_messages
  FROM (
    SELECT
      cm.message_id AS id,
      cm.role,
      cm.content,
      cm.metadata,
      cm.client_message_id,
      cm.referenced_listing_ids,
      cm.suggested_follow_ups,
      cm.created_at
    FROM public.conversation_messages cm
    WHERE cm.thread_id = p_thread_id
    ORDER BY cm.created_at ASC, cm.message_id ASC
    LIMIT 400
  ) m;

  RETURN jsonb_build_object(
    'ok', true,
    'thread', jsonb_build_object(
      'id', v_thread.thread_id,
      'title', COALESCE(v_thread.title, 'New conversation'),
      'title_source', v_thread.title_source,
      'summary', v_thread.summary,
      'summary_facts', v_thread.summary_facts,
      'created_at', v_thread.created_at,
      'last_message_at', v_thread.last_message_at,
      'expires_at', v_thread.expires_at
    ),
    'messages', v_messages
  );
END;
$$;

-- Sprite for the one durable write of a turn. Idempotent per
-- (thread_id, client_message_id) so a stream tee that fires on both `flush`
-- and `cancel` cannot duplicate a turn.
CREATE OR REPLACE FUNCTION public.simon_save_turn(
  p_thread_id uuid,
  p_device_id text,
  p_user_content text,
  p_user_client_id text,
  p_assistant_content text,
  p_assistant_client_id text,
  p_page_context jsonb DEFAULT '{}'::jsonb,
  p_message_metadata jsonb DEFAULT '{}'::jsonb,
  p_assistant_metadata jsonb DEFAULT '{}'::jsonb,
  p_suggested_follow_ups text[] DEFAULT '{}'::text[],
  p_title text DEFAULT NULL,
  p_replace_from_client_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_device text := public.simon_normalize_device_id(p_device_id);
  v_existing public.conversation_threads%ROWTYPE;
  v_user_message_id uuid := gen_random_uuid();
  v_assistant_message_id uuid := NULL;
  v_snippet text;
  v_title text;
  v_title_source text;
  v_expires_at timestamptz;
BEGIN
  IF p_thread_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_thread_input');
  END IF;
  IF p_user_content IS NULL OR btrim(p_user_content) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'empty_message');
  END IF;
  IF v_uid IS NULL AND v_device IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'identity_required');
  END IF;
  IF v_device IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_device');
  END IF;

  IF v_uid IS NOT NULL THEN
    PERFORM public.simon_claim_device_data(p_device_id);
  END IF;

  SELECT * INTO v_existing
  FROM public.conversation_threads
  WHERE thread_id = p_thread_id;

  IF FOUND THEN
    IF v_existing.history_source <> 'simon' THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'forbidden');
    END IF;
    IF v_existing.expires_at <= now() THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'expired');
    END IF;

    IF v_existing.user_id IS NOT NULL THEN
      IF v_uid IS NULL OR v_existing.user_id <> v_uid THEN
        RETURN jsonb_build_object('ok', false, 'reason_code', 'forbidden');
      END IF;
    ELSE
      IF v_existing.device_id IS NULL OR v_existing.device_id <> v_device THEN
        RETURN jsonb_build_object('ok', false, 'reason_code', 'forbidden');
      END IF;
      IF v_uid IS NOT NULL THEN
        UPDATE public.conversation_threads
        SET user_id = v_uid, device_id = NULL, updated_at = now()
        WHERE thread_id = p_thread_id;
      END IF;
    END IF;
  ELSE
    INSERT INTO public.conversation_threads (
      thread_id, user_id, session_id, device_id, history_source,
      title, title_source, page_context, last_message_at, expires_at
    ) VALUES (
      p_thread_id,
      v_uid,
      p_thread_id::text,
      CASE WHEN v_uid IS NULL THEN v_device ELSE NULL END,
      'simon',
      left(regexp_replace(btrim(p_user_content), '\s+', ' ', 'g'), 80),
      'snippet',
      COALESCE(p_page_context, '{}'::jsonb),
      now(),
      now() + interval '14 days'
    );
  END IF;

  -- Edit / regenerate truncates from the edited user message onward.
  IF p_replace_from_client_id IS NOT NULL AND btrim(p_replace_from_client_id) <> '' THEN
    DELETE FROM public.conversation_messages m
    USING (
      SELECT cm.created_at, cm.message_id
      FROM public.conversation_messages cm
      WHERE cm.thread_id = p_thread_id
        AND cm.client_message_id = p_replace_from_client_id
      LIMIT 1
    ) t
    WHERE m.thread_id = p_thread_id
      AND (m.created_at, m.message_id) >= (t.created_at, t.message_id);
  END IF;

  INSERT INTO public.conversation_messages (
    message_id, thread_id, role, content, metadata, client_message_id, created_at
  ) VALUES (
    v_user_message_id,
    p_thread_id,
    'user',
    btrim(p_user_content),
    COALESCE(p_message_metadata, '{}'::jsonb),
    NULLIF(btrim(p_user_client_id), ''),
    now()
  )
  ON CONFLICT (thread_id, client_message_id) WHERE client_message_id IS NOT NULL
  DO UPDATE SET
    content = excluded.content,
    metadata = excluded.metadata;

  IF p_assistant_content IS NOT NULL AND btrim(p_assistant_content) <> '' THEN
    v_assistant_message_id := gen_random_uuid();
    INSERT INTO public.conversation_messages (
      message_id, thread_id, role, content, metadata, client_message_id,
      suggested_follow_ups, created_at
    ) VALUES (
      v_assistant_message_id,
      p_thread_id,
      'assistant',
      btrim(p_assistant_content),
      COALESCE(p_assistant_metadata, '{}'::jsonb),
      NULLIF(btrim(p_assistant_client_id), ''),
      COALESCE(p_suggested_follow_ups, '{}'::text[]),
      now() + interval '1 millisecond'
    )
    ON CONFLICT (thread_id, client_message_id) WHERE client_message_id IS NOT NULL
    DO UPDATE SET
      content = excluded.content,
      metadata = excluded.metadata,
      suggested_follow_ups = excluded.suggested_follow_ups;
  END IF;

  SELECT title, title_source INTO v_title, v_title_source
  FROM public.conversation_threads
  WHERE thread_id = p_thread_id;

  v_snippet := left(regexp_replace(btrim(p_user_content), '\s+', ' ', 'g'), 80);

  IF v_title_source <> 'user'
     AND p_title IS NOT NULL
     AND btrim(p_title) <> ''
     AND (v_title IS NULL OR v_title_source = 'snippet') THEN
    v_title := left(btrim(p_title), 120);
    v_title_source := 'snippet';
  ELSIF v_title IS NULL OR btrim(v_title) = '' THEN
    v_title := v_snippet;
    v_title_source := 'snippet';
  END IF;

  UPDATE public.conversation_threads
  SET title = v_title,
      title_source = v_title_source,
      last_message_at = now(),
      updated_at = now(),
      expires_at = now() + interval '14 days',
      page_context = CASE
        WHEN p_page_context IS NOT NULL AND p_page_context <> '{}'::jsonb
          THEN p_page_context
        ELSE page_context
      END
  WHERE thread_id = p_thread_id
  RETURNING expires_at INTO v_expires_at;

  RETURN jsonb_build_object(
    'ok', true,
    'thread_id', p_thread_id,
    'user_message_id', v_user_message_id,
    'assistant_message_id', v_assistant_message_id,
    'title', v_title,
    'title_source', v_title_source,
    'expires_at', v_expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.simon_thread_rename(
  p_thread_id uuid,
  p_device_id text,
  p_title text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_title text := left(btrim(COALESCE(p_title, '')), 120);
BEGIN
  IF v_title = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_title');
  END IF;
  IF NOT public.simon_thread_owned(p_thread_id, p_device_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'forbidden');
  END IF;

  UPDATE public.conversation_threads
  SET title = v_title,
      title_source = 'user',
      updated_at = now(),
      expires_at = now() + interval '14 days'
  WHERE thread_id = p_thread_id;

  RETURN jsonb_build_object('ok', true, 'thread_id', p_thread_id, 'title', v_title);
END;
$$;

CREATE OR REPLACE FUNCTION public.simon_thread_set_title(
  p_thread_id uuid,
  p_device_id text,
  p_title text,
  p_source text DEFAULT 'llm'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_title text := left(btrim(COALESCE(p_title, '')), 120);
  v_current_source text;
BEGIN
  IF p_source NOT IN ('llm', 'snippet') THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_source');
  END IF;
  IF v_title = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_title');
  END IF;
  IF NOT public.simon_thread_owned(p_thread_id, p_device_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'forbidden');
  END IF;

  SELECT title_source INTO v_current_source
  FROM public.conversation_threads
  WHERE thread_id = p_thread_id;

  -- A user rename always wins; a second LLM pass never rewrites itself.
  IF v_current_source = 'user' OR (p_source = 'llm' AND v_current_source = 'llm') THEN
    RETURN jsonb_build_object('ok', true, 'thread_id', p_thread_id, 'unchanged', true);
  END IF;

  UPDATE public.conversation_threads
  SET title = v_title,
      title_source = p_source,
      updated_at = now(),
      expires_at = now() + interval '14 days'
  WHERE thread_id = p_thread_id;

  RETURN jsonb_build_object('ok', true, 'thread_id', p_thread_id, 'title', v_title, 'title_source', p_source);
END;
$$;

CREATE OR REPLACE FUNCTION public.simon_thread_set_summary(
  p_thread_id uuid,
  p_device_id text,
  p_summary text,
  p_facts jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.simon_thread_owned(p_thread_id, p_device_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'forbidden');
  END IF;
  IF p_facts IS NOT NULL AND jsonb_typeof(p_facts) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_facts');
  END IF;

  UPDATE public.conversation_threads
  SET summary = left(btrim(COALESCE(p_summary, '')), 4000),
      summary_facts = COALESCE(p_facts, '[]'::jsonb),
      updated_at = now(),
      expires_at = now() + interval '14 days'
  WHERE thread_id = p_thread_id;

  RETURN jsonb_build_object('ok', true, 'thread_id', p_thread_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.simon_thread_delete(
  p_thread_id uuid,
  p_device_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.simon_thread_owned(p_thread_id, p_device_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'forbidden');
  END IF;

  DELETE FROM public.conversation_threads WHERE thread_id = p_thread_id;
  RETURN jsonb_build_object('ok', true, 'thread_id', p_thread_id);
END;
$$;

-- ============================================================================
-- 5. LONG-TERM MEMORY RPCS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.simon_memory_list(p_device_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_device text := public.simon_normalize_device_id(p_device_id);
  v_memories jsonb;
BEGIN
  IF v_uid IS NOT NULL THEN
    PERFORM public.simon_claim_device_data(p_device_id);
  ELSIF v_device IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'identity_required', 'memories', '[]'::jsonb);
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(m)::jsonb ORDER BY m.kind ASC, m.updated_at DESC), '[]'::jsonb)
  INTO v_memories
  FROM (
    SELECT
      sm.memory_id AS id,
      sm.kind,
      sm.key,
      sm.value,
      sm.source_thread_id,
      sm.updated_at,
      sm.expires_at
    FROM public.simon_memory sm
    WHERE sm.expires_at > now()
      AND (
        (v_uid IS NOT NULL AND sm.user_id = v_uid)
        OR (v_uid IS NULL AND sm.user_id IS NULL AND sm.device_id = v_device)
      )
    ORDER BY sm.kind ASC, sm.updated_at DESC
    LIMIT 50
  ) m;

  RETURN jsonb_build_object('ok', true, 'memories', v_memories);
END;
$$;

CREATE OR REPLACE FUNCTION public.simon_memory_upsert(
  p_device_id text,
  p_kind text,
  p_key text,
  p_value text,
  p_source_thread_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_device text := public.simon_normalize_device_id(p_device_id);
  v_key text := left(btrim(COALESCE(p_key, '')), 80);
  v_value text := left(btrim(COALESCE(p_value, '')), 500);
  v_source uuid := NULL;
  v_id uuid;
BEGIN
  IF p_kind NOT IN ('preference', 'fact') THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_kind');
  END IF;
  IF v_key = '' OR v_value = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_memory');
  END IF;
  IF v_uid IS NULL AND v_device IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'identity_required');
  END IF;

  IF p_source_thread_id IS NOT NULL
     AND public.simon_thread_owned(p_source_thread_id, p_device_id) THEN
    v_source := p_source_thread_id;
  END IF;

  IF v_uid IS NOT NULL THEN
    INSERT INTO public.simon_memory (
      user_id, device_id, kind, key, value, source_thread_id, expires_at
    ) VALUES (
      v_uid, NULL, p_kind, v_key, v_value, v_source, now() + interval '14 days'
    )
    ON CONFLICT (user_id, kind, key) WHERE user_id IS NOT NULL
    DO UPDATE SET
      value = excluded.value,
      source_thread_id = COALESCE(excluded.source_thread_id, public.simon_memory.source_thread_id),
      updated_at = now(),
      expires_at = now() + interval '14 days'
    RETURNING memory_id INTO v_id;
  ELSE
    INSERT INTO public.simon_memory (
      user_id, device_id, kind, key, value, source_thread_id, expires_at
    ) VALUES (
      NULL, v_device, p_kind, v_key, v_value, v_source, now() + interval '14 days'
    )
    ON CONFLICT (device_id, kind, key) WHERE device_id IS NOT NULL
    DO UPDATE SET
      value = excluded.value,
      source_thread_id = COALESCE(excluded.source_thread_id, public.simon_memory.source_thread_id),
      updated_at = now(),
      expires_at = now() + interval '14 days'
    RETURNING memory_id INTO v_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'memory_id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.simon_memory_delete(
  p_memory_id uuid,
  p_device_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_device text := public.simon_normalize_device_id(p_device_id);
BEGIN
  IF p_memory_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_memory');
  END IF;

  DELETE FROM public.simon_memory
  WHERE memory_id = p_memory_id
    AND (
      (v_uid IS NOT NULL AND user_id = v_uid)
      OR (v_uid IS NULL AND user_id IS NULL AND device_id = v_device)
    );

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_found');
  END IF;

  RETURN jsonb_build_object('ok', true, 'memory_id', p_memory_id);
END;
$$;

-- ============================================================================
-- 6. RETENTION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.simon_purge_expired()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_threads integer := 0;
  v_memories integer := 0;
BEGIN
  DELETE FROM public.conversation_threads WHERE expires_at <= now();
  GET DIAGNOSTICS v_threads = ROW_COUNT;

  DELETE FROM public.simon_memory WHERE expires_at <= now();
  GET DIAGNOSTICS v_memories = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'threads', v_threads, 'memories', v_memories);
END;
$$;

-- ============================================================================
-- 7. LEGACY RPC HARDENING (0007 / 0012)
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

  IF v_thread.user_id IS NOT NULL THEN
    -- Owned thread: only the owner, never an anonymous caller.
    IF v_uid IS DISTINCT FROM v_thread.user_id THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'forbidden', 'message', 'Access denied.');
    END IF;
  ELSE
    -- Anonymous thread: a session id is mandatory and must match. A null
    -- p_session_id no longer skips the check (the 0012 hole).
    IF p_session_id IS NULL
       OR btrim(p_session_id) = ''
       OR v_thread.session_id <> p_session_id THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'forbidden', 'message', 'Access denied.');
    END IF;
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', m.message_id,
      'role', m.role,
      'content', m.content,
      'metadata', m.metadata,
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
  v_existing public.conversation_threads%ROWTYPE;
BEGIN
  IF p_thread_id IS NULL OR p_session_id IS NULL OR btrim(p_session_id) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_thread_input', 'message', 'thread_id and session_id are required.');
  END IF;

  SELECT * INTO v_existing FROM public.conversation_threads WHERE thread_id = p_thread_id;

  IF FOUND THEN
    IF v_existing.user_id IS NOT NULL THEN
      IF v_uid IS NULL OR v_existing.user_id <> v_uid THEN
        RETURN jsonb_build_object('ok', false, 'reason_code', 'forbidden', 'message', 'Access denied.');
      END IF;
    ELSE
      IF v_existing.session_id IS DISTINCT FROM p_session_id THEN
        RETURN jsonb_build_object('ok', false, 'reason_code', 'forbidden', 'message', 'Access denied.');
      END IF;
    END IF;
  END IF;

  INSERT INTO public.conversation_threads (
    thread_id, user_id, session_id, page_context, updated_at
  ) VALUES (
    p_thread_id, v_uid, p_session_id, COALESCE(p_page_context, '{}'::jsonb), now()
  )
  ON CONFLICT (thread_id) DO UPDATE SET
    user_id = COALESCE(v_uid, public.conversation_threads.user_id),
    page_context = CASE WHEN p_page_context IS NOT NULL AND p_page_context <> '{}'::jsonb THEN p_page_context ELSE public.conversation_threads.page_context END,
    updated_at = now();

  IF p_user_content IS NOT NULL AND btrim(p_user_content) <> '' THEN
    INSERT INTO public.conversation_messages (
      message_id, thread_id, role, content, created_at
    ) VALUES (
      v_user_msg_id, p_thread_id, 'user', btrim(p_user_content), now()
    );
  END IF;

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
-- 8. GRANTS
-- ============================================================================

REVOKE ALL ON FUNCTION public.simon_normalize_device_id(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.simon_thread_owned(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.simon_purge_expired() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.simon_claim_device_data(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.simon_thread_list(text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simon_thread_get(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simon_save_turn(uuid, text, text, text, text, text, jsonb, jsonb, jsonb, text[], text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simon_thread_rename(uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simon_thread_set_title(uuid, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simon_thread_set_summary(uuid, text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simon_thread_delete(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simon_memory_list(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simon_memory_upsert(text, text, text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simon_memory_delete(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simon_purge_expired() TO service_role;

-- ============================================================================
-- 9. RETENTION SCHEDULE (best effort; the /api/cron route is the fallback)
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_cron;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    BEGIN
      PERFORM cron.unschedule('simon-retention');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    BEGIN
      PERFORM cron.schedule(
        'simon-retention',
        '17 * * * *',
        'SELECT public.simon_purge_expired();'
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
END;
$$;
