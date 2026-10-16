'use client';

import { useState } from 'react';
import { Sparkles, X, Check, ArrowRight, Wand2 } from 'lucide-react';
import type { AIDraftResponse } from '@/app/api/owner/draft-assist/route';

interface AIDraftingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (draft: AIDraftResponse) => void;
}

const PRESET_EXAMPLES = [
  '5-bed villa in Karen, 0.5 acre, private pool, borehole, solar, DSQ, asking 145M KES',
  'Modern 3-bed penthouse in Westlands, 8th floor, rift views, gym, pool, 42M KES',
  'Executive 4-bed townhouse in Runda, gated court, private garden, 89.5M KES',
  '4-bed coastal villa in Nyali near beach, plunge pool, walled garden, 350k/mo rent',
];

export function AIDraftingModal({ isOpen, onClose, onApply }: AIDraftingModalProps) {
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AIDraftResponse | null>(null);

  if (!isOpen) return null;

  const handleGenerate = async () => {
    if (!notes.trim()) return;
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/owner/draft-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate draft.');
      }

      setPreview(data.draft);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApply = () => {
    if (preview) {
      onApply(preview);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-lg border border-gold/30 bg-[#0c0c0e] text-foreground shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gold/15 px-6 py-4 bg-surface-2/40">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-gold" />
            <h2 className="text-lg font-heading tracking-wide text-foreground">
              Draft with Simon AI
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-muted hover:text-foreground hover:bg-white/5 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 [scrollbar-color:var(--gold)_transparent] [scrollbar-width:thin]">
          {!preview ? (
            <>
              <div>
                <label className="block text-xs uppercase tracking-[0.2em] text-champagne mb-2">
                  Enter property notes or bullet points
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. 5 bedroom standalone home in Karen near Crossroads, 0.5 acre plot with mature trees, private swimming pool, borehole and generator, asking 130 million KES..."
                  rows={5}
                  className="w-full rounded-md border border-white/10 bg-black/50 p-4 text-sm text-foreground placeholder:text-muted/60 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
                />
              </div>

              {/* Preset Examples */}
              <div>
                <p className="text-xs tracking-wider text-muted mb-2">Quick examples to try:</p>
                <div className="flex flex-wrap gap-2">
                  {PRESET_EXAMPLES.map((example, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setNotes(example)}
                      className="text-left text-xs rounded-md border border-white/10 bg-surface-2/30 px-3 py-1.5 text-muted hover:border-gold/40 hover:text-champagne transition-all"
                    >
                      {example.slice(0, 48)}...
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">
                  {error}
                </div>
              )}
            </>
          ) : (
            /* Preview of Generated Draft */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-[0.2em] text-emerald-400 flex items-center gap-1.5">
                  <Check className="h-4 w-4" />
                  Luxury Draft Proposal Ready
                </span>
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="text-xs text-muted hover:text-gold transition-colors"
                >
                  Edit notes and re-generate
                </button>
              </div>

              <div className="rounded-lg border border-gold/20 bg-black/40 p-4 space-y-3 text-sm">
                <div>
                  <span className="text-xs text-muted block">Proposed Editorial Title:</span>
                  <p className="font-heading text-lg text-champagne mt-0.5">{preview.title}</p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-white/5 text-xs">
                  <div>
                    <span className="text-muted block">Type:</span>
                    <span className="capitalize text-foreground font-medium">{preview.propertyType}</span>
                  </div>
                  <div>
                    <span className="text-muted block">Price:</span>
                    <span className="text-gold font-medium">
                      {preview.priceCurrency} {parseFloat(preview.priceAmount).toLocaleString()}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted block">Beds / Baths:</span>
                    <span className="text-foreground font-medium">
                      {preview.bedrooms || '—'} bd / {preview.bathrooms || '—'} ba
                    </span>
                  </div>
                  <div>
                    <span className="text-muted block">Location:</span>
                    <span className="text-foreground font-medium">{preview.area}, {preview.city}</span>
                  </div>
                </div>

                {preview.amenities.length > 0 && (
                  <div className="pt-2 border-t border-white/5">
                    <span className="text-xs text-muted block mb-1.5">Detected Amenities:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {preview.amenities.map((am, i) => (
                        <span
                          key={i}
                          className="rounded-full border border-gold/30 bg-gold/5 px-2.5 py-0.5 text-[11px] text-champagne"
                        >
                          {am}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-2 border-t border-white/5">
                  <span className="text-xs text-muted block mb-1">Architectural Prose:</span>
                  <p className="text-xs text-muted leading-relaxed whitespace-pre-line bg-surface-2/20 p-3 rounded-lg border border-white/5">
                    {preview.description}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 border-t border-gold/15 px-6 py-4 bg-surface-2/40">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/10 px-4 py-2 text-xs tracking-wider text-muted hover:text-foreground transition-colors"
          >
            Cancel
          </button>

          {!preview ? (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isLoading || !notes.trim()}
              className="flex items-center gap-2 rounded-md border border-gold bg-gold/15 px-5 py-2 text-xs tracking-wider text-gold hover:bg-gold/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border border-gold border-t-transparent" />
                  <span>Synthesizing Draft...</span>
                </>
              ) : (
                <>
                  <Wand2 className="h-3.5 w-3.5" />
                  <span>Generate Luxury Draft</span>
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleApply}
              className="flex items-center gap-2 rounded-md border border-gold bg-gold px-5 py-2 text-xs font-semibold tracking-wider text-black hover:bg-gold/90 transition-all shadow-lg shadow-gold/20"
            >
              <span>Apply to Form</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
