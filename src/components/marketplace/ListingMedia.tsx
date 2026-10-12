/**
 * Published listing media strip (server component).
 *
 * Renders the stitched buyer-safe media rows with imagery, featured first,
 * then by position. Until Phase 3 runs the media pipeline, demo rows have
 * empty derivative_paths, so this shows the honest media-pending state -
 * never a fake photo.
 */

import type { PublicMediaRow } from '@/lib/marketplace/read-model';

export default function ListingMedia({
  strip,
  title,
}: {
  readonly strip: readonly PublicMediaRow[];
  readonly title: string;
}) {
  const withImagery = strip.filter((m) => m.derivativePaths.length > 0);

  if (withImagery.length === 0) {
    return (
      <div className="flex aspect-[16/9] w-full flex-col items-center justify-center gap-2 rounded-xl border border-white/10 bg-surface-2 text-center">
        <span
          aria-hidden
          className="font-display text-5xl tracking-wide text-gold/40"
        >
          LUXONN
        </span>
        <span className="px-6 text-xs tracking-[0.2em] text-muted">
          IMAGERY PENDING
        </span>
      </div>
    );
  }

  // Real imagery: featured derivative leads, grid fills from position order.
  // (Dormant until Phase 3 supplies derivative paths.)
  const sorted = [...withImagery].sort(
    (a, b) =>
      Number(b.isFeatured) - Number(a.isFeatured) || a.position - b.position,
  );

  return (
    <div
      className="grid gap-3 sm:grid-cols-2"
      role="list"
      aria-label={`Imagery for ${title}`}
    >
      {sorted.map((m, i) => (
        <div
          key={m.mediaId}
          role="listitem"
          className={`overflow-hidden rounded-xl border border-white/10 bg-surface-2 ${
            i === 0 ? 'sm:col-span-2 aspect-[16/9]' : 'aspect-[4/3]'
          }`}
        >
          <div
            className="h-full w-full bg-cover bg-center"
            style={{ backgroundImage: `url(${m.derivativePaths[0]})` }}
            role="img"
            aria-label={title}
          />
        </div>
      ))}
    </div>
  );
}
