'use client';

/**
 * The Simon chat runtime: transport, persistence, and assistant-ui adapter.
 *
 * The shipped surfaces (`/simon`, `/simon-chat`, and the marketplace dock) all
 * run with `history: true`: the conversation lives in Postgres for fourteen
 * days, and the marketplace thread id is also Simon's checkpoint id, so a
 * reloaded thread keeps the agent's own memory as well as the stored
 * transcript. Every completed turn is written by the API routes; the runtime
 * owns the rail, switching, rename, delete, and archive. `history: false`
 * remains available for tests and renders an ephemeral thread that writes
 * nothing.
 *
 * Transport rules that matter:
 *
 * - Streaming is the primary source; a non-streamed JSON fallback keeps the
 *   concierge answering when the SSE relay fails.
 * - A turn owns two client-generated UUIDs (`client_message_id` and
 *   `assistant_message_id`) so retries and edits are idempotent server-side.
 *   `/api/simon/stream` accepts only bare UUIDs and silently substitutes a
 *   random one otherwise.
 * - `replaceFrom` asks the save RPC to truncate first. Edits truncate at the
 *   old user row; reloads truncate at the last user row and re-use its client
 *   id, so the regenerated answer replaces the old one instead of appending.
 * - A thread switch increments a turn token and aborts the stream. Every async
 *   mutation checks the token, so a late frame cannot land in the thread the
 *   buyer just opened.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useExternalStoreRuntime,
  type AppendMessage,
  type ExternalStoreThreadData,
  type ThreadMessageLike,
  type ThreadSuggestion,
} from '@assistant-ui/react';
import type { PageContext } from '@/lib/contracts/page-context';
import type { SimonMessage } from './types';
import {
  simonEntriesFromStoredMessages,
  simonSnippetTitle,
  type SimonChatEntry,
  type SimonNotice,
  type SimonToolActivity,
  type StoredSimonMessage,
  type StoredSimonThread,
} from './chat-types';

// Re-exported for the shells, which historically imported these from here.
export type { SimonChatEntry, SimonNotice, SimonToolActivity } from './chat-types';

function convertMessage(entry: SimonChatEntry): ThreadMessageLike {
  if (entry.role === 'user') {
    return {
      id: entry.id,
      role: 'user',
      createdAt: entry.createdAt,
      content: [{ type: 'text', text: entry.text }],
      // assistant-ui rejects `status` on user messages at runtime (it is an
      // assistant-only field). Streaming state belongs on the assistant row.
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

/**
 * A stable empty history snapshot. The external-store core compares thread
 * arrays by identity; a fresh literal on every render would rebuild its
 * thread cache each time.
 */
const EMPTY_THREADS = [] as const;

const MAX_THREADS = 80;
const ARCHIVE_LIMIT = 60;
const ACTIVE_THREAD_KEY = 'luxonn.simon.activeThread';
const ARCHIVED_THREADS_KEY = 'luxonn.simon.archivedThreads';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A rail row, plus the title provenance the server uses for precedence. */
type SimonThreadListItem = ExternalStoreThreadData<'regular'> & {
  readonly titleSource?: 'snippet' | 'llm' | 'user';
};

interface ActiveThreadState {
  readonly id: string;
  readonly entries: readonly SimonChatEntry[];
}

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

/** Extracts the text Simon should answer from a composer submission. */
function appendMessageText(message: AppendMessage): string {
  return message.content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

/**
 * A thread switch aborts the in-flight answer, so nothing may stay marked as
 * streaming once its transcript is parked in the cache. An assistant row that
 * never received text or tool activity is dropped: the save route skips it
 * too, so keeping it would show a bubble that history can never restore.
 */
function settleEntries(
  entries: readonly SimonChatEntry[],
): readonly SimonChatEntry[] {
  return entries.flatMap((entry) => {
    if (!entry.streaming) return [entry];
    const hasActivity =
      entry.text.trim().length > 0 ||
      (entry.tools?.length ?? 0) > 0 ||
      (entry.listingCards?.length ?? 0) > 0 ||
      (entry.suggestedFollowUps?.length ?? 0) > 0;
    if (entry.role === 'assistant' && !hasActivity) return [];
    return [{ ...entry, streaming: false }];
  });
}

/** Higher rank wins when a stale server title races a local rename. */
function titleRank(source: string | undefined): number {
  if (source === 'user') return 2;
  if (source === 'llm') return 1;
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readStoredThread(value: unknown): StoredSimonThread | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  const title =
    typeof value.title === 'string' && value.title.trim()
      ? value.title
      : 'New conversation';
  return {
    id: value.id,
    title,
    titleSource:
      value.titleSource === 'llm' || value.titleSource === 'user'
        ? value.titleSource
        : 'snippet',
    lastMessageAt:
      typeof value.lastMessageAt === 'string' ? value.lastMessageAt : null,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : null,
  };
}

function toThreadItem(thread: StoredSimonThread): SimonThreadListItem {
  return {
    status: 'regular',
    id: thread.id,
    remoteId: thread.id,
    externalId: thread.id,
    title: thread.title,
    titleSource: thread.titleSource,
  };
}

// ---------------------------------------------------------------------------
// Browser storage. Every access is guarded: the hook also renders on the
// server, and a privacy-mode browser can throw from localStorage.
// ---------------------------------------------------------------------------

function readStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage is a convenience, never a source of truth.
  }
}

function readActiveThreadId(): string | null {
  const value = readStorage(ACTIVE_THREAD_KEY);
  return value && UUID_PATTERN.test(value) ? value : null;
}

function writeActiveThreadId(threadId: string): void {
  writeStorage(ACTIVE_THREAD_KEY, threadId);
}

function readArchivedThreadIds(): string[] {
  const raw = readStorage(ARCHIVED_THREADS_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (value): value is string =>
          typeof value === 'string' && UUID_PATTERN.test(value),
      )
      .slice(0, ARCHIVE_LIMIT);
  } catch {
    return [];
  }
}

function writeArchivedThreadIds(ids: readonly string[]): void {
  writeStorage(ARCHIVED_THREADS_KEY, JSON.stringify(ids.slice(0, ARCHIVE_LIMIT)));
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

export interface UseSimonRuntimeOptions {
  /** Effective ADR-008 page context, re-read from this ref at send time. */
  context?: Partial<PageContext>;
  /**
   * Start with no rows so the host shell can render its own new-chat view
   * (assistant-ui considers an empty thread a new chat). The docked concierge
   * keeps the seeded greeting; `/simon-chat` opts out.
   */
  startEmpty?: boolean;
  /**
   * Persist threads, expose the history rail, and restore the last open thread.
   * Only `/simon-chat` enables this; the docked concierge stays ephemeral so a
   * passing question never leaves a record.
   */
  history?: boolean;
}

export function useSimonRuntime(options: UseSimonRuntimeOptions = {}) {
  const historyEnabled = options.history === true;

  const [active, setActive] = useState<ActiveThreadState>(() => ({
    id: '',
    entries: options.startEmpty ? [] : welcomeEntries(options.context),
  }));
  const [threads, setThreads] = useState<readonly SimonThreadListItem[]>(
    () => EMPTY_THREADS,
  );
  const [notice, setNotice] = useState<SimonNotice | null>(null);
  const [historyLoading, setHistoryLoading] = useState(historyEnabled);

  const activeRef = useRef(active);
  activeRef.current = active;

  const threadsRef = useRef<readonly SimonThreadListItem[]>(threads);
  threadsRef.current = threads;

  // Context is read at send time, not at mount: the sidebar stays mounted
  // across route changes while pages pass fresh context in.
  const contextRef = useRef<Partial<PageContext> | undefined>(options.context);
  contextRef.current = options.context;

  /**
   * Per-thread transcript cache. Switching back is instant and keeps scroll and
   * settled entries; a change bumps the turn token so the previous thread's
   * late frames are ignored.
   */
  const entriesCacheRef = useRef<Map<string, readonly SimonChatEntry[]>>(
    new Map(),
  );
  /** Threads the user has created but the server has not listed yet. */
  const optimisticIdsRef = useRef<Set<string>>(new Set());
  /** Optimistic threads that have produced a turn worth claiming. */
  const sentIdsRef = useRef<Set<string>>(new Set());
  /** User-hidden threads. Archive is local-only, so no schema change. */
  const archivedRef = useRef<Set<string>>(new Set());

  const conversationIdRef = useRef<string>('');
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const lastEventId = useRef<number>(0);
  /** Invalidate every in-flight mutation when the open thread changes. */
  const turnTokenRef = useRef(0);
  /** Sequence guard for overlapping thread loads. */
  const loadSeqRef = useRef(0);
  const historyBusyRef = useRef(historyEnabled);
  /** The next turn after opening a stored thread carries the summary. */
  const resumedRef = useRef(false);

  const isRunning = active.entries.some((entry) => entry.streaming);

  const writeThreads = useCallback(
    (
      updater: (
        previous: readonly SimonThreadListItem[],
      ) => readonly SimonThreadListItem[],
    ) => {
      const next = updater(threadsRef.current);
      if (next === threadsRef.current) return;
      threadsRef.current = next;
      setThreads(next);
    },
    [],
  );

  const applyActive = useCallback((next: ActiveThreadState) => {
    activeRef.current = next;
    setActive(next);
    if (next.id) entriesCacheRef.current.set(next.id, next.entries);
  }, []);

  /**
   * Publishing entries is deliberately synchronous through `activeRef`: a
   * burst of stream deltas and a thread switch can land in the same tick, and
   * reading React state there would resurrect the old thread's row.
   */
  const commitEntries = useCallback(
    (updater: (previous: readonly SimonChatEntry[]) => readonly SimonChatEntry[]) => {
      const current = activeRef.current;
      const next = updater(current.entries);
      if (next === current.entries) return;
      applyActive({ id: current.id, entries: next });
    },
    [applyActive],
  );

  const settleActive = useCallback(() => {
    const current = activeRef.current;
    if (!current.entries.some((entry) => entry.streaming)) return;
    applyActive({ id: current.id, entries: settleEntries(current.entries) });
  }, [applyActive]);

  const setThreadTitle = useCallback(
    (threadId: string, rawTitle: string, source: 'snippet' | 'llm' | 'user') => {
      const title = rawTitle.trim();
      if (!title) return;
      writeThreads((previous) => {
        const index = previous.findIndex((thread) => thread.id === threadId);
        if (index === -1) {
          return [
            {
              status: 'regular' as const,
              id: threadId,
              remoteId: threadId,
              externalId: threadId,
              title,
              titleSource: source,
            },
            ...previous,
          ].slice(0, MAX_THREADS);
        }
        const current = previous[index];
        if (!current) return previous;
        if (titleRank(source) < titleRank(current.titleSource)) return previous;
        if (current.title === title && current.titleSource === source) {
          return previous;
        }
        const next = [...previous];
        next[index] = { ...current, title, titleSource: source };
        return next;
      });
    },
    [writeThreads],
  );

  const removeThreadLocal = useCallback(
    (threadId: string) => {
      optimisticIdsRef.current.delete(threadId);
      sentIdsRef.current.delete(threadId);
      entriesCacheRef.current.delete(threadId);
      writeThreads((previous) =>
        previous.some((thread) => thread.id === threadId)
          ? previous.filter((thread) => thread.id !== threadId)
          : previous,
      );
    },
    [writeThreads],
  );

  /**
   * Refresh the rail after a saved turn. The API's persistence is asynchronous
   * (a registered `after()` callback on the stream path), so this normally runs
   * ~1.2s after the answer completes and tolerates a list that is one turn
   * behind.
   */
  const refreshThreads = useCallback(async () => {
    if (!historyEnabled) return;

    let stored: StoredSimonThread[];
    try {
      const response = await fetch('/api/simon/threads', {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const data = await readJson(response);
      const rows = isRecord(data) && Array.isArray(data.threads)
        ? data.threads
        : [];
      stored = rows.flatMap((row) => {
        const thread = readStoredThread(row);
        return thread ? [thread] : [];
      });
    } catch {
      return;
    }

    const serverIds = new Set(stored.map((thread) => thread.id));
    for (const id of serverIds) {
      optimisticIdsRef.current.delete(id);
      sentIdsRef.current.delete(id);
    }

    writeThreads((previous) => {
      // Keep a just-created thread visible until the server lists it. The
      // active id stays even if a stale list response omits it.
      const optimistic = previous.filter(
        (thread) =>
          !serverIds.has(thread.id) && optimisticIdsRef.current.has(thread.id),
      );

      const merged = stored
        .filter((thread) => !archivedRef.current.has(thread.id))
        .map((thread) => {
          const local = previous.find((item) => item.id === thread.id);
          const localRank = local ? titleRank(local.titleSource) : -1;
          const serverRank = titleRank(thread.titleSource);
          const item = toThreadItem(thread);
          // A slower list response must not downgrade a title the user just
          // renamed or the model just generated.
          return local && localRank > serverRank
            ? { ...item, title: local.title, titleSource: local.titleSource }
            : item;
        });

      return [...optimistic, ...merged].slice(0, MAX_THREADS);
    });
  }, [historyEnabled, writeThreads]);

  /**
   * Ask the server for an LLM title / summary / facts after the first completed
   * turn. The 404 and `incomplete_turn` retries cover the streaming `after()`
   * save landing a moment after the client sees the answer. Later turns hit
   * `title_locked` before any model call, which is the accepted tradeoff: the
   * summary is a first-turn artifact and memory stays heuristic after that.
   */
  const requestThreadMeta = useCallback(
    async (threadId: string) => {
      if (!historyEnabled) return;
      const delays = [0, 700, 1400];

      for (const delay of delays) {
        if (delay > 0) {
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, delay);
          });
        }

        try {
          const response = await fetch(
            `/api/simon/threads/${threadId}/title`,
            { method: 'POST' },
          );

          if (response.status === 404) continue;
          if (!response.ok) return;

          const data = await readJson(response);
          if (isRecord(data) && typeof data.title === 'string') {
            setThreadTitle(threadId, data.title, 'llm');
          }
          if (isRecord(data) && data.reason === 'incomplete_turn') continue;
          return;
        } catch {
          return;
        }
      }
    },
    [historyEnabled, setThreadTitle],
  );

  const scheduleMeta = useCallback(
    (threadId: string) => {
      if (!historyEnabled) return;
      window.setTimeout(() => {
        void requestThreadMeta(threadId);
        void refreshThreads();
      }, 1200);
    },
    [historyEnabled, refreshThreads, requestThreadMeta],
  );

  const startNewThread = useCallback(
    (meta?: { title?: string }) => {
      turnTokenRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      runningRef.current = false;
      settleActive();
      setNotice(null);

      const id = crypto.randomUUID();
      const entries = options.startEmpty ? [] : welcomeEntries(contextRef.current);

      applyActive({ id, entries });
      conversationIdRef.current = id;
      lastEventId.current = 0;
      resumedRef.current = false;

      if (!historyEnabled) return;

      writeActiveThreadId(id);

      // A new chat supersedes abandoned blank drafts, but never a thread that
      // has already produced a turn and is merely waiting for the save.
      const stale = new Set(
        [...optimisticIdsRef.current].filter(
          (candidate) => candidate !== id && !sentIdsRef.current.has(candidate),
        ),
      );
      for (const candidate of stale) {
        optimisticIdsRef.current.delete(candidate);
        entriesCacheRef.current.delete(candidate);
      }
      optimisticIdsRef.current.add(id);

      writeThreads((previous) =>
        [
          {
            status: 'regular' as const,
            id,
            remoteId: id,
            externalId: id,
            title: meta?.title ?? 'New conversation',
            titleSource: 'snippet' as const,
          },
          ...previous.filter(
            (thread) => thread.id !== id && !stale.has(thread.id),
          ),
        ].slice(0, MAX_THREADS),
      );
    },
    [
      applyActive,
      historyEnabled,
      options.startEmpty,
      settleActive,
      writeThreads,
    ],
  );

  const loadThread = useCallback(
    async (threadId: string) => {
      if (!historyEnabled) return;
      if (
        activeRef.current.id === threadId &&
        !historyBusyRef.current
      ) {
        return;
      }

      turnTokenRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      runningRef.current = false;
      settleActive();
      setNotice(null);

      const sequence = ++loadSeqRef.current;
      historyBusyRef.current = true;
      setHistoryLoading(true);

      const cached = entriesCacheRef.current.get(threadId);
      if (cached) {
        // A cached transcript can still hold the streaming flag from the
        // moment we switched away mid-answer. Settling it here keeps the
        // phantom Stop button from coming back with the cache.
        const entries = cached.some((entry) => entry.streaming)
          ? settleEntries(cached)
          : cached;
        applyActive({ id: threadId, entries });
        resumedRef.current = cached.length > 0;
        writeActiveThreadId(threadId);
        historyBusyRef.current = false;
        setHistoryLoading(false);
        return;
      }

      try {
        const response = await fetch(`/api/simon/threads/${threadId}`, {
          cache: 'no-store',
        });

        if (sequence !== loadSeqRef.current) return;

        if (response.status === 404 || response.status === 410) {
          // Expired or deleted: the rail row is stale, so drop it and open a
          // fresh chat rather than stranding the shell on an empty transcript.
          removeThreadLocal(threadId);
          if (activeRef.current.id === threadId) startNewThread();
          setNotice({
            kind: 'error',
            text: 'That conversation is no longer available, so this is a new one.',
          });
          return;
        }

        if (!response.ok) {
          // Anything else is transient. Keep the current transcript and let
          // the buyer retry instead of silently discarding their thread.
          setNotice({
            kind: 'error',
            text: 'That conversation could not be opened right now.',
          });
          return;
        }

        const data = await readJson(response);
        if (sequence !== loadSeqRef.current) return;

        const thread =
          isRecord(data) && isRecord(data.thread)
            ? readStoredThread({
                id: data.thread.id,
                title: data.thread.title,
                titleSource: data.thread.titleSource,
                lastMessageAt: data.thread.lastMessageAt,
                createdAt: data.thread.createdAt,
              })
            : null;
        const rows = isRecord(data) && Array.isArray(data.messages)
          ? (data.messages as StoredSimonMessage[])
          : [];
        const entries = simonEntriesFromStoredMessages(rows);

        applyActive({ id: threadId, entries });
        resumedRef.current = entries.length > 0;
        lastEventId.current = 0;
        writeActiveThreadId(threadId);

        if (thread) {
          setThreadTitle(threadId, thread.title, thread.titleSource);
        }
      } catch {
        if (sequence !== loadSeqRef.current) return;
        setNotice({
          kind: 'error',
          text: 'That conversation could not be opened right now.',
        });
      } finally {
        if (sequence === loadSeqRef.current) {
          historyBusyRef.current = false;
          setHistoryLoading(false);
        }
      }
    },
    [
      applyActive,
      historyEnabled,
      removeThreadLocal,
      setThreadTitle,
      settleActive,
      startNewThread,
    ],
  );

  const renameThread = useCallback(
    async (threadId: string, rawTitle: string) => {
      const title = rawTitle.trim().slice(0, 120);
      if (!title) return;

      setThreadTitle(threadId, title, 'user');

      const applyRename = async () => {
        const response = await fetch(`/api/simon/threads/${threadId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        });
        return response;
      };

      try {
        let response = await applyRename();
        if (response.status === 404 && optimisticIdsRef.current.has(threadId)) {
          // The first turn may still be in the stream route's `after()` save.
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 1500);
          });
          response = await applyRename();
        }
        if (!response.ok && response.status !== 404) {
          throw new Error(`rename failed: ${response.status}`);
        }
      } catch {
        setNotice({
          kind: 'error',
          text: 'That conversation could not be renamed.',
        });
        void refreshThreads();
      }
    },
    [refreshThreads, setThreadTitle],
  );

  const archiveThread = useCallback(
    (threadId: string) => {
      if (activeRef.current.id === threadId) startNewThread();

      const next = [
        threadId,
        ...[...archivedRef.current].filter((id) => id !== threadId),
      ].slice(0, ARCHIVE_LIMIT);
      archivedRef.current = new Set(next);
      writeArchivedThreadIds(next);

      optimisticIdsRef.current.delete(threadId);
      sentIdsRef.current.delete(threadId);
      entriesCacheRef.current.delete(threadId);
      writeThreads((previous) =>
        previous.filter((thread) => thread.id !== threadId),
      );
    },
    [startNewThread, writeThreads],
  );

  const deleteThread = useCallback(
    async (threadId: string) => {
      if (activeRef.current.id === threadId) startNewThread();
      removeThreadLocal(threadId);

      try {
        const response = await fetch(`/api/simon/threads/${threadId}`, {
          method: 'DELETE',
        });
        if (!response.ok && response.status !== 404) {
          throw new Error(`delete failed: ${response.status}`);
        }
      } catch {
        setNotice({
          kind: 'error',
          text: 'That conversation could not be deleted.',
        });
        void refreshThreads();
      }
    },
    [refreshThreads, removeThreadLocal, startNewThread],
  );

  const runTurn = useCallback(
    async (
      text: string,
      turnOptions: {
        appendUser?: boolean;
        replaceFrom?: string | null;
        userEntryId?: string;
      } = {},
    ) => {
      const message = text.trim();
      if (!message || runningRef.current) return;
      if (historyEnabled && historyBusyRef.current) return;

      const appendUser = turnOptions.appendUser !== false;
      const userEntryId = turnOptions.userEntryId ?? crypto.randomUUID();
      const assistantEntryId = crypto.randomUUID();
      const replaceFrom = turnOptions.replaceFrom ?? null;

      const before = activeRef.current;
      const isFirstTurn = !before.entries.some((entry) => entry.role === 'user');
      const threadId = before.id || crypto.randomUUID();
      const conversationId = historyEnabled
        ? threadId
        : conversationIdRef.current || crypto.randomUUID();
      conversationIdRef.current = conversationId;

      const token = ++turnTokenRef.current;
      runningRef.current = true;
      setNotice(null);

      const stillCurrent = () => token === turnTokenRef.current;
      const commit = (
        updater: (
          previous: readonly SimonChatEntry[],
        ) => readonly SimonChatEntry[],
      ) => {
        if (!stillCurrent()) return;
        commitEntries(updater);
      };
      const patchEntry = (
        id: string,
        patch: (entry: SimonChatEntry) => SimonChatEntry,
      ) => {
        commit((previous) =>
          previous.map((entry) => (entry.id === id ? patch(entry) : entry)),
        );
      };
      const removeEntry = (id: string) => {
        commit((previous) => previous.filter((entry) => entry.id !== id));
      };
      const finalizeEntry = (
        id: string,
        patch: Partial<SimonChatEntry>,
      ) => {
        patchEntry(id, (entry) => ({ ...entry, ...patch, streaming: false }));
      };

      if (historyEnabled) {
        if (!before.id) {
          applyActive({ id: threadId, entries: before.entries });
          writeActiveThreadId(threadId);
          optimisticIdsRef.current.add(threadId);
        }
        if (isFirstTurn) {
          setThreadTitle(threadId, simonSnippetTitle(message), 'snippet');
        }
        sentIdsRef.current.add(threadId);
      }

      commit((previous) => [
        ...previous,
        ...(appendUser
          ? [
              {
                id: userEntryId,
                role: 'user' as const,
                text: message,
              },
            ]
          : []),
        {
          id: assistantEntryId,
          role: 'assistant' as const,
          text: '',
          tools: [],
          streaming: true,
        },
      ]);

      const requestBody = {
        message,
        conversationId,
        pageContext: contextRef.current,
        lastEventId: lastEventId.current,
        persist: historyEnabled,
        clientMessageId: userEntryId,
        assistantMessageId: assistantEntryId,
        replaceFrom,
        resumed: resumedRef.current,
      };

      // The first turn consumes the resume context; later turns rely on
      // Simon's own checkpoint for the same conversation.
      resumedRef.current = false;

      // Cancel and thread switches abort this controller. It must be handed
      // to every fetch in the turn, otherwise Stop only stops the spinner
      // while the upstream stream keeps delivering tokens.
      const controller = new AbortController();
      abortRef.current = controller;

      const completed = async () => {
        if (!stillCurrent()) return;
        runningRef.current = false;
        if (historyEnabled) scheduleMeta(threadId);
      };

      const fallback = async () => {
        let response: Response;
        try {
          response = await fetch('/api/simon/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          });
        } catch (error) {
          if ((error as Error)?.name === 'AbortError') {
            removeEntry(assistantEntryId);
            runningRef.current = false;
            return;
          }
          if (!stillCurrent()) return;
          setNotice({
            kind: 'error',
            text: 'The concierge is unavailable right now.',
          });
          removeEntry(assistantEntryId);
          runningRef.current = false;
          return;
        }

        if (!stillCurrent()) return;

        if (response.status === 429) {
          const body = await readJson(response);
          setNotice({
            kind: 'rate-limited',
            text:
              (isRecord(body) && typeof body.error === 'string'
                ? body.error
                : null) ?? 'The concierge is resting. Try again shortly.',
            retryAfterSeconds:
              isRecord(body) && typeof body.retryAfterSeconds === 'number'
                ? body.retryAfterSeconds
                : undefined,
          });
          removeEntry(assistantEntryId);
          runningRef.current = false;
          return;
        }

        if (!response.ok) {
          setNotice({
            kind: 'error',
            text: 'The concierge is unavailable right now.',
          });
          removeEntry(assistantEntryId);
          runningRef.current = false;
          return;
        }

        const data = await readJson(response);
        if (!stillCurrent()) return;

        const assistant =
          isRecord(data) && isRecord(data.message)
            ? (data.message as unknown as Partial<SimonMessage>)
            : null;
        const answer = typeof assistant?.content === 'string'
          ? assistant.content.trim()
          : '';

        if (!answer) {
          removeEntry(assistantEntryId);
          runningRef.current = false;
          return;
        }

        if (isRecord(data) && data.source === 'offline-fallback') {
          setNotice({
            kind: 'error',
            text: "Simon’s AI concierge is temporarily offline — you’re getting basic verified-fact answers only.",
          });
        }

        finalizeEntry(assistantEntryId, {
          text: answer,
          tools: [],
          listingCards: assistant?.listingCards,
          suggestedFollowUps: assistant?.suggestedFollowUps,
          source: assistant?.source ?? 'offline-fallback',
        });
        await completed();
      };

      try {
        let response: Response;
        try {
          response = await fetch('/api/simon/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          });
        } catch (error) {
          if ((error as Error)?.name === 'AbortError') {
            removeEntry(assistantEntryId);
            if (stillCurrent()) runningRef.current = false;
            return;
          }
          await fallback();
          return;
        }

        if (!stillCurrent()) return;

        if (response.status === 429) {
          const body = await readJson(response);
          setNotice({
            kind: 'rate-limited',
            text:
              (isRecord(body) && typeof body.error === 'string'
                ? body.error
                : null) ?? 'The concierge is resting. Try again shortly.',
            retryAfterSeconds:
              isRecord(body) && typeof body.retryAfterSeconds === 'number'
                ? body.retryAfterSeconds
                : undefined,
          });
          removeEntry(assistantEntryId);
          runningRef.current = false;
          return;
        }

        if (!response.ok || !response.body) {
          await fallback();
          return;
        }

        const reader = response.body.getReader();
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
                const data = (envelope.params?.data ?? {}) as Record<
                  string,
                  unknown
                >;

                if (method === 'messages') {
                  if (data.event === 'content-block-delta') {
                    const delta = data.delta as
                      | { type?: string; text?: string }
                      | undefined;
                    if (delta?.type === 'text-delta' && delta.text) {
                      accumulated += delta.text;
                      patchEntry(assistantEntryId, (entry) => ({
                        ...entry,
                        text: accumulated,
                      }));
                    }
                  }
                  if (data.event === 'message-finish') {
                    // The server's message id is not the entry id; this frame
                    // is confirmation that the stream message completed.
                  }
                }

                if (method === 'tools') {
                  const toolId = String(data.toolCallId ?? '');
                  if (data.event === 'tool-started') {
                    tools?.push({
                      id: toolId,
                      name: String(data.name ?? 'tool'),
                      status: 'running',
                    });
                    patchEntry(assistantEntryId, (entry) => ({
                      ...entry,
                      tools: [...(tools ?? [])],
                    }));
                  } else if (data.event === 'tool-finished') {
                    const index = tools?.findIndex((tool) => tool.id === toolId) ?? -1;
                    if (index >= 0 && tools) {
                      const found = tools[index];
                      if (found) tools[index] = { ...found, status: 'done' };
                    }
                    patchEntry(assistantEntryId, (entry) => ({
                      ...entry,
                      tools: [...(tools ?? [])],
                    }));
                  } else if (data.event === 'tool-error') {
                    const index = tools?.findIndex((tool) => tool.id === toolId) ?? -1;
                    if (index >= 0 && tools) {
                      const found = tools[index];
                      if (found) tools[index] = { ...found, status: 'failed' };
                    }
                    patchEntry(assistantEntryId, (entry) => ({
                      ...entry,
                      tools: [...(tools ?? [])],
                    }));
                  }
                }

                if (method === 'lifecycle' && data.event === 'failed') {
                  if (stillCurrent()) {
                    setNotice({
                      kind: 'error',
                      text: String(
                        data.error ?? 'The concierge could not answer.',
                      ),
                    });
                  }
                }
              } catch {
                // Malformed SSE frame — skip
              }
            }

            cut = buffer.indexOf('\n');
          }
        }

        if (!stillCurrent()) return;

        if (!accumulated) {
          removeEntry(assistantEntryId);
          runningRef.current = false;
          return;
        }

        finalizeEntry(assistantEntryId, { tools, source: 'simon-agent' });
        await completed();
      } catch (error) {
        if (!stillCurrent()) return;

        if ((error as Error)?.name === 'AbortError') {
          // Cancel: partial text stays as a finished agent answer; an
          // answerless placeholder is dropped rather than leaving an empty
          // bubble. The stream route saves the same partial text.
          commit((previous) => {
            const target = previous.find(
              (entry) => entry.id === assistantEntryId,
            );
            if (!target) return previous;
            if (!target.text) {
              return previous.filter(
                (entry) => entry.id !== assistantEntryId,
              );
            }
            return previous.map((entry) =>
              entry.id === assistantEntryId
                ? {
                    ...entry,
                    streaming: false,
                    source: 'simon-agent' as const,
                  }
                : entry,
            );
          });
          runningRef.current = false;
          return;
        }

        await fallback();
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        if (stillCurrent()) runningRef.current = false;
      }
    },
    [
      applyActive,
      commitEntries,
      historyEnabled,
      scheduleMeta,
      setThreadTitle,
    ],
  );

  /**
   * Boot the history rail once per mount. There is deliberately no
   * `bootedRef`: React StrictMode cancels the first effect run and re-runs it,
   * so the guard must live on each run's own `cancelled` flag.
   */
  useEffect(() => {
    if (!historyEnabled) return;

    let cancelled = false;

    const boot = async () => {
      archivedRef.current = new Set(readArchivedThreadIds());
      historyBusyRef.current = true;
      setHistoryLoading(true);

      try {
        const response = await fetch('/api/simon/threads', {
          cache: 'no-store',
        });
        if (cancelled) return;

        const data = response.ok ? await readJson(response) : null;
        const rows =
          isRecord(data) && Array.isArray(data.threads) ? data.threads : [];
        const stored = rows.flatMap((row) => {
          const thread = readStoredThread(row);
          return thread ? [thread] : [];
        });

        const items = stored
          .filter((thread) => !archivedRef.current.has(thread.id))
          .map(toThreadItem);
        writeThreads(() => items);

        const storedActive = readActiveThreadId();
        const restore =
          storedActive && items.some((thread) => thread.id === storedActive)
            ? storedActive
            : null;

        if (restore) {
          await loadThread(restore);
        } else {
          startNewThread();
        }
      } finally {
        if (!cancelled) {
          historyBusyRef.current = false;
          setHistoryLoading(false);
        }
      }
    };

    void boot();

    return () => {
      cancelled = true;
    };
  }, [historyEnabled, loadThread, startNewThread, writeThreads]);

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
    // An empty (new-chat) thread has no assistant row to source them from;
    // the shell's welcome view still offers Simon's opening questions.
    if (active.entries.length === 0) {
      const [welcome] = welcomeEntries(contextRef.current);
      return (welcome?.suggestedFollowUps ?? []).map((prompt) => ({ prompt }));
    }
    for (let i = active.entries.length - 1; i >= 0; i--) {
      const entry = active.entries[i];
      if (entry?.role !== 'assistant') continue;
      const followUps = entry.suggestedFollowUps;
      if (followUps?.length) {
        return followUps.map((prompt) => ({ prompt }));
      }
      return [];
    }
    return [];
  }, [active.entries, isRunning]);

  const threadList = useMemo(
    () => ({
      threadId: historyEnabled ? active.id : undefined,
      isLoading: historyEnabled ? historyLoading : false,
      threads: historyEnabled ? threads : EMPTY_THREADS,
      onSwitchToNewThread: () => {
        startNewThread();
      },
      onSwitchToThread: async (threadId: string) => {
        await loadThread(threadId);
      },
      onRename: async (threadId: string, title: string) => {
        await renameThread(threadId, title);
      },
      onDelete: async (threadId: string) => {
        await deleteThread(threadId);
      },
      onArchive: (threadId: string) => {
        archiveThread(threadId);
      },
    }),
    [
      active.id,
      archiveThread,
      deleteThread,
      historyEnabled,
      historyLoading,
      loadThread,
      renameThread,
      startNewThread,
      threads,
    ],
  );

  const runtime = useExternalStoreRuntime<SimonChatEntry>({
    messages: active.entries,
    convertMessage,
    isRunning,
    isSendDisabled: historyEnabled && historyLoading,
    suggestions,
    onNew: async (message: AppendMessage) => {
      const text = appendMessageText(message);
      if (!text || runningRef.current) return;
      await runTurn(text);
    },
    /**
     * The shell's edit pencil re-asks an edited question. Truncate the old
     * question and everything after it, then send the edited text as a new
     * turn. `replaceFrom` makes the server truncate the stored rows too.
     */
    onEdit: async (message: AppendMessage) => {
      const text = appendMessageText(message);
      if (!text || runningRef.current) return;
      const sourceId = message.sourceId;
      if (sourceId) {
        const index = activeRef.current.entries.findIndex(
          (entry) => entry.id === sourceId,
        );
        if (index >= 0) {
          commitEntries((previous) => previous.slice(0, index));
        }
      }
      await runTurn(text, {
        replaceFrom: sourceId ?? null,
        userEntryId: crypto.randomUUID(),
      });
    },
    /**
     * Regenerate the last answer. Keep the user row and its client id so the
     * idempotent save replaces the assistant row instead of appending a
     * duplicate question.
     */
    onReload: async () => {
      if (runningRef.current) return;
      const entries = activeRef.current.entries;
      let lastUser: SimonChatEntry | undefined;
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (entry?.role === 'user') {
          lastUser = entry;
          break;
        }
      }
      if (!lastUser) return;

      const index = entries.findIndex((entry) => entry.id === lastUser?.id);
      if (index >= 0) {
        commitEntries((previous) => previous.slice(0, index + 1));
      }

      await runTurn(lastUser.text, {
        appendUser: false,
        replaceFrom: lastUser.id,
        userEntryId: lastUser.id,
      });
    },
    onCancel: async () => {
      abortRef.current?.abort();
    },
    adapters: { threadList },
  });

  return {
    runtime,
    entries: active.entries,
    notice,
    dismissNotice,
    send,
    /** "New chat" — a fresh ephemeral thread, or a fresh persisted thread. */
    reset: startNewThread,
    historyLoading: historyEnabled ? historyLoading : false,
    activeThreadId: historyEnabled ? active.id : null,
  };
}
