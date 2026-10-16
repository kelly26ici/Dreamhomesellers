'use client';

/**
 * Circular 3D Gallery for curated LUXONN signature collections.
 * Conforms strictly to ADR-007:
 * - Constrained to small curated sets (5-10 residences).
 * - Never broad search results.
 * - Interactive 3D carousel with drag/scroll and direct link to listing.
 */

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { MapPin, ArrowUpRight, Building2 } from 'lucide-react';
import { resolveDerivativeUrl } from '@/lib/media/url';

export interface ResidenceGalleryItem {
  id: string;
  title: string;
  propertyType: string;
  location: string;
  priceFormatted: string;
  imageUrl?: string | null;
  href: string;
}

interface CircularGalleryProps {
  items: ResidenceGalleryItem[];
  radius?: number;
  autoRotateSpeed?: number;
  className?: string;
}

export function CircularGallery({
  items,
  radius = 540,
  autoRotateSpeed = 0.04,
  className = '',
}: CircularGalleryProps) {
  const [rotation, setRotation] = useState(0);
  const [isInteracting, setIsInteracting] = useState(false);
  const isDraggingRef = useRef(false);
  const lastXRef = useRef(0);
  const interactionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Auto-rotation when idle
  useEffect(() => {
    const loop = () => {
      if (!isInteracting) {
        setRotation((prev) => prev + autoRotateSpeed);
      }
      animationFrameRef.current = requestAnimationFrame(loop);
    };

    animationFrameRef.current = requestAnimationFrame(loop);
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isInteracting, autoRotateSpeed]);

  // Touch and mouse drag handlers for seamless 3D rotation
  const handlePointerDown = (e: React.PointerEvent) => {
    isDraggingRef.current = true;
    lastXRef.current = e.clientX;
    setIsInteracting(true);
    if (interactionTimeoutRef.current) {
      clearTimeout(interactionTimeoutRef.current);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const deltaX = e.clientX - lastXRef.current;
    lastXRef.current = e.clientX;
    setRotation((prev) => prev + deltaX * 0.25);
  };

  const handlePointerUp = () => {
    isDraggingRef.current = false;
    interactionTimeoutRef.current = setTimeout(() => {
      setIsInteracting(false);
    }, 2000);
  };

  if (items.length === 0) {
    return (
      <div className="flex h-96 w-full items-center justify-center text-xs tracking-widest text-muted">
        NO CURATED RESIDENCES AVAILABLE
      </div>
    );
  }

  const anglePerItem = 360 / items.length;

  return (
    <div
      role="region"
      aria-label="Curated 3D Residence Gallery"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      className={`relative flex h-full w-full cursor-grab items-center justify-center select-none active:cursor-grabbing ${className}`}
      style={{ perspective: '2000px' }}
    >
      <div
        className="relative h-full w-full"
        style={{
          transform: `rotateY(${rotation}deg)`,
          transformStyle: 'preserve-3d',
        }}
      >
        {items.map((item, i) => {
          const itemAngle = i * anglePerItem;
          const totalRotation = rotation % 360;
          const relativeAngle = (itemAngle + totalRotation + 360) % 360;
          const normalizedAngle = Math.abs(
            relativeAngle > 180 ? 360 - relativeAngle : relativeAngle
          );
          const opacity = Math.max(0.2, 1 - normalizedAngle / 150);
          const isFacingFront = normalizedAngle < 45;
          const resolvedImg = resolveDerivativeUrl(item.imageUrl);

          return (
            <div
              key={item.id}
              role="group"
              aria-label={item.title}
              className="absolute h-[420px] w-[320px]"
              style={{
                transform: `rotateY(${itemAngle}deg) translateZ(${radius}px)`,
                left: '50%',
                top: '50%',
                marginLeft: '-160px',
                marginTop: '-210px',
                opacity,
                transition: 'opacity 0.25s linear',
              }}
            >
              <div className="group relative flex h-full w-full flex-col justify-between overflow-hidden rounded-lg border border-gold/25 bg-surface-1/90 shadow-[0_20px_50px_rgba(0,0,0,0.8)] backdrop-blur-xl transition-all duration-300 hover:border-gold/60">
                {/* Visual Imagery or Branded Architectural Canvas */}
                <div className="relative aspect-[16/11] w-full overflow-hidden bg-black/60">
                  {resolvedImg ? (
                    <img
                      src={resolvedImg}
                      alt={item.title}
                      className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-surface-2 via-surface-1 to-black p-4 text-center">
                      <Building2 className="h-8 w-8 text-gold/40" />
                      <span className="font-display text-2xl tracking-widest text-gold/40">
                        LUXONN
                      </span>
                      <span className="text-[10px] tracking-widest text-muted">
                        CURATED RESIDENCE
                      </span>
                    </div>
                  )}

                  {/* Property type badge */}
                  <span className="absolute left-3 top-3 rounded-full border border-gold/40 bg-black/70 px-3 py-0.5 text-[10px] font-semibold tracking-wider text-gold backdrop-blur-md">
                    {item.propertyType.toUpperCase()}
                  </span>
                </div>

                {/* Facts content */}
                <div className="flex flex-1 flex-col justify-between p-5">
                  <div>
                    <div className="flex items-center gap-1.5 text-xs text-muted">
                      <MapPin className="h-3.5 w-3.5 text-gold/80" />
                      <span className="truncate">{item.location}</span>
                    </div>
                    <h3 className="mt-2 font-heading text-xl tracking-wide text-foreground line-clamp-2">
                      {item.title}
                    </h3>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3">
                    <div>
                      <p className="text-[10px] tracking-widest text-gold uppercase">PRICE</p>
                      <p className="text-sm font-semibold text-champagne">
                        {item.priceFormatted}
                      </p>
                    </div>

                    <Link
                      href={item.href}
                      onClick={(e) => {
                        // Prevent navigation if dragged
                        if (!isFacingFront) e.preventDefault();
                      }}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-gold/40 bg-gold/10 text-gold transition-colors hover:border-gold hover:bg-gold hover:text-black"
                      aria-label={`View ${item.title}`}
                    >
                      <ArrowUpRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
