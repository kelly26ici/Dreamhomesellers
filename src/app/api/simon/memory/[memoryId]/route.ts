/**
 * Forget one remembered Simon preference or fact.
 *
 * Deletion is scoped by the RPC to the caller's identity: an id belonging to
 * another browser or account returns `ok: false`, which this route reports as
 * 404 rather than 403 so it does not confirm that the row exists.
 */

import { NextRequest } from 'next/server';
import {
  applySimonIdentityCookie,
  resolveSimonIdentity,
} from '@/lib/simon/identity';
import { deleteSimonMemory } from '@/lib/simon/persistence';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = { params: Promise<{ memoryId: string }> };

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const { memoryId } = await params;

  if (!UUID_PATTERN.test(memoryId)) {
    return Response.json({ error: 'Invalid memory id.' }, { status: 400 });
  }

  try {
    const identity = await resolveSimonIdentity(req);
    const deleted = await deleteSimonMemory(identity, memoryId);

    const headers = new Headers({ 'Cache-Control': 'no-store' });
    applySimonIdentityCookie(headers, identity);

    if (!deleted) {
      return Response.json(
        { error: 'That memory is already gone.' },
        { status: 404, headers },
      );
    }

    return Response.json({ ok: true }, { headers });
  } catch (error) {
    console.error('[simon] memory delete failed:', error);
    return Response.json(
      { error: 'That memory could not be removed.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
