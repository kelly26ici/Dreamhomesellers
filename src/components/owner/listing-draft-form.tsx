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
import { ChevronDown, Sparkles } from 'lucide-react';

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

/**
 * A short, buyer-facing vocabulary. Values stay lowercase to match the
 * existing published rows and Simon's output; the label carries the casing
 * the owner reads. The schema still accepts free text (the vocabulary is
 * not frozen), so "Other" keeps an escape hatch for the rare residence that
 * does not fit — and for legacy rows saved before this list.
 */
const PROPERTY_TYPES = [
  { value: 'apartment', label: 'Apartment' },
  { value: 'house', label: 'House' },
  { value: 'villa', label: 'Villa' },
  { value: 'townhouse', label: 'Townhouse' },
  { value: 'penthouse', label: 'Penthouse' },
  { value: 'bungalow', label: 'Bungalow' },
  { value: 'land', label: 'Land' },
  { value: 'commercial', label: 'Commercial' },
] as const;

type PricePeriod = 'one_time' | 'per_month' | 'per_night';

/** The period is a consequence of the offer, not a separate question. */
const PERIOD_FOR_KIND: Record<FormState['listingKind'], PricePeriod> = {
  sale: 'one_time',
  rent: 'per_month',
  shortlet: 'per_night',
};

/** Only stacked residences have a meaningful floor position. */
function isMultiUnitType(propertyType: string): boolean {
  return /apartment|penthouse/i.test(propertyType);
}

/**
 * Map a free-text type onto the short buyer-facing vocabulary when it
 * matches case-insensitively (Simon and legacy rows use lowercase), and
 * fall back to the raw text as a custom value otherwise.
 */
function canonicalPropertyType(raw: string): {
  value: string;
  custom: boolean;
} {
  const trimmed = raw.trim();
  const known = PROPERTY_TYPES.find(
    (type) => type.value === trimmed.toLowerCase(),
  );
  return known !== undefined
    ? { value: known.value, custom: false }
    : { value: trimmed, custom: trimmed !== '' };
}

interface FormState {
  listingKind: 'sale' | 'rent' | 'shortlet';
  title: string;
  description: string;
  propertyType: string;
  /** True when the owner is typing a type outside PROPERTY_TYPES. */
  propertyTypeCustom: boolean;
  /** Legacy-only (no input): preserved so an edit does not null it. */
  propertySubtype: string;
  priceAmount: string;
  /** Kept for legacy rows; new listings default to KES (ADR-001). */
  priceCurrency: string;
  bedrooms: string;
  bathrooms: string;
  squareMeters: string;
  lotSizeSqm: string;
  yearBuilt: string;
  floorNumber: string;
  totalFloors: string;
  /** Legacy-only (no input): preserved so an edit does not null it. */
  plotDimensions: string;
  landSizeRaw: string;
  /** null = not specified; the buyer page shows an em dash. */
  furnished: boolean | null;
  area: string;
  city: string;
  /** Legacy-only (no input): preserved so an edit does not null it. */
  town: string;
  county: string;
  amenities: string;
}

const INITIAL_STATE: FormState = {
  listingKind: 'sale',
  title: '',
  description: '',
  propertyType: '',
  propertyTypeCustom: false,
  propertySubtype: '',
  priceAmount: '',
  priceCurrency: 'KES',
  bedrooms: '',
  bathrooms: '',
  squareMeters: '',
  lotSizeSqm: '',
  yearBuilt: '',
  floorNumber: '',
  totalFloors: '',
  plotDimensions: '',
  landSizeRaw: '',
  furnished: null,
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
    price_period: PERIOD_FOR_KIND[s.listingKind],
    bedrooms: optionalInt(s.bedrooms),
    bathrooms: optionalInt(s.bathrooms),
    square_meters: optionalNum(s.squareMeters),
    lot_size_sqm: optionalNum(s.lotSizeSqm),
    year_built: optionalInt(s.yearBuilt),
    floor_number: optionalInt(s.floorNumber),
    total_floors: optionalInt(s.totalFloors),
    plot_dimensions:
      s.plotDimensions.trim() === '' ? null : s.plotDimensions.trim(),
    land_size_raw:
      s.landSizeRaw.trim() === '' ? null : s.landSizeRaw.trim(),
    area: s.area.trim(),
    city: s.city.trim(),
    town: s.town.trim() === '' ? null : s.town.trim(),
    county: s.county.trim() === '' ? null : s.county.trim(),
    country: 'Kenya',
    amenities: amenities.length > 0 ? amenities : undefined,
    furnished: s.furnished,
  };
}

/**
 * The form runs in exactly one of two modes. The discriminated union makes
 * it impossible to render an edit form without the ids it needs, or a
 * create form with stray ids — TypeScript enforces which fields must be
 * present for each kind, rather than a pile of optional props.
 */
export type ListingFormMode =
  | { readonly kind: 'create'; readonly organizationId: string }
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
  const propertyType = canonicalPropertyType(detail.propertyType);
  return {
    listingKind: knownKind ?? 'sale',
    title: detail.title,
    description: detail.description,
    propertyType: propertyType.value,
    propertyTypeCustom: propertyType.custom,
    propertySubtype: detail.propertySubtype ?? '',
    priceAmount: detail.price.amount,
    priceCurrency: detail.price.currency,
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
  // Optional facts are collapsed so the first screen stays about the
  // residence, not the database. An edit with optional facts already filled
  // opens the section so nothing looks lost.
  const [showAdvanced, setShowAdvanced] = useState(() => {
    if (initial === undefined) return false;
    return Boolean(
      initial.county ||
        initial.bedrooms !== null ||
        initial.bathrooms !== null ||
        initial.squareMeters !== null ||
        initial.lotSizeSqm !== null ||
        initial.yearBuilt !== null ||
        initial.floorNumber !== null ||
        initial.totalFloors !== null ||
        initial.furnished !== null ||
        initial.amenities.length > 0,
    );
  });

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

    const result = await createListingDraft(mode.organizationId, content);
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
  const isMultiUnit = isMultiUnitType(state.propertyType);
  const periodLabel =
    state.listingKind === 'sale'
      ? 'One-time price'
      : state.listingKind === 'rent'
        ? 'Price per month'
        : 'Price per night';

  /** The select carries a sentinel for the free-text escape hatch; the wire
   *  value never sees it. */
  function handlePropertyTypeChange(value: string) {
    if (value === '__other__') {
      setState((prev) => ({
        ...prev,
        propertyTypeCustom: true,
        propertyType: '',
      }));
      return;
    }
    setState((prev) => ({
      ...prev,
      propertyTypeCustom: false,
      propertyType: value,
    }));
  }

  return (
    <>
      <div className="mt-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-lg border border-gold/30 p-4">
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
          const propertyType = canonicalPropertyType(draft.propertyType);
          // The draft often carries optional facts; reveal them once so the
          // owner can review what Simon filled instead of saving blind.
          if (
            draft.bedrooms ||
            draft.bathrooms ||
            draft.squareMeters ||
            draft.lotSizeSqm ||
            draft.amenities.length > 0
          ) {
            setShowAdvanced(true);
          }
          setState((prev) => ({
            ...prev,
            title: draft.title,
            description: draft.description,
            propertyType: propertyType.value,
            propertyTypeCustom: propertyType.custom,
            propertySubtype: draft.propertySubtype || prev.propertySubtype,
            priceAmount: draft.priceAmount,
            priceCurrency: draft.priceCurrency,
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
        <fieldset disabled={submitting} className="space-y-5">
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
              <select
                id="property-type"
                required
                value={state.propertyTypeCustom ? '__other__' : state.propertyType}
                onChange={(e) => handlePropertyTypeChange(e.target.value)}
                className={inputClass}
              >
                <option value="" disabled>
                  Select a type
                </option>
                {PROPERTY_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
                <option value="__other__">Other…</option>
              </select>
              {state.propertyTypeCustom && (
                <input
                  type="text"
                  required
                  maxLength={50}
                  value={state.propertyType}
                  onChange={(e) => set('propertyType', e.target.value)}
                  placeholder="Describe the property type"
                  aria-label="Custom property type"
                  className={inputClass}
                />
              )}
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
              rows={5}
              required
              maxLength={20000}
              value={state.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Describe the residence, its finishes, and the neighborhood."
              className={`${inputClass} resize-y`}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label htmlFor="price-amount" className={labelClass}>
                PRICE
              </label>
              <div className="mt-2 flex rounded-md border border-gold/20 bg-surface-2/50 focus-within:border-gold/50">
                <span className="flex items-center border-r border-gold/20 px-3 text-xs tracking-widest text-muted">
                  {state.priceCurrency}
                </span>
                <input
                  id="price-amount"
                  type="text"
                  inputMode="decimal"
                  required
                  value={state.priceAmount}
                  onChange={(e) => set('priceAmount', e.target.value)}
                  placeholder="12500000"
                  className="w-full bg-transparent px-4 py-2.5 text-sm text-foreground placeholder:text-muted/60 focus:outline-none disabled:opacity-50"
                />
              </div>
              <p className="mt-1 text-[11px] text-muted">{periodLabel}</p>
            </div>
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
          </div>

          <div className="border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={() => setShowAdvanced((open) => !open)}
              aria-expanded={showAdvanced}
              className="group flex w-full items-center justify-between gap-4 text-left"
            >
              <span>
                <span className="block text-xs tracking-[0.2em] text-muted transition-colors group-hover:text-gold">
                  OPTIONAL DETAILS
                </span>
                <span className="mt-1 block text-[11px] text-muted/60">
                  Bedrooms, size, amenities, and other facts buyers see.
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-[11px] tracking-widest text-muted transition-colors group-hover:text-gold">
                {showAdvanced ? 'HIDE' : 'ADD'}
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${
                    showAdvanced ? 'rotate-180' : ''
                  }`}
                />
              </span>
            </button>

            {showAdvanced && (
              <div className="mt-4 space-y-4 rounded-lg border border-white/10 bg-surface-2/20 p-4 sm:p-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="county" className={labelClass}>
                      COUNTY
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
                      INTERIOR (m²)
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
                      PLOT (m²)
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

                <div className="sm:max-w-xs">
                  <label htmlFor="furnished" className={labelClass}>
                    FURNISHED
                  </label>
                  <select
                    id="furnished"
                    value={
                      state.furnished === null
                        ? ''
                        : state.furnished
                          ? 'yes'
                          : 'no'
                    }
                    onChange={(e) =>
                      set(
                        'furnished',
                        e.target.value === ''
                          ? null
                          : e.target.value === 'yes',
                      )
                    }
                    className={inputClass}
                  >
                    <option value="">Not specified</option>
                    <option value="yes">Furnished</option>
                    <option value="no">Unfurnished</option>
                  </select>
                </div>

                {isMultiUnit && (
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
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
                  </div>
                )}

                <div>
                  <label htmlFor="amenities" className={labelClass}>
                    AMENITIES
                  </label>
                  <input
                    id="amenities"
                    type="text"
                    value={state.amenities}
                    onChange={(e) => set('amenities', e.target.value)}
                    placeholder="pool, garden, borehole, 24h security"
                    className={inputClass}
                  />
                  <p className="mt-1 text-[11px] text-muted/60">
                    Separate each amenity with a comma.
                  </p>
                </div>
              </div>
            )}
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
