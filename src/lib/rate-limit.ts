/**
 * ADR-016 anonymous usage controls: server-side rate limiting.
 *
 * Budgets (per the ADR): generous for cheap reads, tight for expensive
 * actions — chat turns and viewing requests are model calls and human
 * follow-up. Soft escalation before hard blocks.
 *
 * Implementation: in-process sliding window. Deliberately dependency-free
 * so it works on any host; the ADR's Redis upgrade path (per-user budgets,
 * multi-instance correctness) is a swap of this module's internals — the
 * call sites do not change.
 */

export type RateLimitTier = 'chat' | 'draftAssist' | 'viewing';

interface TierConfig {
  /** Max requests per window. */
  readonly limit: number;
  /** Window length in ms. */
  readonly windowMs: number;
}

const TIERS: Record<RateLimitTier, TierConfig> = {
  // Expensive: every chat turn can hit paid LLM APIs (ADR-016 "tightly
  // limited"). 10 turns / 10 min / IP, 40 / day.
  chat: { limit: 10, windowMs: 10 * 60_000 },
  // Owner draft assist proxies to Simon too, but owners are authenticated
  // and few; generous per-user budget.
  draftAssist: { limit: 20, windowMs: 10 * 60_000 },
  // Viewing requests already have a DB-layer limit (5/24h per identity in
  // migration 0002); this network-layer budget only stops pre-RPC floods.
  viewing: { limit: 6, windowMs: 60 * 60_000 },
};

/** Daily hard budget per tier per IP (soft-escalation backstop). */
const DAILY_LIMITS: Record<RateLimitTier, number> = {
  chat: 40,
  draftAssist: 100,
  viewing: 12,
};

interface Bucket {
  /** Timestamps of accepted requests inside the current window. */
  hits: number[];
  /** Timestamps accepted inside the current UTC day. */
  dayHits: number[];
  /** ISO date of dayHits (UTC), so the day bucket rolls at midnight. */
  day: string;
}

const buckets = new Map<string, Bucket>();

/** Cap memory: at most this many tracked keys; expired entries are evicted
 * first, then oldest-inserted. 10k keys is far above any realistic
 * single-instance load. */
const MAX_KEYS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the caller may retry (0 when allowed). */
  retryAfterSeconds: number;
  /** Which budget was hit, for logging/telemetry. */
  reason?: 'window' | 'daily';
}

function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function evictIfNeeded(): void {
  if (buckets.size <= MAX_KEYS) return;
  // Cheap lru-ish: drop entries whose buckets have fully emptied.
  for (const [key, bucket] of buckets) {
    if (bucket.hits.length === 0 && bucket.dayHits.length === 0) {
      buckets.delete(key);
    }
    if (buckets.size <= MAX_KEYS) return;
  }
  // Still over? Drop oldest-inserted (Map preserves insertion order).
  for (const key of buckets.keys()) {
    buckets.delete(key);
    if (buckets.size <= MAX_KEYS) return;
  }
}

export function checkRateLimit(
  tier: RateLimitTier,
  clientIp: string
): RateLimitResult {
  const cfg = TIERS[tier];
  const now = new Date();
  const nowMs = now.getTime();
  const today = dayKey(now);

  let bucket = buckets.get(`${tier}:${clientIp}`);
  if (!bucket || bucket.day !== today) {
    bucket = { hits: [], dayHits: [], day: today };
    buckets.set(`${tier}:${clientIp}`, bucket);
  }

  // Roll the window: drop hits older than windowMs.
  bucket.hits = bucket.hits.filter((t) => nowMs - t < cfg.windowMs);

  if (bucket.dayHits.length >= DAILY_LIMITS[tier]) {
    return { allowed: false, retryAfterSeconds: 3600, reason: 'daily' };
  }
  if (bucket.hits.length >= cfg.limit) {
    const oldest = bucket.hits[0] ?? nowMs;
    const retryAfter = Math.max(1, Math.ceil((oldest + cfg.windowMs - nowMs) / 1000));
    return { allowed: false, retryAfterSeconds: retryAfter, reason: 'window' };
  }

  bucket.hits.push(nowMs);
  bucket.dayHits.push(nowMs);
  evictIfNeeded();
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Extract a client IP from proxy-forwarded headers, falling back to the
 * direct peer. Standard posture for Next.js behind a reverse proxy: the
 * platform overwrites/honors the first X-Forwarded-For hop. */
export function clientIpFrom(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip') ?? 'unknown';
}
