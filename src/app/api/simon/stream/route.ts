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
 * 4. One place to persist. The relay sees the complete answer text, so the
 *    stored turn is written from here rather than from a second request the
 *    browser could lose.
 *
 * The 429 body carries `retryAfterSeconds`, so a caller that reads it can show
 * a countdown instead of resending into a closed window.
 */

import { NextRequest, after } from 'next/server';
import { checkRateLimit, clientIpFrom } from '@/lib/rate-limit';
import {
  applyHeuristicMemories,
  buildSimonPreamble,
  getSimonThread,
  saveSimonTurn,
  simonFirstTurnTitle,
} from '@/lib/simon/persistence';
import {
  resolveSimonIdentity,
  type SimonIdentity,
} from '@/lib/simon/identity';
import {
  simonAssistantMetadata,
  simonRequestMessage,
} from '@/lib/simon/chat-types';

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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clientId(value: unknown): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Collect the assistant's text out of Simon's SSE frames while they are being
 * relayed.
 *
 * Only `messages` / `content-block-delta` / `text-delta` frames contribute.
 * That is the same rule the browser applies, so the stored answer and the
 * rendered answer cannot disagree about what was said.
 */
function createAnswerCapture() {
  let accumulated = '';
  let buffer = '';
  let settled = false;
  const decoder = new TextDecoder();

  let resolveDone: (text: string) => void = () => {};
  const done = new Promise<string>((resolve) => {
    resolveDone = resolve;
  });

  const finish = () => {
    if (settled) return;
    settled = true;
    resolveDone(accumulated.trim());
  };

  const consumeLine = (line: string) => {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload) return;

    try {
      const envelope = JSON.parse(payload) as {
        method?: string;
        params?: { data?: unknown } | null;
      };
      if (envelope.method !== 'messages') return;

      const data = isRecord(envelope.params?.data)
        ? envelope.params.data
        : {};
      if (data.event !== 'content-block-delta') return;

      const delta = isRecord(data.delta) ? data.delta : null;
      if (
        delta?.type === 'text-delta' &&
        typeof delta.text === 'string' &&
        delta.text.length > 0
      ) {
        accumulated += delta.text;
      }
    } catch {
      // A malformed frame is the browser's problem too; skipping it here keeps
      // the stored text aligned with what was actually rendered.
    }
  };

  return {
    done,
    finish,
    push(chunk: Uint8Array) {
      buffer += decoder.decode(chunk, { stream: true });
      let cut = buffer.indexOf('\n');
      while (cut !== -1) {
        consumeLine(buffer.slice(0, cut).trim());
        buffer = buffer.slice(cut + 1);
        cut = buffer.indexOf('\n');
      }
    },
  };
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
    /** Persistence contract; omitted by the ephemeral docked concierge. */
    persist?: boolean;
    clientMessageId?: string;
    assistantMessageId?: string;
    replaceFrom?: string | null;
    resumed?: boolean;
  };

  const message = (body.message ?? '').trim();
  if (!message) {
    return Response.json({ error: 'Message cannot be empty.' }, { status: 400 });
  }

  // The marketplace's conversationId IS the protocol's threadId: one id, one
  // checkpoint history, so the full-page chat and the floating chat share a
  // conversation instead of forgetting each other.
  const threadId = body.conversationId ?? crypto.randomUUID();

  const persist = body.persist === true;
  const clientMessageId = clientId(body.clientMessageId) ?? crypto.randomUUID();
  const assistantMessageId =
    clientId(body.assistantMessageId) ?? crypto.randomUUID();
  const replaceFrom = clientId(body.replaceFrom);
  const resumed = body.resumed === true;

  // Identity must resolve before the response starts: cookies cannot be set
  // after SSE headers flush, and the memory preamble has to be inside the
  // message Simon receives.
  let identity: SimonIdentity | null = null;
  let upstreamMessage = message;

  if (persist) {
    identity = await resolveSimonIdentity(req);

    const detail = resumed
      ? await getSimonThread(identity, threadId).catch(() => null)
      : null;

    const preamble = await buildSimonPreamble(identity, detail).catch(() => '');
    upstreamMessage = simonRequestMessage({ message, preamble });
  }

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
        input: { messages: [{ role: 'user', content: upstreamMessage }] },
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

  const capture = createAnswerCapture();
  const reader = upstream.body.getReader();

  // A client cancellation does not always reject the reader; it can arrive as
  // an abort on the request. Resolving the capture from either path means the
  // partial answer is still stored, which is what the UI shows.
  req.signal.addEventListener('abort', capture.finish, { once: true });

  const relay = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          capture.finish();
          controller.close();
          return;
        }
        capture.push(value);
        controller.enqueue(value);
      } catch (error) {
        capture.finish();
        controller.error(error);
      }
    },
    cancel(reason) {
      capture.finish();
      void reader.cancel(reason).catch(() => {});
    },
  });

  if (persist && identity) {
    after(async () => {
      // The response is finished by now, so this normally resolves at once.
      // The race is a guard against a platform that ends the response before
      // the upstream reader has observed completion.
      const assistantText = await Promise.race([
        capture.done,
        new Promise<string>((resolve) => setTimeout(() => resolve(''), 5_000)),
      ]);

      if (!assistantText) return;

      try {
        const saved = await saveSimonTurn(identity, {
          threadId,
          userContent: message,
          userClientId: clientMessageId,
          assistantContent: assistantText,
          assistantClientId: assistantMessageId,
          pageContext: isRecord(body.pageContext) ? body.pageContext : undefined,
          assistantMetadata: simonAssistantMetadata({
            id: assistantMessageId,
            role: 'assistant',
            text: assistantText,
            source: 'simon-agent',
          }),
          title: simonFirstTurnTitle(message),
          replaceFromClientId: replaceFrom,
        });

        if (saved) {
          await applyHeuristicMemories(identity, message, threadId).catch(
            () => {},
          );
        }
      } catch (error) {
        console.warn('[simon] stream persistence failed:', error);
      }
    });
  }

  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Both hosts sit behind proxies that buffer SSE unless told not to.
    'X-Accel-Buffering': 'no',
  };
  if (identity?.setCookie) headers['Set-Cookie'] = identity.setCookie;

  // Relay Simon's frames untouched: parsing and re-emitting them here would let
  // a protocol change break the UI without failing anything.
  return new Response(relay, { status: 200, headers });
}
