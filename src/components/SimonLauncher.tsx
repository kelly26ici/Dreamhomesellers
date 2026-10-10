"use client";

import Link from "next/link";
import { ArrowUpRight, MessageCircle, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export default function SimonLauncher() {
  const [isOpen, setIsOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [isFrameReady, setIsFrameReady] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const shouldRestoreFocus = useRef(false);

  const openSimon = () => {
    setHasOpened(true);
    setIsOpen(true);
  };

  const closeSimon = () => {
    shouldRestoreFocus.current = true;
    setIsOpen(false);
  };

  useEffect(() => {
    if (isOpen) {
      const frame = requestAnimationFrame(() => closeRef.current?.focus());
      const onKeyDown = (event: KeyboardEvent) => {
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          document.activeElement?.tagName !== "IFRAME"
        ) {
          closeSimon();
        }
      };

      document.addEventListener("keydown", onKeyDown);
      return () => {
        cancelAnimationFrame(frame);
        document.removeEventListener("keydown", onKeyDown);
      };
    }

    if (shouldRestoreFocus.current) {
      const frame = requestAnimationFrame(() => triggerRef.current?.focus());
      shouldRestoreFocus.current = false;
      return () => cancelAnimationFrame(frame);
    }
  }, [isOpen]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-controls="simon-concierge"
        aria-expanded={isOpen}
        aria-label="Chat with Simon, property concierge"
        onClick={openSimon}
        className={`fixed bottom-5 right-5 z-50 flex h-14 items-center gap-3 border border-gold/70 bg-black/90 px-4 text-gold shadow-[0_18px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl transition-[opacity,transform,border-color,background-color] duration-200 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] hover:border-gold hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold active:scale-[0.97] sm:bottom-6 sm:right-6 sm:h-16 sm:px-5 ${
          isOpen
            ? "pointer-events-none translate-y-3 opacity-0"
            : "translate-y-0 opacity-100"
        }`}
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-gold/50 bg-gold/10">
          <MessageCircle className="h-4 w-4" aria-hidden />
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-[10px] font-medium tracking-[0.22em] text-champagne">
            PROPERTY CONCIERGE
          </span>
          <span className="mt-0.5 block font-display text-xl tracking-[0.12em] text-white">
            CHAT WITH SIMON
          </span>
        </span>
      </button>

      <section
        id="simon-concierge"
        role="dialog"
        aria-modal="false"
        aria-hidden={!isOpen}
        aria-labelledby="simon-concierge-title"
        inert={!isOpen}
        className={`fixed inset-x-3 bottom-3 z-50 flex h-[calc(100dvh-1.5rem)] max-h-[44rem] flex-col overflow-hidden border border-gold/35 bg-[#090909]/95 shadow-[0_24px_80px_rgba(0,0,0,0.65)] backdrop-blur-xl transition-[opacity,transform] duration-200 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] sm:inset-x-auto sm:bottom-6 sm:right-6 sm:h-[44rem] sm:max-h-[calc(100dvh-3rem)] sm:w-[30rem] ${
          isOpen
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-4 opacity-0"
        }`}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gold/50 bg-gold/10 text-gold">
              <Sparkles className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <p className="text-[10px] font-medium tracking-[0.22em] text-champagne">
                PROPERTY CONCIERGE
              </p>
              <h2
                id="simon-concierge-title"
                className="mt-1 font-display text-2xl tracking-[0.14em] text-white"
              >
                SIMON
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Link
              href="/simon"
              className="flex h-10 w-10 items-center justify-center text-muted transition-colors hover:text-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
              aria-label="Open Simon in a full page"
            >
              <ArrowUpRight className="h-4 w-4" aria-hidden />
            </Link>
            <button
              ref={closeRef}
              type="button"
              onClick={closeSimon}
              className="flex h-10 w-10 items-center justify-center text-muted transition-colors hover:text-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold active:scale-[0.97]"
              aria-label="Close Simon"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </header>

        <div className="relative min-h-0 flex-1 bg-black">
          {hasOpened && (
            <iframe
              src="/api/simon"
              title="Simon, LUXONN property concierge"
              className="h-full w-full border-0"
              sandbox="allow-forms allow-popups allow-same-origin allow-scripts"
              allow="clipboard-write"
              onLoad={() => setIsFrameReady(true)}
            />
          )}
          {!isFrameReady && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#090909] px-8 text-center">
              <span
                aria-hidden="true"
                className="h-10 w-10 rounded-full border border-gold/50 border-t-gold"
              />
              <p className="text-xs tracking-[0.18em] text-champagne" role="status">
                CONNECTING TO SIMON
              </p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
