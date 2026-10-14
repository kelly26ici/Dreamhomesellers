/**
 * Media domain contracts and types for LUXONN marketplace.
 * Sourced from contracts.md §5 and ADR-010.
 */

export type MediaKind = 'image' | 'video';
export type MediaSource = 'owner_upload' | 'inherited_external';
export type MediaProcessingStatus =
  | 'pending'
  | 'processing'
  | 'processed'
  | 'failed'
  | 'quarantined';
export type MediaModerationStatus = 'unreviewed' | 'approved' | 'rejected';

export interface ListingMediaItem {
  readonly mediaId: string;
  readonly revisionId: string;
  readonly organizationId?: string;
  readonly position: number;
  readonly kind: MediaKind;
  readonly isFeatured: boolean;
  readonly source?: MediaSource;
  readonly originalPath?: string | null;
  readonly derivativePaths: readonly string[] | null;
  readonly processingStatus?: MediaProcessingStatus;
  readonly moderationStatus?: MediaModerationStatus;
  readonly createdAt?: string;
}

export interface AttachMediaInput {
  readonly revisionId: string;
  readonly originalPath: string;
  readonly kind: MediaKind;
  readonly isFeatured?: boolean;
  readonly contentHash?: string;
  readonly idempotencyKey?: string;
}

export type MediaCommandResult<T = unknown> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly reasonCode: string; readonly message: string };
