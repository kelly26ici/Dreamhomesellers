'use client';

/**
 * Global Simon Concierge UI & Context Provider.
 * Governs the 3-state view machine (closed, docked, fullscreen),
 * dynamic desktop layout reflow, and typed PageContext synchronization (ADR-008).
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useTransition,
  Suspense,
} from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import type { PageContext, PageViewMode, SearchFilters } from '@/lib/contracts/page-context';
import type { ListingId } from '@/lib/contracts/shared';

export type SimonViewMode = 'closed' | 'docked' | 'fullscreen';

interface OpenSimonOptions {
  mode?: 'docked' | 'fullscreen';
  prompt?: string;
  listingId?: string;
  title?: string;
}

interface SimonContextType {
  viewMode: SimonViewMode;
  isOpen: boolean;
  pageContext: PageContext;
  initialPrompt: string | null;
  activeListingTitle: string | null;
  openSimon: (options?: OpenSimonOptions) => void;
  closeSimon: () => void;
  toggleFullscreen: () => void;
  clearInitialPrompt: () => void;
  setPageContextOverride: (ctx: Partial<PageContext>) => void;
}

const defaultContext: PageContext = {
  contract_version: '1.0.0',
  sequence: 0,
  route: '/',
  view_mode: 'other',
  active_listing_id: null,
  active_revision_id: null,
  result_position: null,
  result_count: null,
  visible_listing_ids: [],
  search_filters: null,
  compare_selection: [],
  approximate_location: null,
};

const SimonContext = createContext<SimonContextType | undefined>(undefined);

function SearchParamsSynchronizer({
  onSync,
}: {
  onSync: (pathname: string, searchParams: URLSearchParams | null) => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    onSync(pathname || '/', searchParams);
  }, [pathname, searchParams, onSync]);

  return null;
}

export function SimonProvider({ children }: { children: React.ReactNode }) {
  const [, startTransition] = useTransition();

  const [viewMode, setViewMode] = useState<SimonViewMode>('closed');
  const [initialPrompt, setInitialPrompt] = useState<string | null>(null);
  const [activeListingTitle, setActiveListingTitle] = useState<string | null>(null);
  const sequenceRef = useRef(0);

  // Synchronize PageContext with current route and search params
  const [pageContext, setPageContext] = useState<PageContext>(defaultContext);

  const handleRouteSync = useCallback(
    (currentRoute: string, searchParams: URLSearchParams | null) => {
      sequenceRef.current += 1;

      let view_mode: PageViewMode = 'other';
      let active_listing_id: ListingId | null = null;
      let search_filters: SearchFilters | null = null;

      if (currentRoute === '/') {
        view_mode = 'curated';
      } else if (currentRoute.startsWith('/property/')) {
        view_mode = 'property_detail';
        const parts = currentRoute.split('/property/');
        if (parts[1]) {
          active_listing_id = decodeURIComponent(parts[1].split('/')[0]) as ListingId;
        }
      } else if (currentRoute.startsWith('/properties')) {
        view_mode = 'search';
        if (searchParams) {
          search_filters = {
            listing_kind: searchParams.get('listing_kind'),
            property_type: searchParams.get('property_type'),
            min_price: searchParams.get('min_price'),
            max_price: searchParams.get('max_price'),
            price_currency: searchParams.get('price_currency') || 'KES',
            min_bedrooms: searchParams.get('min_bedrooms')
              ? parseInt(searchParams.get('min_bedrooms')!, 10)
              : null,
            min_bathrooms: searchParams.get('min_bathrooms')
              ? parseInt(searchParams.get('min_bathrooms')!, 10)
              : null,
            city: searchParams.get('city'),
            area: searchParams.get('area'),
            amenities: searchParams.getAll('amenities'),
            sort: searchParams.get('sort'),
            cursor: searchParams.get('cursor'),
          };
        }
      } else if (currentRoute.startsWith('/gallery')) {
        view_mode = 'curated';
      } else if (currentRoute.startsWith('/compare')) {
        view_mode = 'compare';
      }

      startTransition(() => {
        setPageContext((prev) => ({
          ...prev,
          sequence: sequenceRef.current,
          route: currentRoute,
          view_mode,
          active_listing_id,
          search_filters,
        }));
      });
    },
    []
  );

  const openSimon = useCallback((options?: OpenSimonOptions) => {
    const targetMode = options?.mode || 'docked';
    setViewMode(targetMode);

    if (options?.prompt) {
      setInitialPrompt(options.prompt);
    }
    if (options?.title) {
      setActiveListingTitle(options.title);
    }
    if (options?.listingId) {
      setPageContext((prev) => ({
        ...prev,
        active_listing_id: options.listingId as ListingId,
        view_mode: 'property_detail',
      }));
    }
  }, []);

  const closeSimon = useCallback(() => {
    setViewMode('closed');
  }, []);

  const toggleFullscreen = useCallback(() => {
    setViewMode((prev) => (prev === 'fullscreen' ? 'docked' : 'fullscreen'));
  }, []);

  const clearInitialPrompt = useCallback(() => {
    setInitialPrompt(null);
  }, []);

  const setPageContextOverride = useCallback((ctx: Partial<PageContext>) => {
    setPageContext((prev) => ({
      ...prev,
      ...ctx,
    }));
  }, []);

  return (
    <SimonContext.Provider
      value={{
        viewMode,
        isOpen: viewMode !== 'closed',
        pageContext,
        initialPrompt,
        activeListingTitle,
        openSimon,
        closeSimon,
        toggleFullscreen,
        clearInitialPrompt,
        setPageContextOverride,
      }}
    >
      <Suspense fallback={null}>
        <SearchParamsSynchronizer onSync={handleRouteSync} />
      </Suspense>
      {children}
    </SimonContext.Provider>
  );
}

export function useSimon() {
  const context = useContext(SimonContext);
  if (!context) {
    throw new Error('useSimon must be used within a SimonProvider');
  }
  return context;
}
