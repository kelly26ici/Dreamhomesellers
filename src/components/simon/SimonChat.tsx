'use client';

/**
 * LUXONN Simon Concierge, powered by assistant-ui primitives (ADR-021).
 *
 * Composition over copy-in: the shadcn-flavored registry is NOT used; this
 * file styles the `@assistant-ui/react` primitives directly with LUXONN's own
 * Tailwind v4 tokens, preserving the maximal dark/gold glassmorphism language
 * and NativeSimonChat's exact layout (which this file replaces prop-for-prop,
 * so `SimonDockedSidebar`, `app/simon`, and `app/simon-chat` keep their
 * interfaces).
 *
 * Threading behavior lives in `use-simon-runtime` (external store): streamed
 * answers mutate an in-list assistant entry in place, the 429/amber notice
 * stays React state outside the runtime, and thread-level suggested
 * follow-ups render in a single row above the composer.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  Building2,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
} from 'lucide-react';
import type { Components } from 'react-markdown';
import {
  AuiIf,
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
} from '@assistant-ui/react';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import type { PageContext } from '@/lib/contracts/page-context';
import type { SimonSource } from '@/lib/simon/types';
import type { SimonListingCardRef } from '@/lib/simon/types';
import { useSimon } from '@/context/SimonContext';
import {
  useSimonRuntime,
  type SimonNotice,
  type SimonToolActivity,
} from '@/lib/simon/use-simon-runtime';

interface SimonChatProps {
  pageContext?: Partial<PageContext>;
  activeListingTitle?: string | null;
}

/**
 * Concierge answers may carry light markdown; the old interface rendered it
 * raw. Links, lists, and emphasis are styled gold-on-dark.
 */
const markdownComponents: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  a: ({ children, href }) => (
    <a
      href={href}
      className="text-gold underline decoration-gold/40 underline-offset-2 transition hover:decoration-gold"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }) => <em>{children}</em>,
  ul: ({ children }) => (
    <ul className="mb-2 list-disc space-y-1 pl-4 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 list-decimal space-y-1 pl-4 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="marker:text-gold/70">{children}</li>,
  code: ({ children }) => (
    <code className="rounded border border-white/10 bg-black/60 px-1 py-0.5 text-[11px] text-champagne">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-md border border-white/10 bg-black/70 p-2 text-[11px] leading-relaxed last:mb-0">
      {children}
    </pre>
  ),
  h1: ({ children }) => (
    <h1 className="mb-2 font-heading text-sm tracking-wide text-foreground last:mb-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 font-heading text-sm tracking-wide text-foreground last:mb-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-champagne last:mb-0">
      {children}
    </h3>
  ),
};

/** User rows speak plainly; markdown artifacts in a question stay literal. */
function UserText({ text }: { text: string }) {
  return <span className="whitespace-pre-line">{text}</span>;
}

function SimonText({
  text,
  status,
}: {
  text: string;
  status:
    | { readonly type: 'running' }
    | { readonly type: 'complete' }
    | {
        readonly type: 'incomplete';
        readonly reason:
          | 'cancelled'
          | 'length'
          | 'content-filter'
          | 'other'
          | 'error';
      };
}) {
  // The analyzing row double-serves as the old empty-stream placeholder:
  // with tools listed above it and no text yet, Simon looks like he is
  // searching rather than having gone quiet.
  if (!text && status.type === 'running') {
    return (
      <div className="flex items-center gap-2 p-2 text-xs text-gold/80">
        <Sparkles className="h-3.5 w-3.5 animate-pulse text-gold" />
        <span className="text-[10px] uppercase tracking-widest">
          Simon is analyzing verified inventory...
        </span>
      </div>
    );
  }

  const streaming = status.type === 'running';
  return (
    <div className={`text-foreground/95 ${streaming ? 'simon-streaming' : ''}`}>
      <MarkdownTextPrimitive components={markdownComponents} />
    </div>
  );
}

/**
 * Live concierge tool rows. Visibility is thread-scoped — they appear only
 * while the streamed run is active and disappear when it completes, exactly
 * like the old `isLoading` activity block.
 */
function ToolActivity({ data }: { data: readonly SimonToolActivity[] }) {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  if (!data.length || !isRunning) return null;
  return (
    <ul className="mb-2 flex flex-col gap-1.5">
      {data.map((tool) => (
        <li key={tool.id} className="flex items-center gap-2 text-[10px] tracking-wide">
          <Search
            className={`h-3.5 w-3.5 ${
              tool.status === 'running' ? 'animate-pulse text-gold' : 'text-gold/70'
            }`}
            aria-hidden
          />
          <span className="text-white/70">
            {tool.status === 'running' ? 'searching…' : 'searched'}
          </span>
          <span className="text-muted">{tool.name.replace(/_/g, ' ')}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Verified listing cards carried by fallback answers. Rendered below the
 * bubble (full row width) like the old embedded card stack.
 */
function ListingCards({ data }: { data: readonly SimonListingCardRef[] }) {
  if (!data.length) return null;
  return (
    <div className="mt-3 w-full space-y-2">
      {data.map((card) => (
        <Link
          key={card.listingId}
          href={`/property/${card.listingId}`}
          className="group flex items-center justify-between gap-3 rounded-lg border border-gold/30 bg-surface-2/60 p-3 transition-all hover:border-gold hover:bg-surface-2"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gold/30 bg-gold/10 text-gold">
              <Building2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate font-heading text-sm text-foreground transition-colors group-hover:text-gold">
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
  );
}

function UserRow() {
  return (
    <MessagePrimitive.Root className="flex flex-col items-end">
      <div className="max-w-[88%] rounded-lg rounded-tr-xs border border-gold/40 bg-gold/20 px-4 py-3 text-xs leading-relaxed text-foreground shadow-lg">
        <MessagePrimitive.Parts components={{ Text: UserText }} />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantRow() {
  return (
    <MessagePrimitive.Root className="flex flex-col items-start">
      <div className="max-w-[88%] rounded-lg rounded-tl-xs border border-white/10 bg-surface-1/90 px-4 py-3 text-xs leading-relaxed text-muted shadow-lg">
        <div className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-widest text-gold">
          <Sparkles className="h-3 w-3" />
          <span>SIMON CONCIERGE</span>
        </div>
        <MessagePrimitive.Parts
          components={{
            Text: SimonText,
            data: {
              // Cards render outside the bubble (below); suppress them here.
              by_name: { tools: ToolActivity, listingCards: () => null },
            },
          }}
        />
      </div>
      <MessagePrimitive.Parts
        components={{
          // Text already rendered above; only the card stack shows here.
          Text: () => null,
          data: {
            by_name: { listingCards: ListingCards, tools: () => null },
          },
        }}
      />
    </MessagePrimitive.Root>
  );
}

function SuggestionChips() {
  return (
    <div className="flex flex-wrap gap-1.5 px-3 pt-2.5 [&:empty]:hidden">
      <ThreadPrimitive.Suggestions>
        {({ suggestion }) => (
          <ThreadPrimitive.Suggestion
            key={suggestion.prompt}
            prompt={suggestion.prompt}
            className="rounded-full border border-gold/30 bg-black/60 px-3 py-1 text-[10px] text-champagne transition-colors hover:border-gold hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {suggestion.title ?? suggestion.prompt}
          </ThreadPrimitive.Suggestion>
        )}
      </ThreadPrimitive.Suggestions>
    </div>
  );
}

/**
 * The amber notice is React state outside the runtime (unchanged from
 * ADR-008: the runtime must not learn about rate limiting). Rendered at the
 * top of the scroll area, exactly where the old banner sat.
 */
function NoticeBanner({ notice }: { notice: SimonNotice }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200"
    >
      {notice.text}
      {notice.retryAfterSeconds ? (
        <span className="ml-1 text-amber-200/70">({notice.retryAfterSeconds}s)</span>
      ) : null}
    </div>
  );
}

export function SimonChat({
  pageContext: propPageContext,
  activeListingTitle: propTitle,
}: SimonChatProps) {
  const {
    pageContext: ctxPageContext,
    activeListingTitle: ctxTitle,
    initialPrompt,
    clearInitialPrompt,
  } = useSimon();

  const effectiveContext = propPageContext || ctxPageContext;
  const effectiveTitle = propTitle || ctxTitle || undefined;

  const { runtime, entries, notice, send } = useSimonRuntime({
    context: effectiveContext,
  });

  const initialPromptSentRef = useRef<string | null>(null);
  useEffect(() => {
    if (initialPrompt && initialPromptSentRef.current !== initialPrompt) {
      initialPromptSentRef.current = initialPrompt;
      clearInitialPrompt();
      send(initialPrompt);
    }
  }, [initialPrompt, clearInitialPrompt, send]);

  const lastSource = useMemo<SimonSource | undefined>(() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry?.role === 'assistant' && entry.source) return entry.source;
    }
    return undefined;
  }, [entries]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-full flex-col bg-background text-foreground">
        {/* Grounded Context Header Strip */}
        <div className="flex items-center justify-between border-b border-white/10 bg-black/50 px-4 py-2 text-[10px]">
          <div className="flex items-center gap-1.5 min-w-0">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-gold" />
            <span className="truncate tracking-wider text-champagne/90">
              {effectiveContext?.active_listing_id
                ? `GROUNDED: ${effectiveTitle ? effectiveTitle : 'ACTIVE RESIDENCE'}`
                : effectiveContext?.route?.startsWith('/properties')
                  ? 'GROUNDED: NAIROBI LUXURY CATALOG'
                  : effectiveContext?.route?.startsWith('/gallery')
                    ? 'GROUNDED: 3D SIGNATURE COLLECTION'
                    : 'GROUNDED: VERIFIED LUXONN KNOWLEDGE'}
            </span>
          </div>
          {/* Derived from the last assistant entry, not from a hope: a thread
              can mix agent and fallback answers when the service drops
              mid-conversation, so a global "LIVE" would be a lie for half of
              it. Before the first reply there is no source, and the badge
              says so rather than defaulting to LIVE. */}
          <span
            role="status"
            aria-live="polite"
            className="flex shrink-0 items-center gap-1 text-[9px] uppercase tracking-widest"
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${
                lastSource === 'offline-fallback'
                  ? 'bg-amber-400'
                  : lastSource === 'simon-agent'
                    ? 'bg-emerald-400'
                    : 'bg-white/30'
              }`}
            />
            <span
              className={
                lastSource === 'offline-fallback'
                  ? 'text-amber-300'
                  : lastSource === 'simon-agent'
                    ? 'text-gold/70'
                    : 'text-muted'
              }
            >
              {lastSource === 'offline-fallback'
                ? 'DATABASE MODE'
                : lastSource === 'simon-agent'
                  ? 'LIVE'
                  : 'READY'}
            </span>
          </span>
        </div>

        {/* Message Thread — assistant-ui viewport owns auto-scroll; the inner
            div keeps the old scroll-area spacing (p-4 space-y-4). */}
        <ThreadPrimitive.Viewport
          autoScroll
          className="flex-1 overflow-y-auto [scrollbar-color:var(--gold)_transparent] [scrollbar-width:thin]"
        >
          <div className="space-y-4 p-4">
            {notice && <NoticeBanner notice={notice} />}
            <ThreadPrimitive.Messages
              components={{ UserMessage: UserRow, AssistantMessage: AssistantRow }}
            />
          </div>
        </ThreadPrimitive.Viewport>

        {/* Suggested follow-ups + composer. The composer swaps its gold send
            action for a stop action while a streamed run is active — a new
            affordance that keeps the old disabled-send wording honest. */}
        <div className="border-t border-white/10 bg-surface-1/90 pb-safe">
          <SuggestionChips />
          <ComposerPrimitive.Root className="p-3">
            <div className="relative flex items-center">
              <ComposerPrimitive.Input
                rows={1}
                maxRows={4}
                placeholder="Ask about this residence, specs, prices..."
                className="max-h-32 w-full resize-none rounded-md border border-gold/30 bg-black/70 py-2.5 pl-4 pr-12 text-xs text-foreground outline-none ring-gold placeholder:text-muted/60 focus:border-gold focus:ring-1"
              />
              <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
                <AuiIf condition={(s) => !s.thread.isRunning}>
                  <ComposerPrimitive.Send
                    aria-label="Send inquiry"
                    className="flex h-8 w-8 items-center justify-center rounded-md bg-gold text-black transition-colors hover:bg-champagne disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <Send className="h-3.5 w-3.5" />
                  </ComposerPrimitive.Send>
                </AuiIf>
                <AuiIf condition={(s) => s.thread.isRunning}>
                  <ComposerPrimitive.Cancel
                    aria-label="Stop generating"
                    title="Stop generating"
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-gold/40 bg-black/70 text-gold transition-colors hover:bg-gold/10"
                  >
                    <Square className="h-3 w-3 fill-gold" />
                  </ComposerPrimitive.Cancel>
                </AuiIf>
              </div>
            </div>
          </ComposerPrimitive.Root>
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
}
