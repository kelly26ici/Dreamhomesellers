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
  console.log("📸 Running LUXONN Media Ingestion & Storage Lifecycle Verification Suite...");

  // 1. Verify storage buckets
  const buckets = await runQuery(`
    SELECT id, name, public, file_size_limit FROM storage.buckets WHERE id IN ('listing-originals', 'listing-derivatives');
  `);

  if (!buckets.some((b) => b.id === "listing-originals" && b.public === false)) {
    throw new Error("listing-originals bucket missing or incorrectly configured as public");
  }
  if (!buckets.some((b) => b.id === "listing-derivatives" && b.public === true)) {
    throw new Error("listing-derivatives bucket missing or incorrectly configured as private");
  }
  console.log("   ✓ Storage buckets verified (listing-originals: private, listing-derivatives: public)");

  // 2. Verify storage RLS policies
  const policies = await runQuery(`
    SELECT policyname FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'listing_%';
  `);
  if (policies.length < 6) {
    throw new Error(`Expected at least 6 storage RLS policies, found ${policies.length}`);
  }
  console.log(`   ✓ Storage RLS policies on storage.objects verified (${policies.length} policies active)`);

  // 3. Verify media RPC lifecycle in transaction
  const lifecycleQuery = `
    DO $$
    DECLARE
      v_user_a uuid := 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      v_org_id uuid := '7a8b9c0d-e1f2-3456-7890-abcd12345678';
      v_draft_res jsonb;
      v_listing_id uuid;
      v_revision_id uuid;
      v_attach_res jsonb;
      v_attach_res2 jsonb;
      v_media_id_1 uuid;
      v_media_id_2 uuid;
      v_reorder_res jsonb;
      v_feat_res jsonb;
      v_get_res jsonb;
      v_del_res jsonb;
      v_outbox_cnt integer;
    BEGIN
      PERFORM set_config('role', 'authenticated', true);
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_a, 'role', 'authenticated')::text, true);

      v_draft_res := public.create_listing_draft(
        v_org_id,
        jsonb_build_object(
          'listing_kind', 'sale',
          'title', 'Media Lifecycle Test Villa',
          'description', 'Extensive architectural photography test residence in Karen.',
          'property_type', 'Villa',
          'availability', 'available',
          'price_amount', 145000000,
          'price_currency', 'KES',
          'price_period', 'one_time',
          'country', 'Kenya',
          'city', 'Nairobi',
          'area', 'Karen'
        ),
        'media-test-draft-key'
      );
      IF (v_draft_res->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'Failed to create draft: %', v_draft_res;
      END IF;

      v_listing_id := (v_draft_res->>'listing_id')::uuid;
      v_revision_id := (v_draft_res->>'revision_id')::uuid;

      -- Attach photo 1 (featured)
      v_attach_res := public.attach_listing_media(
        v_revision_id,
        v_org_id::text || '/' || v_revision_id::text || '/facade.jpg',
        'image',
        true,
        'hash-facade',
        'attach-key-facade'
      );
      IF (v_attach_res->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'Failed to attach photo 1: %', v_attach_res;
      END IF;
      v_media_id_1 := (v_attach_res->>'media_id')::uuid;

      -- Attach photo 2
      v_attach_res2 := public.attach_listing_media(
        v_revision_id,
        v_org_id::text || '/' || v_revision_id::text || '/garden.jpg',
        'image',
        false,
        'hash-garden',
        'attach-key-garden'
      );
      IF (v_attach_res2->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'Failed to attach photo 2: %', v_attach_res2;
      END IF;
      v_media_id_2 := (v_attach_res2->>'media_id')::uuid;

      -- Reorder media
      v_reorder_res := public.reorder_listing_media(
        v_revision_id,
        ARRAY[v_media_id_2, v_media_id_1],
        'reorder-key-1'
      );
      IF (v_reorder_res->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'Failed to reorder: %', v_reorder_res;
      END IF;

      -- Set featured to garden
      v_feat_res := public.set_featured_media(
        v_revision_id,
        v_media_id_2,
        'feat-key-1'
      );
      IF (v_feat_res->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'Failed to set featured: %', v_feat_res;
      END IF;

      -- Read back
      v_get_res := public.get_revision_media(v_revision_id);
      IF (v_get_res->>'ok')::boolean IS NOT TRUE OR jsonb_array_length(v_get_res->'items') <> 2 THEN
        RAISE EXCEPTION 'Read back failed: %', v_get_res;
      END IF;

      -- Delete photo 1
      v_del_res := public.delete_listing_media(v_media_id_1, 'del-key-1');
      IF (v_del_res->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'Delete failed: %', v_del_res;
      END IF;

      -- Remaining count is 1
      v_get_res := public.get_revision_media(v_revision_id);
      IF jsonb_array_length(v_get_res->'items') <> 1 THEN
        RAISE EXCEPTION 'Expected 1 item after delete, got %', jsonb_array_length(v_get_res->'items');
      END IF;

      -- Verify outbox event as service role
      RESET ROLE;
      SELECT count(*) INTO v_outbox_cnt
      FROM public.outbox_events
      WHERE event_type = 'media.uploaded'
        AND aggregate_id = v_media_id_2::text;
      IF v_outbox_cnt <> 1 THEN
        RAISE EXCEPTION 'Outbox event media.uploaded missing';
      END IF;

      RAISE EXCEPTION 'ROLLBACK_TEST_SUCCESS';
    END;
    $$;
  `;

  try {
    await runQuery(lifecycleQuery);
  } catch (err) {
    if (err.message && err.message.includes("ROLLBACK_TEST_SUCCESS")) {
      console.log("   ✓ Media domain command lifecycle verified (attach, reorder, featured, delete, outbox emission)");
    } else {
      throw err;
    }
  }

  console.log("✅ All Media Ingestion tests passed successfully!");
}

main().catch((err) => {
  console.error("❌ Media lifecycle test failed:", err);
  process.exit(1);
});
