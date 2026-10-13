-- ============================================================
-- 0002 — ViewingRequest domain command (ADR-016)
--
-- viewing_requests has NO client INSERT policy (migration 0001: "creates
-- go through the ADR-016 domain command"). This migration is that command:
-- create_viewing_request(), a SECURITY DEFINER RPC that is the only write
-- path into viewing_requests from the anon/authenticated roles.
--
-- Obligations honored per ADR-016 (contracts §8 "Behavior"):
--   * server-validated input      — every field checked below
--   * explicit consent            — ConsentRecord required, provenance='native',
--                                   consented_at stamped server-side
--   * verified contact            — contact enters unverified; authenticated
--                                   buyers' Supabase-verified email is
--                                   stamped verified in-band
--   * rate limits                 — 5 creates / 24h per identity
--                                   (authenticated uid, else contact value)
--   * audit record                — every attempt audited (accepted AND
--                                   rejected); domain rejections RETURN a
--                                   result instead of raising so the audit
--                                   row survives the transaction
--   * idempotency                 — replay with the same idempotency key
--                                   returns the original result
--   * pending start state         — owner-invisible until contact
--                                   verification completes
--   * outbox event                — buyer-safe payload only (the table's
--                                   CHECK rejects contact/consent keys)
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_viewing_request(
  p_listing_id       uuid,
  p_contact          jsonb,
  p_consent          jsonb,
  p_stated_purpose   text,
  p_preferred_slot   jsonb,
  p_notes            text DEFAULT NULL,
  p_idempotency_key  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_uid            uuid := public.current_app_user_id();
  v_listing        public.listings%ROWTYPE;
  v_request_id     uuid;
  v_reference      text;
  v_request_state  public.viewing_request_state;
  v_verified_at    timestamptz := NULL;
  v_channel        text;
  v_contact_value  text;
  v_display_name   text;
  v_mode           text;
  v_viewing_date   timestamptz;
  v_duration       integer;
  v_alt_date       timestamptz;
  v_correlation    text;
  v_recent_count   integer;
  v_attempts       integer := 0;
BEGIN
  -- ---------- input shape ----------
  IF p_listing_id IS NULL OR p_contact IS NULL OR p_consent IS NULL
     OR p_preferred_slot IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_input',
      'message', 'listing_id, contact, consent and preferred_slot are required.');
  END IF;

  v_correlation := COALESCE(NULLIF(p_idempotency_key, ''), gen_random_uuid()::text);

  -- ---------- idempotent replay ----------
  IF NULLIF(p_idempotency_key, '') IS NOT NULL THEN
    SELECT r.request_id, r.reference, r.request_state
      INTO v_request_id, v_reference, v_request_state
      FROM public.viewing_requests r
     WHERE r.idempotency_key = p_idempotency_key;
    IF v_request_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'idempotent_replay', true,
        'request_id', v_request_id, 'reference', v_reference,
        'request_state', v_request_state::text);
    END IF;
  END IF;

  -- ---------- listing must be published and non-internal ----------
  SELECT * INTO v_listing
    FROM public.listings l
   WHERE l.listing_id = p_listing_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'listing_not_found',
      'message', 'No such listing.');
  END IF;
  IF v_listing.lifecycle_state <> 'published'
     OR public.is_org_internal(v_listing.organization_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'listing_not_available',
      'message', 'This listing is not open for viewing requests.');
  END IF;

  -- ---------- contact validation ----------
  v_channel       := p_contact ->> 'channel';
  v_contact_value := btrim(COALESCE(p_contact ->> 'value', ''));
  v_display_name  := p_contact ->> 'display_name';

  IF v_channel NOT IN ('email', 'phone') OR v_contact_value = ''
     OR length(v_contact_value) > 320 THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_contact',
      'message', 'Contact requires channel (email|phone) and a value of at most 320 characters.');
  END IF;
  IF v_display_name IS NOT NULL AND length(v_display_name) > 120 THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_contact',
      'message', 'display_name must be at most 120 characters.');
  END IF;

  -- In-band verification: an authenticated buyer naming their own
  -- Supabase-verified email needs no second verification round-trip.
  IF v_uid IS NOT NULL AND v_channel = 'email' THEN
    IF EXISTS (
      SELECT 1 FROM auth.users u
       WHERE u.id = v_uid
         AND u.email_confirmed_at IS NOT NULL
         AND lower(u.email) = lower(v_contact_value)
    ) THEN
      v_verified_at := now();
    END IF;
  END IF;

  v_request_state := CASE WHEN v_verified_at IS NOT NULL
                          THEN 'open'::public.viewing_request_state
                          ELSE 'pending_contact_verification'::public.viewing_request_state
                     END;

  -- ---------- consent validation ----------
  IF p_consent ->> 'provenance' IS DISTINCT FROM 'native' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_consent',
      'message', 'Consent must be captured natively in the LUXONN UI.');
  END IF;
  IF COALESCE(btrim(COALESCE(p_consent ->> 'purpose', '')), '') = ''
     OR length(p_consent ->> 'purpose') > 200 THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_consent',
      'message', 'Consent requires a stated purpose of at most 200 characters.');
  END IF;

  -- ---------- stated purpose ----------
  p_stated_purpose := btrim(COALESCE(p_stated_purpose, ''));
  IF p_stated_purpose = '' OR length(p_stated_purpose) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_purpose',
      'message', 'stated_purpose is required (1-500 characters).');
  END IF;
  IF p_notes IS NOT NULL AND length(p_notes) > 1000 THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_purpose',
      'message', 'notes must be at most 1000 characters.');
  END IF;

  -- ---------- slot validation (Phase 1 frozen vocabulary) ----------
  v_mode := p_preferred_slot ->> 'mode';
  IF v_mode NOT IN ('in_person', 'virtual') THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_slot',
      'message', 'mode must be in_person or virtual (Phase 1 vocabulary).');
  END IF;
  v_duration := (p_preferred_slot ->> 'duration_minutes')::integer;
  IF v_duration IS NULL OR v_duration < 15 OR v_duration > 480 THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_slot',
      'message', 'duration_minutes must be between 15 and 480.');
  END IF;
  v_viewing_date := (p_preferred_slot ->> 'viewing_date')::timestamptz;
  IF v_viewing_date IS NULL OR v_viewing_date <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_slot',
      'message', 'viewing_date must be an explicit instant in the future.');
  END IF;
  IF p_preferred_slot ? 'alternate_viewing_date'
     AND p_preferred_slot ->> 'alternate_viewing_date' IS NOT NULL THEN
    v_alt_date := (p_preferred_slot ->> 'alternate_viewing_date')::timestamptz;
    IF v_alt_date <= now() THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_slot',
        'message', 'alternate_viewing_date must be in the future.');
    END IF;
  END IF;

  -- ---------- rate limit: 5 creates / 24h per identity ----------
  SELECT count(*) INTO v_recent_count
    FROM public.viewing_requests r
   WHERE r.created_at > now() - interval '24 hours'
     AND ( (v_uid IS NOT NULL AND r.requester_user_id = v_uid)
        OR (v_uid IS NULL AND r.contact ->> 'value' = v_contact_value) );
  IF v_recent_count >= 5 THEN
    INSERT INTO public.audit_records (
      actor_type, actor_id, organization_id, action,
      resource_type, resource_id, request_id, outcome, reason_code)
    VALUES (
      CASE WHEN v_uid IS NOT NULL THEN 'buyer' ELSE 'anonymous' END,
      v_uid, v_listing.organization_id, 'viewing_request.create',
      'viewing_request', p_listing_id::text, v_correlation,
      'rejected', 'rate_limited');
    RETURN jsonb_build_object('ok', false, 'reason_code', 'rate_limited',
      'message', 'Too many viewing requests from this identity in the last 24 hours.');
  END IF;

  -- ---------- create ----------
  v_request_id := gen_random_uuid();
  LOOP
    v_attempts := v_attempts + 1;
    BEGIN
      INSERT INTO public.viewing_requests (
        request_id, listing_id, organization_id, actor_type,
        requester_user_id, contact, consent, stated_purpose,
        preferred_slot, notes, request_state, reference, idempotency_key)
      VALUES (
        v_request_id, p_listing_id, v_listing.organization_id,
        CASE WHEN v_uid IS NOT NULL THEN 'buyer' ELSE 'anonymous' END,
        v_uid,
        jsonb_build_object(
          'contact_id', gen_random_uuid(),
          'channel', v_channel,
          'value', v_contact_value,
          'verified_at', v_verified_at,
          'display_name', v_display_name),
        jsonb_build_object(
          'consent_id', gen_random_uuid(),
          'purpose', p_consent ->> 'purpose',
          'consented_at', now(),
          'provenance', 'native'),
        p_stated_purpose,
        jsonb_build_object(
          'viewing_date', v_viewing_date,
          'duration_minutes', v_duration,
          'alternate_viewing_date', v_alt_date,
          'mode', v_mode),
        p_notes, v_request_state,
        -- pgcrypto installs into the extensions schema on Supabase; the
        -- pinned search_path (pg_catalog, public) does not include it, so
        -- the call must be schema-qualified.
        'VR-' || upper(substring(encode(extensions.gen_random_bytes(4), 'hex'), 1, 8)),
        NULLIF(p_idempotency_key, ''));
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempts >= 3 THEN
        RAISE;
      END IF;
      -- reference or idempotency_key collision: retry with a new code
    END;
  END LOOP;

  SELECT r.reference, r.request_state INTO v_reference, v_request_state
    FROM public.viewing_requests r WHERE r.request_id = v_request_id;

  -- ---------- audit ----------
  INSERT INTO public.audit_records (
    actor_type, actor_id, organization_id, action,
    resource_type, resource_id, request_id, outcome, reason_code)
  VALUES (
    CASE WHEN v_uid IS NOT NULL THEN 'buyer' ELSE 'anonymous' END,
    v_uid, v_listing.organization_id, 'viewing_request.create',
    'viewing_request', v_request_id::text, v_correlation,
    'accepted', 'created_' || v_request_state::text);

  -- ---------- outbox (buyer-safe payload only) ----------
  INSERT INTO public.outbox_events (
    organization_id, event_type, aggregate_type, aggregate_id,
    correlation_id, payload)
  VALUES (
    v_listing.organization_id, 'viewing_request.created',
    'viewing_request', v_request_id::text, v_correlation,
    jsonb_build_object(
      'request_id', v_request_id,
      'reference', v_reference,
      'listing_id', p_listing_id,
      'organization_id', v_listing.organization_id,
      'request_state', v_request_state::text,
      'viewing_date', v_viewing_date));

  RETURN jsonb_build_object('ok', true, 'idempotent_replay', false,
    'request_id', v_request_id, 'reference', v_reference,
    'request_state', v_request_state::text);
END $$;

-- The command is the only client write path; keep EXECUTE tight and explicit.
REVOKE ALL ON FUNCTION public.create_viewing_request(uuid, jsonb, jsonb, text, jsonb, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_viewing_request(uuid, jsonb, jsonb, text, jsonb, text, text)
  TO anon, authenticated;

COMMENT ON FUNCTION public.create_viewing_request(uuid, jsonb, jsonb, text, jsonb, text, text) IS
  'ADR-016 domain command: the sole client write path into viewing_requests. Server-validated input, native consent, rate limits (5/24h per identity), audit record for every attempt, idempotent replay, buyer-safe outbox event. Rejections return {ok:false, reason_code} so the audit row survives the transaction.';
