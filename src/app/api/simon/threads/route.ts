/**
 * The persisted Simon thread list behind the history rail.
 *
 * Scope is deliberately narrow: the rail only needs titles and recency, so this
 * returns the same shape `simon_thread_list` produces and nothing else. Message
 * bodies are fetched per thread, only when a buyer actually opens one.
 *
 * The device cookie is minted here on first contact. Cookies cannot be set
 * after a streaming response flushes, so every route that touches history
 * resolves identity up front and attaches the signed cookie to its own
 * response.
 */

import { NextRequest } from 'next/server';
import {
  applySimonIdentityCookie,
  resolveSimonIdentity,
} from '@/lib/simon/identity';
import { listSimonThreads } from '@/lib/simon/persistence';

export async function GET(req: NextRequest) {
  try {
    const identity = await resolveSimonIdentity(req);
    const threads = await listSimonThreads(identity);

    const headers = new Headers({ 'Cache-Control': 'no-store' });
    applySimonIdentityCookie(headers, identity);

    return Response.json(
      {
        threads,
        authenticated: identity.userId !== null,
      },
      { headers },
    );
  } catch (error) {
    console.error('[simon] thread list failed:', error);
    return Response.json(
      { error: 'Simon history is unavailable right now.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
