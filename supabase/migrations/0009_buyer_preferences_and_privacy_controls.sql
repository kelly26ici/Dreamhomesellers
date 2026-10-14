-- Migration 0009: Buyer Preferences, Privacy Deletion Controls, and Operational Health
-- Implements Phase 6 Step 3 & Step 5:
-- 1. Controlled durable buyer preferences in Postgres with explicit consent flags.
-- 2. Right-to-be-forgotten purge RPC (Kenya Data Protection Act / GDPR).
-- 3. Operational health telemetry RPC for platform monitoring.

-- ============================================================================
-- 1. BUYER PREFERENCES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.buyer_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  preferred_cities text[] DEFAULT '{}'::text[],
  preferred_areas text[] DEFAULT '{}'::text[],
  preferred_property_types text[] DEFAULT '{}'::text[],
  budget_min numeric,
  budget_max numeric,
  budget_currency text DEFAULT 'KES',
  min_bedrooms integer,
  preferred_amenities text[] DEFAULT '{}'::text[],
  investment_purpose text CHECK (investment_purpose IN ('primary_residence', 'holiday_home', 'investment_rental', 'land_banking')),
  consent_marketing boolean DEFAULT false,
  consent_ai_personalization boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.buyer_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS buyer_pref_select ON public.buyer_preferences;
CREATE POLICY buyer_pref_select ON public.buyer_preferences
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS buyer_pref_update ON public.buyer_preferences;
CREATE POLICY buyer_pref_update ON public.buyer_preferences
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ============================================================================
-- 2. PREFERENCES DOMAIN RPCS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.upsert_buyer_preferences(
  p_preferred_cities text[] DEFAULT '{}'::text[],
  p_preferred_areas text[] DEFAULT '{}'::text[],
  p_preferred_property_types text[] DEFAULT '{}'::text[],
  p_budget_min numeric DEFAULT NULL,
  p_budget_max numeric DEFAULT NULL,
  p_budget_currency text DEFAULT 'KES',
  p_min_bedrooms integer DEFAULT NULL,
  p_preferred_amenities text[] DEFAULT '{}'::text[],
  p_investment_purpose text DEFAULT NULL,
  p_consent_marketing boolean DEFAULT false,
  p_consent_ai_personalization boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authenticated', 'message', 'Sign in required.');
  END IF;

  INSERT INTO public.buyer_preferences (
    user_id, preferred_cities, preferred_areas, preferred_property_types,
    budget_min, budget_max, budget_currency, min_bedrooms, preferred_amenities,
    investment_purpose, consent_marketing, consent_ai_personalization, updated_at
  ) VALUES (
    v_uid, p_preferred_cities, p_preferred_areas, p_preferred_property_types,
    p_budget_min, p_budget_max, COALESCE(p_budget_currency, 'KES'), p_min_bedrooms, p_preferred_amenities,
    p_investment_purpose, p_consent_marketing, p_consent_ai_personalization, now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    preferred_cities = EXCLUDED.preferred_cities,
    preferred_areas = EXCLUDED.preferred_areas,
    preferred_property_types = EXCLUDED.preferred_property_types,
    budget_min = EXCLUDED.budget_min,
    budget_max = EXCLUDED.budget_max,
    budget_currency = EXCLUDED.budget_currency,
    min_bedrooms = EXCLUDED.min_bedrooms,
    preferred_amenities = EXCLUDED.preferred_amenities,
    investment_purpose = EXCLUDED.investment_purpose,
    consent_marketing = EXCLUDED.consent_marketing,
    consent_ai_personalization = EXCLUDED.consent_ai_personalization,
    updated_at = now();

  RETURN jsonb_build_object('ok', true, 'user_id', v_uid);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_buyer_preferences()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_rec public.buyer_preferences%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authenticated');
  END IF;

  SELECT * INTO v_rec FROM public.buyer_preferences WHERE user_id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'preferences', NULL);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'preferences', jsonb_build_object(
      'preferred_cities', v_rec.preferred_cities,
      'preferred_areas', v_rec.preferred_areas,
      'preferred_property_types', v_rec.preferred_property_types,
      'budget_min', v_rec.budget_min,
      'budget_max', v_rec.budget_max,
      'budget_currency', v_rec.budget_currency,
      'min_bedrooms', v_rec.min_bedrooms,
      'preferred_amenities', v_rec.preferred_amenities,
      'investment_purpose', v_rec.investment_purpose,
      'consent_marketing', v_rec.consent_marketing,
      'consent_ai_personalization', v_rec.consent_ai_personalization,
      'updated_at', v_rec.updated_at
    )
  );
END;
$$;

-- ============================================================================
-- 3. PRIVACY PURGE RPC (RIGHT-TO-BE-FORGOTTEN)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.purge_buyer_personal_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_threads_deleted integer := 0;
  v_prefs_deleted integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authenticated');
  END IF;

  -- Delete buyer preferences
  DELETE FROM public.buyer_preferences WHERE user_id = v_uid;
  GET DIAGNOSTICS v_prefs_deleted = ROW_COUNT;

  -- Delete conversation threads and cascading messages
  DELETE FROM public.conversation_threads WHERE user_id = v_uid;
  GET DIAGNOSTICS v_threads_deleted = ROW_COUNT;

  -- Record audit trail
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
    'threads_deleted', v_threads_deleted
  );
END;
$$;

-- ============================================================================
-- 4. OPERATIONAL HEALTH TELEMETRY RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_platform_operational_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
      'pending_moderation_cases', v_pending_moderation,
      'open_viewing_requests', v_open_viewings
    )
  );
END;
$$;

-- ============================================================================
-- 5. GRANTS
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.upsert_buyer_preferences TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_buyer_preferences TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_buyer_personal_data TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_operational_health TO anon, authenticated, service_role;
