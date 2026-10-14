/**
 * Browser write-model for listing media.
 * Invokes SECURITY DEFINER domain commands in migration 0006.
 */

import { createSupabaseBrowserClient } from '@/lib/auth/supabase-browser';
import type { AttachMediaInput, MediaCommandResult } from './types';

interface RawRpcResponse {
  ok: boolean;
  reason_code?: string;
  message?: string;
  media_id?: string;
  [key: string]: unknown;
}

export async function attachListingMedia(
  input: AttachMediaInput
): Promise<MediaCommandResult<{ mediaId: string }>> {
  const client = createSupabaseBrowserClient();

  const { data, error } = await client.rpc('attach_listing_media', {
    p_revision_id: input.revisionId,
    p_original_path: input.originalPath,
    p_kind: input.kind,
    p_is_featured: input.isFeatured ?? false,
    p_content_hash: input.contentHash ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
  });

  if (error !== null) {
    return {
      ok: false,
      reasonCode: error.code ?? 'rpc_error',
      message: error.message,
    };
  }

  const res = data as RawRpcResponse | null;
  if (!res || !res.ok) {
    return {
      ok: false,
      reasonCode: res?.reason_code ?? 'rejection',
      message: res?.message ?? 'Failed to attach media.',
    };
  }

  return {
    ok: true,
    data: { mediaId: (res.media_id as string) ?? '' },
  };
}

export async function deleteListingMedia(
  mediaId: string,
  idempotencyKey?: string
): Promise<MediaCommandResult<{ mediaId: string }>> {
  const client = createSupabaseBrowserClient();

  const { data, error } = await client.rpc('delete_listing_media', {
    p_media_id: mediaId,
    p_idempotency_key: idempotencyKey ?? null,
  });

  if (error !== null) {
    return {
      ok: false,
      reasonCode: error.code ?? 'rpc_error',
      message: error.message,
    };
  }

  const res = data as RawRpcResponse | null;
  if (!res || !res.ok) {
    return {
      ok: false,
      reasonCode: res?.reason_code ?? 'rejection',
      message: res?.message ?? 'Failed to delete media.',
    };
  }

  return {
    ok: true,
    data: { mediaId },
  };
}

export async function reorderListingMedia(
  revisionId: string,
  mediaIds: string[],
  idempotencyKey?: string
): Promise<MediaCommandResult<void>> {
  const client = createSupabaseBrowserClient();

  const { data, error } = await client.rpc('reorder_listing_media', {
    p_revision_id: revisionId,
    p_media_ids: mediaIds,
    p_idempotency_key: idempotencyKey ?? null,
  });

  if (error !== null) {
    return {
      ok: false,
      reasonCode: error.code ?? 'rpc_error',
      message: error.message,
    };
  }

  const res = data as RawRpcResponse | null;
  if (!res || !res.ok) {
    return {
      ok: false,
      reasonCode: res?.reason_code ?? 'rejection',
      message: res?.message ?? 'Failed to reorder media.',
    };
  }

  return {
    ok: true,
    data: undefined,
  };
}

export async function setFeaturedMedia(
  revisionId: string,
  mediaId: string,
  idempotencyKey?: string
): Promise<MediaCommandResult<void>> {
  const client = createSupabaseBrowserClient();

  const { data, error } = await client.rpc('set_featured_media', {
    p_revision_id: revisionId,
    p_media_id: mediaId,
    p_idempotency_key: idempotencyKey ?? null,
  });

  if (error !== null) {
    return {
      ok: false,
      reasonCode: error.code ?? 'rpc_error',
      message: error.message,
    };
  }

  const res = data as RawRpcResponse | null;
  if (!res || !res.ok) {
    return {
      ok: false,
      reasonCode: res?.reason_code ?? 'rejection',
      message: res?.message ?? 'Failed to set featured media.',
    };
  }

  return {
    ok: true,
    data: undefined,
  };
}
