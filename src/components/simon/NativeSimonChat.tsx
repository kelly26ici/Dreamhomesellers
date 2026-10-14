'use client';

/**
 * Native LUXONN Simon Concierge Chat Interface.
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
  ExternalLink,
} from 'lucide-react';
import type { SimonMessage } from '@/lib/simon/types';
import type { PageContext } from '@/lib/contracts/page-context';

interface NativeSimonChatProps {
  pageContext?: Partial<PageContext>;
  onSwitchToLegacy?: () => void;
}

export function NativeSimonChat({
  pageContext,
  onSwitchToLegacy,
}: NativeSimonChatProps) {
  const [messages, setMessages] = useState<SimonMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Greetings. I am Simon, your LUXONN personal property concierge. I can guide you through Kenya’s premier architectural estates, clarify specifications, or arrange confidential viewings.\n\nHow may I serve your search today?',
      timestamp: '',
      suggestedFollowUps: [
        'Explore residences in Karen',
        'Show penthouses in Nairobi',
        'How does private viewing work?',
      ],
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const conversationIdRef = useRef<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
          pageContext,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to reach Simon concierge.');
      }

      const data = await res.json();
      if (data.message) {
        setMessages((prev) => [...prev, data.message]);
      }
    } catch (err) {
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* Top Banner / Mode Switcher */}
      {onSwitchToLegacy && (
        <div className="flex items-center justify-between border-b border-white/5 bg-black/40 px-4 py-2 text-[10px] text-muted">
          <span className="flex items-center gap-1.5 text-champagne">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            NATIVE VERIFIED ENGINE
          </span>
          <button
            type="button"
            onClick={onSwitchToLegacy}
            className="flex items-center gap-1 text-muted hover:text-gold transition-colors"
          >
            <span>Legacy Chainlit</span>
            <ExternalLink className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Message Thread */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 [scrollbar-color:var(--gold)_transparent] [scrollbar-width:thin]">
        {messages.map((msg) => {
          const isUser = msg.role === 'user';

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-lg ${
                  isUser
                    ? 'rounded-tr-xs bg-gold/20 border border-gold/40 text-foreground'
                    : 'rounded-tl-xs bg-surface-1/90 border border-white/10 text-muted'
                }`}
              >
                {!isUser && (
                  <div className="mb-1 flex items-center gap-1 text-[10px] tracking-widest text-gold uppercase">
                    <Sparkles className="h-3 w-3" />
                    <span>SIMON</span>
                  </div>
                )}
                <div className="whitespace-pre-line text-foreground/90">
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
        className="border-t border-white/10 bg-surface-1/90 p-3"
      >
        <div className="relative flex items-center">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about verified residences, prices, or locations..."
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
