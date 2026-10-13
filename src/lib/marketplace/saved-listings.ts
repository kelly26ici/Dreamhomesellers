'use client';

/**
 * Client-side saved & compare state for anonymous buyers.
 *
 * Both stores keep ONLY listing IDs in localStorage — never content
 * snapshots. Saved facts always come back through the published read
 * model (RLS-governed), so an unpublished listing drops out of the saved
 * view on its own and the UI can never show stale price or availability.
 *
 * Snapshots are cached at module scope and updated on write, because
 * useSyncExternalStore compares snapshot identity: a fresh array per read
 * would loop renders. getServerSnapshot returns one shared empty array so
 * SSR and hydration agree.
 */

type Listener = () => void;

const SAVED_KEY = 'luxonn.saved.v1';
const COMPARE_KEY = 'luxonn.compare.v1';

/** Saved-listing cap; oldest falls off the end when exceeded. */
export const SAVED_LIMIT = 24;
/** Compare-table cap; the compare UI never offers more columns. */
export const COMPARE_LIMIT = 4;

function readIds(key: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string')
      : [];
  } catch {
    // Private mode, blocked storage, or corrupt JSON: an empty list is the
    // honest state — the feature degrades, nothing breaks.
    return [];
  }
}

function createIdStore(key: string, limit: number) {
  const EMPTY: readonly string[] = [];
  const listeners = new Set<Listener>();
  let cache: readonly string[] | null = null;

  function emit() {
    for (const listener of listeners) listener();
  }

  return {
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      // Cross-tab coherence: another tab writing the same key invalidates
      // our cache and re-renders this one.
      const onStorage = (e: StorageEvent) => {
        if (e.key === key) {
          cache = null;
          emit();
        }
      };
      window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(listener);
        window.removeEventListener('storage', onStorage);
      };
    },

    getSnapshot(): readonly string[] {
      if (cache === null) cache = readIds(key);
      return cache;
    },

    getServerSnapshot(): readonly string[] {
      return EMPTY;
    },

    /** Remove the id, or add it most-recent-first; cap drops the oldest. */
    toggle(id: string): readonly string[] {
      const current = this.getSnapshot();
      const next = current.includes(id)
        ? current.filter((v) => v !== id)
        : [id, ...current].slice(0, limit);
      cache = next;
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Storage write failed (quota/private mode): the in-memory cache
        // still holds this tab's state for the session.
      }
      emit();
      return next;
    },
  };
}

export const savedStore = createIdStore(SAVED_KEY, SAVED_LIMIT);
export const compareStore = createIdStore(COMPARE_KEY, COMPARE_LIMIT);
