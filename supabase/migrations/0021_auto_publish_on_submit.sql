-- =====================================================================
-- Migration: 0021_auto_publish_on_submit.sql
-- Description: a submitted listing goes live immediately. No review gate.
--
-- WHY: owner instruction, verbatim, in the transcript: "it says a person
-- listing must be reviewed, no one has time for reviewwing, let it just auto
-- show, no reviewwing". KEY-POINTS.md decision 1 says the same: "No
-- pre-publication review. A listing goes live when its owner publishes it.
-- Moderation is after the fact only."
--
-- The database did not do that. submit_revision_for_review set both
-- revision_state and lifecycle_state to 'submitted' and inserted an OPEN
-- moderation case of kind 'submission'. The only command that could then move
-- a listing to 'published' was decide_moderation_case with 'approve', which is
-- gated on caller_is_platform_moderator().
--
-- So an owner published and then waited for a moderator who may never come.
-- Measured in production this session: 7 listings sit in 'submitted', the
-- oldest since 2026-10-13, each with an OPEN 'submission' case, none visible
-- to a buyer.
--
-- THIS FUNCTION WAS READ FROM THE LIVE DATABASE BEFORE EDITING. Its real
-- signature is (p_revision_id uuid, p_idempotency_key text) -- it takes a
-- REVISION id, not a listing id, which is what an earlier draft of this
-- migration got wrong and had to be withdrawn for. Everything below is the
-- live body with the review gate removed; nothing else is invented.
--
-- WHAT CHANGES
--   1. The transition becomes the same atomic pointer swap
--      decide_moderation_case uses, so the two paths cannot disagree about
--      what "published" means.
--   2. The moderation_cases insert, the reference loop, the pre-checks and the
--      moderation.case_opened outbox event are gone. Nothing is submitted for
--      review any more.
--   3. Audit action becomes 'listing_revision.publish' with reason
--      'auto_publish', so the two paths are distinguishable in the log.
--
-- WHAT DOES NOT CHANGE
--   * The idempotent-replay path, the membership check, the draft-only guard,
--     the restricted-field validation upstream of this function, and the
--     pointer-poisoning protection: published_ref_revision_id is still
--     generated as CASE WHEN revision_state = 'published' THEN revision_id END
--     and listings.published_revision_id still FKs onto it, so a listing still
--     physically cannot point at an unpublished revision.
--   * decide_moderation_case. Takedown, reject and request_changes still work.
--     Moderation survives as a takedown surface, not a gate.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   * It does not backfill the 7 listings already stuck in 'submitted'. They
--     are 'submitted', not 'draft', so this function rejects them by design.
--     Publishing live production content that has never been approved is a
--     decision, not a side effect of a refactor -- see the note at the bottom.
--
-- Rollback: the pre-image is the live function, whose full body is quoted in
-- the two files under scratch/ so this change is reviewable without a
-- database connection.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.submit_revision_for_review(p_revision_id uuid, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_uid         uuid := public.current_app_user_id();
  v_revision    public.listing_revisions%ROWTYPE;
  v_listing     public.listings%ROWTYPE;
  v_correlation text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authenticated',
      'message', 'Sign in to publish a listing.');
  END IF;
  IF p_revision_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_input',
      'message', 'revision_id is required.');
  END IF;

  v_correlation := COALESCE(NULLIF(p_idempotency_key, ''), gen_random_uuid()::text);

  -- ---------- idempotent replay ----------
  -- Unchanged in shape. The action name moves with the transition below so a
  -- replay looks for the record this function now writes.
  IF NULLIF(p_idempotency_key, '') IS NOT NULL THEN
    DECLARE
      v_published uuid;
    BEGIN
      SELECT resource_id::uuid INTO v_published
        FROM public.audit_records
       WHERE action = 'listing_revision.publish'
         AND request_id = v_correlation
         AND outcome = 'accepted'
         AND actor_id = v_uid
       LIMIT 1;
      IF v_published IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'idempotent_replay', true,
          'revision_id', p_revision_id);
      END IF;
    END;
  END IF;

  SELECT * INTO v_revision
    FROM public.listing_revisions r WHERE r.revision_id = p_revision_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'revision_not_found',
      'message', 'No such revision.');
  END IF;

  IF NOT public.caller_is_org_member(v_revision.organization_id) THEN
    INSERT INTO public.audit_records (
      actor_type, actor_id, organization_id, action,
      resource_type, resource_id, request_id, outcome, reason_code)
    VALUES ('owner', v_uid, v_revision.organization_id, 'listing_revision.publish',
      'listing_revision', p_revision_id::text, v_correlation,
      'rejected', 'not_authorized');
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_authorized',
      'message', 'You are not a member of this revision''s organization.');
  END IF;

  IF v_revision.revision_state <> 'draft' THEN
    INSERT INTO public.audit_records (
      actor_type, actor_id, organization_id, action,
      resource_type, resource_id, request_id, outcome, reason_code)
    VALUES ('owner', v_uid, v_revision.organization_id, 'listing_revision.publish',
      'listing_revision', p_revision_id::text, v_correlation,
      'rejected', 'invalid_state');
    RETURN jsonb_build_object('ok', false, 'reason_code', 'invalid_state',
      'message', 'Only a draft revision can be published.');
  END IF;

  SELECT * INTO v_listing
    FROM public.listings l WHERE l.listing_id = v_revision.listing_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'listing_not_found',
      'message', 'The revision''s listing no longer exists.');
  END IF;

  -- ---------- transition: DRAFT -> PUBLISHED ----------
  -- The mirror rule is gone with the 'submitted' state it existed for: there
  -- is no longer an unpublished pipeline state to keep off the Listing, so the
  -- listing follows the revision to 'published' in the same command.
  PERFORM set_config('luxonn.domain_command', 'on', true);

  -- 1. Advance the revision. Identical to decide_moderation_case's step 1.
  UPDATE public.listing_revisions
     SET revision_state = 'published',
         published_at = now(),
         updated_at = now()
   WHERE revision_id = p_revision_id;

  -- 2. Atomic swap of the listing pointer and lifecycle. Identical to
  --    decide_moderation_case's step 2, and safe by construction: the FK is
  --    onto published_ref_revision_id, which is non-NULL only for a published
  --    revision, so this UPDATE cannot point at anything unpublished.
  UPDATE public.listings
     SET published_revision_id = p_revision_id,
         lifecycle_state = 'published',
         updated_at = now()
   WHERE listing_id = v_revision.listing_id;

  PERFORM set_config('luxonn.domain_command', 'off', true);

  -- ---------- audit + outbox ----------
  -- One audit row and one event, both for the publish. The
  -- moderation.case_opened event is gone because no case is opened.
  INSERT INTO public.audit_records (
    actor_type, actor_id, organization_id, action,
    resource_type, resource_id, request_id, outcome, reason_code)
  VALUES (
    'owner', v_uid, v_revision.organization_id, 'listing_revision.publish',
    'listing_revision', p_revision_id::text, v_correlation,
    'accepted', 'auto_publish');

  INSERT INTO public.outbox_events (
    organization_id, event_type, aggregate_type, aggregate_id,
    correlation_id, payload)
  VALUES
    (v_revision.organization_id, 'listing_revision.published',
     'listing_revision', p_revision_id::text, v_correlation,
     jsonb_build_object(
       'revision_id', p_revision_id,
       'listing_id', v_revision.listing_id,
       'organization_id', v_revision.organization_id));

  RETURN jsonb_build_object('ok', true, 'idempotent_replay', false,
    'revision_id', p_revision_id,
    'listing_id', v_revision.listing_id,
    'published_at', now());
END $function$;

-- Grants unchanged: the owner path is `authenticated` only, never anon.
REVOKE ALL ON FUNCTION public.submit_revision_for_review(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_revision_for_review(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------
-- A guard, so the gate cannot be reintroduced quietly
-- ---------------------------------------------------------------------
-- Auto-publish is a decision, not an implementation detail. If a future
-- migration re-opens submission cases, this function is the tripwire: it is
-- called by nothing, and exists only so the next person has to read it.
CREATE OR REPLACE FUNCTION public.assert_no_submission_gate()
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'auto-publish regression: submission cases exist'
    USING HINT = 'Auto-publish was added on owner instruction (0021). A submission moderation case means the review gate came back.';
END $$;

COMMENT ON FUNCTION public.assert_no_submission_gate() IS
  'Tripwire for auto-publish. An open submission moderation case means the pre-publication review gate was reintroduced after being removed on owner instruction. This function is never called; it exists to be read.';

COMMIT;

-- ---------------------------------------------------------------------
-- NOT DONE, ON PURPOSE, AND IT NEEDS YOUR WORD
-- ---------------------------------------------------------------------
-- The 7 listings currently stuck in 'submitted' stay exactly where they are.
-- This function now rejects them (they are not 'draft'), so auto-publish fixes
-- the path going forward and leaves the backlog untouched.
--
-- Backfilling them is one UPDATE and it is genuinely a decision:
--
--   UPDATE public.listing_revisions r
--      SET revision_state = 'published', published_at = now()
--    WHERE r.revision_state = 'submitted';
--   UPDATE public.listings l
--      SET lifecycle_state = 'published',
--          published_revision_id = (
--            SELECT rr.revision_id FROM public.listing_revisions rr
--             WHERE rr.listing_id = l.listing_id
--               AND rr.revision_state = 'published'
--             ORDER BY rr.published_at DESC LIMIT 1)
--    WHERE l.lifecycle_state = 'submitted';
--
-- Say the word and it becomes 0022 as its own migration, so it is reviewable
-- and reversible on its own rather than bundled into a refactor.
-- ---------------------------------------------------------------------
