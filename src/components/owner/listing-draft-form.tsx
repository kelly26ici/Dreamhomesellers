'use client';

/**
 * Listing draft form — creates a listing + first draft, or edits a draft.
 *
 * Runs in the browser (per-keystroke state), but authority stays
 * server-side: create_listing_draft / update_draft_revision (migration
 * 0003, SECURITY DEFINER) re-check org membership and the draft state, and
 * run validate_revision_content — the SQL validator is the authority. The
 * type on RevisionContentInput makes ADR-014's restricted fields
 * (exact_address, latitude, longitude) unrepresentable.
 *
 * Mode discriminates create vs edit (see ListingFormMode). Edit prefill
 * flows through revisionDetailToFormState from the server page, so every
 * field the form renders is also a field the prefill maps — an edit-save
 * cannot silently null a field it forgot to carry.
 *
 * Save = create the draft (→ detail surface) or update in place (→ back to
 * detail). One write per surface keeps each screen single-purpose and the
 * lifecycle transitions visible.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';

import {
  createListingDraft,
  updateDraftRevision,
  type RevisionContentInput,
} from '@/lib/owner/write-model';
import type { OwnerRevisionDetail } from '@/lib/owner/read-model';
import { AIDraftingModal } from './AIDraftingModal';

/** reason_code → user copy, mirroring the SQL validator's documented
 *  rejections. Unknown codes fall back to the server's message. */
const REJECTION_MESSAGES: Record<string, string> = {
  not_authenticated:
    'Your session has expired. Sign in again and retry.',
  not_authorized:
    'You do not have permission to change listings in this organization.',
  not_draft:
    'This revision is no longer a draft — refresh to see its current state.',
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
  plotDimensions: string;
  landSizeRaw: string;
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
  plotDimensions: '',
  landSizeRaw: '',
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
    plot_dimensions: s.plotDimensions.trim() === '' ? null : s.plotDimensions.trim(),
    land_size_raw: s.landSizeRaw.trim() === '' ? null : s.landSizeRaw.trim(),
    area: s.area.trim(),
    city: s.city.trim(),
    town: s.town.trim() === '' ? null : s.town.trim(),
    county: s.county.trim() === '' ? null : s.county.trim(),
    country: 'Kenya',
    amenities: amenities.length > 0 ? amenities : undefined,
  };
}

/**
 * The form runs in exactly one of two modes. The discriminated union makes
 * it impossible to render an edit form without the ids it needs, or a
 * create form with stray ids — TypeScript enforces which fields must be
 * present for each kind, rather than a pile of optional props.
 */
export type ListingFormMode =
  | { readonly kind: 'create'; readonly organizationIdHint: string | undefined }
  | { readonly kind: 'edit'; readonly revisionId: string; readonly listingId: string };

/**
 * OwnerRevisionDetail → form state, for prefilling the edit form. Lives
 * here (next to FormState) so any field added to the form must be added to
 * this mapping in the same file — the compiler flags the missing key in
 * the object literal below, which is what keeps an edit-save from
 * silently nulling a field the form forgot to prefill.
 */
export function revisionDetailToFormState(
  detail: OwnerRevisionDetail,
): FormState {
  const numToStr = (n: number | null): string => (n === null ? '' : String(n));
  // The contract types are open unions (they admit unknown server values);
  // a <select> can only render its 3 options, so unrecognized values
  // narrow to the first option rather than producing an impossible state.
  const knownKind = (['sale', 'rent', 'shortlet'] as const).find(
    (k) => k === detail.listingKind,
  );
  const knownPeriod = (
    ['one_time', 'per_month', 'per_night'] as const
  ).find((p) => p === detail.pricePeriod);
  return {
    listingKind: knownKind ?? 'sale',
    title: detail.title,
    description: detail.description,
    propertyType: detail.propertyType,
    propertySubtype: detail.propertySubtype ?? '',
    priceAmount: detail.price.amount,
    priceCurrency: detail.price.currency,
    pricePeriod: knownPeriod ?? 'one_time',
    bedrooms: numToStr(detail.bedrooms),
    bathrooms: numToStr(detail.bathrooms),
    squareMeters: numToStr(detail.squareMeters),
    lotSizeSqm: numToStr(detail.lotSizeSqm),
    yearBuilt: numToStr(detail.yearBuilt),
    floorNumber: numToStr(detail.floorNumber),
    totalFloors: numToStr(detail.totalFloors),
    plotDimensions: detail.plotDimensions ?? '',
    landSizeRaw: detail.landSizeRaw ?? '',
    furnished: detail.furnished,
    area: detail.area,
    city: detail.city,
    town: detail.town ?? '',
    county: detail.county ?? '',
    amenities: detail.amenities.join(', '),
  };
}

export function ListingDraftForm({
  mode,
  initial,
}: {
  mode: ListingFormMode;
  /** Edit mode only: the revision to prefill from. The lazy useState
   *  initializer converts it once at mount; later re-renders never clobber
   *  the owner's edits-in-progress. */
  initial?: OwnerRevisionDetail;
}) {
  const router = useRouter();
  const [state, setState] = useState<FormState>(() =>
    initial !== undefined ? revisionDetailToFormState(initial) : INITIAL_STATE,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAIDraftOpen, setIsAIDraftOpen] = useState(false);

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

    if (mode.kind === 'edit') {
      // Update in place; the server RPC re-checks that the revision is
      // still a draft and still owned by the caller's org.
      const result = await updateDraftRevision(mode.revisionId, content);
      if (!result.ok || result.kind !== 'revision_updated') {
        setSubmitting(false);
        setError(
          result.ok
            ? 'Unexpected server response. Try again.'
            : (REJECTION_MESSAGES[result.reasonCode] ??
              result.message ??
              'Something went wrong. Try again.'),
        );
        return;
      }
      // Back to the detail surface, which now shows the saved content and
      // still offers Submit for review.
      router.replace(`/owner/listings/${mode.listingId}`);
      return;
    }

    const result = await createListingDraft(mode.organizationIdHint ?? '', content);
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
    'mt-2 w-full rounded-md border border-gold/20 bg-surface-2/50 px-4 py-2.5 text-sm text-foreground placeholder:text-muted/60 focus:border-gold/50 focus:outline-none disabled:opacity-50';
  const labelClass = 'block text-xs tracking-[0.2em] text-gold';

  return (
    <>
      <div className="mt-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-lg border border-gold/30 bg-gradient-to-r from-gold/15 via-gold/5 to-transparent p-4 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gold/40 bg-gold/10 text-gold shadow-sm shadow-gold/20">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-sm font-heading tracking-wider text-champagne">
              SIMON AI DRAFT ASSISTANT
            </h3>
            <p className="text-xs text-muted">
              Paste rough property notes or features and let Simon synthesize luxury editorial prose, specs, and amenities.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsAIDraftOpen(true)}
          className="flex items-center gap-2 rounded-md border border-gold bg-gold/15 px-4 py-2 text-xs font-semibold tracking-wider text-gold hover:bg-gold/25 transition-all shadow-sm shadow-gold/20 shrink-0"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>Draft with Simon</span>
        </button>
      </div>

      <AIDraftingModal
        isOpen={isAIDraftOpen}
        onClose={() => setIsAIDraftOpen(false)}
        onApply={(draft) => {
          setState((prev) => ({
            ...prev,
            title: draft.title,
            description: draft.description,
            propertyType: draft.propertyType,
            propertySubtype: draft.propertySubtype || prev.propertySubtype,
            priceAmount: draft.priceAmount,
            priceCurrency: draft.priceCurrency,
            pricePeriod: draft.pricePeriod,
            bedrooms: draft.bedrooms || prev.bedrooms,
            bathrooms: draft.bathrooms || prev.bathrooms,
            squareMeters: draft.squareMeters || prev.squareMeters,
            lotSizeSqm: draft.lotSizeSqm || prev.lotSizeSqm,
            area: draft.area,
            city: draft.city,
            amenities: draft.amenities.join(', '),
          }));
        }}
      />

      <form onSubmit={handleSubmit} className="mt-6 space-y-6">
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="plot-dimensions" className={labelClass}>
              PLOT DIMENSIONS <span className="text-muted">(optional)</span>
            </label>
            <input
              id="plot-dimensions"
              type="text"
              maxLength={100}
              value={state.plotDimensions}
              onChange={(e) => set('plotDimensions', e.target.value)}
              placeholder="e.g. 50 x 100"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="land-size-raw" className={labelClass}>
              LAND SIZE (RAW) <span className="text-muted">(optional)</span>
            </label>
            <input
              id="land-size-raw"
              type="text"
              maxLength={100}
              value={state.landSizeRaw}
              onChange={(e) => set('landSizeRaw', e.target.value)}
              placeholder="e.g. 1/4 acre"
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
        className="w-full rounded-md border border-gold/40 bg-gold/10 px-4 py-2.5 text-sm tracking-wide text-gold transition-colors hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting
          ? 'Saving…'
          : mode.kind === 'edit'
            ? 'Save changes'
            : 'Save draft'}
      </button>
    </form>
    </>
  );
}
