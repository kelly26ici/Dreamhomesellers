/**
 * One persisted Simon thread: read, rename, delete.
 *
 * Next 16 passes route params as a Promise. All three verbs resolve identity
 * first so an anonymous browser's first visit mints its signed device cookie,
 * and ownership is enforced inside the `simon_thread_*` RPCs rather than here
 * — a route-level check would be a second, weaker source of truth.
 */

import { NextRequest } from 'next/server';
import { resolveSimonIdentity } from '@/lib/simon/identity';
import {
  deleteSimonThread,
  getSimonThread,
  renameSimonThread,
} from '@/lib/simon/persistence';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = { params: Promise<{ threadId: string }> };

function jsonHeaders(setCookie: string | null): Headers {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  if (setCookie) headers.append('Set-Cookie', setCookie);
  return headers;
}

function notFound(setCookie: string | null): Response {
  return Response.json(
    { error: 'That conversation is no longer available.' },
    { status: 404, headers: jsonHeaders(setCookie) },
  );
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { threadId } = await params;

  if (!UUID_PATTERN.test(threadId)) {
    return Response.json({ error: 'Invalid thread id.' }, { status: 400 });
  }

  try {
    const identity = await resolveSimonIdentity(req);
    const detail = await getSimonThread(identity, threadId);

    if (!detail) return notFound(identity.setCookie);

    return Response.json(detail, {
      headers: jsonHeaders(identity.setCookie),
    });
  } catch (error) {
    console.error('[simon] thread read failed:', error);
    return Response.json(
      { error: 'That conversation could not be loaded.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { threadId } = await params;

  if (!UUID_PATTERN.test(threadId)) {
    return Response.json({ error: 'Invalid thread id.' }, { status: 400 });
  }

  let title: string;
  try {
    const body = (await req.json()) as { title?: unknown };
    title = typeof body.title === 'string' ? body.title.trim() : '';
  } catch {
    return Response.json({ error: 'A title is required.' }, { status: 400 });
  }

  if (title.length === 0 || title.length > 120) {
    return Response.json(
      { error: 'Titles must be between 1 and 120 characters.' },
      { status: 400 },
    );
  }

  try {
    const identity = await resolveSimonIdentity(req);
    const saved = await renameSimonThread(identity, threadId, title);

    if (!saved) return notFound(identity.setCookie);

    return Response.json(
      { title: saved },
      { headers: jsonHeaders(identity.setCookie) },
    );
  } catch (error) {
    console.error('[simon] thread rename failed:', error);
    return Response.json(
      { error: 'That conversation could not be renamed.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const { threadId } = await params;

  if (!UUID_PATTERN.test(threadId)) {
    return Response.json({ error: 'Invalid thread id.' }, { status: 400 });
  }

  try {
    const identity = await resolveSimonIdentity(req);
    const deleted = await deleteSimonThread(identity, threadId);

    if (!deleted) return notFound(identity.setCookie);

    return Response.json(
      { ok: true },
      { headers: jsonHeaders(identity.setCookie) },
    );
  } catch (error) {
    console.error('[simon] thread delete failed:', error);
    return Response.json(
      { error: 'That conversation could not be deleted.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
