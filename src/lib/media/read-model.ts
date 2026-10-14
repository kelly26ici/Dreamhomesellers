/**
 * Server read-model for listing media.
 * Queries public.get_revision_media (migration 0006) with session cookies.
 */

import { createAuthServerClient } from '@/lib/auth/supabase-server';
import type { ListingMediaItem, MediaCommandResult } from './types';

interface RawMediaRpcItem {
  media_id: string;
  revision_id: string;
  organization_id?: string;
  position: number;
  kind: 'image' | 'video';
  is_featured: boolean;
  source?: 'owner_upload' | 'inherited_external';
  original_path?: string | null;
  derivative_paths?: string[] | null;
  processing_status?: 'pending' | 'processing' | 'processed' | 'failed' | 'quarantined';
  moderation_status?: 'unreviewed' | 'approved' | 'rejected';
  created_at?: string;
}

interface RawGetRevisionMediaResponse {
  ok: boolean;
  reason_code?: string;
  message?: string;
  items?: RawMediaRpcItem[];
}

export async function fetchRevisionMedia(
  revisionId: string
): Promise<MediaCommandResult<ListingMediaItem[]>> {
  const client = await createAuthServerClient();

  const { data, error } = await client.rpc('get_revision_media', {
    p_revision_id: revisionId,
  });

  if (error !== null) {
    return {
      ok: false,
      reasonCode: error.code ?? 'query_error',
      message: error.message,
    };
  }

  const payload = data as RawGetRevisionMediaResponse | null;
  if (!payload || !payload.ok) {
    return {
      ok: false,
      reasonCode: payload?.reason_code ?? 'unknown_error',
      message: payload?.message ?? 'Failed to load media.',
    };
  }

  const items: ListingMediaItem[] = (payload.items ?? []).map((row) => ({
    mediaId: row.media_id,
    revisionId: row.revision_id,
    organizationId: row.organization_id,
    position: row.position,
    kind: row.kind,
    isFeatured: row.is_featured,
    source: row.source,
    originalPath: row.original_path ?? null,
    derivativePaths: row.derivative_paths ?? null,
    processingStatus: row.processing_status,
    moderationStatus: row.moderation_status,
    createdAt: row.created_at,
  }));

  return {
    ok: true,
    data: items,
  };
}
