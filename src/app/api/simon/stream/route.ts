/**
 * Streaming proxy to Simon's Agent Streaming Protocol.
 *
 * POST /api/simon/stream  ->  Simon POST /threads/{id}/stream
 *
 * Why this exists rather than the browser calling Simon directly:
 *
 * 1. Same-origin. No CORS preflight, and SIMON_API_URL never reaches the
 *    client — the marketplace's environment is not public surface.
 * 2. One rate limit, applied once. The browser hitting Simon directly would
 *    bypass the chat budget entirely.
 * 3. One place to translate. Simon already speaks the protocol; this relays its
 *    SSE frames verbatim so the client can use a standard protocol parser
 *    instead of a bespoke one.
 *
 * The 429 body carries `retryAfterSeconds`, so a caller that reads it can show
 * a countdown instead of resending into a closed window.
 */

import { NextRequest } from 'next/server';
import { checkRateLimit, clientIpFrom } from '@/lib/rate-limit';

// No `export const runtime` here: Next 16 with cacheComponents rejects route
// segment configs, and this relay does not need one.

function rateLimited(rl: ReturnType<typeof checkRateLimit>) {
  const scope = rl.reason === 'daily' ? 'for today' : 'for the next few minutes';
  const secs = rl.retryAfterSeconds;
  return Response.json(
    {
      error:
        `You’ve reached the concierge’s request limit ${scope}. ` +
        `Please try again in ${secs} second${secs === 1 ? '' : 's'}.`,
      source: 'rate-limited',
      retryAfterSeconds: secs,
      reason: rl.reason,
      remaining: 0,
      limit: rl.limit,
    },
    { status: 429, headers: { 'Retry-After': String(secs) } },
  );
}

export async function POST(req: NextRequest) {
  const rl = checkRateLimit('chat', clientIpFrom(req));
  if (!rl.allowed) {
    return rateLimited(rl);
  }

  const simonApiUrl = process.env.SIMON_API_URL;
  if (!simonApiUrl) {
    return Response.json(
      { error: 'The concierge service is not configured.', source: 'misconfigured' },
      { status: 503 },
    );
  }

  const body = (await req.json()) as {
    message?: string;
    conversationId?: string;
    pageContext?: unknown;
    /** Resume a dropped stream from this seq rather than re-running the turn. */
    lastEventId?: number;
  };

  const message = (body.message ?? '').trim();
  if (!message) {
    return Response.json({ error: 'Message cannot be empty.' }, { status: 400 });
  }

  // The marketplace's conversationId IS the protocol's threadId: one id, one
  // checkpoint history, so the full-page chat and the floating chat share a
  // conversation instead of forgetting each other.
  const threadId = body.conversationId ?? crypto.randomUUID();

  // 1. Start the run. run.start returns as soon as the turn is RUNNING, so the
  //    subscription below can open before the first token is produced. Skipping
  //    this ordering drops the opening events, which reads as an empty reply.
  const started = await fetch(`${simonApiUrl}/threads/${encodeURIComponent(threadId)}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 1,
      method: 'run.start',
      params: {
        assistantId: 'agent',
        input: { messages: [{ role: 'user', content: message }] },
        metadata: { conversationId: threadId, pageContext: body.pageContext ?? null },
      },
    }),
    // Generous because this request is what wakes Simon when Render has spun it
    // down: measured cold start is ~10s for /api/health alone, and the agent
    // then has to boot on top of that. At 30s the first message of a cold
    // session aborted before the stream could ever open — a failure that looks
    // exactly like "Simon doesn't reply".
    signal: AbortSignal.timeout(90_000),
  });

  if (!started.ok) {
    // A dead or sleeping Simon surfaces here rather than as an empty stream, so
    // the caller can show the degraded notice instead of a blank chat window.
    return Response.json(
      {
        error:
          'Simon is waking up — Render puts the concierge to sleep when idle. ' +
          'Send your message again in a few seconds and it will go through.',
        source: 'upstream-error',
      },
      { status: 502 },
    );
  }

  // 2. Subscribe. Last-Event-ID makes a reconnect resume from the buffer
  //    instead of re-running a billable 15s agent turn.
  const resumeFrom = Number(body.lastEventId) || 0;
  const upstream = await fetch(`${simonApiUrl}/threads/${encodeURIComponent(threadId)}/stream`, {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      ...(resumeFrom > 0 ? { 'Last-Event-ID': String(resumeFrom) } : {}),
    },
    signal: req.signal,
  });

  if (!upstream.ok || !upstream.body) {
    return Response.json(
      { error: 'The concierge stream could not be opened.', source: 'upstream-error' },
      { status: 502 },
    );
  }

  // Relay Simon's frames untouched: parsing and re-emitting them here would let
  // a protocol change break the UI without failing anything.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Both hosts sit behind proxies that buffer SSE unless told not to.
      'X-Accel-Buffering': 'no',
    },
  });
}
