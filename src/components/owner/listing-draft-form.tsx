'use client';

/**
 * Listing draft form — creates a listing + its first draft revision.
 *
 * Runs in the browser (per-keystroke state), but authority stays
 * server-side: create_listing_draft (migration 0003, SECURITY DEFINER)
 * re-checks org membership and runs validate_revision_content, so the
 * SQL validator is the authority. The type on RevisionContentInput makes
 * ADR-014's restricted fields (exact_address, latitude, longitude)
 * unrepresentable.
 *
 * Save = create the draft, then hand off to the listing detail surface,
 * where Edit and Submit-for-review live. One write per surface keeps each
 * screen single-purpose and the lifecycle transitions visible.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  createListingDraft,
  type RevisionContentInput,
} from '@/lib/owner/write-model';

/** reason_code → user copy, mirroring the SQL validator's documented
 *  rejections. Unknown codes fall back to the server's message. */
const REJECTION_MESSAGES: Record<string, string> = {
  not_authenticated:
    'Your session has expired. Sign in again and retry.',
  not_authorized:
    'You do not have permission to create listings in this organization.',
  invalid_content:
    'The listing content failed validation. Check the highlighted fields.',
  idempotency_conflict:
    'A request with this reference is already in flight — try again in a moment.',
  unexpected_response:
    'The server replied with an unexpected shape. Try again; if it persists, contact LUXONN support.',
};

/** Client-side mirror of validate_revision_content — UX only, never the
 *  gate. The server validator is the authority. */
function validate(content: RevisionContentInput): string | null {
  if (content.title.length === 0 || content.title.length > 200) {
    return 'Title must be 1–200 characters.';
  }
  if (content.description.length === 0 || content.description.length > 20000) {
    return 'Description must be 1–20000 characters.';
  }
  if (content.property_type.length === 0 || content.property_type.length > 50) {
    return 'Property type must be 1–50 characters.';
  }
  if (content.price_amount === '' || !/^\d{1,13}(\.\d{1,2})?$/.test(content.price_amount)) {
    return 'Price must be a positive amount (e.g. 12500000 or 12500000.50).';
  }
  if (!/^[A-Z]{3}$/.test(content.price_currency)) {
    return 'Currency must be a 3-letter code (e.g. KES).';
  }
  if (content.area.length === 0 || content.area.length > 200) {
    return 'Area must be 1–200 characters.';
  }
  if (content.city.length === 0 || content.city.length > 100) {
    return 'City must be 1–100 characters.';
  }
  if (content.country.length === 0) {
    return 'Country is required.';
  }
  return null;
}

const LISTING_KINDS = [
  { value: 'sale', label: 'For sale' },
  { value: 'rent', label: 'For rent' },
  { value: 'shortlet', label: 'Shortlet' },
] as const;

const PRICE_PERIODS = [
  { value: 'one_time', label: 'One-time' },
  { value: 'per_month', label: 'Per month' },
  { value: 'per_night', label: 'Per night' },
] as const;

interface FormState {
  listingKind: 'sale' | 'rent' | 'shortlet';
  title: string;
  description: string;
  propertyType: string;
  propertySubtype: string;
  priceAmount: string;
  priceCurrency: string;
  pricePeriod: 'one_time' | 'per_month' | 'per_night';
  bedrooms: string;
  bathrooms: string;
  squareMeters: string;
  lotSizeSqm: string;
  yearBuilt: string;
  floorNumber: string;
  totalFloors: string;
  furnished: boolean;
  area: string;
  city: string;
  town: string;
  county: string;
  amenities: string;
}

const INITIAL_STATE: FormState = {
  listingKind: 'sale',
  title: '',
  description: '',
  propertyType: '',
  propertySubtype: '',
  priceAmount: '',
  priceCurrency: 'KES',
  pricePeriod: 'one_time',
  bedrooms: '',
  bathrooms: '',
  squareMeters: '',
  lotSizeSqm: '',
  yearBuilt: '',
  floorNumber: '',
  totalFloors: '',
  furnished: false,
  area: '',
  city: '',
  town: '',
  county: '',
  amenities: '',
};

/** Build the wire-shape content from the form state. Optional numerics
 *  become null when blank (the validator only checks a key when present;
 *  null passes through as "not provided"). */
function toContent(s: FormState): RevisionContentInput {
  const optionalInt = (raw: string): number | null => {
    const t = raw.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isInteger(n) ? n : null;
  };
  const optionalNum = (raw: string): number | null => {
    const t = raw.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const amenities = s.amenities
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a.length > 0);

  return {
    listing_kind: s.listingKind,
    title: s.title.trim(),
    description: s.description.trim(),
    property_type: s.propertyType.trim(),
    property_subtype:
      s.propertySubtype.trim() === '' ? null : s.propertySubtype.trim(),
    availability: 'available',
    price_amount: s.priceAmount.trim(),
    price_currency: s.priceCurrency.trim().toUpperCase(),
    price_period: s.pricePeriod,
    bedrooms: optionalInt(s.bedrooms),
    bathrooms: optionalInt(s.bathrooms),
    square_meters: optionalNum(s.squareMeters),
    lot_size_sqm: optionalNum(s.lotSizeSqm),
    year_built: optionalInt(s.yearBuilt),
    floor_number: optionalInt(s.floorNumber),
    total_floors: optionalInt(s.totalFloors),
    area: s.area.trim(),
    city: s.city.trim(),
    town: s.town.trim() === '' ? null : s.town.trim(),
    county: s.county.trim() === '' ? null : s.county.trim(),
    country: 'Kenya',
    amenities: amenities.length > 0 ? amenities : undefined,
  };
}

export function ListingDraftForm({
  organizationIdHint,
}: {
  /** UX hint from the URL; undefined means "no hint". */
  organizationIdHint: string | undefined;
}) {
  const router = useRouter();
  const [state, setState] = useState<FormState>(INITIAL_STATE);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const content = toContent(state);
    const clientError = validate(content);
    if (clientError !== null) {
      setError(clientError);
      return;
    }

    setSubmitting(true);
    setError(null);

    const result = await createListingDraft(organizationIdHint ?? '', content);
    if (!result.ok) {
      setSubmitting(false);
      setError(
        REJECTION_MESSAGES[result.reasonCode] ??
          result.message ??
          'Something went wrong. Try again.',
      );
      return;
    }

    // Draft exists; the detail surface owns Edit + Submit-for-review.
    if (result.kind !== 'draft_created') {
      // createListingDraft only ever returns draft_created on success, but
      // the union type requires the narrowing before .listingId is legal.
      setSubmitting(false);
      setError('Unexpected server response. Try again.');
      return;
    }
    router.replace(`/owner/listings/${result.listingId}`);
  }

  const inputClass =
    'mt-2 w-full rounded-lg border border-gold/20 bg-surface-2/50 px-4 py-2.5 text-sm text-foreground placeholder:text-muted/60 focus:border-gold/50 focus:outline-none disabled:opacity-50';
  const labelClass = 'block text-xs tracking-[0.2em] text-gold';

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-6">
      <fieldset disabled={submitting} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="listing-kind" className={labelClass}>
              LISTING KIND
            </label>
            <select
              id="listing-kind"
              value={state.listingKind}
              onChange={(e) =>
                set('listingKind', e.target.value as FormState['listingKind'])
              }
              className={inputClass}
            >
              {LISTING_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="property-type" className={labelClass}>
              PROPERTY TYPE
            </label>
            <input
              id="property-type"
              type="text"
              required
              maxLength={50}
              value={state.propertyType}
              onChange={(e) => set('propertyType', e.target.value)}
              placeholder="e.g. apartment, house, land"
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label htmlFor="title" className={labelClass}>
            TITLE
          </label>
          <input
            id="title"
            type="text"
            required
            maxLength={200}
            value={state.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="e.g. 4-Bedroom Villa with Pool in Karen"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="description" className={labelClass}>
            DESCRIPTION
          </label>
          <textarea
            id="description"
            rows={6}
            required
            maxLength={20000}
            value={state.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Describe the residence, its finishes, and the neighborhood."
            className={`${inputClass} resize-y`}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="price-amount" className={labelClass}>
              PRICE (AMOUNT)
            </label>
            <input
              id="price-amount"
              type="text"
              inputMode="decimal"
              required
              value={state.priceAmount}
              onChange={(e) => set('priceAmount', e.target.value)}
              placeholder="12500000"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="price-currency" className={labelClass}>
              CURRENCY
            </label>
            <input
              id="price-currency"
              type="text"
              required
              maxLength={3}
              minLength={3}
              value={state.priceCurrency}
              onChange={(e) => set('priceCurrency', e.target.value.toUpperCase())}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="price-period" className={labelClass}>
              PRICE PERIOD
            </label>
            <select
              id="price-period"
              value={state.pricePeriod}
              onChange={(e) =>
                set('pricePeriod', e.target.value as FormState['pricePeriod'])
              }
              className={inputClass}
            >
              {PRICE_PERIODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <label htmlFor="bedrooms" className={labelClass}>
              BEDROOMS
            </label>
            <input
              id="bedrooms"
              type="number"
              min={0}
              max={50}
              value={state.bedrooms}
              onChange={(e) => set('bedrooms', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="bathrooms" className={labelClass}>
              BATHROOMS
            </label>
            <input
              id="bathrooms"
              type="number"
              min={0}
              max={50}
              value={state.bathrooms}
              onChange={(e) => set('bathrooms', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="square-meters" className={labelClass}>
              FLOOR AREA (m²)
            </label>
            <input
              id="square-meters"
              type="number"
              min={0}
              step="any"
              value={state.squareMeters}
              onChange={(e) => set('squareMeters', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="lot-size" className={labelClass}>
              LOT SIZE (m²)
            </label>
            <input
              id="lot-size"
              type="number"
              min={0}
              step="any"
              value={state.lotSizeSqm}
              onChange={(e) => set('lotSizeSqm', e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <label htmlFor="year-built" className={labelClass}>
              YEAR BUILT
            </label>
            <input
              id="year-built"
              type="number"
              min={1800}
              max={2100}
              value={state.yearBuilt}
              onChange={(e) => set('yearBuilt', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="floor-number" className={labelClass}>
              FLOOR
            </label>
            <input
              id="floor-number"
              type="number"
              min={-5}
              max={300}
              value={state.floorNumber}
              onChange={(e) => set('floorNumber', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="total-floors" className={labelClass}>
              TOTAL FLOORS
            </label>
            <input
              id="total-floors"
              type="number"
              min={1}
              max={300}
              value={state.totalFloors}
              onChange={(e) => set('totalFloors', e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="flex items-end pb-3">
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={state.furnished}
                onChange={(e) => set('furnished', e.target.checked)}
                className="h-4 w-4 accent-[var(--color-gold)]"
              />
              Furnished
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="area" className={labelClass}>
              AREA
            </label>
            <input
              id="area"
              type="text"
              required
              maxLength={200}
              value={state.area}
              onChange={(e) => set('area', e.target.value)}
              placeholder="e.g. Karen"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="city" className={labelClass}>
              CITY
            </label>
            <input
              id="city"
              type="text"
              required
              maxLength={100}
              value={state.city}
              onChange={(e) => set('city', e.target.value)}
              placeholder="e.g. Nairobi"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="town" className={labelClass}>
              TOWN <span className="text-muted">(optional)</span>
            </label>
            <input
              id="town"
              type="text"
              maxLength={100}
              value={state.town}
              onChange={(e) => set('town', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="county" className={labelClass}>
              COUNTY <span className="text-muted">(optional)</span>
            </label>
            <input
              id="county"
              type="text"
              maxLength={100}
              value={state.county}
              onChange={(e) => set('county', e.target.value)}
              placeholder="e.g. Nairobi"
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label htmlFor="amenities" className={labelClass}>
            AMENITIES{' '}
            <span className="text-muted">(comma-separated, optional)</span>
          </label>
          <input
            id="amenities"
            type="text"
            value={state.amenities}
            onChange={(e) => set('amenities', e.target.value)}
            placeholder="pool, garden, borehole, 24h security"
            className={inputClass}
          />
        </div>
      </fieldset>

      {error !== null && (
        <p
          className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300"
          role="alert"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg border border-gold/40 bg-gold/10 px-4 py-2.5 text-sm tracking-wide text-gold transition-colors hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Saving draft…' : 'Save draft'}
      </button>
    </form>
  );
}
