# Phase 0 domain contracts — contract of record

**Status:** accepted Phase 0 contracts (implementation sequence step 1.2–1.5) · **Date:** 2026-10-11

This document is the contract of record for the LUXONN marketplace domain model: TypeScript contracts in `src/lib/contracts/`, the Python mirrors, the field classification of every field at every depth, the publication/withdrawal/correction behavior specification, the placement rationale synthesizing the two Phase 0 drafts (A: target-first, B: migration-first), and the full inherited-column disposition for the 129 marketplace-relevant columns in the [discovery brief](../plans/schema-discovery-brief.md).

Sources: [ADR-001 through ADR-016](decisions.md), [security and data boundaries](security-data-boundaries.md), [target marketplace architecture](marketplace-target.md), [Simon service boundary](../agent-service/simon-boundary.md), and the [schema discovery brief](../plans/schema-discovery-brief.md). These contracts are types and behavior specifications only: no SQL DDL (Phase 1), no runtime code, no new dependencies.

## 0. Naming-parity rule (TS ↔ Python)

TS camelCase maps mechanically to Python snake_case and **nothing else differs**: same field set, same nullability, same literal vocabularies, same classification per field, same behavior notes. The mechanical type correspondences are:

| TS | Python (pydantic v2) |
| --- | --- |
| branded id (`PropertyId`, …) | `str` |
| `Timestamp` (ISO-8601 UTC string) | `datetime` |
| `Money` | `Money` model (`amount: str`, `currency: str`) |
| closed string unions | `Literal[...]` |
| provisional open unions (`'available' \| (string & {})`) | `str` (known members documented) |
| `X \| null` | `X \| None` |
| `readonly X[]` | `list[X]` |
| `Record<string, unknown>` | `dict[str, Any]` |

Python mirrors below are pydantic v2 BaseModel classes. Field-class classification records (`XFieldClass` in TS) are documentation tables here, not code.

## 1. Shared primitives (`src/lib/contracts/shared.ts`)

**FieldClass union** — `'public' | 'restricted' | 'personal' | 'derived-ai-evidence' | 'secret'`, mapping to the security doc's full names:

- `public` → *Public published*: readable only through a current published revision.
- `restricted` → *Restricted operational*: server-side role checks; never in public Qdrant projections or general Simon context.
- `personal` → *Personal/consent-bound*: purpose-limited, consent-aware access and retention.
- `derived-ai-evidence` → *Derived AI evidence*: versioned, attributable, never a canonical business fact.
- `secret` → *Secret*: environment/secret manager only. No inherited column maps here (brief attestation); the member exists because the security doc defines five classes.

**Branded id types** (one per entity, all opaque `string & { __brand }`): `PropertyId`, `ListingId`, `RevisionId`, `MediaId`, `MediaObservationId`, `VisualDossierId`, `EmbeddingId`, `OrganizationId`, `MembershipId`, `PlatformRoleId`, `UserId`, `ModerationCaseId`, `ModerationDecisionId`, `PreCheckId`, `ViewingRequestId`, `HandoffId`, `AuditId`, `OutboxEventId`, `ContactId`, `ConsentId`, plus `StoragePath`.

**Other primitives:** `Timestamp` (ISO-8601 UTC string), `Money { amount: string; currency: string }` (amount is a decimal string, never a bare number; currency is an explicit ISO 4217 code, never hardcoded — ADR-001), `ActorType`, `VerifiedContact`, `ConsentRecord`, `AuditRecord`, `OutboxEvent`.

```python
from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel

class Money(BaseModel):
    amount: str          # decimal string, never a float
    currency: str        # ISO 4217 code, e.g. "KES"; never a schema constant

class VerifiedContact(BaseModel):
    contact_id: str
    channel: Literal["email", "phone"]
    value: str           # personal data; never a lookup key
    verified_at: datetime | None   # null until the ADR-016 verification step completes
    display_name: str | None

class ConsentRecord(BaseModel):
    consent_id: str
    purpose: str
    consented_at: datetime
    provenance: Literal["native", "inherited"]  # "inherited" only for continuity of live records

class AuditRecord(BaseModel):
    audit_id: str
    occurred_at: datetime
    actor_type: Literal["anonymous", "buyer", "owner", "moderator", "service"]
    actor_id: str | None
    organization_id: str | None   # always present for listing-scoped resources (ADR-012)
    action: str                   # e.g. "listing.submit"
    resource_type: str
    resource_id: str
    request_id: str                # idempotency/correlation
    outcome: Literal["accepted", "rejected", "completed", "failed"]
    reason_code: str

class OutboxEvent(BaseModel):
    event_id: str
    occurred_at: datetime
    organization_id: str | None
    event_type: str                # e.g. "listing.published"
    payload: dict[str, Any]        # typed; buyer-safe + operational references only — never restricted fields
    delivery_state: Literal["pending", "delivered", "failed"]
    delivery_attempts: int
```

**Classification.** `Money`: public/public. `VerifiedContact`, `ConsentRecord`: every field `personal`. `AuditRecord`, `OutboxEvent`: every field `restricted` (payload carries buyer-safe content only; no secrets, raw prompts, or restricted fields ever).

**Behavior notes.** Audit records are server-generated and append-only (security doc baseline). Outbox events are written in the same transaction as the state change and consumed idempotently by indexing, media, notification, and CRM workers (ADR-005). The inherited `request_outbox` rows are legacy-only: the unknown writer of that legacy table must not gain a second owner of the new ledger. Consent does not transfer through import; `inherited` provenance is permitted only for continuity of live personal records with the origin noted, and fresh consent capture is required for every new target purpose.

## 2. Property — stable physical asset (ADR-014 restricted set)

TS: `src/lib/contracts/property.ts`. The Property carries the restricted set: **exact address, latitude, longitude live here as restricted operational data and never appear in public revision shapes, buyer-visible read models, Qdrant projections, or Simon page context** (ADR-014). Public content (rooms, areas, amenities) lives on ListingRevision.

```python
class Property(BaseModel):
    property_id: str                       # opaque; buyer surfaces key on listing/revision ids
    organization_id: str                   # denormalized ownership (ADR-012)
    exact_address: str | None              # ADR-014: released only after an accepted viewing
    latitude: float | None                 # ADR-014: approximate pins derive from public fields only
    longitude: float | None
    verification_status: Literal["unverified", "verified"]  # import forces "unverified" (ADR-015)
    source: str | None                     # ingestion provenance
    external_id: str | None                # ingestion provenance; import dedupe key
    created_via: Literal["owner", "import"]
    created_at: datetime                   # imported rows: first-seen ingestion time, unverified provenance
    updated_at: datetime
```

| Field | Class | Note |
| --- | --- | --- |
| property_id | restricted | Opaque identity, carried for traceability; Qdrant is rebuilt, no id coupling |
| organization_id | restricted | Authority resolves through membership, never a bare user id |
| exact_address | restricted | ADR-014 |
| latitude / longitude | restricted | ADR-014 |
| verification_status | restricted | ADR-015 staging state |
| source / external_id | restricted | Ingestion provenance; import dedupe key |
| created_via | restricted | Provenance marker |
| created_at / updated_at | restricted | Age displays use `ListingRevision.published_at`, never these |

**Behavior.** Import initializes `verification_status='unverified'` regardless of any inherited `last_verified_at`. The inherited flat `created_at` lands here as first-seen ingestion time (unverified provenance only). Buyer-facing age displays derive from the published revision. Approximate pins are derived at render/index time from public area fields only. The import path is auditable end to end (ADR-015, brief §8): the import run and every row's staging decision write server-generated, append-only AuditRecords per the security doc's baseline — `actor_type='service'`, one import-run `request_id` for idempotency/correlation, and each record's `organization_id` — and the import never runs with the service-role key (§15).

## 3. Listing — commercial offer, buyer-facing lifecycle surface

TS: `src/lib/contracts/listing.ts`.

```python
# ADR-005 lifecycle vocabulary — shared by Listing (lifecycle_state) and
# ListingRevision (revision_state); transition maps in §4:
RevisionState = Literal["draft", "submitted", "changes_requested", "rejected",
                        "approved", "publishing", "published"]
ListingTerminalState = Literal["withdrawn", "closed"]
ListingLifecycleState = RevisionState | ListingTerminalState

class Listing(BaseModel):
    listing_id: str
    property_id: str                 # internal link to the asset record (restricted)
    organization_id: str
    listing_kind: str                # provisional: prototype-known sale/rent/shortlet; freezes Phase 1 via pg_enum audit
    lifecycle_state: ListingLifecycleState   # mirrors the working revision before first publication, then stays 'published' through correction cycles
    published_revision_id: str | None   # sole public authority; null before first publication
    created_via: Literal["owner", "import"]
    created_at: datetime            # imported rows: import-run timestamp (not the inherited value)
    updated_at: datetime
    withdrawn_at: datetime | None
    closed_at: datetime | None
```

| Field | Class | Note |
| --- | --- | --- |
| listing_id | public | The buyer-addressable entity (URLs, compare, save) |
| listing_kind | public | Offer identity; immutable per Listing; provisional vocabulary (prototype-known sale/rent/shortlet; enum list never obtained via REST — freezes Phase 1 via pg_enum audit) |
| lifecycle_state | public | Mirrors the working revision before first publication; once published, stays 'published' through any correction cycle until withdrawal/closure or the next atomic swap. Only PUBLISHED / WITHDRAWN / CLOSED are externally observable |
| published_revision_id | public | Set only at PUBLISHING→PUBLISHED (atomic swap); retained through WITHDRAWN/CLOSED |
| property_id / organization_id | restricted | Internal linkage; ADR-012 denormalized ownership |
| created_via / created_at / updated_at / withdrawn_at / closed_at | restricted | Provenance; imported listing created_at is the import-run time (the flat row cannot attest to listing creation) |

**Behavior.** `lifecycle_state` mirrors the working revision's pipeline state before first publication; once published it stays `'published'` through any correction cycle — a correction draft's pipeline progress never surfaces on the Listing, so previously published content stays live until the next PUBLISHING→PUBLISHED atomic swap — and it changes thereafter only via withdrawal/closure. Visibility gates on `lifecycle_state` after withdrawal/closure (pointer retained; Qdrant points removed or made unreachable). Transfer between organizations is an explicit, auditable operation moving property, listing, and revisions together (ADR-012). `CLOSED` is terminal: relisting is a new Listing on the same Property.

## 4. ListingRevision — immutable content snapshot (ADR-005)

TS: `src/lib/contracts/listing-revision.ts`. Lifecycle states are exactly ADR-005's, exported as `RevisionState`, `ListingTerminalState`, `ListingLifecycleState`, plus `RevisionTransitionMap` and `ListingTransitionMap` (type-level transition maps — see §10).

```python
# RevisionState / ListingTerminalState / ListingLifecycleState are defined in
# the section 3 Python block (one ADR-005 vocabulary, used by Listing and
# ListingRevision alike). The transition maps that constrain them are below.

class ListingRevision(BaseModel):
    revision_id: str
    listing_id: str
    organization_id: str
    base_revision_id: str | None       # published revision this draft corrects
    revision_state: RevisionState
    title: str
    description: str
    property_type: str                 # provisional; freezes Phase 1 via pg_enum audit
    property_subtype: str | None
    availability: str                  # provisional; 'available' is the only verified member
    price: Money
    price_period: str                  # provisional; prototype-known 'one_time'
    bedrooms: int | None
    bathrooms: int | None
    square_meters: float | None
    lot_size_sqm: float | None
    year_built: int | None
    floor_number: int | None
    total_floors: int | None
    plot_dimensions: str | None
    land_size_raw: str | None
    area: str                          # area-level only; per-row precision audited at import (ADR-014)
    city: str
    town: str | None
    county: str | None
    country: str
    amenities: list[str]               # owner-supplied, unverified until moderation
    furnished: bool | None
    created_by: str | None            # owning-org member; null for import rows
    created_via: Literal["owner", "import"]
    created_at: datetime
    updated_at: datetime
    published_at: datetime | None      # buyer-facing age displays derive from this
```

| Field | Class | Note |
| --- | --- | --- |
| revision_id / listing_id | public | revision_id surfaces only through the published pointer |
| organization_id / base_revision_id / revision_state / created_by / created_via / created_at / updated_at | restricted | Pipeline state and lineage; buyers resolve content via the pointer, never by reading revision_state |
| title, description, property_type, property_subtype, availability, price, price_period, bedrooms, bathrooms, square_meters, lot_size_sqm, year_built, floor_number, total_floors, plot_dimensions, land_size_raw, area, city, town, county, country, amenities, furnished, published_at | public | Public content derived from the published revision only; **never** address, latitude/longitude, or contact data (ADR-014) |

**Behavior.** A submitted revision is reviewed as a stable artifact; approved/published snapshots never change — every correction is a new DRAFT revision with `base_revision_id` = the published revision. Historical PUBLISHED revisions are immutable history, superseded only via the pointer. Public revisions carry area-level location only; the import precision audit moves any precise `location` text to `Property.exact_address` (restricted). `price_per_sqm` is derived at read time (`round(price / square_meters, 2)` when > 0), never stored, never migrated. Provisional vocabularies (`property_type`, `availability`, `price_period`) freeze in Phase 1 from the `pg_enum` audit; imported values pass through an audited mapping table and unmappable values stage as unverified content, never coerced.

## 5. ListingMedia — media records plus derived-evidence satellites (ADR-010)

TS: `src/lib/contracts/listing-media.ts`. Media attach to a **revision** (ordered by `position`), never to a bare property. Four shapes: `ListingMedia` (facts), `MediaObservation` (per-image derived AI evidence), `VisualDossier` (revision-level derived evidence), `EmbeddingProvenance` (restricted-operational provenance for the Qdrant embedding — projection bookkeeping, not derived evidence). AI observations are never media facts and never mix into verified fact shapes.

```python
class ListingMedia(BaseModel):
    media_id: str
    revision_id: str
    organization_id: str
    position: int
    kind: Literal["image", "video"]
    is_featured: bool
    source: Literal["owner_upload", "inherited_external"]
    inherited_url: str | None        # unverified external reference; never buyer-visible by row existence
    original_path: str | None        # private Supabase Storage original
    derivative_paths: list[str] | None   # safe derivatives; served only via published revision links
    processing_status: Literal["pending", "processing", "processed", "failed", "quarantined"]
    moderation_status: Literal["unreviewed", "approved", "rejected"]
    content_hash: str | None
    created_at: datetime

class VisualFeatures(BaseModel):
    feature_schema_version: int
    values: dict[str, Any]           # concrete schema freezes Phase 1 with the vision model choice

class MediaObservation(BaseModel):
    observation_id: str
    media_id: str
    observation_version: int          # regeneration = new version, never an edit
    caption: str | None
    room_classification: str | None
    visual_features: VisualFeatures | None
    quality_flags: list[str] | None
    analysis_model: str
    analysis_model_version: str       # model provenance (ADR-011)
    observed_at: datetime

class DossierRoomGroup(BaseModel):
    group_label: str
    media_ids: list[str]
    summary: str | None

class VisualDossier(BaseModel):
    dossier_id: str
    revision_id: str
    coverage_summary: str | None
    room_groups: list[DossierRoomGroup] | None
    dossier_version: int
    analysis_model: str
    analysis_model_version: str
    generated_at: datetime

class EmbeddingProvenance(BaseModel):   # restricted operational — projection provenance, not derived evidence
    embedding_id: str
    revision_id: str                # the revision whose buyer-safe document was embedded
    organization_id: str
    embedding_version: int          # re-embedding = new version, never an edit
    recipe_version: str            # document-assembly recipe: which revision fields / captions form the text
    content_hash: str              # hash of the exact assembled document text
    embedding_model: str           # distinct from the vision analysis_model on MediaObservation
    embedding_model_version: str
    vector_dimension: int           # pins the projection's vector space
    embedded_at: datetime
```

| Shape | Fields | Class |
| --- | --- | --- |
| ListingMedia | media_id, revision_id, position, kind, is_featured, derivative_paths | public |
| ListingMedia | organization_id, source, inherited_url, original_path, processing_status, moderation_status, content_hash, created_at | restricted |
| VisualFeatures, MediaObservation, DossierRoomGroup, VisualDossier | every field at every depth | derived-ai-evidence |
| EmbeddingProvenance | every field | restricted |

**Behavior.** Owner uploads (auth required, ADR-003) create `source='owner_upload'` records with private originals. Import creates `source='inherited_external'` records: the 12,748 external URLs are unverified references — fetch-and-validate (liveness, ownership, EXIF/location), then copy into private Storage, precede any derivative. Public derivatives appear only through a published, moderation-approved revision (security doc media control 6). Workers (deterministic, ADR-009) process, strip EXIF, generate observations, and emit outbox events. Rejected media never publishes. Withdrawal/closure makes derivatives unreachable. The dossier summarizes image evidence so the live agent never re-reads a pile of captions every turn.

The deterministic indexing worker (ADR-009), driven by the publication outbox, writes one `EmbeddingProvenance` record per projected revision, idempotently: it records the exact recipe behind every Qdrant point — embedded revision (the explicit revision reference the security doc requires of every projection), document-assembly recipe version, content hash, embedding model + version, and vector dimension — so a rebuilt Qdrant collection is reproducible. The inherited 4,258-point collection is unreproducible precisely because no recipe was recorded (brief §6/§8); this record is the fix. Re-embedding produces a new `embedding_version`, never an edit. Embedding provenance is operational metadata about the projection, never buyer-visible and never derived evidence.

## 6. OwnerOrganization — tenancy (ADR-012)

TS: `src/lib/contracts/organization.ts`. Four shapes: `OwnerOrganization`, `OrganizationMembership`, `PlatformRole` (flagged recommendation), `OrgContactCandidate` (migration staging).

```python
OrganizationKind = Literal["solo", "agency", "brokerage", "developer"]

class OwnerOrganization(BaseModel):
    organization_id: str
    display_name: str
    kind: OrganizationKind
    is_internal: bool                 # e.g. the auditable import-staging org; never buyer-visible
    public_bio: str | None
    avatar_url: str | None            # inherited external URLs re-enter storage before display
    is_verified: bool                 # forced false at import (ADR-015); inherited value is provenance only
    created_at: datetime
    updated_at: datetime

class OrganizationMembership(BaseModel):
    membership_id: str
    organization_id: str
    user_id: str                      # authority flows org -> membership -> user, never the reverse
    member_role: Literal["owner", "admin", "member"]
    created_at: datetime

class PlatformRole(BaseModel):        # FLAGGED RECOMMENDATION (see §14)
    platform_role_id: str
    user_id: str
    role: Literal["moderator", "admin"]
    created_at: datetime

class OrgContactCandidate(BaseModel): # migration staging; never buyer-visible, never revision content
    contact_id: str
    organization_id: str
    channel: Literal["email", "phone"]
    value: str
    display_name: str | None
    consent_id: str | None            # null: consent does not transfer through import
    source_column: str                # provenance label, e.g. "properties.public_contact_phone"
    staged_at: datetime
```

| Shape | Fields | Class |
| --- | --- | --- |
| OwnerOrganization | organization_id, display_name, kind, public_bio, avatar_url, is_verified | public |
| OwnerOrganization | is_internal, created_at, updated_at | restricted |
| OrganizationMembership | every field | restricted |
| PlatformRole | every field | restricted |
| OrgContactCandidate | contact_id, channel, value, display_name, consent_id | personal |
| OrgContactCandidate | organization_id, source_column, staged_at | restricted |

**Behavior.** Created at owner signup as a solo org (one member) or by an administrator. Import synthesizes one organization per inherited agent row (13 rows), default `kind='solo'`, with a userless pending membership claimable only through a verified invite; shared `agency_name` dedupe is a Phase 1 data-audit decision (default: no merging). `properties.agent_id` is nullable with an unmeasured null rate: inherited rows with a NULL or unresolvable `agent_id` stage under the internal import-staging organization (`is_internal`, never buyer-visible) pending owner claim — `organization_id` is never null, so tenancy and ADR-012 authority resolution hold for every staged row. `is_verified` is forced false at import (ADR-015) — the inherited badge is recorded as provenance, never migrated as a live badge. Org members read/write only their org's listings, drafts, media, requests. Buyers may see public org display fields. Listing transfer between organizations is an explicit auditable operation moving property, listing, and revisions together. Staged contact candidates become usable only after the owner claims the org and re-consents, and only under a still-pending publication policy; until then all buyer→owner contact routes through Handoff and ViewingRequest.

## 7. Moderation — case, decisions, pre-checks (ADR-013)

TS: `src/lib/contracts/moderation.ts`. Moderators are platform staff, never owner-org members.

```python
class ModerationCase(BaseModel):
    case_id: str
    case_kind: Literal["submission", "buyer_report", "staff_initiated"]
    revision_id: str | None          # submitted revision under review, or the published revision reported/reviewed
    listing_id: str
    organization_id: str
    case_state: Literal["open", "resolved"]
    report_category: str | None       # buyer_report only; vocabulary Phase 1
    report_note: str | None           # T&S evidence; personal-data handling in practice
    reporter_contact: VerifiedContact | None   # buyer_report only; requires reporter_consent when present
    reporter_consent: ConsentRecord | None     # required whenever reporter_contact is present; while null, contact is inert
    reference: str | None
    idempotency_key: str | None
    opened_at: datetime
    resolved_at: datetime | None
    created_at: datetime

class ModerationDecision(BaseModel):
    decision_id: str
    case_id: str
    revision_id: str | None
    organization_id: str
    decision: Literal["approve", "request_changes", "reject", "dismiss", "takedown"]
    decided_by: str                  # platform moderator auth user; fixes the inherited reviewer FK gap
    decided_at: datetime
    reason_code: str
    note: str | None                 # doubles as the change note when request_changes

class PreCheckResult(BaseModel):
    check_id: str
    case_id: str
    revision_id: str
    organization_id: str
    check_code: str                  # validator id
    outcome: Literal["pass", "fail", "warn"]
    detail_code: str | None
    checker_version: str
    ran_at: datetime
```

**Classification.** All fields of all three shapes are `restricted`, except `reporter_contact` and `reporter_consent` on ModerationCase, which are `personal`. Consent coupling: `reporter_consent` is required whenever `reporter_contact` is present — consent covering collection and any trust-and-safety follow-up is captured at intake (the inherited `property_reports.consent_at` was required). While `reporter_consent` is null the contact is inert: no moderator reply, clarification request, or contact attempt may use it.

**Behavior.** Cases are opened by the submit command (kind `'submission'`), buyer-report intake (kind `'buyer_report'`), or moderator intake (kind `'staff_initiated'`: a platform moderator proactively reviewing a published listing — the marketplace-target `suspend` capability, so takedown is never reachable only through a buyer report; `reporter_contact`/`reporter_consent` are null there). `approve` drives SUBMITTED→APPROVED; `request_changes` drives SUBMITTED→CHANGES_REQUESTED; `reject` drives SUBMITTED→REJECTED; `dismiss` closes a buyer_report or staff_initiated case without action; `takedown` forces PUBLISHED→WITHDRAWN on a buyer_report or staff_initiated case (a submission case targets a revision that has never published). Every decision writes an AuditRecord and emits the matching transition outbox event. Pre-checks are deterministic validators (ADR-013); they never approve or publish autonomously. Queue depth is visible (moderation capacity is the launch pacing constraint). Owners see outcomes plus change notes, never other orgs' cases; buyers never see cases.

## 8. ViewingRequest (ADR-016)

TS: `src/lib/contracts/viewing-request.ts`.

```python
class ViewingSlot(BaseModel):
    viewing_date: datetime           # explicit instant; no server-timezone dependency
    duration_minutes: int
    alternate_viewing_date: datetime | None
    mode: str                        # provisional ('in_person'/'virtual' known); Phase 1 freeze

class ViewingRequest(BaseModel):
    request_id: str                  # primary key — never keyed by phone
    listing_id: str                  # fixes the inherited missing FK; unresolvable orphans stay legacy-only
    organization_id: str
    actor_type: Literal["anonymous", "buyer"]
    requester_user_id: str | None
    requester_session_id: str | None # server-generated; not PII
    contact: VerifiedContact
    consent: ConsentRecord
    stated_purpose: str
    preferred_slot: ViewingSlot
    notes: str | None
    request_state: Literal["pending_contact_verification", "open", "accepted",
                           "declined", "expired", "completed", "cancelled"]
    address_disclosed_at: datetime | None   # ADR-014 disclosure provenance
    reference: str
    idempotency_key: str | None
    created_at: datetime
    updated_at: datetime
```

**Classification.** `request_state` and all routing/identity fields (request_id, listing_id, organization_id, actor_type, requester_user_id, requester_session_id, address_disclosed_at, reference, idempotency_key, created_at, updated_at) are `restricted`. The person-facing fields (contact, consent, stated_purpose, preferred_slot and every ViewingSlot field, notes) are `personal`. `ViewingSlot.mode` deliberately re-homes the brief's restricted-operational label for the inherited `scheduled_viewings.mode` column: as part of the requester's slot preference it is personal/consent-bound (the security doc lists viewing preferences among personal examples); both classes bar public exposure.

**Behavior.** Anonymous or authenticated buyers create under ADR-016 tight limits. Contact verification must complete before the request becomes owner-visible (`open`) — unverified contact cannot reach owners. Owning-org members accept or decline; acceptance discloses the exact address to that requester (audited) and books the slot; expiries are worker-managed. Lookups use request_id or the authenticated requester, never a raw phone scan. The inherited hardcoded `confirmed` status is abolished; `accepted` is the human-confirmed equivalent. The inherited 26 rows are legacy-only personal data under retention rules, not migrated as actionable requests.

## 9. Handoff — buyer-to-owner lead

TS: `src/lib/contracts/handoff.ts`.

```python
class Handoff(BaseModel):
    handoff_id: str
    listing_id: str | None           # null for general concierge handoffs
    viewing_request_id: str | None   # continuity after a viewing request
    organization_id: str | None     # null = platform concierge
    actor_type: Literal["anonymous", "buyer"]
    requester_user_id: str | None
    requester_session_id: str | None
    handoff_kind: Literal["general", "viewing", "listing"]   # verified legacy vocabulary
    message: str | None
    contact: VerifiedContact         # verified before routing to owners
    consent: ConsentRecord
    handoff_state: Literal["pending_contact_verification", "routed", "acknowledged", "closed", "expired"]
    reference: str                  # required: buyer follow-up needs a human-facing code
    idempotency_key: str | None
    created_at: datetime
    updated_at: datetime
```

**Classification.** `message`, `contact`, `consent` are `personal`; every other field is `restricted`.

**Behavior.** Created from the UI or Simon's `create_handoff` tool — a consequential action (contacts a person), so it requires explicit user confirmation, server-validated input, verified contact, rate limits, an audit record, and idempotency. Routed via outbox consumers (notifications/CRM); the owner org acknowledges or closes. Never carries restricted property data (ADR-014).

## 10. PageContext — typed transient intent (ADR-008)

TS: `src/lib/contracts/page-context.ts`.

```python
class SearchFilters(BaseModel):
    listing_kind: str | None
    property_type: str | None
    min_price: str | None            # decimal-string bounds (Money.amount semantics)
    max_price: str | None
    price_currency: str | None       # ISO 4217; server-validated — bounds never resolve against an implicit market default (ADR-001)
    min_bedrooms: int | None
    min_bathrooms: int | None
    city: str | None
    area: str | None
    amenities: list[str] | None
    sort: str | None                 # server-defined ordering; inherited created_at.desc not carried
    cursor: str | None

class ApproximateLocation(BaseModel):
    latitude: float
    longitude: float                 # the visitor's own consented location — never property location

class PageContext(BaseModel):
    contract_version: str
    sequence: int                     # monotonic per session
    route: str
    view_mode: Literal["search", "property_detail", "compare", "curated", "saved", "workspace", "other"]
    active_listing_id: str | None
    active_revision_id: str | None
    result_position: int | None
    result_count: int | None
    visible_listing_ids: list[str]   # bounded to the current page
    search_filters: SearchFilters | None
    compare_selection: list[str]     # bounded (<= 4)
    approximate_location: ApproximateLocation | None
```

**Classification.** Every field is `restricted` except `approximate_location` (and its two members), which is `personal`. Classification nuance: browser-supplied fields are operational intent, never published data, and are **untrusted until the server revalidates them** — the five-class union has no "untrusted" member, so the TSDoc in the TS file carries that rule; the class records state where the data lives (operational), not that it may be trusted.

**Behavior.** Created by the native client each relevant turn; read by Simon as intent only. The server revalidates every id and fact against Postgres (security doc trust rules); context is never persisted as authority and never substitutes for retrieval. Price bounds are currency-denominated (ADR-001): `min_price`/`max_price` compare against each revision's own `Money.currency` via exact-currency matching or explicit server-side conversion — never an implicit market default. `price_currency`, when present, is a server-validated ISO 4217 code fixing the bounds' denomination; when null, the server applies an explicit product-level default (KES at launch — a product default, not a schema constant). No restricted property field ever appears here (ADR-014). Browsing/search context is generous; chat turns remain rate-limited (ADR-016).

## 11. Publication, withdrawal, and correction behavior

**One ADR-005 machine, two carriers.** Pipeline states (DRAFT→SUBMITTED→{CHANGES_REQUESTED | REJECTED | APPROVED}→PUBLISHING→PUBLISHED) live per revision. WITHDRAWN and CLOSED are reachable only from PUBLISHED and live on the Listing; the Listing's `lifecycle_state` mirrors its working revision before first publication, then stays `'published'` through any correction cycle (a correction draft's pipeline progress never surfaces on the Listing) and carries those two terminal states. No other states exist; no state is renamed.

```text
DRAFT ──submit──▶ SUBMITTED ──request changes──▶ CHANGES_REQUESTED*   (owner continues on a new draft)
                    │ └──reject──▶ REJECTED*
                    └──approve──▶ APPROVED ──▶ PUBLISHING ──▶ PUBLISHED ──▶ WITHDRAWN ─(new draft → fresh review)─▶ …PUBLISHED
                                                                └───────▶ CLOSED (terminal; relist = new Listing)
* terminal for that revision artifact
```

Type-level transition maps (exported from `listing-revision.ts`):

```ts
export type RevisionTransitionMap = {
  readonly draft: readonly ['submitted'];
  readonly submitted: readonly ['approved', 'changes_requested', 'rejected'];
  readonly changes_requested: readonly [];
  readonly rejected: readonly [];
  readonly approved: readonly ['publishing'];
  readonly publishing: readonly ['published'];
  readonly published: readonly [];
};
export type ListingTransitionMap = {
  readonly published: readonly ['withdrawn', 'closed'];
  readonly withdrawn: readonly [];
  readonly closed: readonly [];
};
```

**Pointer rule.** `listing.published_revision_id` is the sole public authority. It is set only at PUBLISHING→PUBLISHED (atomic swap) and is retained through WITHDRAWN/CLOSED — visibility then gates on `lifecycle_state`, and Qdrant points are removed or made unreachable (security doc).

| Transition (who) | Pointer | Outbox events | Buyer view |
| --- | --- | --- | --- |
| DRAFT→SUBMITTED (owner) | unchanged | `listing_revision.submitted`, `moderation.case_opened` | none; previously published content stays live |
| pre-checks (worker) | unchanged | `moderation.prechecks_completed` | none |
| SUBMITTED→CHANGES_REQUESTED (moderator) | unchanged | `listing_revision.changes_requested` | none |
| SUBMITTED→REJECTED (moderator) | unchanged | `listing_revision.rejected` | none |
| SUBMITTED→APPROVED (moderator) | unchanged | `listing_revision.approved` | none |
| APPROVED→PUBLISHING (worker) | unchanged | `listing_revision.publishing` (media/index readiness jobs) | old content live |
| PUBLISHING→PUBLISHED (worker) | **set to this revision** | `listing.published` (Qdrant upsert, cache refresh, notifications) | new content live; prior revision immutable history |
| PUBLISHED→WITHDRAWN (owner; moderator `takedown`) | retained, visibility off | `listing.withdrawn` (Qdrant removal, cache purge, derivatives unreachable) | absent; detail shows unavailable |
| PUBLISHED→CLOSED (owner) | retained, visibility off | `listing.closed` (same consumers) | absent; closed notice |

**Correction.** A price, description, availability, or media change on a published listing creates a new DRAFT revision (`base_revision_id` = published revision) and re-enters the pipeline; buyers see the old approved revision until the atomic swap — never a blank or half-updated listing. The Listing's `lifecycle_state` stays `'published'` throughout the correction cycle; the new draft's pipeline progress surfaces only on the revision, never on the Listing. Media changes are revision-level: a new revision references the new media set.

**Withdrawal re-entry (flagged):** ADR-005 draws no edge out of WITHDRAWN; recommended reading — re-entry is a new draft → SUBMITTED → fresh human review → PUBLISHED. **CLOSED** has no exit; relisting is a new Listing on the same Property.

All publication, withdrawal, booking, and import-staging state changes are deterministic workers or audited domain commands — never agent-initiated (ADR-009). Import staging additionally writes an AuditRecord per run and per staged row (§2).

## 12. Placement rationale — synthesis of the two drafts

Two independent drafts (A: target-first, B: migration-first) were merged. Where they disagreed, the resolution and its winner:

1. **`created_at` semantics on the flat row — B wins for Listing/Revision; A's `created_via` marker adopted.** A flat row cannot distinguish property creation, listing creation, and ingestion time. Resolution: the inherited value lands on `Property.created_at` as first-seen ingestion time (unverified provenance); `Listing.created_at` and revision timestamps on imported records are import-run timestamps. Both drafts agree buyer-facing age displays derive from `Revision.published_at`. A's `created_via='owner' | 'import'` provenance marker is adopted on Property, Listing, and ListingRevision — it makes the staging posture explicit per record. B's flag is kept: the prototype's `created_at.desc` browse ordering is not carried forward; target ordering is server-defined.

2. **`public_contact_*` fields — B wins for the migration path; A wins for the contract shape.** The four fields have no listing-content home. Resolution: no public contact field exists in any buyer-visible shape or revision (A's contract stance); the values stage as `OrgContactCandidate` on the import-synthesized org (B's staging stance) — personal/consent-bound, restricted until re-consent and a still-pending publication policy. `public_contact_consent_at` is legacy-only: consent does not transfer through an import and nothing is grandfathered. If a publication policy ever permits displayed contact, it enters as a consent-gated org profile field under an explicit Phase 0+ owner decision — flagged, not decided.

3. **`price_per_sqm` — both agree; B's derivation rule adopted verbatim.** Dropped as a stored field everywhere. Derived at read time as `round(price / square_meters, 2)` when both present and > 0, matching the prototype's in-memory dataclass derivation and making disagreement with the revision's own price and size impossible by construction. Inherited stored values are never migrated or trusted. If price-per-sqm sorting is ever needed, it becomes a derived cache recomputed by the deterministic worker on PUBLISHING→PUBLISHED — never owner-writable, never inherited.

4. **`agents` → organizations — B wins on `is_verified`; both agree on per-row org synthesis.** One organization per inherited agent row (13), default `kind='solo'`, with a userless pending membership claimable through a verified invite; `properties.agent_id` resolves to `Listing.organization_id` through the recorded agent→org mapping; the bare-agent FK dies with the tenancy gap. Where they disagreed: A mapped the inherited `is_verified` badge onto the org's live `is_verified` field; B forced it false at import. **B wins**: ADR-015 grandfathers nothing, and a trust badge is a publication-adjacent claim — the inherited value is recorded as import provenance only, and the badge is re-earned through the target's own verification workflow. Both flag the shared-`agency_name` dedupe question as a Phase 1 data-audit decision (default: no merging).

5. **`status` vs `marketplace_status` — both agree; drop both as authority.** `status` survives conceptually as `ListingRevision.availability` (public content; `available` the only verified member, vocabulary frozen Phase 1). `marketplace_status` (free text, unmeasurable) is dropped: superseded by the ADR-005 lifecycle. The import maps no publication decision from either column; every row starts DRAFT/unverified regardless of values. B's operational flags ride the backlog: the unseen `marketplace_status` writer (a live default or trigger the legacy insert path depends on) must be identified before any legacy-table change, and the enum vocabularies freeze after the `pg_enum` audit.

6. **Page-context classification — A's "untrusted" class resolved into the five-class union.** A used a non-standard "Untrusted" class label. Resolution: browser-supplied intent fields are classed `restricted` (operational, never published) with the untrusted/revalidate rule carried in TSDoc and behavior notes; `approximate_location` is `personal` (the visitor's own consented, revocable location — never property location).

7. **Staff modeling — A's platform-role recommendation adopted, flagged.** Moderator/administrator authority is a separate `PlatformRole` assignment, not org membership, so moderation cannot inherit owner-org privileges. Whether staff instead form an internal organization is a Phase 1 decision.

8. **Viewing/handoff shapes — A's full contract tables adopted; B's consent-transfer rule merged.** A supplied the complete field tables (verified-contact gate, stated purpose, disclosure provenance, reference-required handoff). B's rule is merged: inherited `consent_at` values may map to `ConsentRecord` with `provenance='inherited'` only for continuity of live personal records; token-flow and contact-display consents do not transfer.

## 13. Appendix A — inherited-column disposition (129 marketplace-relevant columns)

Row posture: under ADR-015 no inherited row is grandfathered — every mapped value arrives unverified; mapped ≠ publishable. Disposition labels: **Mapped** (target field), **Replaced-by** (target concept), **Legacy-only** (stays in staging, not migrated), **Dropped** (with reason). Column counts follow the brief's per-table lists: properties 43, property_images 6, agents 11, scheduled_viewings 18, property_inquiries 15, property_submissions 17, property_moderation_events 8, property_reports 11 — 129 total.

### properties (43)

| Inherited column | Disposition | Home / reason |
| --- | --- | --- |
| id | Mapped | `Property.property_id` (carried for traceability; Qdrant is rebuilt, so no id coupling) |
| title / description | Mapped | `ListingRevision.title` / `.description` |
| property_type | Mapped | `ListingRevision.property_type` (public content; vocabulary frozen Phase 1 via `pg_enum`) |
| listing_type | Mapped | `Listing.listing_kind` (provisional vocabulary: prototype-known sale/rent/shortlet; the enum list was never obtainable through REST — freezes Phase 1 via the `pg_enum` audit; unmappable values stage as unverified content through the audited mapping table, never coerced; a kind change is a new Listing) |
| status | Replaced-by | Split: lifecycle → ADR-005 states; buyer-visible availability → `ListingRevision.availability` (only verified member `available`; vocabulary frozen Phase 1) |
| price / currency | Mapped | `ListingRevision.price` (Money: amount string + currency code) — currency never written by the prototype → unverified |
| price_per_sqm | Dropped | Derived-only (§12.3): recompute `round(price / square_meters, 2)`; stored value unverifiable and drift-prone |
| bedrooms / bathrooms / square_meters / lot_size_sqm | Mapped | `ListingRevision` (public physical facts on revisions; public content derives from the published revision only) |
| year_built / floor_number / total_floors / plot_dimensions / land_size_raw / property_subtype | Mapped | `ListingRevision` (same rule) |
| price_period | Mapped | `ListingRevision.price_period` (provisional; prototype-known `one_time`; frozen Phase 1) |
| location | Mapped | `ListingRevision.area` — precision audit at import (ADR-014): precise values move to `Property.exact_address`, area-level value stays |
| city / town / county / country | Mapped | `ListingRevision.city` / `.town` / `.county` / `.country` |
| latitude / longitude | Mapped | `Property.latitude` / `.longitude` — restricted; never in revisions, read models, Qdrant, or Simon context |
| amenities / furnished | Mapped | `ListingRevision.amenities` / `.furnished` (owner-supplied, unverified until moderation) |
| video_url | Replaced-by | `ListingMedia` (`kind='video'`); inherited external URL imports as unverified `inherited_url`, never a public revision field |
| source / external_id | Mapped | `Property.source` / `.external_id` (ingestion provenance; import dedupe key) |
| created_at | Mapped | `Property.created_at` **and** `created_via='import'` (first-seen ingestion time; Listing/Revision created_at are import-run timestamps — §12.1) |
| updated_at | Legacy-only | Row-mutation timestamp has no single target home; targets keep per-record timestamps + revision lineage |
| address | Mapped | `Property.exact_address` — restricted (ADR-014) |
| agent_id | Replaced-by | `Listing.organization_id` via synthesized organizations (§12.4); NULL or unresolvable agent_id stages under the internal import-staging organization (never buyer-visible) pending owner claim — organization_id is never null; the bare-agent FK is dropped |
| marketplace_status | Dropped | Free-text visibility vocabulary, unmeasurable and untrusted; superseded by ADR-005 `lifecycle_state`. Unseen-writer identification rides the backlog before any legacy-table change |
| last_verified_at | Legacy-only | Evidence of a prior verification workflow; import initializes `verification_status='unverified'` regardless |
| public_contact_name / _phone / _email / _method | Replaced-by | No listing-content home: stage as `OrgContactCandidate` on the import-synthesized org (personal/consent-bound, restricted until re-consent + publication policy — §12.2); all buyer→owner contact is platform-mediated via Handoff/ViewingRequest |
| public_contact_consent_at | Legacy-only | Consent does not transfer through import |

### property_images (6) — 12,748 external URLs import as unverified references; nothing becomes buyer-visible merely because a row points at it

| Inherited column | Disposition | Home / reason |
| --- | --- | --- |
| id | Mapped | `ListingMedia.media_id` |
| property_id | Replaced-by | `ListingMedia.revision_id` (media attach to revisions; import resolves property → listing → initial revision) |
| url | Mapped | `ListingMedia.inherited_url` (`source='inherited_external'`); after fetch-validate-EXIF-copy → `original_path`, then derivatives after moderation |
| sort_order | Mapped | `ListingMedia.position` |
| is_featured | Mapped | `ListingMedia.is_featured` |
| created_at | Mapped | `ListingMedia.created_at` (unverified provenance) |

### agents (11) — 13 rows synthesize organizations; rows are legacy-only as identity records

| Inherited column | Disposition | Home / reason |
| --- | --- | --- |
| id | Replaced-by | `OwnerOrganization.organization_id` (synthesized at import; mapping retained as provenance) |
| first_name / last_name | Mapped | Composed into `display_name` for solo orgs; person identity lives in Auth + membership, not on the org |
| email / phone | Replaced-by | Stage as `OrgContactCandidate` under the consent-reset rule (§12.2); personal/consent-bound, never public without fresh consent |
| agency_name | Mapped | `display_name` with `kind='agency'` where the row represents an agency (dedupe policy flagged, §12.4) |
| bio | Mapped | `public_bio` (org profile policy flagged Phase 0, §14) |
| is_verified | Mapped | Recorded as import provenance only; live `is_verified` forced false at import (ADR-015 — §12.4) |
| avatar_url | Mapped | `avatar_url`, with the unverified-external-URL caveat — re-enter the storage pipeline before display |
| created_at | Mapped | `created_at` (unverified provenance) |
| updated_at | Legacy-only | Target regenerates |

### scheduled_viewings (18) — 26 rows legacy-only (personal data, retention rules); columns map to the contract shape

| Inherited column | Disposition | Home / reason |
| --- | --- | --- |
| id | Mapped | `ViewingRequest.request_id` |
| property_id | Replaced-by | `ViewingRequest.listing_id` (fixes the missing FK; unresolvable orphans stay legacy-only) |
| customer_phone / customer_email / customer_name / preferred_contact_method | Mapped | `ViewingRequest.contact.*` — fields, never lookup keys |
| viewing_date / duration_minutes / alternate_viewing_date / mode | Mapped | `ViewingRequest.preferred_slot.*` (mode vocabulary frozen Phase 1; deliberately re-homed from the brief's restricted-operational label to personal as the requester's viewing preference — §8) |
| status | Replaced-by | `request_state` (`confirmed` ≈ `accepted`; auto-confirmed abolished) |
| notes | Mapped | `ViewingRequest.notes` |
| consent_at | Mapped | `ViewingRequest.consent` with `provenance='inherited'` — continuity of live records only (§12.8) |
| request_state | Replaced-by | Single `request_state` machine (two overlapping status columns collapse) |
| reference / idempotency_key | Mapped | `ViewingRequest.reference` / `.idempotency_key` |
| created_at / updated_at | Mapped | `ViewingRequest.created_at` / `.updated_at` |

### property_inquiries (15) — 0 rows; pure shape mapping to Handoff

| Inherited column | Disposition | Home / reason |
| --- | --- | --- |
| id | Mapped | `Handoff.handoff_id` |
| customer_phone / customer_email / customer_name / preferred_contact_method | Mapped | `Handoff.contact.*` |
| property_id | Replaced-by | `Handoff.listing_id` (fixes the missing FK) |
| inquiry_type | Mapped | `Handoff.handoff_kind` ('general'/'viewing'/'listing' — verified vocabulary) |
| message | Mapped | `Handoff.message` |
| agent_id | Replaced-by | `Handoff.organization_id` (routing org) |
| metadata | Legacy-only | jsonb never inspected; no home until the content audit runs |
| consent_at | Mapped | `Handoff.consent` with inherited-provenance caveat |
| request_state | Replaced-by | `handoff_state` |
| reference / idempotency_key | Mapped | `Handoff.reference` / `.idempotency_key` |
| created_at | Mapped | `Handoff.created_at` |

### property_submissions (17) — 1 row legacy-only ("evidence of intent, not a contract"); the pre-auth status-token flow is replaced wholesale

| Inherited column | Disposition | Home / reason |
| --- | --- | --- |
| id / property_id / status | Replaced-by | `ModerationCase` (kind='submission') + `ListingRevision.revision_state`; reviews target revisions, not flat rows |
| submitter_name / _phone / _email / preferred_contact_method | Dropped | Pre-auth intake; target submissions are authenticated owner actions — identity comes from membership and the audit record |
| consent_at | Dropped | Token-flow consent does not transfer; owners are authenticated |
| status_token_hash / _expires_at / _revoked_at | Dropped | Pre-auth anonymous status-check mechanism; secret-adjacent and never migrated; status visibility is the authenticated owner workspace |
| idempotency_key | Replaced-by | Command idempotency via `AuditRecord.request_id` |
| decision_reason / requested_change_note | Mapped | `ModerationDecision.reason_code` / `.note` |
| last_verified_at | Legacy-only | As with properties |
| created_at / updated_at | Legacy-only | Replaced by `opened_at`/`decided_at` |

### property_moderation_events (8) — 0 rows; shape maps to decision + audit records

| Inherited column | Disposition | Home / reason |
| --- | --- | --- |
| id | Replaced-by | `ModerationDecision.decision_id` |
| submission_id | Replaced-by | `ModerationDecision.case_id` |
| from_status / to_status | Replaced-by | Transition captured in `AuditRecord.action`/`outcome` + the decision record |
| reason / requested_change_note | Mapped | `ModerationDecision.reason_code` / `.note` |
| reviewer_id | Replaced-by | `ModerationDecision.decided_by` — tied to an Auth user + platform role (fixes the missing-FK reviewer) |
| created_at | Mapped | `ModerationDecision.decided_at` |

### property_reports (11) — 0 rows; trust-and-safety intake maps to the report case

| Inherited column | Disposition | Home / reason |
| --- | --- | --- |
| id | Mapped | `ModerationCase.case_id` (kind='buyer_report') |
| property_id | Replaced-by | `case.listing_id` + published `revision_id` (reports target the listing) |
| category / note | Mapped | `report_category` (vocabulary Phase 1) / `report_note` |
| reporter_name / _phone / _email | Mapped | `reporter_contact.*` (personal) |
| consent_at | Mapped | `reporter_consent` with inherited-provenance caveat; when `reporter_contact` is present, consent covering collection and any T&S follow-up is required at intake — while consent is null the contact is inert (§7) |
| reference / idempotency_key | Mapped | `case.reference` / command idempotency |
| created_at | Mapped | `opened_at` |

## 14. Appendix B — out of marketplace migration scope

Seven concierge/infrastructure tables (per the brief, pending open question 9): `conversation_messages` (8 cols), `conversation_summaries` (5), `customer_profiles` (7), `bot_settings` (5), `request_outbox` (7), `mpesa_transactions` (10), `schema_migrations` (3). All are WhatsApp/M-Pesa/infrastructure artifacts; several carry personal data with no retention policy — retention rules by data category are required before broad collection continues. Two notes: the target adopts the *outbox pattern* as `OutboxEvent`, but the inherited `request_outbox` rows are legacy-only and the unknown writer must not gain a second owner of the new ledger; `schema_migrations` ownership must be identified before any LUXONN migration lands.

## 15. What the target needs that the inherited schema lacks

Supabase Auth linkage (no accounts are verifiable); organizations and membership (ADR-012 tenancy gap); the revision model and immutable history (one flat table today); the published-revision pointer; a transactional outbox (the 4,258-vs-4,259 Qdrant drift is direct evidence there is no sync mechanism); the verified-contact step (viewings are keyed by raw phone with a hardcoded `confirmed`); command idempotency + the audit record baseline; reviewer identity tied to auth (the inherited `reviewer_id` has no FK); the storage-backed media lifecycle (zero buckets; 12,748 external URLs; no upload/validation/EXIF/derivative path anywhere); per-image AI observations and the visual dossier as separated derived evidence; embedding provenance for the Qdrant projection — the inherited 4,258-point collection's recipe is unrecorded, so no point is reproducible (ADR-010, §5); withdrawal/closure states; staging/verification state for imports (ADR-015); RLS and any authorization boundary (the prototype holds a service-role key process-globally — the import path must not); and the typed page-context contract.

## 16. Open tensions awaiting owner review

Each item below is a flagged recommendation, not a silent choice:

1. **WITHDRAWN re-entry (recommendation: fresh review).** ADR-005 draws no edge out of WITHDRAWN. Recommended reading: re-entry is a new draft → SUBMITTED → fresh human review → PUBLISHED. CLOSED has no exit; relisting is a new Listing on the same Property.
2. **Organization public-profile policy (Phase 0).** Whether orgs display `public_bio`, avatars, and any contact field to buyers. The contract exposes `public_bio`/`avatar_url` as public org fields; displayed *contact* requires the re-consent + publication-policy path (§12.2) and is not decided.
3. **Staff modeling (recommendation: platform roles).** `PlatformRole` is the recommended shape so moderation cannot inherit owner-org privileges; whether staff instead form an internal organization is a Phase 1 decision.
4. **Agents dedupe (Phase 1 data-audit decision).** Agent rows sharing `agency_name`/email may belong in one multi-member org — it changes who may claim. Default: no merging.
5. **Consent transfer (recommendation, partially open).** Inherited `consent_at` on viewings/inquiries/reports may map to `ConsentRecord` with `provenance='inherited'` for continuity of live records; contact-display and token-flow consents do not transfer. Fresh consent capture is required for every new target purpose.
6. **Vocabulary freezes (Phase 1, blocked on database access).** `Availability`, `PricePeriod`, `PropertyType`, `ListingKind`, and the viewings `mode` vocabulary are provisional open unions in the TS contracts; each freezes when the `pg_enum` and text-status audits run. For `ListingKind` the prototype-known members are sale/rent/shortlet — the inherited `listing_type` enum list was never obtained through REST (brief: "vocabulary known only from code"). Unmappable inherited values stage as unverified content, never coerced.
7. **Structural flags riding the backlog.** Identification of the unseen `marketplace_status` writer before any legacy-table change; Qdrant payload-key inspection before the legacy collection is decommissioned; the `rls_auto_enable` body plus actual RLS state before authorization tests are written; the `location` per-row precision audit at import. None of these can change a home or disposition assigned above — they can only complete a frozen literal list.
