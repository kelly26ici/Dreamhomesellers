'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { bootstrapFirstAdmin } from '@/lib/moderator/write-model';

export function BootstrapAdminButton() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleBootstrap() {
    setSubmitting(true);
    setError(null);

    const result = await bootstrapFirstAdmin();
    if (!result.ok) {
      setSubmitting(false);
      setError(result.message);
      return;
    }

    router.refresh();
  }

  return (
    <div className="mt-4">
      {error && (
        <p className="mb-3 text-xs text-red-300" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={submitting}
        onClick={handleBootstrap}
        className="rounded-md border border-gold/40 bg-gold/15 px-4 py-2 text-xs font-semibold tracking-wider text-gold transition-colors hover:bg-gold/25 disabled:opacity-50"
      >
        {submitting ? 'INITIALIZING…' : 'BOOTSTRAP AS FIRST PLATFORM ADMIN'}
      </button>
    </div>
  );
}
