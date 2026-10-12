/**
 * URL <-> filter-state mapping for the buyer grid (ADR-006: the URL is the
 * search state). The page is a pure function of these params; the filter
 * bar writes them back with router.replace so every view is shareable,
 * back/forward-navigable, and server-renderable.
 *
 * Param vocabulary (kept short for shareable Kenyan URLs):
 *   q / kind / county / type / beds / min / max / sort / page
 *
 * Nothing here trusts client input: unknown values fall back to defaults,
 * numbers are clamped, and page can't go below 1.
 */

import type { ListingKind } from '@/lib/contracts/listing';
import type { ListingFilters, ListingSort } from './read-model';

const SORTS: readonly ListingSort[] = [
  'newest',
  'price-asc',
  'price-desc',
  'bedrooms-desc',
];

const KINDS: readonly string[] = ['sale', 'rent', 'shortlet'];
const MAX_BEDS = 10;
/** Ceiling guard: KES amounts fit comfortably; anything bigger is bogus. */
const MAX_PRICE = 10_000_000_000;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function all(value: string | string[] | undefined): string[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function toNumber(raw: string | undefined, max: number): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.min(n, max);
}

/** Parse Next.js searchParams (already awaited by the caller) into state. */
export function parseListingFilters(
  params: Record<string, string | string[] | undefined>,
): ListingFilters
{
  const sortRaw = first(params.sort);
  const pageRaw = first(params.page);
  const page = pageRaw ? Number(pageRaw) : 1;
  const kinds = all(params.kind).filter((k): k is ListingKind =>
    KINDS.includes(k),
  );

  return {
    q: first(params.q)?.trim() || undefined,
    kinds: kinds.length ? kinds : undefined,
    county: first(params.county) || undefined,
    type: first(params.type) || undefined,
    minBedrooms: toNumber(first(params.beds), MAX_BEDS),
    minPrice: toNumber(first(params.min), MAX_PRICE),
    maxPrice: toNumber(first(params.max), MAX_PRICE),
    sort: SORTS.includes(sortRaw as ListingSort)
      ? (sortRaw as ListingSort)
      : 'newest',
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** Serialize state back to params, omitting defaults for clean URLs. */
export function filtersToParams(filters: ListingFilters): {
  q?: string;
  kind?: string; // comma-joined; split by buildListingUrl
  county?: string;
  type?: string;
  beds?: string;
  min?: string;
  max?: string;
  sort?: string;
  page?: string;
} {
  const out: ReturnType<typeof filtersToParams> = {};
  if (filters.q) out.q = filters.q;
  if (filters.kinds?.length) out.kind = filters.kinds.join(',');
  if (filters.county) out.county = filters.county;
  if (filters.type) out.type = filters.type;
  if (filters.minBedrooms != null) out.beds = String(filters.minBedrooms);
  if (filters.minPrice != null) out.min = String(filters.minPrice);
  if (filters.maxPrice != null) out.max = String(filters.maxPrice);
  if (filters.sort !== 'newest') out.sort = filters.sort;
  if (filters.page > 1) out.page = String(filters.page);
  return out;
}

/**
 * Build a canonical /properties URL for the given state (router.replace in
 * the filter bar; also usable for share links). Multi-kind arrives
 * comma-joined and splits into repeated `kind` params, matching the parse
 * side's all().
 */
export function buildListingUrl(filters: ListingFilters): string {
  const params = new URLSearchParams();
  const p = filtersToParams(filters);
  if (p.q) params.set('q', p.q);
  for (const k of p.kind?.split(',') ?? []) {
    if (k) params.append('kind', k);
  }
  if (p.county) params.set('county', p.county);
  if (p.type) params.set('type', p.type);
  if (p.beds) params.set('beds', p.beds);
  if (p.min) params.set('min', p.min);
  if (p.max) params.set('max', p.max);
  if (p.sort) params.set('sort', p.sort);
  if (p.page) params.set('page', p.page);
  const qs = params.toString();
  return qs ? `/properties?${qs}` : '/properties';
}
