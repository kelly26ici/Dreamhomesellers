'use client';

/**
 * MediaManager — visual upload, ordering, and curation surface for listing media.
 * Follows the LUXONN dark/gold visual language (glassmorphism, subtle borders, gold accents).
 */

import { useState, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Upload,
  Image as ImageIcon,
  Film,
  Star,
  Trash2,
  ArrowUp,
  ArrowDown,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';

import type { ListingMediaItem } from '@/lib/media/types';
import { uploadListingMedia } from '@/lib/media/upload';
import {
  deleteListingMedia,
  reorderListingMedia,
  setFeaturedMedia,
} from '@/lib/media/write-model';

interface MediaManagerProps {
  organizationId: string;
  revisionId: string;
  isDraft: boolean;
  initialMedia: ListingMediaItem[];
}

export function MediaManager({
  organizationId,
  revisionId,
  isDraft,
  initialMedia,
}: MediaManagerProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mediaList, setMediaList] = useState<ListingMediaItem[]>(initialMedia);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadError(null);
    setUploadSuccess(null);
    setIsUploading(true);

    try {
      const fileArray = Array.from(files);
      let successCount = 0;

      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        const isFirst = mediaList.length === 0 && i === 0;

        const res = await uploadListingMedia({
          organizationId,
          revisionId,
          file,
          isFeatured: isFirst,
        });

        if (res.ok) {
          successCount++;
        } else {
          setUploadError(`${file.name}: ${res.message}`);
          break;
        }
      }

      if (successCount > 0) {
        setUploadSuccess(
          `Successfully uploaded ${successCount} asset${successCount > 1 ? 's' : ''}.`
        );
        startTransition(() => {
          router.refresh();
        });
      }
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'An unexpected error occurred during upload.'
      );
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleSetFeatured = async (mediaId: string) => {
    setPendingActionId(mediaId);
    setUploadError(null);

    const res = await setFeaturedMedia(revisionId, mediaId);
    if (!res.ok) {
      setUploadError(res.message);
    } else {
      setMediaList((prev) =>
        prev.map((item) => ({
          ...item,
          isFeatured: item.mediaId === mediaId,
        }))
      );
      startTransition(() => {
        router.refresh();
      });
    }
    setPendingActionId(null);
  };

  const handleDelete = async (mediaId: string) => {
    if (!confirm('Are you sure you want to remove this media asset?')) return;
    setPendingActionId(mediaId);
    setUploadError(null);

    const res = await deleteListingMedia(mediaId);
    if (!res.ok) {
      setUploadError(res.message);
    } else {
      setMediaList((prev) => prev.filter((item) => item.mediaId !== mediaId));
      startTransition(() => {
        router.refresh();
      });
    }
    setPendingActionId(null);
  };

  const handleMove = async (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= mediaList.length) return;

    const newItems = [...mediaList];
    const [moved] = newItems.splice(index, 1);
    newItems.splice(targetIndex, 0, moved);

    const mediaIds = newItems.map((m) => m.mediaId);
    setPendingActionId(moved.mediaId);
    setUploadError(null);

    const res = await reorderListingMedia(revisionId, mediaIds);
    if (!res.ok) {
      setUploadError(res.message);
    } else {
      setMediaList(newItems);
      startTransition(() => {
        router.refresh();
      });
    }
    setPendingActionId(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-heading tracking-wide text-foreground">
            Residence Media & Visual Assets
          </h2>
          <p className="mt-1 text-xs text-muted">
            High-fidelity photographs and walkthrough videos. The first featured image serves as the residence hero cover.
          </p>
        </div>
        {isDraft && (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/avif,image/heic,video/mp4,video/quicktime"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
              disabled={isUploading}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="flex items-center gap-2 rounded-xl border border-gold/40 bg-gold/10 px-5 py-2.5 text-xs font-medium tracking-[0.15em] text-gold transition-all duration-300 hover:border-gold hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-gold" />
                  UPLOADING ASSETS...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 text-gold" />
                  ADD RESIDENCE MEDIA
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {uploadError && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
          <p>{uploadError}</p>
        </div>
      )}

      {uploadSuccess && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          <p>{uploadSuccess}</p>
        </div>
      )}

      {mediaList.length === 0 ? (
        <div
          onClick={() => isDraft && fileInputRef.current?.click()}
          className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gold/20 bg-surface-2/20 p-12 text-center backdrop-blur-sm transition-all duration-300 ${
            isDraft ? 'cursor-pointer hover:border-gold/40 hover:bg-surface-2/30' : ''
          }`}
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-gold/20 bg-gold/5">
            <ImageIcon className="h-6 w-6 text-gold/70" />
          </div>
          <h3 className="mt-4 text-sm font-medium tracking-wide text-foreground">
            No media attached yet
          </h3>
          <p className="mt-1 max-w-sm text-xs text-muted">
            {isDraft
              ? 'Drag & drop high-resolution photographs or architectural footage here, or click to browse.'
              : 'No media records currently attached to this revision.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {mediaList.map((item, index) => {
            const isProcessing = pendingActionId === item.mediaId;

            return (
              <div
                key={item.mediaId}
                className={`group relative overflow-hidden rounded-2xl border transition-all duration-300 ${
                  item.isFeatured
                    ? 'border-gold/60 bg-gradient-to-b from-gold/10 via-surface-2/40 to-surface-2/20 shadow-lg shadow-gold/5'
                    : 'border-white/10 bg-surface-2/30 hover:border-gold/30'
                }`}
              >
                {/* Media preview block */}
                <div className="relative aspect-[16/10] w-full overflow-hidden bg-black/40">
                  <div className="flex h-full w-full items-center justify-center">
                    {item.kind === 'video' ? (
                      <Film className="h-10 w-10 text-gold/60" />
                    ) : (
                      <ImageIcon className="h-10 w-10 text-gold/40" />
                    )}
                  </div>

                  {/* Position badge */}
                  <span className="absolute left-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-[10px] font-mono text-gold backdrop-blur-sm">
                    {index + 1}
                  </span>

                  {/* Featured badge */}
                  {item.isFeatured && (
                    <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full border border-gold/40 bg-gold/20 px-2.5 py-0.5 text-[10px] font-semibold tracking-wider text-gold backdrop-blur-md">
                      <Star className="h-3 w-3 fill-gold" />
                      COVER HERO
                    </span>
                  )}
                </div>

                {/* Details and controls */}
                <div className="p-4">
                  <div className="flex items-center justify-between text-[11px] text-muted">
                    <span className="uppercase tracking-wider">{item.kind}</span>
                    <span className="capitalize">{item.processingStatus ?? 'pending'}</span>
                  </div>

                  {isDraft && (
                    <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleMove(index, 'up')}
                          disabled={index === 0 || isProcessing}
                          title="Move earlier"
                          className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-muted hover:border-gold/40 hover:text-gold disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMove(index, 'down')}
                          disabled={index === mediaList.length - 1 || isProcessing}
                          title="Move later"
                          className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-muted hover:border-gold/40 hover:text-gold disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        {!item.isFeatured && (
                          <button
                            type="button"
                            onClick={() => handleSetFeatured(item.mediaId)}
                            disabled={isProcessing}
                            className="rounded-lg border border-gold/20 px-2 py-1 text-[10px] tracking-wider text-gold hover:border-gold/50 hover:bg-gold/10"
                          >
                            SET COVER
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDelete(item.mediaId)}
                          disabled={isProcessing}
                          title="Remove asset"
                          className="flex h-7 w-7 items-center justify-center rounded-lg border border-red-500/20 text-red-400 hover:border-red-500/50 hover:bg-red-500/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
