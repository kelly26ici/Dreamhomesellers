'use client';

/**
 * Context-aware "Ask Simon About This" action button.
 * Adheres to ADR-008 (PageContext / typed intent) and Phase 2 discovery requirements.
 */

import Link from 'next/link';
import { Sparkles, MessageCircle } from 'lucide-react';

interface AskSimonButtonProps {
  listingId: string;
  title: string;
  variant?: 'primary' | 'outline' | 'compact';
  className?: string;
}

export function AskSimonButton({
  listingId,
  title,
  variant = 'outline',
  className = '',
}: AskSimonButtonProps) {
  const query = new URLSearchParams({
    listingId,
    title,
    action: 'inquire',
  });

  const href = `/simon?${query.toString()}`;

  if (variant === 'compact') {
    return (
      <Link
        href={href}
        className={`flex items-center gap-1.5 rounded-lg border border-gold/30 bg-gold/5 px-3 py-1.5 text-xs font-medium tracking-wider text-gold transition-all duration-300 hover:border-gold hover:bg-gold/15 ${className}`}
        title={`Ask Simon concierge about ${title}`}
      >
        <Sparkles className="h-3.5 w-3.5 text-gold" />
        <span>ASK SIMON</span>
      </Link>
    );
  }

  if (variant === 'primary') {
    return (
      <Link
        href={href}
        className={`flex items-center justify-center gap-2.5 rounded-xl border border-gold bg-gold px-6 py-3 text-xs font-semibold tracking-[0.15em] text-black shadow-lg shadow-gold/10 transition-all duration-300 hover:bg-champagne active:scale-[0.98] ${className}`}
      >
        <Sparkles className="h-4 w-4" />
        <span>ASK SIMON ABOUT THIS RESIDENCE</span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className={`flex items-center justify-center gap-2 rounded-xl border border-gold/40 bg-black/60 px-5 py-2.5 text-xs font-medium tracking-[0.15em] text-gold backdrop-blur-md transition-all duration-300 hover:border-gold hover:bg-gold/10 active:scale-[0.98] ${className}`}
    >
      <MessageCircle className="h-4 w-4 text-gold" />
      <span>ASK SIMON ABOUT THIS RESIDENCE</span>
    </Link>
  );
}
