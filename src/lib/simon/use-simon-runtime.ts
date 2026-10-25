'use client';

/**
 * Simon concierge engine as an assistant-ui external store.
 *
 * This replaces `use-simon-stream` (an ephemeral-turn hook) with a thread
 * whose entries the runtime renders directly (ADR-021): a streamed answer
 * appends an assistant entry up front and mutates it in place as SSE deltas
 * and tool frames arrive, so tool chips, the partial text, and the final
 * message are one entry with one life cycle instead of a bubble that swaps
 * identities when the run ends.
 *
 * Transport behavior is preserved from `use-simon-stream`:
 * - POST `/api/simon/stream` first (Agent Streaming Protocol, SSE), folding
 *   `id:` frames into `lastEventId` for reconnect context and `data:` frames
 *   into tool state + partial text.
 * - HTTP 429 short-circuits to a rate-limit notice and no answer; it does not
 *   fall through to the fallback (replying into a closed window would make
 *   "wait N seconds" a lie).
 * - Any other non-OK response or a thrown transport error falls back to
 *   POST `/api/simon/chat` (Postgres-backed keyword answers), whose message
 *   carries listing cards, suggested follow-ups, and `source`.
 * - The fallback source (`offline-fallback`) surfaces a dedicated notice so a
 *   mixed thread is honest about which answers came from the agent.
 *
 * Rendering decisions that changed with this migration are recorded in
 * `docs/architecture/decisions.md` (ADR-021), notably: suggested follow-ups
 * render in one row above the composer from the most recent assistant entry
 * that carries them (welcome / fallback turns), and cancelling a run is now
 * exposed — the partial text is kept as a complete assistant message.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
  type ThreadSuggestion,
} from '@assistant-ui/react';
import type { PageContext } from '@/lib/contracts/page-context';
import type { SimonListingCardRef, SimonMessage, SimonSource } from './types';

/**
 * A live concierge tool call during a streamed turn. Frames arrive as
 * `tool-started` / `tool-finished` / `tool-error`; statuses mirror those
 * without inventing a lifecycle the server does not authorize.
 */
export interface SimonToolActivity {
  readonly id: string;
  readonly name: string;
  readonly status: 'running' | 'done' | 'failed';
}

export interface SimonNotice {
  readonly kind: 'rate-limited' | 'error';
  readonly text: string;
  readonly retryAfterSeconds?: number;
}

/**
 * One row of the Simon thread. Fully hydrated answers (fallback path)
 * carry cards / follow-ups / source; streamed answers grow tools + text
 * while `streaming` is true.
 */
export interface SimonChatEntry {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  /** Assistant entries render these as progress rows while active. */
  readonly tools?: readonly SimonToolActivity[];
  readonly listingCards?: readonly SimonListingCardRef[];
  readonly suggestedFollowUps?: readonly string[];
  readonly source?: SimonSource;
  readonly streaming?: boolean;
  /**
   * Fixed creation time for rows that exist during prerender (the welcome
   * row). assistant-ui fills a missing `createdAt` with a no-arg
   * `new Date()`, which cacheComponents rejects in the static shell
   * (ADR-021); runtime rows omit it and are stamped in the browser,
   * where reading the clock is allowed.
   */
  readonly createdAt?: Date;
}

function convertMessage(entry: SimonChatEntry): ThreadMessageLike {
  if (entry.role === 'user') {
    return {
      id: entry.id,
      role: 'user',
      createdAt: entry.createdAt,
      content: [{ type: 'text', text: entry.text }],
      status: { type: 'complete', reason: 'unknown' },
    };
  }

  /**
   * The part type is not exported publicly, so it is derived from
   * `ThreadMessageLike['content']` (a `string | readonly Part[]` union).
   * A local mutable array is needed while assembling streamed content.
   */
  type ContentPart = (Exclude<ThreadMessageLike['content'], string>)[number];

  const tools = entry.tools ?? [];
  const content: ContentPart[] = [];
  if (tools.length > 0) {
    content.push({ type: 'data', name: 'tools', data: tools });
  }
  if (entry.text) {
    content.push({ type: 'text', text: entry.text });
  }
  if (entry.listingCards && entry.listingCards.length > 0) {
    content.push({
      type: 'data',
      name: 'listingCards',
      data: entry.listingCards,
    });
  }

  return {
    id: entry.id,
    role: 'assistant',
    createdAt: entry.createdAt,
    content: content.length > 0 ? content : [{ type: 'text', text: '' }],
    status: entry.streaming
      ? { type: 'running' }
      : { type: 'complete', reason: 'unknown' },
    metadata: {
      custom: {
        source: entry.source,
        suggestedFollowUps: entry.suggestedFollowUps,
      },
    },
  };
}

/**
 * The welcome row is seeded in the `useState` initializer, which also runs
 * during prerender, where cacheComponents forbids reading the clock (Next's
 * Date extension flags only no-arg `new Date()`). A fixed timestamp keeps
 * prerender and hydration byte-identical; nothing renders it — assistant-ui
 * consumes it only for its internal message cache.
 */
const WELCOME_CREATED_AT = new Date('2026-01-01T00:00:00.000Z');

function welcomeEntries(context?: Partial<PageContext>): readonly SimonChatEntry[] {
  const isListingPage = Boolean(context?.active_listing_id);
  return [
    {
      id: 'welcome',
      role: 'assistant',
      createdAt: WELCOME_CREATED_AT,
      text: isListingPage
        ? 'Greetings. I am Simon, your LUXONN personal property concierge. I am actively reviewing the verified architectural facts for this residence.\n\nYou can ask "what is this?", explore dimensions, request verified pricing, or arrange a confidential viewing.'
        : "Greetings. I am Simon, your LUXONN personal property concierge. I can guide you through Kenya's premier architectural estates, clarify specifications, or arrange confidential viewings.\n\nHow may I serve your search today?",
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
}

export interface UseSimonRuntimeOptions {
  /** Effective ADR-008 page context, re-read from this ref at send time. */
  context?: Partial<PageContext>;
}

export function useSimonRuntime(options: UseSimonRuntimeOptions = {}) {
  const [entries, setEntries] = useState<readonly SimonChatEntry[]>(() =>
    welcomeEntries(options.context),
  );
  const [notice, setNotice] = useState<SimonNotice | null>(null);

  // Context is read at send time, not at mount: the sidebar stays mounted
  // across route changes while pages pass fresh context in.
  const contextRef = useRef<Partial<PageContext> | undefined>(options.context);
  contextRef.current = options.context;

  const conversationIdRef = useRef<string>('');
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const lastEventId = useRef<number>(0);

  const isRunning = entries.some((entry) => entry.streaming);

  const patchEntry = useCallback(
    (id: string, patch: (entry: SimonChatEntry) => SimonChatEntry) => {
      setEntries((prev) =>
        prev.map((entry) => (entry.id === id ? patch(entry) : entry)),
      );
    },
    [],
  );

  const removeEntry = useCallback((id: string) => {
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
  }, []);

  const finalizeEntry = useCallback(
    (id: string, merge: Partial<SimonChatEntry>) => {
      patchEntry(id, (entry) => ({ ...entry, ...merge, streaming: false }));
    },
    [patchEntry],
  );

  const runTurn = useCallback(
    async (text: string) => {
      if (runningRef.current) return;
      runningRef.current = true;

      // The old hook cleared any standing notice at send start so a new
      // question is not shaded by the previous turn's 429/offline message.
      setNotice(null);

      abortRef.current?.abort();

      const userId = `u_${crypto.randomUUID()}`;
      const assistantId = `a_${crypto.randomUUID()}`;

      if (!conversationIdRef.current) {
        conversationIdRef.current = crypto.randomUUID();
      }

      const ac = new AbortController();
      abortRef.current = ac;

      setEntries((prev) => [
        ...prev,
        { id: userId, role: 'user' as const, text },
        {
          id: assistantId,
          role: 'assistant' as const,
          text: '',
          tools: [],
          streaming: true,
        },
      ]);

      const fallback = async () => {
        runningRef.current = false;
        try {
          const res = await fetch('/api/simon/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: text,
              conversationId: conversationIdRef.current,
              pageContext: contextRef.current,
            }),
          });

          if (res.status === 429) {
            const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
            setNotice({
              kind: 'rate-limited',
              text: String(body.error ?? 'The concierge is resting. Try again shortly.'),
              retryAfterSeconds: body.retryAfterSeconds as number | undefined,
            });
            removeEntry(assistantId);
            return;
          }

          if (!res.ok) {
            setNotice({ kind: 'error', text: 'The concierge is unavailable right now.' });
            removeEntry(assistantId);
            return;
          }

          const data = (await res.json()) as {
            source?: SimonSource;
            message?: SimonMessage;
          };

          if (data.source === 'offline-fallback') {
            setNotice({
              kind: 'error',
              text: "Simon’s AI concierge is temporarily offline — you’re getting basic verified-fact answers only.",
            });
          }

          if (data.message) {
            finalizeEntry(assistantId, {
              text: data.message.content,
              listingCards: data.message.listingCards,
              suggestedFollowUps: data.message.suggestedFollowUps,
              source: data.message.source,
            });
          } else {
            removeEntry(assistantId);
          }
        } catch {
          setNotice({ kind: 'error', text: 'The concierge connection dropped.' });
          removeEntry(assistantId);
        }
      };

      try {
        const res = await fetch('/api/simon/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            conversationId: conversationIdRef.current,
            pageContext: contextRef.current,
            lastEventId: lastEventId.current || undefined,
          }),
          signal: ac.signal,
        });

        if (res.status === 429) {
          const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          setNotice({
            kind: 'rate-limited',
            text: String(body.error ?? 'The concierge is resting. Try again shortly.'),
            retryAfterSeconds: body.retryAfterSeconds as number | undefined,
          });
          runningRef.current = false;
          removeEntry(assistantId);
          return;
        }

        if (!res.ok || !res.body) {
          await fallback();
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accumulated = '';
        const tools: SimonToolActivity[] = [];

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let cut = buffer.indexOf('\n');
          while (cut !== -1) {
            const line = buffer.slice(0, cut).trim();
            buffer = buffer.slice(cut + 1);

            if (line.startsWith('id: ')) {
              lastEventId.current = Number(line.slice(4)) || lastEventId.current;
            } else if (line.startsWith('data: ')) {
              try {
                const envelope = JSON.parse(line.slice(6)) as {
                  method?: string;
                  params?: { data?: unknown } | null;
                };
                const method = String(envelope.method ?? '');
                const data = (envelope.params?.data ?? {}) as Record<string, unknown>;

                if (method === 'messages') {
                  if (data.event === 'content-block-delta') {
                    const delta = data.delta as { type?: string; text?: string } | undefined;
                    if (delta?.type === 'text-delta' && delta.text) {
                      accumulated += delta.text;
                      patchEntry(assistantId, (entry) => ({ ...entry, text: accumulated }));
                    }
                  }
                  if (data.event === 'message-finish') {
                    // The old parser captured the server's message id here;
                    // entries now own a stable client id, so this frame is
                    // simply confirmation that the stream message completed.
                  }
                }

                if (method === 'tools') {
                  const toolId = String(data.toolCallId ?? '');
                  if (data.event === 'tool-started') {
                    tools.push({
                      id: toolId,
                      name: String(data.name ?? 'tool'),
                      status: 'running',
                    });
                    patchEntry(assistantId, (entry) => ({ ...entry, tools: [...tools] }));
                  } else if (data.event === 'tool-finished') {
                    // Entries hold readonly tool rows; completion swaps the
                    // row for an updated copy rather than mutating in place.
                    const index = tools.findIndex((t) => t.id === toolId);
                    if (index >= 0) {
                      const found = tools[index];
                      if (found) tools[index] = { ...found, status: 'done' };
                    }
                    patchEntry(assistantId, (entry) => ({ ...entry, tools: [...tools] }));
                  } else if (data.event === 'tool-error') {
                    const index = tools.findIndex((t) => t.id === toolId);
                    if (index >= 0) {
                      const found = tools[index];
                      if (found) tools[index] = { ...found, status: 'failed' };
                    }
                    patchEntry(assistantId, (entry) => ({ ...entry, tools: [...tools] }));
                  }
                }

                if (method === 'lifecycle' && data.event === 'failed') {
                  setNotice({
                    kind: 'error',
                    text: String(data.error ?? 'The concierge could not answer.'),
                  });
                }
              } catch {
                // Malformed SSE frame — skip
              }
            }

            cut = buffer.indexOf('\n');
          }
        }

        runningRef.current = false;

        if (!accumulated) {
          removeEntry(assistantId);
          return;
        }

        finalizeEntry(assistantId, { tools, source: 'simon-agent' });
      } catch (err) {
        runningRef.current = false;
        if ((err as Error)?.name === 'AbortError') {
          // Cancel: the partial text stays as a finished agent answer; an
          // answerless placeholder (no text delivered) is dropped rather
          // than leaving a mid-air empty bubble.
          setEntries((prev) => {
            const target = prev.find((entry) => entry.id === assistantId);
            if (!target) return prev;
            if (!target.text) {
              return prev.filter((entry) => entry.id !== assistantId);
            }
            return prev.map((entry) =>
              entry.id === assistantId
                ? { ...entry, streaming: false, source: 'simon-agent' as const }
                : entry,
            );
          });
          return;
        }
        // Any other transport failure falls back to the verified-facts API.
        await fallback();
      }
    },
    [finalizeEntry, patchEntry, removeEntry],
  );

  const send = useCallback(
    (text: string) => {
      void runTurn(text);
    },
    [runTurn],
  );

  const dismissNotice = useCallback(() => setNotice(null), []);

  /**
   * Follow-up suggestions for the thread-level row above the composer,
   * sourced from the most recent assistant entry that carries them (the
   * welcome message, or a fallback answer). Streamed agent replies do not
   * produce follow-ups, so the row is simply absent after them.
   */
  const suggestions = useMemo<readonly ThreadSuggestion[]>(() => {
    if (isRunning) return [];
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry?.role !== 'assistant') continue;
      const followUps = entry.suggestedFollowUps;
      if (followUps?.length) {
        return followUps.map((prompt) => ({ prompt }));
      }
      return [];
    }
    return [];
  }, [entries, isRunning]);

  const runtime = useExternalStoreRuntime<SimonChatEntry>({
    messages: entries,
    convertMessage,
    isRunning,
    suggestions,
    onNew: async (message: AppendMessage) => {
      const text = message.content
        .map((part) => (part.type === 'text' ? part.text : ''))
        .filter(Boolean)
        .join('\n')
        .trim();
      if (!text || runningRef.current) return;
      await runTurn(text);
    },
    onCancel: async () => {
      // Drives the AbortError path above, which finalizes the partial entry.
      abortRef.current?.abort();
    },
  });

  return { runtime, entries, notice, dismissNotice, send };
}
