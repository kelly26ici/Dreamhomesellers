/**
 * ListingMedia — ordered media attached to a revision, plus the derived-AI
 * evidence satellites (per-image observations, revision-level visual
 * dossier) kept strictly separate per ADR-010 and the security doc: AI
 * observations are never media facts and never mix into verified fact
 * shapes. Also carries EmbeddingProvenance — restricted-operational
 * metadata about the Qdrant embedding (ADR-010: "embedding metadata, and
 * versioning"), which is projection bookkeeping, not derived evidence.
 *
 * Media attach to a revision (ordered by position), never to a bare
 * property. Inherited external URLs (`inherited_url`) are restricted,
 * unverified references: fetch-and-validate (liveness, ownership,
 * EXIF/location), then copy into private Storage, must precede any
 * derivative. Public derivatives surface only through a published,
 * moderation-approved revision; rejected media never publishes;
 * withdrawal/closure makes derivatives unreachable.
 */

import type {
  EmbeddingId,
  FieldClass,
  MediaId,
  MediaObservationId,
  OrganizationId,
  RevisionId,
  StoragePath,
  Timestamp,
  VisualDossierId,
} from './shared';

export type MediaKind = 'image' | 'video';
export type MediaSource = 'owner_upload' | 'inherited_external';
export type MediaProcessingStatus =
  | 'pending'
  | 'processing'
  | 'processed'
  | 'failed'
  | 'quarantined';
export type MediaModerationStatus = 'unreviewed' | 'approved' | 'rejected';

export interface ListingMedia {
  /** Stable media identity. */
  readonly media_id: MediaId;
  /** Attached to a revision, ordered by position — never to a bare
   * property. */
  readonly revision_id: RevisionId;
  /** Denormalized ownership (ADR-012). */
  readonly organization_id: OrganizationId;
  /** Display ordering (inherited `property_images.sort_order`). */
  readonly position: number;
  /** Video is media (kind='video'), not a revision URL field: the inherited
   * `video_url` column is replaced by this pipeline. */
  readonly kind: MediaKind;
  /** Cover/hero flag (inherited `is_featured`). */
  readonly is_featured: boolean;
  /** Provenance: owner upload (auth required, ADR-003) or inherited
   * external reference (ADR-015 import). */
  readonly source: MediaSource;
  /** External URL for inherited media: an unverified reference only. Never
   * buyer-visible by row existence. */
  readonly inherited_url: string | null;
  /** Private Supabase Storage original (target lifecycle requirement). */
  readonly original_path: StoragePath | null;
  /** Safe derivatives; served only via approved/published revision links
   * (security doc media control 6). */
  readonly derivative_paths: readonly StoragePath[] | null;
  /** Worker-owned (ADR-009: deterministic workers, not agents). */
  readonly processing_status: MediaProcessingStatus;
  /** Human/operational; approval never automatic. */
  readonly moderation_status: MediaModerationStatus;
  /** Integrity/dedupe hash. */
  readonly content_hash: string | null;
  readonly created_at: Timestamp;
}

export const ListingMediaFieldClass = {
  media_id: 'public',
  revision_id: 'public',
  organization_id: 'restricted',
  position: 'public',
  kind: 'public',
  is_featured: 'public',
  source: 'restricted',
  inherited_url: 'restricted',
  original_path: 'restricted',
  derivative_paths: 'public',
  processing_status: 'restricted',
  moderation_status: 'restricted',
  content_hash: 'restricted',
  created_at: 'restricted',
} as const satisfies Record<keyof ListingMedia, FieldClass>;

/**
 * Structured visual features extracted by the vision model. The concrete
 * feature schema is model-dependent and freezes in Phase 1 with the model
 * choice; the envelope is versioned so schema evolution is attributable.
 */
export interface VisualFeatures {
  readonly feature_schema_version: number;
  readonly values: Record<string, unknown>;
}

export const VisualFeaturesFieldClass = {
  feature_schema_version: 'derived-ai-evidence',
  values: 'derived-ai-evidence',
} as const satisfies Record<keyof VisualFeatures, FieldClass>;

/**
 * Per-image AI observation — a separate derived-evidence shape (ADR-010),
 * never a media fact. Versioned and attributable (ADR-011).
 */
export interface MediaObservation {
  readonly observation_id: MediaObservationId;
  readonly media_id: MediaId;
  /** Versioned: regeneration produces a new version, never an edit. */
  readonly observation_version: number;
  readonly caption: string | null;
  readonly room_classification: string | null;
  readonly visual_features: VisualFeatures | null;
  readonly quality_flags: readonly string[] | null;
  /** Model provenance (ADR-011 attributability). */
  readonly analysis_model: string;
  readonly analysis_model_version: string;
  readonly observed_at: Timestamp;
}

export const MediaObservationFieldClass = {
  observation_id: 'derived-ai-evidence',
  media_id: 'derived-ai-evidence',
  observation_version: 'derived-ai-evidence',
  caption: 'derived-ai-evidence',
  room_classification: 'derived-ai-evidence',
  visual_features: 'derived-ai-evidence',
  quality_flags: 'derived-ai-evidence',
  analysis_model: 'derived-ai-evidence',
  analysis_model_version: 'derived-ai-evidence',
  observed_at: 'derived-ai-evidence',
} as const satisfies Record<keyof MediaObservation, FieldClass>;

/** A room/feature group within the visual dossier. */
export interface DossierRoomGroup {
  /** Group label, e.g. "kitchen", "exterior". */
  readonly group_label: string;
  /** Media contributing evidence to this group. */
  readonly media_ids: readonly MediaId[];
  /** Short derived summary of the group's evidence. */
  readonly summary: string | null;
}

export const DossierRoomGroupFieldClass = {
  group_label: 'derived-ai-evidence',
  media_ids: 'derived-ai-evidence',
  summary: 'derived-ai-evidence',
} as const satisfies Record<keyof DossierRoomGroup, FieldClass>;

/**
 * Revision-level visual dossier (derived-AI, ADR-010): summarizes image
 * evidence so the live agent never re-reads a pile of captions every turn.
 * Regeneration produces a new dossier_version, never an edit.
 */
export interface VisualDossier {
  readonly dossier_id: VisualDossierId;
  readonly revision_id: RevisionId;
  readonly coverage_summary: string | null;
  readonly room_groups: readonly DossierRoomGroup[] | null;
  readonly dossier_version: number;
  readonly analysis_model: string;
  readonly analysis_model_version: string;
  readonly generated_at: Timestamp;
}

export const VisualDossierFieldClass = {
  dossier_id: 'derived-ai-evidence',
  revision_id: 'derived-ai-evidence',
  coverage_summary: 'derived-ai-evidence',
  room_groups: 'derived-ai-evidence',
  dossier_version: 'derived-ai-evidence',
  analysis_model: 'derived-ai-evidence',
  analysis_model_version: 'derived-ai-evidence',
  generated_at: 'derived-ai-evidence',
} as const satisfies Record<keyof VisualDossier, FieldClass>;

/**
 * Embedding provenance for the buyer-safe Qdrant projection (ADR-010:
 * persist embedding metadata, and versioning). The deterministic indexing
 * worker (ADR-009), driven by the publication outbox, records the exact
 * recipe behind every projected point: which revision was embedded, which
 * document-assembly recipe formed the text, the hash of that text, and the
 * embedding model + version + output dimension. This is the record the
 * inherited projection lacked — its 4,258 points are unreproducible
 * because the recipe was never recorded (discovery brief §6/§8).
 *
 * Restricted operational: never buyer-visible, never part of any
 * derived-evidence shape, never a revision fact. Re-embedding produces a
 * new embedding_version, never an edit.
 */
export interface EmbeddingProvenance {
  readonly embedding_id: EmbeddingId;
  /** The revision whose buyer-safe document was embedded — the explicit
   * revision reference the security doc requires of every projection. */
  readonly revision_id: RevisionId;
  /** Denormalized ownership (ADR-012). */
  readonly organization_id: OrganizationId;
  /** Versioned: re-embedding (recipe or model change) produces a new
   * version, never an edit. */
  readonly embedding_version: number;
  /** Version of the document-assembly recipe — which revision fields and
   * caption/dossier text form the embedded document. The unrecorded-recipe
   * defect this field closes: "which listing fields form the stored
   * embedding text" was unknowable from the inherited source. */
  readonly recipe_version: string;
  /** Hash of the exact assembled document text that was embedded. */
  readonly content_hash: string;
  /** Embedding model provenance — distinct from the vision
   * analysis_model on MediaObservation. */
  readonly embedding_model: string;
  readonly embedding_model_version: string;
  /** Output dimensionality; pins the projection's vector space (the
   * inherited collection's 1024 dimensions were presumed from the query
   * path, never recorded). */
  readonly vector_dimension: number;
  readonly embedded_at: Timestamp;
}

export const EmbeddingProvenanceFieldClass = {
  embedding_id: 'restricted',
  revision_id: 'restricted',
  organization_id: 'restricted',
  embedding_version: 'restricted',
  recipe_version: 'restricted',
  content_hash: 'restricted',
  embedding_model: 'restricted',
  embedding_model_version: 'restricted',
  vector_dimension: 'restricted',
  embedded_at: 'restricted',
} as const satisfies Record<keyof EmbeddingProvenance, FieldClass>;
