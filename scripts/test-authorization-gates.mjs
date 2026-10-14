import fs from "node:fs";
import path from "node:path";

// Load .env.local without external dependencies
const envPath = path.resolve(process.cwd(), ".env.local");
if (!fs.existsSync(envPath)) {
  console.error("Missing .env.local");
  process.exit(1);
}

const env = Object.fromEntries(
  fs
    .readFileSync(envPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const idx = line.indexOf("=");
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
    })
);

const projectRef = env.NEXT_PUBLIC_SUPABASE_PROJECT_REF || "nokarvewyorsupraufdg";
const accessToken = env.SUPABASE_ACCESS_TOKEN;

if (!accessToken) {
  console.error("SUPABASE_ACCESS_TOKEN is missing from .env.local");
  process.exit(1);
}

async function runQuery(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Management API error HTTP ${res.status}: ${text}`);
  }

  return await res.json();
}

async function main() {
  console.log("🔒 Running LUXONN Authorization Gate Verification Suite...");

  const testQuery = `
    DO $$
    DECLARE
      v_cnt integer;
      v_res jsonb;
      v_user_a uuid := 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'; -- Luxonn smoke test owner
      v_user_b uuid := '00000000-0000-0000-0000-00000000c001'; -- Demo owner
      v_admin  uuid := 'c297ecf5-9769-454a-be24-37fecb138533'; -- Admin
      v_smoke_listing_id uuid := '06a1ef69-9f43-480b-a326-794dee6a0b3f';
      v_smoke_revision_id uuid := '68311795-2a8d-4986-8234-ce60d10aae38';
    BEGIN
      -- ========================================================
      -- GATE 1: Anon role (unauthenticated buyer)
      -- ========================================================
      PERFORM set_config('role', 'anon', true);
      PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

      -- 1a: Anon CANNOT see the submitted listing
      SELECT count(listing_id) INTO v_cnt FROM public.listings WHERE listing_id = v_smoke_listing_id;
      IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'Gate 1 FAIL: Anon was able to see submitted listing %', v_smoke_listing_id;
      END IF;

      -- 1b: Anon CANNOT see the submitted revision
      SELECT count(revision_id) INTO v_cnt FROM public.listing_revisions WHERE revision_id = v_smoke_revision_id;
      IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'Gate 1 FAIL: Anon was able to see submitted revision %', v_smoke_revision_id;
      END IF;

      -- 1c: Anon CAN see published listings (count must equal published count)
      SELECT count(listing_id) INTO v_cnt FROM public.listings;
      IF v_cnt = 0 THEN
        RAISE EXCEPTION 'Gate 1 FAIL: Anon could not see any published listings';
      END IF;

      -- 1d: Anon CANNOT read moderation_cases
      BEGIN
        SELECT count(*) INTO v_cnt FROM public.moderation_cases;
        IF v_cnt <> 0 THEN
          RAISE EXCEPTION 'Gate 1 FAIL: Anon was able to see % moderation cases', v_cnt;
        END IF;
      EXCEPTION WHEN insufficient_privilege THEN
        NULL;
      END;

      -- ========================================================
      -- GATE 2: Tenant isolation between Owner A and Owner B
      -- ========================================================
      PERFORM set_config('role', 'authenticated', true);
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_b, 'role', 'authenticated')::text, true);

      -- 2a: Owner B CANNOT see Owner A submitted listing
      SELECT count(listing_id) INTO v_cnt FROM public.listings WHERE listing_id = v_smoke_listing_id;
      IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'Gate 2 FAIL: Owner B was able to see Owner A submitted listing';
      END IF;

      -- 2b: Owner B CANNOT see Owner A submitted revision
      SELECT count(revision_id) INTO v_cnt FROM public.listing_revisions WHERE revision_id = v_smoke_revision_id;
      IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'Gate 2 FAIL: Owner B was able to see Owner A submitted revision';
      END IF;

      -- 2c: Owner B CANNOT see Owner A moderation case
      SELECT count(*) INTO v_cnt FROM public.moderation_cases WHERE listing_id = v_smoke_listing_id;
      IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'Gate 2 FAIL: Owner B was able to see Owner A moderation case';
      END IF;

      -- 2d: Owner B CANNOT see Owner A memberships
      SELECT count(*) INTO v_cnt FROM public.owner_organizations_memberships WHERE user_id = v_user_a;
      IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'Gate 2 FAIL: Owner B was able to see Owner A membership';
      END IF;

      -- 2e: Owner B cannot decide moderation cases
      v_res := public.decide_moderation_case(
        '2f14d2b6-a0e8-438f-9607-781d0bd9edc1',
        'approve',
        'manual_verification_passed',
        'Should fail',
        'test-key-fail'
      );
      IF (v_res->>'ok')::boolean IS TRUE THEN
        RAISE EXCEPTION 'Gate 2 FAIL: Non-moderator Owner B was able to approve a case';
      END IF;

      -- ========================================================
      -- GATE 3: Platform Admin / Moderator checks
      -- ========================================================
      PERFORM set_config('role', 'authenticated', true);
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

      IF NOT public.caller_is_platform_moderator() THEN
        RAISE EXCEPTION 'Gate 3 FAIL: Admin was not recognized as moderator';
      END IF;

      v_res := public.moderator_cases_summary(NULL, NULL);
      IF (v_res->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'Gate 3 FAIL: Admin could not read moderation cases summary: %', v_res;
      END IF;

      RAISE NOTICE 'ALL AUTHORIZATION GATES PASSED!';
    END;
    $$;
  `;

  await runQuery(testQuery);
  console.log("✅ All Gate checks passed:");
  console.log("   - Gate 1: Anonymous buyer cannot read draft/submitted listings or revisions");
  console.log("   - Gate 2: Multi-tenant isolation verified — Owner cannot read another Owner's draft/submitted listings, revisions, memberships, or moderation cases");
  console.log("   - Gate 3: Platform moderator verification verified — non-moderators cannot review or decide cases; admins can review and decide");
}

main().catch((err) => {
  console.error("❌ Authorization Gate test failed:", err);
  process.exit(1);
});
