/**
 * Server-side persistence for Simon threads and long-term memory.
 *
 * Every call goes through a SECURITY DEFINER RPC on the cookie-aware anon /
 * authenticated client, never the service role. That keeps `auth.uid()` real
 * and lets the database enforce ownership; the service role is reserved for
 * the retention purge, which has no user context by definition.
 *
 * These helpers throw on transport failure so callers can decide. A chat turn
 * treats persistence as best-effort (it must not fail the answer), while the
 * history rail surfaces the failure honestly.
 */

import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { createAuthServerClient } from '@/lib/auth/supabase-server';
import { getSupabaseUrl } from '@/lib/auth/supabase-key';
import {
  extractSimonMemories,
  simonMemoryPreamble,
  simonSnippetTitle,
  type StoredSimonMemory,
  type StoredSimonMessage,
  type StoredSimonThread,
  type StoredSimonThreadDetail,
} from './chat-types';
import type { SimonIdentity } from './identity';

export interface SimonTurnInput {
  readonly threadId: string;
  readonly userContent: string;
  readonly userClientId: string;
  readonly assistantContent: string;
  readonly assistantClientId: string;
  readonly pageContext?: Record<string, unknown>;
  readonly messageMetadata?: Record<string, unknown>;
  readonly assistantMetadata?: Record<string, unknown>;
  readonly suggestedFollowUps?: readonly string[];
  /** Snippet written with the first turn; null on later turns. */
  readonly title?: string | null;
  /** Truncate this persisted client id and everything after it. */
  readonly replaceFromClientId?: string | null;
}

export interface SimonSavedTurn {
  readonly threadId: string;
  readonly userMessageId: string | null;
  readonly assistantMessageId: string | null;
  readonly title: string | null;
  readonly titleSource: 'snippet' | 'llm' | 'user' | null;
}

interface RpcEnvelope {
  ok?: boolean;
  reason_code?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rpcFailure(scope: string, message: string): Error {
  return new Error(`simon ${scope}: ${message}`);
}

function parseThreads(value: unknown): StoredSimonThread[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== 'string') return [];
    return [
      {
        id: row.id,
        title:
          typeof row.title === 'string' && row.title.trim()
            ? row.title
            : 'New conversation',
        titleSource:
          row.title_source === 'llm' || row.title_source === 'user'
            ? row.title_source
            : 'snippet',
        lastMessageAt:
          typeof row.last_message_at === 'string' ? row.last_message_at : null,
        createdAt: typeof row.created_at === 'string' ? row.created_at : null,
      },
    ];
  });
}

function parseMessages(value: unknown): StoredSimonMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== 'string') return [];
    if (row.role !== 'user' && row.role !== 'assistant' && row.role !== 'system') {
      return [];
    }
    return [
      {
        id: row.id,
        role: row.role,
        content: typeof row.content === 'string' ? row.content : '',
        metadata: isRecord(row.metadata) ? row.metadata : null,
        client_message_id:
          typeof row.client_message_id === 'string'
            ? row.client_message_id
            : null,
        referenced_listing_ids: Array.isArray(row.referenced_listing_ids)
          ? (row.referenced_listing_ids.filter(
              (id): id is string => typeof id === 'string',
            ) as string[])
          : null,
        suggested_follow_ups: Array.isArray(row.suggested_follow_ups)
          ? (row.suggested_follow_ups.filter(
              (item): item is string => typeof item === 'string',
            ) as string[])
          : null,
        created_at:
          typeof row.created_at === 'string' ? row.created_at : null,
      },
    ];
  });
}

export async function listSimonThreads(
  identity: SimonIdentity,
): Promise<StoredSimonThread[]> {
  const supabase = await createAuthServerClient();
  const { data, error } = await supabase.rpc('simon_thread_list', {
    p_device_id: identity.deviceId,
    p_limit: 80,
  });

  if (error) throw rpcFailure('thread_list', error.message);
  const payload = data as (RpcEnvelope & { threads?: unknown }) | null;
  if (!payload || payload.ok !== true) return [];
  return parseThreads(payload.threads);
}

export async function getSimonThread(
  identity: SimonIdentity,
  threadId: string,
): Promise<StoredSimonThreadDetail | null> {
  const supabase = await createAuthServerClient();
  const { data, error } = await supabase.rpc('simon_thread_get', {
    p_thread_id: threadId,
    p_device_id: identity.deviceId,
  });

  if (error) throw rpcFailure('thread_get', error.message);
  const payload = data as
    | (RpcEnvelope & { thread?: unknown; messages?: unknown })
    | null;
  if (!payload || payload.ok !== true || !isRecord(payload.thread)) return null;

  const thread = payload.thread;
  if (typeof thread.id !== 'string') return null;

  return {
    thread: {
      id: thread.id,
      title:
        typeof thread.title === 'string' && thread.title.trim()
          ? thread.title
          : 'New conversation',
      titleSource:
        thread.title_source === 'llm' || thread.title_source === 'user'
          ? thread.title_source
          : 'snippet',
      lastMessageAt:
        typeof thread.last_message_at === 'string'
          ? thread.last_message_at
          : null,
      createdAt:
        typeof thread.created_at === 'string' ? thread.created_at : null,
      summary: typeof thread.summary === 'string' ? thread.summary : null,
      summaryFacts: Array.isArray(thread.summary_facts)
        ? (thread.summary_facts.filter(
            (fact): fact is string => typeof fact === 'string',
          ) as string[])
        : [],
      expiresAt:
        typeof thread.expires_at === 'string' ? thread.expires_at : null,
    },
    messages: parseMessages(payload.messages),
  };
}

export async function saveSimonTurn(
  identity: SimonIdentity,
  input: SimonTurnInput,
): Promise<SimonSavedTurn | null> {
  const supabase = await createAuthServerClient();
  const { data, error } = await supabase.rpc('simon_save_turn', {
    p_thread_id: input.threadId,
    p_device_id: identity.deviceId,
    p_user_content: input.userContent,
    p_user_client_id: input.userClientId,
    p_assistant_content: input.assistantContent,
    p_assistant_client_id: input.assistantClientId,
    p_page_context: input.pageContext ?? {},
    p_message_metadata: input.messageMetadata ?? {},
    p_assistant_metadata: input.assistantMetadata ?? {},
    p_suggested_follow_ups: input.suggestedFollowUps ?? [],
    p_title: input.title ?? null,
    p_replace_from_client_id: input.replaceFromClientId ?? null,
  });

  if (error) throw rpcFailure('save_turn', error.message);
  const payload = data as
    | (RpcEnvelope & {
        thread_id?: unknown;
        user_message_id?: unknown;
        assistant_message_id?: unknown;
        title?: unknown;
        title_source?: unknown;
      })
    | null;

  if (!payload || payload.ok !== true || typeof payload.thread_id !== 'string') {
    return null;
  }

  return {
    threadId: payload.thread_id,
    userMessageId:
      typeof payload.user_message_id === 'string'
        ? payload.user_message_id
        : null,
    assistantMessageId:
      typeof payload.assistant_message_id === 'string'
        ? payload.assistant_message_id
        : null,
    title: typeof payload.title === 'string' ? payload.title : null,
    titleSource:
      payload.title_source === 'llm' ||
      payload.title_source === 'user' ||
      payload.title_source === 'snippet'
        ? payload.title_source
        : null,
  };
}

export async function renameSimonThread(
  identity: SimonIdentity,
  threadId: string,
  title: string,
): Promise<string | null> {
  const supabase = await createAuthServerClient();
  const { data, error } = await supabase.rpc('simon_thread_rename', {
    p_thread_id: threadId,
    p_device_id: identity.deviceId,
    p_title: title,
  });
  if (error) throw rpcFailure('thread_rename', error.message);
  const payload = data as (RpcEnvelope & { title?: unknown }) | null;
  return payload?.ok === true && typeof payload.title === 'string'
    ? payload.title
    : null;
}

/**
 * The server-side title pass. `simon_thread_set_title` already enforces
 * precedence: a user rename wins, and a second LLM title is ignored, so a
 * retried request cannot overwrite better metadata.
 */
export async function setSimonThreadTitle(
  identity: SimonIdentity,
  threadId: string,
  title: string,
  source: 'llm' | 'snippet',
): Promise<boolean> {
  const supabase = await createAuthServerClient();
  const { data, error } = await supabase.rpc('simon_thread_set_title', {
    p_thread_id: threadId,
    p_device_id: identity.deviceId,
    p_title: title,
    p_source: source,
  });
  if (error) throw rpcFailure('thread_set_title', error.message);
  return (data as RpcEnvelope | null)?.ok === true;
}

export async function setSimonThreadSummary(
  identity: SimonIdentity,
  threadId: string,
  summary: string,
  facts: readonly string[],
): Promise<boolean> {
  const supabase = await createAuthServerClient();
  const { data, error } = await supabase.rpc('simon_thread_set_summary', {
    p_thread_id: threadId,
    p_device_id: identity.deviceId,
    p_summary: summary,
    p_facts: facts,
  });
  if (error) throw rpcFailure('thread_set_summary', error.message);
  return (data as RpcEnvelope | null)?.ok === true;
}

export async function deleteSimonThread(
  identity: SimonIdentity,
  threadId: string,
): Promise<boolean> {
  const supabase = await createAuthServerClient();
  const { data, error } = await supabase.rpc('simon_thread_delete', {
    p_thread_id: threadId,
    p_device_id: identity.deviceId,
  });
  if (error) throw rpcFailure('thread_delete', error.message);
  return (data as RpcEnvelope | null)?.ok === true;
}

/**
 * Move anonymous threads and memories onto the signed-in account.
 *
 * The same claim runs lazily inside the thread and memory RPCs, so this is an
 * optimisation rather than a requirement: calling it from the auth callback
 * means the rail is already correct on the first render after sign-in.
 */
export async function claimSimonDeviceData(deviceId: string): Promise<{
  threads: number;
  memories: number;
}> {
  const supabase = await createAuthServerClient();
  const { data, error } = await supabase.rpc('simon_claim_device_data', {
    p_device_id: deviceId,
  });
  if (error) throw rpcFailure('claim_device_data', error.message);

  const payload = data as
    | { ok?: boolean; claimed_threads?: unknown; claimed_memories?: unknown }
    | null;
  return {
    threads:
      typeof payload?.claimed_threads === 'number' ? payload.claimed_threads : 0,
    memories:
      typeof payload?.claimed_memories === 'number'
        ? payload.claimed_memories
        : 0,
  };
}

function parseMemories(value: unknown): StoredSimonMemory[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== 'string') return [];
    if (row.kind !== 'preference' && row.kind !== 'fact') return [];
    if (typeof row.key !== 'string' || typeof row.value !== 'string') return [];
    return [
      {
        id: row.id,
        kind: row.kind,
        key: row.key,
        value: row.value,
        sourceThreadId:
          typeof row.source_thread_id === 'string'
            ? row.source_thread_id
            : null,
        updatedAt:
          typeof row.updated_at === 'string' ? row.updated_at : null,
        expiresAt: typeof row.expires_at === 'string' ? row.expires_at : null,
      },
    ];
  });
}

export async function listSimonMemories(
  identity: SimonIdentity,
): Promise<StoredSimonMemory[]> {
  const supabase = await createAuthServerClient();
  const { data, error } = await supabase.rpc('simon_memory_list', {
    p_device_id: identity.deviceId,
  });
  if (error) throw rpcFailure('memory_list', error.message);
  const payload = data as (RpcEnvelope & { memories?: unknown }) | null;
  if (!payload || payload.ok !== true) return [];
  return parseMemories(payload.memories);
}

export async function upsertSimonMemory(
  identity: SimonIdentity,
  input: {
    readonly kind: 'preference' | 'fact';
    readonly key: string;
    readonly value: string;
    readonly sourceThreadId?: string | null;
  },
): Promise<boolean> {
  const supabase = await createAuthServerClient();
  const { data, error } = await supabase.rpc('simon_memory_upsert', {
    p_device_id: identity.deviceId,
    p_kind: input.kind,
    p_key: input.key,
    p_value: input.value,
    p_source_thread_id: input.sourceThreadId ?? null,
  });
  if (error) throw rpcFailure('memory_upsert', error.message);
  return (data as RpcEnvelope | null)?.ok === true;
}

export async function deleteSimonMemory(
  identity: SimonIdentity,
  memoryId: string,
): Promise<boolean> {
  const supabase = await createAuthServerClient();
  const { data, error } = await supabase.rpc('simon_memory_delete', {
    p_memory_id: memoryId,
    p_device_id: identity.deviceId,
  });
  if (error) throw rpcFailure('memory_delete', error.message);
  return (data as RpcEnvelope | null)?.ok === true;
}

/**
 * Fold one user message's durable signals into memory.
 *
 * Runs after the turn is saved, independent of the model, and never fails the
 * answer. A failed write only means the next turn has less context.
 */
export async function applyHeuristicMemories(
  identity: SimonIdentity,
  text: string,
  sourceThreadId: string,
): Promise<void> {
  const candidates = extractSimonMemories(text);
  if (candidates.length === 0) return;

  await Promise.allSettled(
    candidates.map((candidate) =>
      upsertSimonMemory(identity, { ...candidate, sourceThreadId }),
    ),
  );
}

/**
 * Persist model-derived facts without overriding anything the buyer stated as
 * a preference (same key, different kind). Facts are the weakest signal in the
 * system and must lose to both heuristics and the memory editor.
 */
export async function applyInferredFacts(
  identity: SimonIdentity,
  facts: readonly { key: string; value: string }[],
  sourceThreadId: string,
): Promise<void> {
  if (facts.length === 0) return;

  const existing = await listSimonMemories(identity).catch(() => []);
  const preferenceKeys = new Set(
    existing.filter((memory) => memory.kind === 'preference').map((m) => m.key),
  );

  await Promise.allSettled(
    facts
      .filter(
        (fact) =>
          fact.key.trim().length > 0 &&
          fact.value.trim().length > 0 &&
          !preferenceKeys.has(fact.key),
      )
      .slice(0, 12)
      .map((fact) =>
        upsertSimonMemory(identity, {
          kind: 'fact',
          key: fact.key.slice(0, 80),
          value: fact.value.slice(0, 500),
          sourceThreadId,
        }),
      ),
  );
}

/**
 * Everything the model should remember on this turn, rendered as the
 * invisible preamble. Memory reads are best-effort: losing them degrades the
 * answer, it does not break the turn.
 */
export async function buildSimonPreamble(
  identity: SimonIdentity,
  detail: StoredSimonThreadDetail | null,
): Promise<string> {
  const memories = await listSimonMemories(identity).catch(() => []);
  return simonMemoryPreamble({
    memories: memories.map(({ kind, key, value }) => ({ kind, key, value })),
    summary: detail?.thread.summary ?? null,
    summaryFacts: detail?.thread.summaryFacts ?? [],
  });
}

/** The first-turn snippet, written in the same RPC as the messages. */
export function simonFirstTurnTitle(userContent: string): string {
  return simonSnippetTitle(userContent);
}

/**
 * Hard-delete every expired thread and memory row.
 *
 * The hourly pg_cron job does the same thing inside Postgres; this exists as
 * the supported fallback when the extension is unavailable. It needs the
 * service role because `simon_purge_expired` has no user to authorize.
 */
export async function purgeExpiredSimonData(): Promise<{
  threads: number;
  memories: number;
}> {
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim();

  if (!key) {
    throw new Error('No service role key configured for Simon retention.');
  }

  const supabase = createClient(getSupabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc('simon_purge_expired');
  if (error) throw rpcFailure('purge_expired', error.message);

  const payload = data as
    | { ok?: boolean; threads?: unknown; memories?: unknown }
    | null;
  return {
    threads: typeof payload?.threads === 'number' ? payload.threads : 0,
    memories: typeof payload?.memories === 'number' ? payload.memories : 0,
  };
}
