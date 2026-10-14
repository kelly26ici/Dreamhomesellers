/**
 * Media URL resolver for public and authenticated surfaces.
 * Resolves storage paths to CDN URLs.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

export function resolveDerivativeUrl(pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl) return null;
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://') || pathOrUrl.startsWith('data:')) {
    return pathOrUrl;
  }
  const cleanPath = pathOrUrl.startsWith('/') ? pathOrUrl.slice(1) : pathOrUrl;
  return `${SUPABASE_URL}/storage/v1/object/public/listing-derivatives/${cleanPath}`;
}

export function resolveOriginalUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  // Authenticated/signed URL path base
  return `${SUPABASE_URL}/storage/v1/object/authenticated/listing-originals/${cleanPath}`;
}
