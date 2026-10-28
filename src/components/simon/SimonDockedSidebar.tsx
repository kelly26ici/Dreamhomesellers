'use client';

/**
 * SimonDockedSidebar — Desktop Docked & Fullscreen Expandable Concierge.
 * Implements the Cloudflare / Meta developer AI sidebar pattern:
 * - On desktop: docks full-height to the right edge and resizes main screen via layout reflow.
 * - On fullscreen: smoothly expands across the entire viewport (100vw, 100dvh).
 * - On tablet: slides over as a drawer with backdrop scrim.
 * - On mobile: native full-screen sheet with safe-area padding.
 * 100% Native React — zero iframes.
 */

import React, { useEffect, useRef } from 'react';
import {
  Sparkles,
  X,
  Maximize2,
  Minimize2,
  MessageCircle,
} from 'lucide-react';
import { useSimon } from '@/context/SimonContext';
import { SimonAssistantChat } from '@/components/simon/SimonAssistantChat';

export function SimonDockedSidebar() {
  const { viewMode, isOpen, closeSimon, toggleFullscreen, openSimon } = useSimon();
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcut: Escape closes Simon
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        closeSimon();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeSimon]);

  const isFullscreen = viewMode === 'fullscreen';
  const isDocked = viewMode === 'docked';

  return (
    <div className="simon-docked-sidebar-root">
      {/* 1. Desktop Edge Tab Trigger (Visible when Simon is closed on lg+ screens) */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => openSimon({ mode: 'docked' })}
          className="hidden lg:flex fixed right-0 top-1/2 -translate-y-1/2 z-40 flex-col items-center gap-2 border-y border-l border-gold/60 bg-[#090909]/90 px-2 py-4 shadow-[-8px_0_30px_rgba(0,0,0,0.6)] backdrop-blur-xl transition-all duration-300 hover:border-gold hover:bg-gold/10 hover:shadow-[-8px_0_35px_rgba(212,175,55,0.25)] group cursor-pointer"
          aria-label="Open Simon Property Concierge"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-gold/50 bg-gold/15 text-gold group-hover:scale-110 transition-transform">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <span className="[writing-mode:vertical-rl] font-display text-xs tracking-[0.25em] text-champagne group-hover:text-gold transition-colors">
            SIMON CONCIERGE
          </span>
        </button>
      )}

      {/* 2. Mobile/Tablet Floating Trigger (Visible when Simon is closed on < lg screens) */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => openSimon({ mode: 'docked' })}
          className="lg:hidden fixed bottom-5 right-5 z-40 flex h-14 items-center gap-2.5 rounded-full border border-gold/70 bg-black/95 px-4 text-gold shadow-[0_12px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl transition-all duration-300 active:scale-95"
          aria-label="Chat with Simon"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-gold/50 bg-gold/15">
            <MessageCircle className="h-4 w-4" />
          </span>
          <span className="font-display text-sm tracking-[0.14em] text-white">
            SIMON
          </span>
        </button>
      )}

      {/* 3. Tablet Scrim (Only visible on md screens when docked) */}
      {isDocked && (
        <div
          onClick={closeSimon}
          className="hidden md:block lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-xs transition-opacity duration-300"
          aria-hidden="true"
        />
      )}

      {/* 4. Simon Sidebar / Fullscreen Surface */}
      <aside
        ref={sidebarRef}
        aria-modal={isFullscreen}
        role="dialog"
        aria-label="Simon Luxury Property Concierge"
        className={`fixed top-0 bottom-0 right-0 flex flex-col overflow-hidden transition-[transform,width,inset] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${
          !isOpen
            ? 'pointer-events-none translate-x-full'
            : 'translate-x-0'
        } ${
          isFullscreen
            ? 'inset-0 w-full h-[100dvh] z-50 bg-[#090909]/98 backdrop-blur-3xl'
            : 'w-full md:w-[420px] lg:w-[440px] h-[100dvh] z-40 border-l border-gold/30 bg-[#090909]/95 backdrop-blur-2xl shadow-[-20px_0_60px_rgba(0,0,0,0.85)]'
        }`}
      >
        {/* Same assistant-ui shell as /simon-chat, without the history rail. */}
        <div className="min-h-0 flex-1 relative bg-black/60">
          {isOpen && (
            <SimonAssistantChat
              variant="docked"
              headerActions={
                <>
                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    className="hidden md:flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-muted transition-colors hover:border-gold/50 hover:text-gold"
                    aria-label={isFullscreen ? 'Restore to sidebar dock' : 'Expand to full screen'}
                    title={isFullscreen ? 'Restore to sidebar' : 'Expand to full screen'}
                  >
                    {isFullscreen ? (
                      <Minimize2 className="h-4 w-4" />
                    ) : (
                      <Maximize2 className="h-4 w-4" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={closeSimon}
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-muted transition-colors hover:border-gold/50 hover:text-gold active:scale-95"
                    aria-label="Close Simon concierge"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </>
              }
            />
          )}
        </div>
      </aside>
    </div>
  );
}
