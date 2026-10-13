'use client';

/**
 * SimilarResidencesStrip — compact circular 3D strip on the property
 * detail page.
 *
 * Same mechanical family as the /gallery animal demo (rotateY ring under
 * perspective), but re-engineered for embedding: auto-rotation with
 * pointer-drag, no page-scroll binding (a scroll-bound strip inside a
 * normal page would hijack the buyer's scroll), and property cards
 * instead of photos. Cards always link to their detail pages — the strip
 * is a navigation surface, never primary search results.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { PublishedListingCard } from '@/lib/marketplace/read-model';
import { formatListingPrice } from '@/lib/marketplace/format-money';

const CARD_W = 240;
const CARD_H = 320;
const RADIUS = 480;
const STEP_DEG = 40; // 9 slots per revolution; fewer items widen the gaps
const AUTO_SPEED = 0.03; // degrees per frame when idle

export default function SimilarResidencesStrip({
  cards,
}: {
  readonly cards: readonly PublishedListingCard[];
}) {
  const [rotation, setRotation] = useState(0);
  const dragRef = useRef<{ startX: number; startRot: number } | null>(null);
  const frameRef = useRef<number | null>(null);

  // Auto-rotate whenever no drag is active. One rAF loop for the
  // component's lifetime; paused per-frame while dragging.
  useEffect(() => {
    const tick = () => {
      if (!dragRef.current) {
        setRotation((r) => r + AUTO_SPEED);
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return (
    <section
      aria-label="Similar residences"
      className="relative mt-10 select-none"
      onPointerDown={(e) => {
        dragRef.current = { startX: e.clientX, startRot: rotation };
      }}
      onPointerMove={(e) => {
        const drag = dragRef.current;
        if (drag) {
          setRotation(drag.startRot + (e.clientX - drag.startX) * 0.25);
        }
      }}
      onPointerUp={() => {
        dragRef.current = null;
      }}
      onPointerLeave={() => {
        dragRef.current = null;
      }}
    >
      <div className="flex items-center justify-center" style={{ perspective: '1600px' }}>
        <div className="relative h-[340px] w-full" style={{ transformStyle: 'preserve-3d' }}>
          {cards.map((card, i) => {
            const itemAngle = i * STEP_DEG;
            const relativeAngle = (itemAngle + (rotation % 360) + 360) % 360;
            const normalized =
              relativeAngle > 180 ? 360 - relativeAngle : relativeAngle;
            const opacity = Math.max(0.25, 1 - normalized / 180);

            return (
              <Link
                key={card.listingId}
                href={`/property/${card.listingId}`}
                aria-label={`View ${card.title}`}
                className="absolute overflow-hidden rounded-lg border border-white/10 bg-surface/70 shadow-2xl backdrop-blur-lg"
                style={{
                  width: CARD_W,
                  height: CARD_H,
                  left: '50%',
                  top: 0,
                  marginLeft: -CARD_W / 2,
                  transform: `rotateY(${itemAngle}deg) translateZ(${RADIUS}px)`,
                  transformStyle: 'preserve-3d',
                  opacity,
                  transition: 'opacity 0.3s linear',
                }}
              >
                <div className="flex h-full flex-col justify-end p-4">
                  <p className="text-xs text-gold">
                    {formatListingPrice(card.priceAmount, card.priceCurrency, card.pricePeriod)}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm text-white">{card.title}</p>
                  <p className="mt-1 text-xs text-muted">
                    {[card.area, card.city].filter(Boolean).join(', ')}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
      <p className="mt-2 text-center text-[10px] tracking-[0.2em] text-muted">
        DRAG TO ROTATE · SAME COUNTY & TYPE · PUBLISHED RECORD
      </p>
    </section>
  );
}
