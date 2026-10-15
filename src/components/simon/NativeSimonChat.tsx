'use client';

/**
 * Native LUXONN Simon Concierge Chat Interface.
 * 100% Native React — zero iframes.
 * Built with the maximal dark/gold visual language (glassmorphism, gold accents, Bebas Neue).
 * Grounded in verified Postgres facts per ADR-008.
 */

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import {
  Sparkles,
  Send,
  Loader2,
  Building2,
  ArrowUpRight,
  ShieldCheck,
} from 'lucide-react';
import type { SimonMessage } from '@/lib/simon/types';
import type { PageContext } from '@/lib/contracts/page-context';
import { useSimon } from '@/context/SimonContext';

interface NativeSimonChatProps {
  pageContext?: Partial<PageContext>;
  activeListingTitle?: string | null;
  onSwitchToLegacy?: () => void;
}

export function NativeSimonChat({
  pageContext: propPageContext,
  activeListingTitle: propTitle,
}: NativeSimonChatProps) {
  const {
    pageContext: ctxPageContext,
    initialPrompt,
    clearInitialPrompt,
    activeListingTitle: ctxTitle,
  } = useSimon();

  const effectiveContext = propPageContext || ctxPageContext;
  const effectiveTitle = propTitle || ctxTitle;

  const [degradedNotice, setDegradedNotice] = useState<string | null>(null);

  const [messages, setMessages] = useState<SimonMessage[]>(() => {

    const isListingPage = Boolean(effectiveContext?.active_listing_id);
    return [
      {
        id: 'welcome',
        role: 'assistant',
        content: isListingPage
          ? `Greetings. I am Simon, your LUXONN personal property concierge. I am actively reviewing the verified architectural facts for this residence.\n\nYou can ask "what is this?", explore dimensions, request verified pricing, or arrange a confidential viewing.`
          : 'Greetings. I am Simon, your LUXONN personal property concierge. I can guide you through Kenya’s premier architectural estates, clarify specifications, or arrange confidential viewings.\n\nHow may I serve your search today?',
        timestamp: '',
        suggestedFollowUps: isListingPage
          ? [
              'What is this residence?',
              'What are the specs & dimensions?',
              'What amenities are included?',
              'Can I schedule a viewing?',
            ]
          : [
              'What residences are on my screen?',
              'Explore residences in Karen',
              'Show penthouses in Nairobi',
              'How does private viewing work?',
            ],
      },
    ];
  });

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const conversationIdRef = useRef<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initialPromptSentRef = useRef<string | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMsg: SimonMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    if (!conversationIdRef.current) {
      conversationIdRef.current = crypto.randomUUID();
    }

    try {
      const res = await fetch('/api/simon/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversationId: conversationIdRef.current,
          pageContext: effectiveContext,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to reach Simon concierge.');
      }

      const data = await res.json();
      if (data.message) {
        setMessages((prev) => [...prev, data.message]);
        // ADR-016 soft escalation: when the agent service is unreachable and
        // the keyword fallback answered instead, say so honestly rather than
        // pretending the full concierge is online.
        if (data.source === 'offline-fallback') {
          setDegradedNotice(
            'Simon’s AI concierge service is temporarily offline — you’re getting basic verified-fact answers only. Full intelligence returns when the service reconnects.'
          );
        } else {
          setDegradedNotice(null);
        }
      }
    } catch {
      const errorMsg: SimonMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content:
          'I apologize, but I encountered a momentary connection interruption. Please retry, or explore our verified properties grid directly.',
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-send initial prompt if triggered by page action (e.g., "Ask Simon about this residence")
  useEffect(() => {
    if (initialPrompt && initialPrompt !== initialPromptSentRef.current) {
      initialPromptSentRef.current = initialPrompt;
      clearInitialPrompt();
      sendMessage(initialPrompt);
    }
  }, [initialPrompt, clearInitialPrompt]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* Grounded Context Header Strip */}
      <div className="flex items-center justify-between border-b border-white/10 bg-black/50 px-4 py-2 text-[10px]">
        <div className="flex items-center gap-1.5 min-w-0">
          <ShieldCheck className="h-3.5 w-3.5 text-gold shrink-0" />
          <span className="truncate text-champagne/90 tracking-wider">
            {effectiveContext?.active_listing_id
              ? `GROUNDED: ${effectiveTitle ? effectiveTitle : 'ACTIVE RESIDENCE'}`
              : effectiveContext?.route?.startsWith('/properties')
              ? 'GROUNDED: NAIROBI LUXURY CATALOG'
              : effectiveContext?.route?.startsWith('/gallery')
              ? 'GROUNDED: 3D SIGNATURE COLLECTION'
              : 'GROUNDED: POSTGRES MARKETPLACE KNOWLEDGE'}
          </span>
        </div>
        <span className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-gold/70 shrink-0">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          LIVE
        </span>
      </div>

      {/* Message Thread */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 [scrollbar-color:var(--gold)_transparent] [scrollbar-width:thin]">
        {degradedNotice && (
          <div
            role="status"
            className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200"
          >
            {degradedNotice}
          </div>
        )}
        {messages.map((msg) => {
          const isUser = msg.role === 'user';

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[88%] rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-lg ${
                  isUser
                    ? 'rounded-tr-xs bg-gold/20 border border-gold/40 text-foreground'
                    : 'rounded-tl-xs bg-surface-1/90 border border-white/10 text-muted'
                }`}
              >
                {!isUser && (
                  <div className="mb-1 flex items-center gap-1 text-[10px] tracking-widest text-gold uppercase font-medium">
                    <Sparkles className="h-3 w-3" />
                    <span>SIMON CONCIERGE</span>
                  </div>
                )}
                <div className="whitespace-pre-line text-foreground/95">
                  {msg.content}
                </div>
              </div>

              {/* Embedded Listing Cards */}
              {msg.listingCards && msg.listingCards.length > 0 && (
                <div className="mt-3 w-full space-y-2 max-w-[90%]">
                  {msg.listingCards.map((card) => (
                    <Link
                      key={card.listingId}
                      href={`/property/${card.listingId}`}
                      className="group flex items-center justify-between gap-3 rounded-xl border border-gold/30 bg-surface-2/60 p-3 transition-all hover:border-gold hover:bg-surface-2"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gold/30 bg-gold/10 text-gold">
                          <Building2 className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-heading text-sm text-foreground group-hover:text-gold transition-colors">
                            {card.title}
                          </p>
                          <p className="text-[10px] text-muted">
                            {card.location} · {card.priceFormatted}
                          </p>
                        </div>
                      </div>
                      <ArrowUpRight className="h-4 w-4 shrink-0 text-gold transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                    </Link>
                  ))}
                </div>
              )}

              {/* Suggested Follow-Ups */}
              {msg.suggestedFollowUps && msg.suggestedFollowUps.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {msg.suggestedFollowUps.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => sendMessage(prompt)}
                      disabled={isLoading}
                      className="rounded-full border border-gold/30 bg-black/60 px-3 py-1 text-[10px] text-champagne hover:border-gold hover:bg-gold/10 transition-colors disabled:opacity-40"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-gold/80 p-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-gold" />
            <span className="text-[10px] tracking-widest uppercase">
              Simon is analyzing verified inventory...
            </span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-white/10 bg-surface-1/90 p-3 pb-safe"
      >
        <div className="relative flex items-center">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about this residence, specs, prices..."
            disabled={isLoading}
            className="w-full rounded-xl border border-gold/30 bg-black/70 py-2.5 pl-4 pr-12 text-xs text-foreground placeholder:text-muted/60 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="absolute right-1.5 flex h-8 w-8 items-center justify-center rounded-lg bg-gold text-black hover:bg-champagne transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Send inquiry"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </form>
    </div>
  );
}
