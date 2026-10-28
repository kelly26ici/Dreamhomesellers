/**
 * Long-term Simon memory: the preferences and facts that survive across
 * threads.
 *
 * Memory is scoped to the caller's identity by the database, not by this
 * route. Values are seller-facing but never expose where they live: the UI
 * calls this "what Simon remembers", not "Postgres rows".
 */

import { NextRequest } from 'next/server';
import {
  applySimonIdentityCookie,
  resolveSimonIdentity,
} from '@/lib/simon/identity';
import {
  listSimonMemories,
  upsertSimonMemory,
} from '@/lib/simon/persistence';

/**
 * Keys are shown in the editor and fed to the model as `key=value`, so they are
 * normalized the same way the model's own facts are: lowercase snake case.
 */
function normalizeKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

export async function GET(req: NextRequest) {
  try {
    const identity = await resolveSimonIdentity(req);
    const memories = await listSimonMemories(identity);

    const headers = new Headers({ 'Cache-Control': 'no-store' });
    applySimonIdentityCookie(headers, identity);

    return Response.json(
      { memories, authenticated: identity.userId !== null },
      { headers },
    );
  } catch (error) {
    console.error('[simon] memory list failed:', error);
    return Response.json(
      { error: 'Simon memory is unavailable right now.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function POST(req: NextRequest) {
  let payload: {
    kind?: unknown;
    key?: unknown;
    value?: unknown;
    sourceThreadId?: unknown;
  };

  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const kind = payload.kind === 'fact' ? 'fact' : 'preference';
  const key = normalizeKey(typeof payload.key === 'string' ? payload.key : '');
  const value =
    typeof payload.value === 'string' ? payload.value.trim().slice(0, 500) : '';
  const sourceThreadId =
    typeof payload.sourceThreadId === 'string' ? payload.sourceThreadId : null;

  if (!key) {
    return Response.json(
      { error: 'Give this memory a short name, for example “budget”.' },
      { status: 400 },
    );
  }

  if (!value) {
    return Response.json(
      { error: 'A memory needs a value.' },
      { status: 400 },
    );
  }

  try {
    const identity = await resolveSimonIdentity(req);
    const ok = await upsertSimonMemory(identity, {
      kind,
      key,
      value,
      sourceThreadId,
    });

    if (!ok) {
      return Response.json(
        { error: 'That memory could not be saved.' },
        { status: 503 },
      );
    }

    const memories = await listSimonMemories(identity);
    const headers = new Headers({ 'Cache-Control': 'no-store' });
    applySimonIdentityCookie(headers, identity);

    return Response.json({ memories }, { headers });
  } catch (error) {
    console.error('[simon] memory write failed:', error);
    return Response.json(
      { error: 'That memory could not be saved.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
