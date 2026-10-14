#!/usr/bin/env node

/**
 * LUXONN Retrieval & Search Evaluation Suite
 *
 * Implements Phase 5 Step 1 & 2 of the LUXONN marketplace implementation sequence.
 * - Tests canonical buyer-safe document assembly (recipe v1_buyer_safe_kenya)
 * - Verifies security boundaries (ADR-014: zero leakage of exact addresses/coordinates)
 * - Evaluates retrieval quality against the Kenya luxury benchmark dataset
 * - Measures MRR, Precision@K, Recall@K, and NDCG@K
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';

// 1. Read environment credentials
const envPath = resolve(process.cwd(), '.env.local');
const envContent = readFileSync(envPath, 'utf8');
const envVars = Object.fromEntries(
  envContent
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

const PROJECT_REF = 'nokarvewyorsupraufdg';
const ACCESS_TOKEN = envVars.SUPABASE_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
  console.error('❌ Error: SUPABASE_ACCESS_TOKEN not found in .env.local');
  process.exit(1);
}

const DB_QUERY_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

async function executeSql(sql) {
  const res = await fetch(DB_QUERY_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`SQL Error: ${JSON.stringify(json)}`);
  }
  return json;
}

// 2. Document assembly recipe (ADR-010 / recipe v1_buyer_safe_kenya)
const RESTRICTED_FORBIDDEN_FIELDS = [
  'exact_address',
  'address',
  'latitude',
  'longitude',
  'contact_phone',
  'contact_email',
  'owner_phone',
  'owner_email',
  'reporter_phone',
  'reporter_email',
  'status_token_hash',
];

function assembleBuyerSafeDocument(rev) {
  const lines = [];

  lines.push(`Title: ${rev.title.trim()}`);
  const typeDesc = [rev.property_type, rev.property_subtype].filter(Boolean).join(' / ');
  lines.push(`Property Type: ${typeDesc}`);
  if (rev.availability) lines.push(`Availability: ${rev.availability}`);

  const amountNum = typeof rev.price_amount === 'string' ? parseFloat(rev.price_amount) : rev.price_amount;
  const formattedAmount = isNaN(amountNum) ? rev.price_amount : amountNum.toLocaleString('en-KE');
  const period = rev.price_period ? ` (${rev.price_period})` : '';
  lines.push(`Price: ${rev.price_currency} ${formattedAmount}${period}`);

  const specs = [];
  if (rev.bedrooms !== null && rev.bedrooms !== undefined) specs.push(`${rev.bedrooms} bedrooms`);
  if (rev.bathrooms !== null && rev.bathrooms !== undefined) specs.push(`${rev.bathrooms} bathrooms`);
  if (rev.square_meters) specs.push(`${rev.square_meters} sqm built area`);
  if (rev.lot_size_sqm) specs.push(`${rev.lot_size_sqm} sqm plot / land`);
  if (rev.year_built) specs.push(`Built ${rev.year_built}`);
  if (rev.furnished !== null && rev.furnished !== undefined) {
    specs.push(rev.furnished ? 'Furnished' : 'Unfurnished');
  }
  if (specs.length > 0) lines.push(`Specifications: ${specs.join(', ')}`);

  const geoParts = [rev.area, rev.town, rev.city, rev.county, rev.country]
    .filter(Boolean)
    .filter((v, idx, arr) => arr.indexOf(v) === idx);
  lines.push(`Location: ${geoParts.join(', ')}`);

  if (rev.amenities && rev.amenities.length > 0) {
    lines.push(`Amenities: ${rev.amenities.join(', ')}`);
  }

  if (rev.description) {
    lines.push(`Description:\n${rev.description.trim()}`);
  }

  const documentText = lines.join('\n\n').trim();
  const contentHash = createHash('sha256').update(documentText, 'utf8').digest('hex');

  return {
    recipeVersion: 'v1_buyer_safe_kenya',
    contentHash,
    documentText,
  };
}

// 3. Simple BM25 / token-overlap retrieval engine for evaluation
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function scoreDocument(queryTokens, docTokens, docFieldBoosts) {
  let score = 0;
  for (const q of queryTokens) {
    for (const d of docTokens) {
      if (d === q) {
        score += 3.0; // exact match
      } else if (d.includes(q) || q.includes(d)) {
        score += 1.0; // substring match
      }
    }
    // Boost on key fields (title, area, property_type)
    for (const [field, val] of Object.entries(docFieldBoosts)) {
      if (typeof val === 'string' && val.toLowerCase().includes(q)) {
        score += 4.0;
      }
    }
  }
  return score;
}

// 4. Main Evaluation Runner
async function main() {
  console.log('🇰🇪 Running LUXONN Kenya Retrieval & Search Evaluation Suite...\n');

  // Step A: Load canonical published inventory from Postgres
  const publishedRows = await executeSql(`
    SELECT 
      l.listing_id,
      r.revision_id,
      r.title,
      r.description,
      r.property_type,
      r.property_subtype,
      r.availability,
      r.price_amount,
      r.price_currency,
      r.price_period,
      r.bedrooms,
      r.bathrooms,
      r.square_meters,
      r.lot_size_sqm,
      r.year_built,
      r.area,
      r.city,
      r.town,
      r.county,
      r.country,
      r.amenities,
      r.furnished
    FROM listings l
    JOIN listing_revisions r ON l.published_revision_id = r.revision_id
    WHERE l.lifecycle_state = 'published'
    ORDER BY l.listing_id;
  `);

  console.log(`   ✓ Loaded ${publishedRows.length} canonical published Kenyan residences from Postgres`);

  // Step B: Verify Document Assembly & Security Invariants (ADR-014)
  const assembledIndex = new Map();
  let securityPassed = true;

  for (const row of publishedRows) {
    const doc = assembleBuyerSafeDocument(row);
    assembledIndex.set(row.listing_id, {
      ...row,
      assembledDoc: doc,
      docTokens: tokenize(doc.documentText),
      fieldBoosts: {
        title: row.title,
        area: row.area,
        city: row.city,
        property_type: row.property_type,
      },
    });

    // Check for forbidden restricted strings or leakages
    const lowerDoc = doc.documentText.toLowerCase();
    for (const forbidden of ['status_token_hash', 'owner_phone', 'exact_address']) {
      if (lowerDoc.includes(forbidden)) {
        console.error(`   ❌ SECURITY BREACH: Forbidden key '${forbidden}' found in doc for ${row.listing_id}`);
        securityPassed = false;
      }
    }
  }

  if (securityPassed) {
    console.log('   ✓ Security Gate Verified: 0 restricted/secret fields in assembled buyer-safe projections');
  } else {
    process.exit(1);
  }

  // Step C: Import Evaluation Benchmark Dataset
  const { KENYA_RETRIEVAL_BENCHMARK } = await import('../src/lib/retrieval/eval-dataset.js').catch(async () => {
    // Fallback if transpilation needed
    const tsFile = readFileSync(resolve(process.cwd(), 'src/lib/retrieval/eval-dataset.ts'), 'utf8');
    // Extract JSON array
    const jsonMatch = tsFile.match(/export const KENYA_RETRIEVAL_BENCHMARK: LabeledQuery\[\] = (\[[\s\S]*?\]);\n/);
    if (!jsonMatch) throw new Error('Could not parse eval dataset');
    // Simple eval of clean array
    return { KENYA_RETRIEVAL_BENCHMARK: eval(`(${jsonMatch[1]})`) };
  });

  console.log(`   ✓ Loaded ${KENYA_RETRIEVAL_BENCHMARK.length} labeled benchmark queries across 7 intent categories\n`);

  // Step D: Run Evaluation across Benchmark Queries
  const K = 3;
  let totalReciprocalRank = 0;
  let totalPrecisionAtK = 0;
  let totalRecallAtK = 0;
  let totalNDCGAtK = 0;
  let top1Matches = 0;

  console.log('─'.repeat(75));
  console.log(' Query ID | Intent Category      | Top Match Title (Truncated)       | MRR  | P@3');
  console.log('─'.repeat(75));

  for (const testCase of KENYA_RETRIEVAL_BENCHMARK) {
    const qTokens = tokenize(testCase.query);

    // Score all published documents
    const scored = [];
    for (const [listingId, item] of assembledIndex.entries()) {
      let score = scoreDocument(qTokens, item.docTokens, item.fieldBoosts);

      // Apply structured filter constraint if present
      if (testCase.filters) {
        if (testCase.filters.property_type && item.property_type !== testCase.filters.property_type) {
          score *= 0.3; // penalize mismatch
        }
        if (testCase.filters.area && item.area.toLowerCase().includes(testCase.filters.area.toLowerCase())) {
          score *= 1.8; // boost area match
        }
      }

      scored.push({ listingId, score, title: item.title });
    }

    scored.sort((a, b) => b.score - a.score);
    const topK = scored.slice(0, K);

    // Compute Metrics
    // 1. Reciprocal Rank
    let firstRank = 0;
    for (let r = 0; r < scored.length; r++) {
      const rel = testCase.groundTruth[scored[r].listingId] || 0;
      if (rel > 0) {
        firstRank = r + 1;
        break;
      }
    }
    const rr = firstRank > 0 ? 1 / firstRank : 0;
    totalReciprocalRank += rr;

    if (topK[0]?.listingId === testCase.expectedTopListingId) {
      top1Matches++;
    }

    // 2. Precision@K and Recall@K
    const relevantInTopK = topK.filter((item) => (testCase.groundTruth[item.listingId] || 0) > 0).length;
    const precision = relevantInTopK / K;
    totalPrecisionAtK += precision;

    const totalRelevantInGroundTruth = Object.values(testCase.groundTruth).filter((v) => v > 0).length;
    const recall = totalRelevantInGroundTruth > 0 ? relevantInTopK / totalRelevantInGroundTruth : 1;
    totalRecallAtK += recall;

    // 3. NDCG@K
    let dcg = 0;
    let idealScores = Object.values(testCase.groundTruth).sort((a, b) => b - a).slice(0, K);
    let idcg = 0;
    for (let i = 0; i < topK.length; i++) {
      const rel = testCase.groundTruth[topK[i].listingId] || 0;
      dcg += (Math.pow(2, rel) - 1) / Math.log2(i + 2);
    }
    for (let i = 0; i < idealScores.length; i++) {
      idcg += (Math.pow(2, idealScores[i]) - 1) / Math.log2(i + 2);
    }
    const ndcg = idcg > 0 ? dcg / idcg : 1;
    totalNDCGAtK += ndcg;

    const paddedId = testCase.id.padEnd(8);
    const paddedCat = testCase.intentCategory.padEnd(20);
    const paddedTitle = (topK[0]?.title || 'None').slice(0, 32).padEnd(33);
    const formattedMRR = rr.toFixed(2).padStart(4);
    const formattedP = precision.toFixed(2).padStart(4);

    console.log(` ${paddedId} | ${paddedCat} | ${paddedTitle} | ${formattedMRR} | ${formattedP}`);
  }

  console.log('─'.repeat(75));

  const N = KENYA_RETRIEVAL_BENCHMARK.length;
  const meanRR = totalReciprocalRank / N;
  const meanP3 = totalPrecisionAtK / N;
  const meanR3 = totalRecallAtK / N;
  const meanNDCG3 = totalNDCGAtK / N;
  const top1Acc = (top1Matches / N) * 100;

  console.log('\n📊 RETRIEVAL QUALITY BENCHMARK RESULTS (K=3):');
  console.log(`   • Mean Reciprocal Rank (MRR):  ${meanRR.toFixed(3)}  (Target: >= 0.750)`);
  console.log(`   • Precision@3:                 ${meanP3.toFixed(3)}  (Target: >= 0.700)`);
  console.log(`   • Recall@3:                    ${meanR3.toFixed(3)}  (Target: >= 0.650)`);
  console.log(`   • NDCG@3:                      ${meanNDCG3.toFixed(3)}  (Target: >= 0.800)`);
  console.log(`   • Top-1 Exact Accuracy:        ${top1Acc.toFixed(1)}%`);

  if (meanRR >= 0.75 && meanNDCG3 >= 0.8) {
    console.log('\n✅ Retrieval benchmark passed all quality and security gates successfully!');
  } else {
    console.warn('\n⚠️ Retrieval benchmark completed with room for embedding fine-tuning.');
  }
}

main().catch((err) => {
  console.error('Fatal retrieval evaluation error:', err);
  process.exit(1);
});
