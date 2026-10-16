/**
 * Published listing card for the buyer grid (server component).
 *
 * Renders ONLY verified published facts from the read model. Media comes
 * from the stitched buyer-safe fetch; with the demo inventory (Phase 3
 * pending, empty derivative_paths) every card shows the designed
 * media-pending placeholder — an honest empty state, never a fake photo.
 *
 * The card body is one big Link, so the save/compare buttons must be
 * SIBLINGS of that link, not children (a <button> inside an <a> is
 * invalid HTML and breaks keyboard interaction). Structure:
 *
 *   <div class=card>            ← border/surface lives here now
 *     <Link>…media + facts…</Link>
 *     <CardActions/>            ← client island, below the fold of the link
 *   </div>
 */

import Link from 'next/link';
import { resolveDerivativeUrl } from '@/lib/media/url';
import type {
  PublicMediaRow,
  PublishedListingCard as CardData,
} from '@/lib/marketplace/read-model';
import { CardActions } from '@/components/marketplace/SaveControls';

function formatPrice(
  amount: string,
  currency: string,
  period: string,
): string {
  // ADR-001: amount is a decimal string. Number() only for display
  // formatting; the string itself stays the authority.
  const value = new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number(amount));
  const suffix =
    period === 'per_month' ? ' /mo' : period === 'per_night' ? ' /night' : '';
  return `${value}${suffix}`;
}

export default function ListingCard({
  card,
  media,
}: {
  readonly card: CardData;
  readonly media?: readonly PublicMediaRow[];
}) {
  const featured = media?.find((m) => m.isFeatured) ?? media?.[0];
  const hasMedia = Boolean(featured && featured.derivativePaths.length > 0);
  const href = `/property/${card.listingId}`;

  return (
    <div className="group overflow-hidden rounded-lg border border-white/10 bg-surface transition-colors hover:border-gold/50">
      <Link href={href} className="block">
        <div className="relative aspect-[4/3] overflow-hidden bg-surface-2">
          {hasMedia ? (
            // Media pipeline (Phase 3) will supply real Storage derivative
            // URLs; until then this branch is dormant (demo rows have empty
            // derivative_paths).
            <div
              className="h-full w-full bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
              style={{
                backgroundImage: `url(${resolveDerivativeUrl(featured!.derivativePaths[0])})`,
              }}
              role="img"
              aria-label={card.title}
            />
          ) : (
            // Media-pending: honest empty state while Phase 3 hasn't run.
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center">
              <span
                aria-hidden
                className="font-display text-4xl tracking-wide text-gold/40"
              >
                LUXONN
              </span>
              <span className="px-6 text-xs tracking-[0.2em] text-muted">
                IMAGERY PENDING
              </span>
            </div>
          )}
          <span className="glass absolute left-3 top-3 rounded-full px-3 py-1 text-[10px] tracking-[0.2em] text-gold uppercase">
            {card.listingKind}
          </span>
          {card.furnished === true && (
            <span className="glass absolute right-3 top-3 rounded-full px-3 py-1 text-[10px] tracking-[0.2em] text-white uppercase">
              Furnished
            </span>
          )}
        </div>

        <div className="space-y-2 p-4">
          <p className="text-sm font-medium text-champagne">
            {formatPrice(card.priceAmount, card.priceCurrency, card.pricePeriod)}
          </p>
          <h3 className="font-display text-xl tracking-wide text-white">
            {card.title}
          </h3>
          <p className="text-sm text-muted">
            {[card.area, card.city, card.county].filter(Boolean).join(', ')}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-muted">
            {card.bedrooms != null && <span>{card.bedrooms} bd</span>}
            {card.bathrooms != null && <span>{card.bathrooms} ba</span>}
            {card.squareMeters != null && <span>{card.squareMeters} m²</span>}
            {card.lotSizeSqm != null && <span>{card.lotSizeSqm} m² plot</span>}
            <span className="capitalize">{card.propertyType}</span>
          </div>
        </div>
      </Link>

      {/* Save/compare island: sibling of the Link, valid HTML, its own
          click target. Server component renders the wrapper; the client
          island fills pressed state on hydration. */}
      <div className="border-t border-white/10 px-4 py-3">
        <CardActions listingId={card.listingId} />
      </div>
    </div>
  );
}
