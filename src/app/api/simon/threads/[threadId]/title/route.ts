/**
 * Post-turn metadata pass: replace the snippet title with a model-written one,
 * and roll the thread summary forward.
 *
 * The client calls this after a completed turn, fire-and-forget. It is
 * intentionally cheap to call repeatedly:
 *
 * - A thread whose title source is already `llm` or `user` returns immediately
 *   without touching the model. `simon_thread_set_title` enforces the same
 *   precedence, so a race cannot overwrite a buyer's rename.
 * - A thread with no assistant answer yet has nothing to summarize.
 * - A missing `/api/aux` (older Simon deploy), slow provider, or malformed JSON
 *   all leave the snippet title and heuristic memory in place.
 */

import { NextRequest } from 'next/server';
import {
  applySimonIdentityCookie,
  resolveSimonIdentity,
} from '@/lib/simon/identity';
import {
  applyInferredFacts,
  getSimonThread,
  setSimonThreadSummary,
  setSimonThreadTitle,
} from '@/lib/simon/persistence';
import { generateSimonThreadMeta } from '@/lib/simon/llm';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_SUMMARY_FACTS = 24;

type RouteContext = { params: Promise<{ threadId: string }> };

/**
 * `simon_thread_set_summary` overwrites `summary_facts` wholesale, so the
 * previous list has to be folded in here rather than at the database. Dedupe
 * is on the rendered `key: value` line: two passes that observe the same fact
 * must not grow the list.
 */
function mergeFacts(
  previous: readonly string[],
  incoming: readonly { key: string; value: string }[],
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const fact of [
    ...previous,
    ...incoming.map(({ key, value }) => `${key}: ${value}`),
  ]) {
    const clean = fact.replace(/\s+/g, ' ').trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    merged.push(clean);
    if (merged.length >= MAX_SUMMARY_FACTS) break;
  }

  return merged;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { threadId } = await params;

  if (!UUID_PATTERN.test(threadId)) {
    return Response.json({ error: 'Invalid thread id.' }, { status: 400 });
  }

  const headers = new Headers({ 'Cache-Control': 'no-store' });

  try {
    const identity = await resolveSimonIdentity(req);
    applySimonIdentityCookie(headers, identity);

    const detail = await getSimonThread(identity, threadId);
    if (!detail) {
      return Response.json(
        { updated: false, reason: 'not_found' },
        { status: 404, headers },
      );
    }

    if (detail.thread.titleSource !== 'snippet') {
      return Response.json(
        { updated: false, reason: 'title_locked', title: detail.thread.title },
        { headers },
      );
    }

    const messages = detail.messages.filter(
      (message) => message.role === 'user' || message.role === 'assistant',
    );
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === 'assistant');

    if (!lastUser || !lastAssistant || !lastAssistant.content.trim()) {
      return Response.json(
        { updated: false, reason: 'incomplete_turn' },
        { headers },
      );
    }

    const meta = await generateSimonThreadMeta({
      userMessage: lastUser.content,
      assistantMessage: lastAssistant.content,
      previousSummary: detail.thread.summary,
    });

    if (!meta) {
      return Response.json(
        { updated: false, reason: 'model_unavailable', title: detail.thread.title },
        { headers },
      );
    }

    const titled = await setSimonThreadTitle(
      identity,
      threadId,
      meta.title,
      'llm',
    );

    if (meta.summary) {
      const facts = mergeFacts(detail.thread.summaryFacts, meta.facts);
      await setSimonThreadSummary(
        identity,
        threadId,
        meta.summary,
        facts,
      ).catch((error) => {
        console.warn('[simon] summary write failed:', error);
      });
    }

    if (meta.facts.length > 0) {
      await applyInferredFacts(identity, meta.facts, threadId).catch((error) => {
        console.warn('[simon] inferred fact write failed:', error);
      });
    }

    return Response.json(
      {
        updated: titled,
        title: meta.title,
        summarized: meta.summary.length > 0,
      },
      { headers },
    );
  } catch (error) {
    console.error('[simon] thread title pass failed:', error);
    return Response.json(
      { updated: false, reason: 'error' },
      { status: 503, headers },
    );
  }
}
