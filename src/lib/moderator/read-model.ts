/**
 * Staff / Moderator read model over migration 0005 RPCs.
 *
 * Runs server-side via createAuthServerClient (request cookies).
 * Authority is enforced in the RPCs via public.caller_is_platform_moderator().
 */

import { createAuthServerClient } from '@/lib/auth/supabase-server';

export interface PreCheckItem {
  readonly checkCode: string;
  readonly outcome: 'pass' | 'fail' | 'warn';
  readonly detailCode: string | null;
}

export interface ModeratorCaseSummary {
  readonly caseId: string;
  readonly caseKind: 'submission' | 'buyer_report' | 'staff_initiated';
  readonly caseState: 'open' | 'resolved';
  readonly reference: string | null;
  readonly openedAt: string;
  readonly resolvedAt: string | null;
  readonly listingId: string;
  readonly revisionId: string | null;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly listingKind: string;
  readonly lifecycleState: string;
  readonly revisionTitle: string | null;
  readonly revisionState: string | null;
  readonly priceAmount: string | null;
  readonly priceCurrency: string | null;
  readonly city: string | null;
  readonly area: string | null;
  readonly preChecks: readonly PreCheckItem[];
}

export interface ModeratorCaseDetail {
  readonly case: {
    readonly caseId: string;
    readonly caseKind: string;
    readonly caseState: string;
    readonly reference: string | null;
    readonly reportCategory: string | null;
    readonly reportNote: string | null;
    readonly openedAt: string;
    readonly resolvedAt: string | null;
  };
  readonly organization: {
    readonly organizationId: string;
    readonly displayName: string;
    readonly kind: string;
    readonly isVerified: boolean;
  };
  readonly listing: {
    readonly listingId: string;
    readonly listingKind: string;
    readonly lifecycleState: string;
    readonly publishedRevisionId: string | null;
  };
  readonly revision: {
    readonly revisionId: string;
    readonly baseRevisionId: string | null;
    readonly revisionState: string;
    readonly title: string;
    readonly description: string;
    readonly propertyType: string;
    readonly propertySubtype: string | null;
    readonly availability: string;
    readonly priceAmount: string;
    readonly priceCurrency: string;
    readonly pricePeriod: string;
    readonly bedrooms: number | null;
    readonly bathrooms: number | null;
    readonly squareMeters: number | null;
    readonly lotSizeSqm: number | null;
    readonly yearBuilt: number | null;
    readonly floorNumber: number | null;
    readonly totalFloors: number | null;
    readonly plotDimensions: string | null;
    readonly landSizeRaw: string | null;
    readonly area: string;
    readonly city: string;
    readonly town: string | null;
    readonly county: string | null;
    readonly country: string;
    readonly amenities: readonly string[];
    readonly furnished: boolean;
    readonly createdAt: string;
    readonly publishedAt: string | null;
  } | null;
  readonly preChecks: readonly {
    readonly checkId: string;
    readonly checkCode: string;
    readonly outcome: 'pass' | 'fail' | 'warn';
    readonly detailCode: string | null;
    readonly checkerVersion: string;
    readonly ranAt: string;
  }[];
  readonly decisionHistory: readonly {
    readonly decisionId: string;
    readonly decision: string;
    readonly reasonCode: string;
    readonly note: string | null;
    readonly decidedBy: string;
    readonly decidedAt: string;
  }[];
}

export interface ModeratorRpcError {
  readonly ok: false;
  readonly reasonCode: string;
  readonly message: string;
}

export async function checkCallerIsModerator(): Promise<boolean> {
  const client = await createAuthServerClient();
  const { data, error } = await client.rpc('caller_is_platform_moderator');
  if (error || !data) return false;
  return true;
}

export async function fetchModerationCases(
  state: 'open' | 'resolved' | null = 'open',
  kind: 'submission' | 'buyer_report' | 'staff_initiated' | null = null,
): Promise<ModeratorRpcError | { ok: true; items: readonly ModeratorCaseSummary[] }> {
  const client = await createAuthServerClient();
  const { data, error } = await client.rpc('moderator_cases_summary', {
    p_case_state: state,
    p_case_kind: kind,
  });

  if (error) {
    return { ok: false, reasonCode: 'rpc_call_failed', message: error.message };
  }

  const envelope = data as { ok?: boolean; reason_code?: string; message?: string; items?: unknown[] };
  if (!envelope || envelope.ok === false) {
    return {
      ok: false,
      reasonCode: envelope?.reason_code ?? 'unexpected_response',
      message: envelope?.message ?? 'Failed to fetch moderation queue.',
    };
  }

  const rawItems = (envelope.items ?? []) as Record<string, unknown>[];
  const items: ModeratorCaseSummary[] = rawItems.map((raw) => ({
    caseId: String(raw.case_id),
    caseKind: raw.case_kind as ModeratorCaseSummary['caseKind'],
    caseState: raw.case_state as ModeratorCaseSummary['caseState'],
    reference: (raw.reference as string) ?? null,
    openedAt: String(raw.opened_at),
    resolvedAt: (raw.resolved_at as string) ?? null,
    listingId: String(raw.listing_id),
    revisionId: (raw.revision_id as string) ?? null,
    organizationId: String(raw.organization_id),
    organizationName: String(raw.organization_name),
    listingKind: String(raw.listing_kind),
    lifecycleState: String(raw.lifecycle_state),
    revisionTitle: (raw.revision_title as string) ?? null,
    revisionState: (raw.revision_state as string) ?? null,
    priceAmount: (raw.price_amount as string) ?? null,
    priceCurrency: (raw.price_currency as string) ?? null,
    city: (raw.city as string) ?? null,
    area: (raw.area as string) ?? null,
    preChecks: Array.isArray(raw.pre_checks)
      ? raw.pre_checks.map((c: Record<string, unknown>) => ({
          checkCode: String(c.check_code),
          outcome: c.outcome as 'pass' | 'fail' | 'warn',
          detailCode: (c.detail_code as string) ?? null,
        }))
      : [],
  }));

  return { ok: true, items };
}

export async function fetchModerationCaseDetail(
  caseId: string,
): Promise<ModeratorRpcError | { ok: true; detail: ModeratorCaseDetail }> {
  const client = await createAuthServerClient();
  const { data, error } = await client.rpc('moderator_case_detail', {
    p_case_id: caseId,
  });

  if (error) {
    return { ok: false, reasonCode: 'rpc_call_failed', message: error.message };
  }

  const envelope = data as { ok?: boolean; reason_code?: string; message?: string; [key: string]: unknown };
  if (!envelope || envelope.ok === false) {
    return {
      ok: false,
      reasonCode: envelope?.reason_code ?? 'unexpected_response',
      message: envelope?.message ?? 'Failed to fetch moderation case detail.',
    };
  }

  const c = envelope.case as Record<string, unknown>;
  const o = envelope.organization as Record<string, unknown>;
  const l = envelope.listing as Record<string, unknown>;
  const r = envelope.revision as Record<string, unknown> | null;
  const checks = (envelope.pre_checks as Record<string, unknown>[]) ?? [];
  const history = (envelope.decision_history as Record<string, unknown>[]) ?? [];

  const detail: ModeratorCaseDetail = {
    case: {
      caseId: String(c.case_id),
      caseKind: String(c.case_kind),
      caseState: String(c.case_state),
      reference: (c.reference as string) ?? null,
      reportCategory: (c.report_category as string) ?? null,
      reportNote: (c.report_note as string) ?? null,
      openedAt: String(c.opened_at),
      resolvedAt: (c.resolved_at as string) ?? null,
    },
    organization: {
      organizationId: String(o.organization_id),
      displayName: String(o.display_name),
      kind: String(o.kind),
      isVerified: Boolean(o.is_verified),
    },
    listing: {
      listingId: String(l.listing_id),
      listingKind: String(l.listing_kind),
      lifecycleState: String(l.lifecycle_state),
      publishedRevisionId: (l.published_revision_id as string) ?? null,
    },
    revision: r
      ? {
          revisionId: String(r.revision_id),
          baseRevisionId: (r.base_revision_id as string) ?? null,
          revisionState: String(r.revision_state),
          title: String(r.title),
          description: String(r.description),
          propertyType: String(r.property_type),
          propertySubtype: (r.property_subtype as string) ?? null,
          availability: String(r.availability),
          priceAmount: String(r.price_amount),
          priceCurrency: String(r.price_currency),
          pricePeriod: String(r.price_period),
          bedrooms: r.bedrooms !== null ? Number(r.bedrooms) : null,
          bathrooms: r.bathrooms !== null ? Number(r.bathrooms) : null,
          squareMeters: r.square_meters !== null ? Number(r.square_meters) : null,
          lotSizeSqm: r.lot_size_sqm !== null ? Number(r.lot_size_sqm) : null,
          yearBuilt: r.year_built !== null ? Number(r.year_built) : null,
          floorNumber: r.floor_number !== null ? Number(r.floor_number) : null,
          totalFloors: r.total_floors !== null ? Number(r.total_floors) : null,
          plotDimensions: (r.plot_dimensions as string) ?? null,
          landSizeRaw: (r.land_size_raw as string) ?? null,
          area: String(r.area),
          city: String(r.city),
          town: (r.town as string) ?? null,
          county: (r.county as string) ?? null,
          country: String(r.country),
          amenities: Array.isArray(r.amenities) ? (r.amenities as string[]) : [],
          furnished: Boolean(r.furnished),
          createdAt: String(r.created_at),
          publishedAt: (r.published_at as string) ?? null,
        }
      : null,
    preChecks: checks.map((pc) => ({
      checkId: String(pc.check_id),
      checkCode: String(pc.check_code),
      outcome: pc.outcome as 'pass' | 'fail' | 'warn',
      detailCode: (pc.detail_code as string) ?? null,
      checkerVersion: String(pc.checker_version),
      ranAt: String(pc.ran_at),
    })),
    decisionHistory: history.map((dh) => ({
      decisionId: String(dh.decision_id),
      decision: String(dh.decision),
      reasonCode: String(dh.reason_code),
      note: (dh.note as string) ?? null,
      decidedBy: String(dh.decided_by),
      decidedAt: String(dh.decided_at),
    })),
  };

  return { ok: true, detail };
}
