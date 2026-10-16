'use client';

/**
 * Save / compare toggle islands for anonymous buyers.
 *
 * These are the only interactive pieces of the save/compare feature: the
 * grid card, detail page, and /saved page embed them to read and write the
 * localStorage-backed stores. Because they are client islands inside
 * server components, they render their pressed state purely from the
 * store — a server-rendered shell can't know what this viewer has saved,
 * and that's fine: the button paints its pressed state after hydration,
 * which is the standard island compromise.
 */

import { useSyncExternalStore } from 'react';

import {
  compareStore,
  savedStore,
  SAVED_LIMIT,
  COMPARE_LIMIT,
} from '@/lib/marketplace/saved-listings';

const BUTTON_CLASS =
  'rounded-md border border-gold/60 bg-black/50 px-3 py-1.5 text-xs tracking-widest ' +
  'text-gold transition-colors hover:bg-gold hover:text-black';

const PRESSED_CLASS =
  'rounded-md border border-gold bg-gold px-3 py-1.5 text-xs tracking-widest ' +
  'text-black transition-colors hover:opacity-90';

function useIds(store: typeof savedStore): readonly string[] {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
}

/** Heart toggle: saves/un-saves one listing. */
export function SaveButton({ listingId }: { listingId: string }) {
  const saved = useIds(savedStore);
  const isSaved = saved.includes(listingId);

  return (
    <button
      type="button"
      className={isSaved ? PRESSED_CLASS : BUTTON_CLASS}
      aria-pressed={isSaved}
      aria-label={isSaved ? `Remove from saved` : `Save this listing`}
      onClick={() => savedStore.toggle(listingId)}
    >
      {isSaved ? 'SAVED ✓' : 'SAVE'}
      <span className="sr-only">
        {isSaved
          ? `Listing is saved (${saved.length} of ${SAVED_LIMIT})`
          : `Save listing (${saved.length} of ${SAVED_LIMIT} used)`}
      </span>
    </button>
  );
}

/** Toggle membership in the compare set. Only offered when saved. */
export function CompareButton({
  listingId,
  savedCount,
}: {
  listingId: string;
  savedCount: number;
}) {
  const compare = useIds(compareStore);
  const inCompare = compare.includes(listingId);

  const disabled = !inCompare && savedCount > 0 && compare.length >= COMPARE_LIMIT;

  return (
    <button
      type="button"
      className={
        inCompare
          ? PRESSED_CLASS
          : disabled
            ? 'cursor-not-allowed rounded-md border border-white/20 bg-black/50 px-3 py-1.5 text-xs tracking-widest text-muted'
            : BUTTON_CLASS
      }
      aria-pressed={inCompare}
      aria-label={
        inCompare
          ? `Remove from compare`
          : disabled
            ? `Compare set is full (${COMPARE_LIMIT})`
            : `Add to compare`
      }
      onClick={() => compareStore.toggle(listingId)}
      disabled={disabled}
    >
      {inCompare ? 'COMPARING ✓' : 'COMPARE'}
    </button>
  );
}

/**
 * Compact toolbar for grid cards: save toggle, and compare toggle that
 * only appears once the listing is saved (compare is a view over saved
 * listings, so an unsaved listing can't join the set).
 */
export function CardActions({ listingId }: { listingId: string }) {
  const saved = useIds(savedStore);
  const isSaved = saved.includes(listingId);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SaveButton listingId={listingId} />
      {isSaved && (
        <CompareButton listingId={listingId} savedCount={saved.length} />
      )}
    </div>
  );
}
