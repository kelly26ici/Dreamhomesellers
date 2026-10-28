/**
 * Simon history retention fallback.
 *
 * The primary purge is an hourly pg_cron job (`simon-retention`) that calls
 * `simon_purge_expired()` inside Postgres. This route exists for deployments
 * where pg_cron is unavailable, and for an operator who wants to force a sweep
 * after a policy change.
 *
 * Authorization is a shared secret, because there is no user to authenticate:
 * `CRON_SECRET` first, then `OUTBOX_CONSUMER_SECRET` so a deployment that
 * already has a scheduler secret does not need a second one. With neither
 * configured the route refuses to run (503) rather than exposing an
 * unauthenticated delete endpoint.
 */

import { NextRequest } from 'next/server';
import { purgeExpiredSimonData } from '@/lib/simon/persistence';

function configuredSecret(): string | null {
  return (
    process.env.CRON_SECRET?.trim() ||
    process.env.OUTBOX_CONSUMER_SECRET?.trim() ||
    null
  );
}

function authorized(req: NextRequest, secret: string): boolean {
  const bearer = req.headers.get('authorization');
  if (bearer === `Bearer ${secret}`) return true;
  if (req.headers.get('x-cron-secret') === secret) return true;
  return false;
}

async function run(req: NextRequest): Promise<Response> {
  const secret = configuredSecret();

  if (!secret) {
    return Response.json(
      {
        error:
          'Retention is not configured. Set CRON_SECRET or OUTBOX_CONSUMER_SECRET.',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (!authorized(req, secret)) {
    return Response.json(
      { error: 'Unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const purged = await purgeExpiredSimonData();
    return Response.json(
      { ok: true, ...purged },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[simon] retention purge failed:', error);
    return Response.json(
      { error: 'Retention purge failed.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
