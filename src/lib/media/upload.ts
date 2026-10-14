/**
 * Client-side media upload workflow for LUXONN marketplace.
 * Follows contracts.md §5 and ADR-010:
 * - Uploads into private 'listing-originals' bucket
 * - Path: {organizationId}/{revisionId}/{mediaId}.{ext}
 * - Computes client-side SHA-256 content hash
 * - Validates file size (<= 25MB) and MIME whitelist
 * - Attaches record via attachListingMedia RPC
 */

import { getSupabaseBrowserClient } from '@/lib/auth/supabase-browser';
import { attachListingMedia } from './write-model';
import type { MediaCommandResult } from './types';

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/avif',
  'video/mp4',
  'video/quicktime',
]);

function getExtension(file: File): string {
  const parts = file.name.split('.');
  if (parts.length > 1) {
    const ext = parts.pop()?.toLowerCase();
    if (ext && /^[a-z0-9]+$/.test(ext)) {
      return ext;
    }
  }
  if (file.type === 'image/jpeg') return 'jpg';
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  if (file.type === 'image/avif') return 'avif';
  if (file.type === 'video/mp4') return 'mp4';
  return 'bin';
}

async function computeSha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digestBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(digestBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface UploadListingMediaOptions {
  organizationId: string;
  revisionId: string;
  file: File;
  isFeatured?: boolean;
}

export async function uploadListingMedia(
  options: UploadListingMediaOptions
): Promise<MediaCommandResult<{ mediaId: string; storagePath: string }>> {
  const { organizationId, revisionId, file, isFeatured = false } = options;

  // 1. Validate file size
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      reasonCode: 'file_too_large',
      message: `File size exceeds the 25 MB limit (${(file.size / (1024 * 1024)).toFixed(1)} MB).`,
    };
  }

  // 2. Validate MIME type
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return {
      ok: false,
      reasonCode: 'unsupported_media_type',
      message: `Unsupported file format (${file.type || 'unknown'}). Supported formats: JPEG, PNG, WebP, AVIF, HEIC, MP4.`,
    };
  }

  const kind = file.type.startsWith('video/') ? 'video' : 'image';
  const mediaId = crypto.randomUUID();
  const ext = getExtension(file);
  const storagePath = `${organizationId}/${revisionId}/${mediaId}.${ext}`;

  // 3. Compute SHA-256 hash
  let contentHash: string | undefined;
  try {
    contentHash = await computeSha256(file);
  } catch {
    // Non-fatal if subtle crypto is unavailable in environment
    contentHash = undefined;
  }

  // 4. Upload to private 'listing-originals' bucket
  const client = getSupabaseBrowserClient();
  const { error: uploadError } = await client.storage
    .from('listing-originals')
    .upload(storagePath, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type,
    });

  if (uploadError !== null) {
    return {
      ok: false,
      reasonCode: 'upload_failed',
      message: uploadError.message,
    };
  }

  // 5. Attach media row in Postgres
  const attachRes = await attachListingMedia({
    revisionId,
    originalPath: storagePath,
    kind,
    isFeatured,
    contentHash,
  });

  if (!attachRes.ok) {
    // Clean up uploaded object if database attach fails
    await client.storage.from('listing-originals').remove([storagePath]);
    return {
      ok: false,
      reasonCode: attachRes.reasonCode,
      message: attachRes.message,
    };
  }

  return {
    ok: true,
    data: {
      mediaId: attachRes.data.mediaId,
      storagePath,
    },
  };
}
