'use client';

/**
 * Full-page Simon shell built from assistant-ui's published `Thread` and
 * `ThreadList` compositions. The components are used as shipped; only the
 * surrounding layout, brand rail, grounding strip, and Simon's data-part
 * renderers are ours.
 *
 * This surface opts into persisted history (`history: true`): the rail lists
 * the buyer's threads for fourteen days, and the memory dialog edits the
 * preferences Simon carries between them. The docked variant uses the same
 * shell and persistence with the rail hidden.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  AssistantRuntimeProvider,
  useAssistantDataUI,
  useAuiState,
  type DataMessagePartProps,
} from '@assistant-ui/react';
import { Thread } from '@/components/assistant-ui/elements/thread.aui';
import { ThreadList } from '@/components/assistant-ui/elements/thread-list.aui';
import type { PageContext } from '@/lib/contracts/page-context';
import type { SimonListingCardRef, SimonSource } from '@/lib/simon/types';
import { useSimon } from '@/context/SimonContext';
import {
  useSimonRuntime,
  type SimonNotice,
  type SimonToolActivity,
} from '@/lib/simon/use-simon-runtime';
import { SimonMemoryDialog } from './SimonMemoryDialog';

interface SimonAssistantChatProps {
  pageContext?: Partial<PageContext>;
  activeListingTitle?: string | null;
  /** `page` owns the full viewport; `docked` fills the marketplace sidebar. */
  variant?: 'page' | 'docked';
  /** Extra controls rendered at the end of the chat header (dock expand/close). */
  headerActions?: ReactNode;
}

/**
 * Live tool rows for a streamed answer. They are thread-scoped, matching the
 * previous shell: visible only while the run is active.
 */
function ToolActivityPart(props: DataMessagePartProps) {
  // `MessagePartState` unions every data part, so the published prop type
  // widens `data` to `any`; the runtime contract is what the host publishes.
  const data = props.data as readonly SimonToolActivity[];
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
          <span className="text-muted-foreground">{tool.name.replace(/_/g, ' ')}</span>
        </li>
      ))}
    </ul>
  );
}

/** Verified listing cards carried by fallback answers. */
function ListingCardsPart(props: DataMessagePartProps) {
  const data = props.data as readonly SimonListingCardRef[];
  if (!data.length) return null;

  return (
    <div className="mt-3 w-full space-y-2">
      {data.map((card) => (
        <Link
          key={card.listingId}
          href={`/property/${card.listingId}`}
          className="group flex items-center justify-between gap-3 rounded-lg border border-gold/30 bg-surface-2/60 p-3 transition-all hover:border-gold hover:bg-surface-2"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gold/30 bg-gold/10 text-gold">
              <Building2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate font-heading text-sm text-foreground transition-colors group-hover:text-gold">
                {card.title}
              </p>
              <p className="text-[10px] text-muted-foreground">
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

/**
 * Registers Simon's data-part renderers with the runtime. A sibling of the
 * thread is enough: `useAssistantDataUI` writes to the provider's registry.
 */
function SimonDataRenderers() {
  useAssistantDataUI({ name: 'tools', render: ToolActivityPart });
  useAssistantDataUI({ name: 'listingCards', render: ListingCardsPart });
  return null;
}

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

export function SimonAssistantChat({
  pageContext: propPageContext,
  activeListingTitle: propTitle,
  variant = 'page',
  headerActions,
}: SimonAssistantChatProps) {
  const docked = variant === 'docked';
  const {
    pageContext: ctxPageContext,
    activeListingTitle: ctxTitle,
    initialPrompt,
    clearInitialPrompt,
  } = useSimon();

  const effectiveContext = propPageContext || ctxPageContext;
  const effectiveTitle = propTitle || ctxTitle || undefined;

  const { runtime, entries, notice, send, historyLoading } = useSimonRuntime({
    context: effectiveContext,
    startEmpty: true,
    history: true,
  });
  const [memoryOpen, setMemoryOpen] = useState(false);

  const initialPromptSentRef = useRef<string | null>(null);
  useEffect(() => {
    // `send` is a no-op while history is loading, so wait for the rail before
    // dispatching a prompt handed over from a listing page.
    if (historyLoading) return;
    if (initialPrompt && initialPromptSentRef.current !== initialPrompt) {
      initialPromptSentRef.current = initialPrompt;
      clearInitialPrompt();
      send(initialPrompt);
    }
  }, [initialPrompt, historyLoading, clearInitialPrompt, send]);

  const lastSource = useMemo<SimonSource | undefined>(() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry?.role === 'assistant' && entry.source) return entry.source;
    }
    return undefined;
  }, [entries]);

  const groundingLabel = effectiveContext?.active_listing_id
    ? `GROUNDED: ${effectiveTitle ? effectiveTitle : 'ACTIVE RESIDENCE'}`
    : effectiveContext?.route?.startsWith('/properties')
      ? 'GROUNDED: NAIROBI LUXURY CATALOG'
      : effectiveContext?.route?.startsWith('/gallery')
        ? 'GROUNDED: 3D SIGNATURE COLLECTION'
        : 'GROUNDED: VERIFIED LUXONN KNOWLEDGE';

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div
        className={`aui-scope flex w-full overflow-hidden bg-background text-foreground ${
          docked ? 'h-full' : 'h-dvh'
        }`}
      >
        {!docked ? (
          <aside className="hidden w-[260px] shrink-0 flex-col border-r border-white/10 bg-[#080808] md:flex">
            <div className="flex h-14 items-center justify-between px-3">
              <Link
                href="/"
                className="font-heading text-sm tracking-[0.35em] text-champagne transition-colors hover:text-gold"
              >
                LUXONN
              </Link>
              <span className="text-[9px] uppercase tracking-[0.3em] text-muted-foreground">
                Simon
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 [scrollbar-width:thin]">
              <ThreadList />
            </div>

            <div className="border-t border-white/10 p-3">
              <button
                type="button"
                onClick={() => setMemoryOpen(true)}
                className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-[11px] tracking-wider text-champagne/80 transition-colors hover:text-gold"
              >
                <Sparkles className="h-3.5 w-3.5 text-gold" aria-hidden />
                What Simon remembers
              </button>
              <Link
                href="/"
                className="mt-1 flex items-center gap-2 rounded-md px-1 py-1.5 text-[11px] tracking-wider text-muted-foreground transition-colors hover:text-gold"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                Back to marketplace
              </Link>
              <p className="mt-2 px-1 text-[10px] leading-relaxed text-white/35">
                Conversations and what Simon remembers are kept for fourteen days
                after your last message.
              </p>
            </div>
          </aside>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-black/40 px-4">
            <div className="flex min-w-0 items-center gap-2">
              <Link
                href="/"
                aria-label="Back to LUXONN"
                className={`text-muted-foreground transition-colors hover:text-gold ${
                  docked ? 'hidden' : 'md:hidden'
                }`}
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
              </Link>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">Simon</p>
                <p className="flex items-center gap-1.5 truncate text-[10px] tracking-wider text-champagne/80">
                  <ShieldCheck className="h-3 w-3 shrink-0 text-gold" aria-hidden />
                  <span className="truncate">{groundingLabel}</span>
                </p>
              </div>
            </div>

            {/* Derived from the last assistant entry: a thread can mix live
                and fallback answers when the agent drops mid-conversation. */}
            <div className="flex shrink-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setMemoryOpen(true)}
                aria-label="What Simon remembers"
                className={`text-white/40 transition-colors hover:text-gold ${
                  docked ? '' : 'md:hidden'
                }`}
              >
                <Sparkles className="h-4 w-4" aria-hidden />
              </button>
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
                        : 'text-muted-foreground'
                  }
                >
                  {lastSource === 'offline-fallback'
                    ? 'DATABASE MODE'
                    : lastSource === 'simon-agent'
                      ? 'LIVE'
                      : 'READY'}
                </span>
              </span>
              {headerActions}
            </div>
          </header>

          {notice ? (
            <div className="shrink-0 px-4 pt-3">
              <NoticeBanner notice={notice} />
            </div>
          ) : null}

          <div className="min-h-0 flex-1">
            <Thread />
          </div>
        </div>

        <SimonDataRenderers />
        <SimonMemoryDialog open={memoryOpen} onOpenChange={setMemoryOpen} />
      </div>
    </AssistantRuntimeProvider>
  );
}
