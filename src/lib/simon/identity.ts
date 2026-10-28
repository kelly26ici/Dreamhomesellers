/**
 * Who a Simon request belongs to.
 *
 * Two identities exist, and they are not interchangeable:
 *
 * - A signed device cookie identifies an anonymous browser so its threads and
 *   preferences survive a reload. It is a convenience identity, never an
 *   authorization boundary: every read and write still runs through a
 *   SECURITY DEFINER RPC scoped to that id.
 * - A Supabase session identifies the signed-in buyer. When one is present it
 *   wins, and the anonymous rows are claimed for the account exactly once.
 *
 * Cookie signing matters because the device id is the only thing separating
 * one anonymous browser's thread from another's. An unsigned id in a cookie
 * would let anyone read anyone else's history by guessing a UUID.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { createAuthServerClient } from '@/lib/auth/supabase-server';

export const SIMON_DEVICE_COOKIE = 'luxonn-simon-device';

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The signing key. Ordered by specificity: a purpose-built secret first, then
 * the server-only Supabase secrets the deployment already has. There is no
 * constant fallback — a hard-coded key would make every forged cookie valid.
 */
function deviceSecret(): string {
  const secret =
    process.env.SIMON_DEVICE_SECRET?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!secret) {
    throw new Error(
      'No Simon device-cookie signing secret. Set SIMON_DEVICE_SECRET ' +
        '(preferred) or SUPABASE_SECRET_KEY.',
    );
  }
  return secret;
}

function signatureFor(deviceId: string): Buffer {
  return createHmac('sha256', deviceSecret()).update(deviceId).digest();
}

/** The value stored in the cookie: `<uuid>.<base64url hmac>`. */
export function signSimonDeviceId(deviceId: string): string {
  return `${deviceId}.${signatureFor(deviceId).toString('base64url')}`;
}

/** Verify and return the device id, or `null` for anything malformed. */
export function verifySimonDeviceCookie(
  raw: string | undefined | null,
): string | null {
  if (!raw) return null;

  const separator = raw.lastIndexOf('.');
  if (separator <= 0) return null;

  const deviceId = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  if (!UUID_PATTERN.test(deviceId) || signature.length === 0) return null;

  let provided: Buffer;
  try {
    provided = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }

  const expected = signatureFor(deviceId);
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  return deviceId.toLowerCase();
}

export function simonDeviceCookieHeader(deviceId: string): string {
  const parts = [
    `${SIMON_DEVICE_COOKIE}=${signSimonDeviceId(deviceId)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  ];
  // Secure cookies are dropped on plain-HTTP localhost, so it is production
  // only rather than unconditional.
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

export interface SimonIdentity {
  /** Always present: a stable per-browser id, existing or freshly minted. */
  readonly deviceId: string;
  /** Present only for a signed-in buyer. */
  readonly userId: string | null;
  /** Set-Cookie value to apply to the response when the id is new. */
  readonly setCookie: string | null;
  readonly isNewDevice: boolean;
}

/**
 * Resolve the request identity before any streaming starts.
 *
 * Cookies cannot be set once the response headers have flushed, so callers
 * must capture `setCookie` here and attach it to the outgoing response — a
 * streaming `Response` cannot rely on Next's mutable cookie store.
 */
export async function resolveSimonIdentity(
  req?: NextRequest,
): Promise<SimonIdentity> {
  const existing = verifySimonDeviceCookie(
    req?.cookies.get(SIMON_DEVICE_COOKIE)?.value,
  );

  const deviceId = existing ?? randomUUID();

  let userId: string | null = null;
  try {
    const supabase = await createAuthServerClient();
    const { data } = await supabase.auth.getUser();
    userId = data.user?.id ?? null;
  } catch {
    // A missing or unreachable auth backend must not break anonymous chat;
    // it only means this request is treated as anonymous.
    userId = null;
  }

  return {
    deviceId,
    userId,
    setCookie: existing ? null : simonDeviceCookieHeader(deviceId),
    isNewDevice: existing === null,
  };
}

/** Attach the minted device cookie to any outgoing response. */
export function applySimonIdentityCookie(
  headers: Headers,
  identity: SimonIdentity,
): void {
  if (identity.setCookie) {
    headers.append('Set-Cookie', identity.setCookie);
  }
}

/** The device id an already-verified request carries, if any. */
export function simonDeviceIdFromRequest(req: NextRequest): string | null {
  return verifySimonDeviceCookie(req.cookies.get(SIMON_DEVICE_COOKIE)?.value);
}
