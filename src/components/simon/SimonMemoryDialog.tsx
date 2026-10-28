'use client';

/**
 * "What Simon remembers" — the buyer-facing editor for the preferences and
 * facts that survive across Simon threads.
 *
 * This is LUXONN chrome, not an assistant-ui composition: the vendored
 * `Dialog` primitives are used as shipped, with the house dark/gold tokens
 * applied through `.aui-scope`. Copy never names the storage layer; from the
 * buyer's side this is simply what the concierge knows about their search.
 *
 * The panel lives inside `DialogContent`, which Radix unmounts when the dialog
 * closes. Mounting per open is also what keeps the read honest: every visit
 * re-fetches instead of showing a snapshot from an earlier session.
 *
 * Server contract (`/api/simon/memory`):
 * - GET  → `{ memories, authenticated }`
 * - POST → `{ memories }` after an upsert (keys are normalized server-side)
 * - DELETE `/api/simon/memory/[id]` → `{ ok: true }`
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Sparkles, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { StoredSimonMemory } from '@/lib/simon/chat-types';

interface SimonMemoryDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readMemories(value: unknown): StoredSimonMemory[] {
  if (!isRecord(value) || !Array.isArray(value.memories)) return [];
  return value.memories.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== 'string') return [];
    if (row.kind !== 'preference' && row.kind !== 'fact') return [];
    if (typeof row.key !== 'string' || typeof row.value !== 'string') return [];
    return [
      {
        id: row.id,
        kind: row.kind,
        key: row.key,
        value: row.value,
        sourceThreadId:
          typeof row.sourceThreadId === 'string' ? row.sourceThreadId : null,
        updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
        expiresAt: typeof row.expiresAt === 'string' ? row.expiresAt : null,
      },
    ];
  });
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function errorText(data: unknown, fallback: string): string {
  return isRecord(data) && typeof data.error === 'string'
    ? data.error
    : fallback;
}

/** `primary_residence` reads as "Primary residence". */
function readableKey(key: string): string {
  const spaced = key.replace(/_/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function MemoryRow({
  memory,
  pending,
  onDelete,
}: {
  readonly memory: StoredSimonMemory;
  readonly pending: boolean;
  readonly onDelete: (id: string) => void;
}) {
  return (
    <li className="group flex items-start justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-gold/80">
          {readableKey(memory.key)}
          <span className="text-white/25">
            {memory.kind === 'fact' ? 'noted' : 'preference'}
          </span>
        </p>
        <p className="mt-1 text-sm leading-relaxed break-words text-foreground/90">
          {memory.value}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onDelete(memory.id)}
        disabled={pending}
        aria-label={`Forget ${readableKey(memory.key)}`}
        className="mt-0.5 shrink-0 rounded-md p-1.5 text-white/35 transition-colors hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        )}
      </button>
    </li>
  );
}

function SimonMemoryPanel() {
  const [memories, setMemories] = useState<readonly StoredSimonMemory[]>([]);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [draftKey, setDraftKey] = useState('');
  const [draftValue, setDraftValue] = useState('');
  const [draftKind, setDraftKind] = useState<'preference' | 'fact'>(
    'preference',
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch('/api/simon/memory', {
          cache: 'no-store',
        });
        const data = await readJson(response);
        if (cancelled) return;
        if (!response.ok) {
          setError(
            errorText(data, 'Simon could not recall anything just now.'),
          );
          return;
        }
        setMemories(readMemories(data));
        setAuthenticated(isRecord(data) && data.authenticated === true);
      } catch {
        if (!cancelled) setError('Simon could not recall anything just now.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const submit = useCallback(async () => {
    const key = draftKey.trim();
    const value = draftValue.trim();
    if (!key || !value || saving) return;

    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/simon/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: draftKind, key, value }),
      });
      const data = await readJson(response);
      if (!response.ok) {
        setError(errorText(data, 'That memory could not be kept.'));
        return;
      }
      setMemories(readMemories(data));
      setDraftKey('');
      setDraftValue('');
      setDraftKind('preference');
    } catch {
      setError('That memory could not be kept.');
    } finally {
      setSaving(false);
    }
  }, [draftKey, draftKind, draftValue, saving]);

  const forget = useCallback(
    async (memoryId: string) => {
      if (deletingId) return;

      setDeletingId(memoryId);
      setError(null);
      try {
        const response = await fetch(`/api/simon/memory/${memoryId}`, {
          method: 'DELETE',
        });
        if (!response.ok && response.status !== 404) {
          setError('That memory could not be removed.');
          return;
        }
        setMemories((previous) =>
          previous.filter((memory) => memory.id !== memoryId),
        );
      } catch {
        setError('That memory could not be removed.');
      } finally {
        setDeletingId(null);
      }
    },
    [deletingId],
  );

  const preferences = memories.filter(
    (memory) => memory.kind === 'preference',
  );
  const facts = memories.filter((memory) => memory.kind === 'fact');

  return (
    <>
      <DialogHeader className="border-b border-white/10 px-6 py-5">
        <DialogTitle className="flex items-center gap-2 font-heading text-base tracking-[0.18em] text-champagne">
          <Sparkles className="h-4 w-4 text-gold" aria-hidden />
          WHAT SIMON REMEMBERS
        </DialogTitle>
        <DialogDescription className="text-xs leading-relaxed text-white/50">
          Preferences and details Simon carries into every conversation. Simon
          keeps them for fourteen days after your last chat, then forgets them.
        </DialogDescription>
      </DialogHeader>

      <div className="max-h-[46vh] min-h-[120px] overflow-y-auto px-6 py-4 [scrollbar-width:thin]">
        {loading ? (
          <p className="flex items-center gap-2 py-6 text-xs text-white/50">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Recalling your preferences…
          </p>
        ) : memories.length === 0 ? (
          <p className="py-6 text-xs leading-relaxed text-white/45">
            Nothing yet. Tell Simon what you are looking for in chat, or add
            something below.
          </p>
        ) : (
          <div className="space-y-5">
            {preferences.length > 0 ? (
              <section>
                <h3 className="mb-2 text-[9px] uppercase tracking-[0.3em] text-white/35">
                  Preferences
                </h3>
                <ul className="space-y-2">
                  {preferences.map((memory) => (
                    <MemoryRow
                      key={memory.id}
                      memory={memory}
                      pending={deletingId === memory.id}
                      onDelete={forget}
                    />
                  ))}
                </ul>
              </section>
            ) : null}

            {facts.length > 0 ? (
              <section>
                <h3 className="mb-2 text-[9px] uppercase tracking-[0.3em] text-white/35">
                  Noted details
                </h3>
                <ul className="space-y-2">
                  {facts.map((memory) => (
                    <MemoryRow
                      key={memory.id}
                      memory={memory}
                      pending={deletingId === memory.id}
                      onDelete={forget}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}

        {error ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-200"
          >
            {error}
          </p>
        ) : null}
      </div>

      <form
        className="border-t border-white/10 px-6 py-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h3 className="mb-2 text-[9px] uppercase tracking-[0.3em] text-white/35">
          Add something
        </h3>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={draftKey}
            onChange={(event) => setDraftKey(event.target.value)}
            placeholder="budget"
            maxLength={80}
            aria-label="Memory name"
            className="border-white/15 bg-white/[0.03] text-sm placeholder:text-white/30 sm:w-40"
          />
          <Input
            value={draftValue}
            onChange={(event) => setDraftValue(event.target.value)}
            placeholder="Up to KES 120M, Karen or Runda"
            maxLength={500}
            aria-label="Memory value"
            className="flex-1 border-white/15 bg-white/[0.03] text-sm placeholder:text-white/30"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div
            role="group"
            aria-label="Memory type"
            className="flex rounded-md border border-white/10 p-0.5"
          >
            {(['preference', 'fact'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setDraftKind(kind)}
                aria-pressed={draftKind === kind}
                className={`rounded px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] transition-colors ${
                  draftKind === kind
                    ? 'bg-gold/15 text-gold'
                    : 'text-white/40 hover:text-white/70'
                }`}
              >
                {kind === 'preference' ? 'Preference' : 'Detail'}
              </button>
            ))}
          </div>

          <button
            type="submit"
            disabled={saving || !draftKey.trim() || !draftValue.trim()}
            className="inline-flex items-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] text-gold transition-colors hover:bg-gold/20 disabled:opacity-40"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : null}
            Remember
          </button>
        </div>

        {!authenticated && !loading ? (
          <p className="mt-3 text-[10px] leading-relaxed text-white/35">
            You are browsing as a guest. Sign in and Simon carries these with
            you across devices.
          </p>
        ) : null}
      </form>
    </>
  );
}

export function SimonMemoryDialog({
  open,
  onOpenChange,
}: SimonMemoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="aui-scope gap-0 border-gold/20 bg-[#0a0a0a] p-0 text-foreground sm:max-w-lg">
        <SimonMemoryPanel />
      </DialogContent>
    </Dialog>
  );
}
