# Schema and authorization discovery brief — 2026-10-11

This is the first implementation task defined in the [implementation sequence](implementation-sequence.md): inventory the inherited Supabase objects, authorization state, current property record fields, media storage state, and migration constraints without exposing credentials or production data. It applies the field classification from [security and data boundaries](../architecture/security-data-boundaries.md), the postures of ADR-012 through ADR-016 in the [decision log](../architecture/decisions.md), and the target model in [target marketplace architecture](../architecture/marketplace-target.md). It feeds Phase 0 contracts work in the [roadmap](marketplace-roadmap.md); it contains no target DDL.

## 1. Purpose, method, and scope

### Purpose

Establish, from evidence, what the inherited Supabase project actually contains and who can reach it, so that the flat-to-revisioned migration, RLS work, and Phase 0 field contracts start from verified facts rather than assumptions. Under [ADR-015](../architecture/decisions.md) the inherited data is prototype material: this brief describes it, and classifies it, without treating any row as publishable inventory.

### Method

All findings come from three read-only probes run on 2026-10-11 through the simon companion repository's own environment (`../simon`, per [current state](../architecture/current-state.md)):

1. **Schema probe.** Fetched the PostgREST OpenAPI document at `GET {supabase_url}/rest/v1/` using the key configured in simon's settings, loaded in-process (values never printed; no environment file was ever opened). The document is authoritative for what REST exposes. Per-table row counts were obtained with `GET {table}?select=<id-or-first-required-column>&limit=0` plus `Prefer: count=exact`, reading only the `content-range` response header; response bodies were never read.
2. **Simon source analysis.** Static read-only analysis of the prototype's committed Python (catalog, records, tools, meaning, pool, settings, app). No database, network, or environment access; nothing in the simon repository was created or modified.
3. **Live access probe.** Key class/role determination, Supabase Storage bucket listing (`GET /storage/v1/bucket`), and Qdrant collection metadata plus an exact point count. Only `GET`/`HEAD` requests were issued, with a single documented exception: the pure-read `POST {qdrant_url}/collections/properties/points/count` with body exactly `{"exact": true}`.

Probe scripts were written only under `/tmp` (`/tmp/luxonn_schema_probe.py`, output `/tmp/luxonn_schema_probe_output.json`; both ephemeral). Nothing was mutated anywhere: no row, storage object, or Qdrant point was created, changed, or deleted, and no row-level production data was read, stored, or printed.

The configured key's class, from the live probe: it is a **legacy-format JWT whose role claim is `service_role`**. Only the token's class and role claim were recorded; the token itself was never printed, copied, or stored.

### What was not probed, and why

- **No direct Postgres connection.** `SUPABASE_DB_PASSWORD` does not exist in this environment ([open questions](open-questions.md), item 7), and `postgres_dsn` is not defined in simon's settings — so catalog-level facts (RLS policies, triggers, function bodies, defaults, the `auth` schema, table owners) are unreachable. They are listed in section 9.
- **No RLS observation.** The configured key's `service_role` claim bypasses RLS, so REST probes cannot see whether policies exist or what they do.
- **No anon-key behavior.** Only the key configured in the simon environment was available; whether a project anon key exists and what it can read is untested. Current true public exposure is therefore unknown.
- **No row-level data.** Counts came from `content-range` headers; the one body that had to be fetched (the OpenAPI document) contributed structure only. No media URL was fetched and no Qdrant payload was read.
- **No environment file contents.** `Simon.env` and `.env*` files were never opened; the probes imported the settings module so values loaded in-process.

## 2. Inherited database inventory

The OpenAPI document is titled "standard public schema": everything exposed lives in the `public` schema. It exposes **15 relations and 1 RPC function**. Beyond the five tables the Simon prototype touches, the API also exposes a moderation intake pair (`property_submissions`, `property_moderation_events`), a report intake, a WhatsApp concierge suite (`conversation_messages`, `conversation_summaries`, `customer_profiles`, `bot_settings`, `request_outbox`, `mpesa_transactions`), and `schema_migrations`.

Reading notes for every table below:

- **Required** means membership in the OpenAPI required list, which PostgREST derives from NOT NULL constraints. It does not reveal database defaults — a NOT NULL column with a default still appears required — so insert semantics cannot be read from the API alone.
- **jsonb** columns surface as OpenAPI type `unknown` (Swagger 2.0 carries no type for jsonb; the format field names it). Their contents were not inspected.
- **Enum-typed** columns surface their Postgres enum format (for example `public.property_status`); the enum value lists were not obtainable through REST.
- **Row counts** come from `content-range` headers via `Prefer: count=exact`; bodies were discarded.

### Summary

| Relation | Rows | Purpose in the inherited system | Simon prototype |
| --- | --- | --- | --- |
| properties | 4,259 | Flat prototype property/listing record | reads + inserts |
| property_images | 12,748 | Gallery image URLs per property | reads |
| agents | 13 | Agent profiles referenced by `properties.agent_id` | reads |
| scheduled_viewings | 26 | Viewing bookings keyed by customer phone | reads + inserts |
| property_inquiries | 0 | Leads and general inquiries | inserts only |
| property_submissions | 1 | Listing submission and status-token moderation intake | untouched |
| property_moderation_events | 0 | Moderation decision audit events | untouched |
| property_reports | 0 | Visitor property reports (trust-and-safety intake) | untouched |
| conversation_messages | 142 | WhatsApp concierge transcripts | untouched |
| conversation_summaries | 0 | Per-conversation generated summaries | untouched |
| customer_profiles | 30 | WhatsApp customer preference profiles | untouched |
| bot_settings | 0 | Bot key/value configuration | untouched |
| request_outbox | 1 | Outbound request delivery outbox | untouched |
| mpesa_transactions | 1 | M-Pesa payment tracking | untouched |
| schema_migrations | 2 | Applied-migration ledger | untouched |

Ten of the fifteen relations are never referenced by the prototype's source, and six of them carry rows (`conversation_messages`, `customer_profiles`, `property_submissions`, `request_outbox`, `mpesa_transactions`, `schema_migrations`). Something outside the simon repository writes those rows (most plausibly a WhatsApp integration, an M-Pesa callback worker, and migration tooling); its identity, deployment, and credentials are unknown. This is an access observation (section 7) and a migration risk (section 8).

### properties — 4,259 rows

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| id | string (uuid) | yes | Primary key |
| title | string (text) | yes | |
| description | string (text) | yes | |
| property_type | string (`public.property_type`) | yes | Enum type |
| listing_type | string (`public.listing_type`) | yes | Enum type |
| status | string (`public.property_status`) | yes | Enum type |
| price | number (numeric) | yes | |
| currency | string (text) | yes | Never written by the prototype |
| price_per_sqm | number (numeric) | no | Name implies a stored price ÷ square_meters value; inference from the column name, contents unverified |
| bedrooms | integer | no | |
| bathrooms | integer | no | |
| square_meters | number (numeric) | no | |
| lot_size_sqm | number (numeric) | no | |
| year_built | integer | no | |
| floor_number | integer | no | |
| total_floors | integer | no | |
| location | string (text) | yes | Area-style free text; per-row precision unverified |
| city | string (text) | yes | |
| county | string (text) | no | |
| latitude | number (numeric) | no | Precise location — ADR-014 |
| longitude | number (numeric) | no | Precise location — ADR-014 |
| amenities | array (text[]) | no | |
| furnished | boolean | no | |
| video_url | string (text) | no | External URL |
| source | string (text) | no | Ingestion provenance |
| external_id | string (text) | no | Ingestion provenance |
| created_at | string (timestamptz) | yes | |
| updated_at | string (timestamptz) | yes | |
| property_subtype | string (text) | no | |
| price_period | string (`public.price_period`) | yes | Enum type |
| address | string (text) | no | Precise address — ADR-014 |
| town | string (text) | no | |
| country | string (text) | yes | |
| plot_dimensions | string (text) | no | |
| land_size_raw | string (text) | no | |
| agent_id | string (uuid) | no | Foreign key → `agents.id` |
| marketplace_status | string (text) | yes | Plain text; vocabulary unknown |
| last_verified_at | string (timestamptz) | no | Verification workflow state |
| public_contact_name | string (text) | no | Contact data |
| public_contact_phone | string (text) | no | Contact data |
| public_contact_email | string (text) | no | Contact data |
| public_contact_method | string (text) | no | Contact data |
| public_contact_consent_at | string (timestamptz) | no | Consent record |

### property_images — 12,748 rows

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| id | string (uuid) | yes | Primary key |
| property_id | string (uuid) | yes | Foreign key → `properties.id` |
| url | string (text) | yes | Complete external URL; no bucket-path handling anywhere |
| sort_order | integer | yes | |
| is_featured | boolean | yes | |
| created_at | string (timestamptz) | yes | |

### agents — 13 rows

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| id | string (uuid) | yes | Primary key |
| first_name | string (text) | yes | |
| last_name | string (text) | no | |
| email | string (text) | no | Contact data |
| phone | string (text) | no | Contact data |
| agency_name | string (text) | no | |
| bio | string (text) | no | |
| is_verified | boolean | yes | |
| avatar_url | string (text) | no | External URL |
| created_at | string (timestamptz) | yes | |
| updated_at | string (timestamptz) | yes | |

### scheduled_viewings — 26 rows

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| id | string (uuid) | yes | Primary key |
| property_id | string (uuid) | no | No declared foreign key (referential gap) |
| customer_phone | string (text) | no | Contact data |
| customer_name | string (text) | no | Personal identifier |
| viewing_date | string (timestamptz) | yes | |
| duration_minutes | integer | yes | |
| status | string (text) | yes | Plain text; prototype writes `confirmed` |
| notes | string (text) | no | Free text, may contain personal details |
| created_at | string (timestamptz) | yes | |
| updated_at | string (timestamptz) | yes | |
| customer_email | string (text) | no | Contact data |
| alternate_viewing_date | string (timestamptz) | no | |
| preferred_contact_method | string (text) | no | Contact data |
| mode | string (text) | no | |
| consent_at | string (timestamptz) | no | Consent record |
| request_state | string (text) | yes | Workflow state |
| reference | string (text) | no | |
| idempotency_key | string (text) | no | |

### property_inquiries — 0 rows

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| id | string (uuid) | yes | Primary key |
| customer_phone | string (text) | no | Contact data |
| property_id | string (uuid) | no | No declared foreign key (referential gap) |
| inquiry_type | string (text) | yes | Prototype default `general` |
| message | string (text) | no | Free text |
| metadata | unknown (jsonb) | yes | Contents not inspected |
| created_at | string (timestamptz) | yes | |
| customer_name | string (text) | no | Personal identifier |
| customer_email | string (text) | no | Contact data |
| agent_id | string (uuid) | no | Foreign key → `agents.id` |
| preferred_contact_method | string (text) | no | Contact data |
| consent_at | string (timestamptz) | no | Consent record |
| request_state | string (text) | yes | Workflow state |
| reference | string (text) | no | |
| idempotency_key | string (text) | no | |

### property_submissions — 1 row

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| id | string (uuid) | yes | Primary key |
| property_id | string (uuid) | yes | Foreign key → `properties.id` |
| status | string (text) | yes | Moderation workflow state |
| submitter_name | string (text) | yes | Personal identifier |
| submitter_phone | string (text) | no | Contact data |
| submitter_email | string (text) | no | Contact data |
| preferred_contact_method | string (text) | no | Contact data |
| consent_at | string (timestamptz) | yes | Consent record |
| status_token_hash | string (text) | yes | Stored credential verifier (see section 3) |
| status_token_expires_at | string (timestamptz) | no | |
| status_token_revoked_at | string (timestamptz) | no | |
| idempotency_key | string (text) | yes | |
| decision_reason | string (text) | no | Moderation evidence |
| requested_change_note | string (text) | no | Moderation evidence |
| last_verified_at | string (timestamptz) | no | |
| created_at | string (timestamptz) | yes | |
| updated_at | string (timestamptz) | yes | |

### property_moderation_events — 0 rows

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| id | integer (bigint) | yes | Primary key |
| submission_id | string (uuid) | yes | Foreign key → `property_submissions.id` |
| from_status | string (text) | no | |
| to_status | string (text) | yes | |
| reason | string (text) | no | Moderation evidence |
| requested_change_note | string (text) | no | Moderation evidence |
| reviewer_id | string (uuid) | no | Internal reviewer identity; no declared foreign key |
| created_at | string (timestamptz) | yes | |

### property_reports — 0 rows

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| id | string (uuid) | yes | Primary key |
| property_id | string (uuid) | no | Foreign key → `properties.id` |
| category | string (text) | yes | |
| note | string (text) | no | May contain personal text |
| reporter_name | string (text) | no | Personal identifier |
| reporter_phone | string (text) | no | Contact data |
| reporter_email | string (text) | no | Contact data |
| consent_at | string (timestamptz) | yes | Consent record |
| reference | string (text) | yes | |
| idempotency_key | string (text) | no | |
| created_at | string (timestamptz) | yes | |

### conversation_messages — 142 rows

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| id | integer (bigint) | yes | Primary key |
| whatsapp_id | string (text) | yes | Phone-derived person identifier |
| role | string (text) | yes | |
| content | unknown (jsonb) | yes | Contents not inspected |
| wamid | string (text) | no | External message identifier |
| source | string (text) | yes | Channel label |
| metadata | unknown (jsonb) | yes | Contents not inspected |
| created_at | string (timestamptz) | yes | |

### conversation_summaries — 0 rows

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| whatsapp_id | string (text) | yes | Primary key; phone-derived person identifier |
| summary | string (text) | yes | Generated summary (AI-derived) |
| metadata | unknown (jsonb) | yes | Contents not inspected |
| created_at | string (timestamptz) | yes | |
| updated_at | string (timestamptz) | yes | |

### customer_profiles — 30 rows

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| whatsapp_id | string (text) | yes | Primary key; phone-derived person identifier |
| preferred_name | string (text) | no | |
| budget_range | string (text) | no | Buyer preference |
| preferred_area | string (text) | no | Approximate location preference |
| metadata | unknown (jsonb) | yes | Contents not inspected |
| created_at | string (timestamptz) | yes | |
| updated_at | string (timestamptz) | yes | |

### bot_settings — 0 rows

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| key | string (text) | yes | Primary key |
| value | string (text) | yes | May hold provider configuration; audit for credential-like values |
| metadata | unknown (jsonb) | yes | Contents not inspected |
| created_at | string (timestamptz) | yes | |
| updated_at | string (timestamptz) | yes | |

### request_outbox — 1 row

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| id | integer (bigint) | yes | Primary key |
| reference | string (text) | yes | |
| channel | string (text) | yes | |
| state | string (text) | yes | Workflow state |
| attempts | integer | yes | |
| created_at | string (timestamptz) | yes | |
| updated_at | string (timestamptz) | yes | |

### mpesa_transactions — 1 row

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| checkout_request_id | string (text) | yes | Primary key |
| merchant_request_id | string (text) | no | |
| phone_number | string (text) | no | Contact data |
| amount | number (numeric) | no | Financial record |
| state | string (text) | no | Workflow state |
| account_reference | string (text) | no | |
| mpesa_receipt | string (text) | no | Financial evidence |
| result_desc | string (text) | no | May contain personal text |
| created_at | string (timestamptz) | yes | |
| updated_at | string (timestamptz) | yes | |

### schema_migrations — 2 rows

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| filename | string (text) | yes | Primary key |
| checksum | string (text) | yes | |
| applied_at | string (timestamptz) | yes | |

### Views

The OpenAPI document does not distinguish base tables from views, so the probe cannot separate them authoritatively. All fifteen relations advertise primary keys, which plain views normally lack, so they are most likely all base tables. Confirming this via `pg_catalog` is in the verification backlog. No separately identified views were exposed.

### RPC functions

One function is exposed: `rls_auto_enable`, declared with no parameters and no return schema in the OpenAPI document. It was not invoked (the probe was strictly read-only). The name suggests a function that enables Row Level Security on tables; its body, coverage, and effect are unknown, as is whether the anon role may execute it. Its mere existence hints that some RLS automation was intended, but nothing about actual policy state can be inferred (section 7).

### Declared foreign keys and referential gaps

Declared, from the OpenAPI foreign-key annotations:

```text
properties.agent_id                    -> agents.id
property_images.property_id            -> properties.id
property_submissions.property_id       -> properties.id
property_reports.property_id           -> properties.id
property_moderation_events.submission_id -> property_submissions.id
property_inquiries.agent_id            -> agents.id
```

Referential gaps — uuid columns with no declared foreign key, so orphans are possible and unenforced:

```text
scheduled_viewings.property_id          (no FK to properties.id)
property_inquiries.property_id         (no FK to properties.id)
property_moderation_events.reviewer_id (no FK to any identity table)
conversation_messages.whatsapp_id      (soft reference to customer_profiles.whatsapp_id)
```

## 3. Field classification

Every inherited column is mapped below to one class from [security and data boundaries](../architecture/security-data-boundaries.md): public published, restricted operational, personal/consent-bound, derived AI evidence, or secret. Reading rules:

- The mapping records the **intended class of the data**, not current visibility. Under [ADR-015](../architecture/decisions.md) no inherited row is trusted or publishable as-is; "public published" means "intended for the public published class after owner confirmation and moderation", never "safe to expose today".
- Timestamps are classified restricted operational as workflow/audit data; on personal-data tables they are also part of the personal record's retention envelope and inherit that table's handling.
- jsonb columns were not inspected; they take the conservative class of their table pending the backlog audit.
- Only one inherited column is derived AI evidence (`conversation_summaries.summary`). Retrieval scores exist only at runtime (Qdrant similarity, section 6) and are never persisted in the exposed schema.

### Columns flagged as restricted under ADR-014

ADR-014 makes the precise address restricted operational data, never in public revisions, Qdrant projections, or Simon context before an accepted viewing request. The same disclosure-gating principle extends to every column that holds precise location or contact data. All of the following are flagged restricted — none may enter a public revision, a buyer-safe projection, or general Simon context:

| Table | Column(s) | Concern |
| --- | --- | --- |
| properties | `address`, `latitude`, `longitude` | Precise location — restricted operational; public maps must use approximate pins derived from public fields only |
| properties | `location` | Treated as area-level for classification, but per-row precision is unverified; any row holding precise text is restricted — audit before treating as public |
| properties | `public_contact_name`, `public_contact_phone`, `public_contact_email`, `public_contact_method` | Contact data with display intent, consent-gated by `public_contact_consent_at` — personal/consent-bound; restricted until a publication policy and consent check allow exposure |
| agents | `email`, `phone` | Professional contact data — personal/consent-bound, never public without consent |
| scheduled_viewings | `customer_phone`, `customer_email`, `preferred_contact_method`, `customer_name` | Buyer contact data |
| property_inquiries | `customer_phone`, `customer_email`, `preferred_contact_method`, `customer_name` | Lead contact data |
| property_submissions | `submitter_name`, `submitter_phone`, `submitter_email`, `preferred_contact_method` | Submitter contact data |
| property_reports | `reporter_name`, `reporter_phone`, `reporter_email` | Reporter contact data |
| mpesa_transactions | `phone_number` | Payer contact data within a financial record |
| conversation_messages, conversation_summaries, customer_profiles | `whatsapp_id` | Phone-derived person identifier |

### properties

| Column | Class | Notes |
| --- | --- | --- |
| id | Public published | Opaque identifier |
| title | Public published | |
| description | Public published | |
| property_type | Public published | |
| listing_type | Public published | |
| status | Public published | Legacy availability vocabulary; the revisioned model moves lifecycle state to the Listing and derives buyer-visible availability from the published revision |
| price | Public published | |
| currency | Public published | |
| price_per_sqm | Public published | Stored value whose name implies price ÷ square_meters (inference from the name); recompute policy is a Phase 0 question |
| bedrooms | Public published | |
| bathrooms | Public published | |
| square_meters | Public published | |
| lot_size_sqm | Public published | |
| year_built | Public published | |
| floor_number | Public published | |
| total_floors | Public published | |
| location | Public published | Area-level per ADR-014, pending the precision audit above |
| city | Public published | |
| county | Public published | |
| latitude | Restricted operational | ADR-014 precise location |
| longitude | Restricted operational | ADR-014 precise location |
| amenities | Public published | Owner-supplied and unverified until moderation |
| furnished | Public published | |
| video_url | Public published | External URL; access model and EXIF treatment unverified |
| source | Restricted operational | Ingestion provenance |
| external_id | Restricted operational | Ingestion provenance |
| created_at | Restricted operational | Listing-age display, if any, flows from the published revision in the target model |
| updated_at | Restricted operational | |
| property_subtype | Public published | |
| price_period | Public published | |
| address | Restricted operational | ADR-014 precise address; never in public revisions, Qdrant, or Simon context before an accepted viewing |
| town | Public published | |
| country | Public published | |
| plot_dimensions | Public published | |
| land_size_raw | Public published | Raw free text; quality unknown |
| agent_id | Restricted operational | Internal ownership relation; becomes organization-scoped under ADR-012 |
| marketplace_status | Restricted operational | Internal visibility pipeline state |
| last_verified_at | Restricted operational | Verification workflow state |
| public_contact_name | Personal/consent-bound | ADR-014 flag |
| public_contact_phone | Personal/consent-bound | ADR-014 flag |
| public_contact_email | Personal/consent-bound | ADR-014 flag |
| public_contact_method | Personal/consent-bound | ADR-014 flag |
| public_contact_consent_at | Personal/consent-bound | Consent record governing the four fields above |

### property_images

| Column | Class | Notes |
| --- | --- | --- |
| id | Public published | Opaque identifier |
| property_id | Public published | Relation on a public entity; target model attaches media to revisions |
| url | Public published | Intended public media target; external URL, access control and EXIF stripping unverified (section 8) |
| sort_order | Public published | Display ordering |
| is_featured | Public published | Display flag |
| created_at | Restricted operational | |

### agents

| Column | Class | Notes |
| --- | --- | --- |
| id | Public published | Opaque identifier |
| first_name | Public published | Public professional profile |
| last_name | Public published | As surfaced by the prototype; Phase 0 confirms the public-agent-profile policy |
| email | Personal/consent-bound | ADR-014 flag |
| phone | Personal/consent-bound | ADR-014 flag |
| agency_name | Public published | |
| bio | Public published | |
| is_verified | Public published | Trust badge |
| avatar_url | Public published | External URL; same caveat as other media URLs |
| created_at | Restricted operational | |
| updated_at | Restricted operational | |

Note: under [ADR-012](../architecture/decisions.md) owner authority resolves through organizations, not individuals. Where the `agents` table is absorbed into that model, these classes must be re-derived in Phase 0.

### scheduled_viewings

| Column | Class | Notes |
| --- | --- | --- |
| id | Restricted operational | Internal record identifier |
| property_id | Restricted operational | |
| customer_phone | Personal/consent-bound | ADR-014 flag |
| customer_name | Personal/consent-bound | ADR-014 flag |
| viewing_date | Personal/consent-bound | Viewing schedule |
| duration_minutes | Personal/consent-bound | Viewing preference |
| status | Restricted operational | Workflow state |
| notes | Personal/consent-bound | Free text |
| created_at | Restricted operational | |
| updated_at | Restricted operational | |
| customer_email | Personal/consent-bound | ADR-014 flag |
| alternate_viewing_date | Personal/consent-bound | |
| preferred_contact_method | Personal/consent-bound | ADR-014 flag |
| mode | Restricted operational | Meeting-mode label |
| consent_at | Personal/consent-bound | Consent record |
| request_state | Restricted operational | |
| reference | Restricted operational | |
| idempotency_key | Restricted operational | |

### property_inquiries

| Column | Class | Notes |
| --- | --- | --- |
| id | Restricted operational | |
| customer_phone | Personal/consent-bound | ADR-014 flag |
| property_id | Restricted operational | |
| inquiry_type | Restricted operational | |
| message | Personal/consent-bound | Free text |
| metadata | Personal/consent-bound | Assumed; jsonb contents not inspected |
| created_at | Restricted operational | |
| customer_name | Personal/consent-bound | ADR-014 flag |
| customer_email | Personal/consent-bound | ADR-014 flag |
| agent_id | Restricted operational | |
| preferred_contact_method | Personal/consent-bound | ADR-014 flag |
| consent_at | Personal/consent-bound | |
| request_state | Restricted operational | |
| reference | Restricted operational | |
| idempotency_key | Restricted operational | |

### property_submissions

| Column | Class | Notes |
| --- | --- | --- |
| id | Restricted operational | |
| property_id | Restricted operational | |
| status | Restricted operational | Moderation workflow state |
| submitter_name | Personal/consent-bound | ADR-014 flag |
| submitter_phone | Personal/consent-bound | ADR-014 flag |
| submitter_email | Personal/consent-bound | ADR-014 flag |
| preferred_contact_method | Personal/consent-bound | ADR-014 flag |
| consent_at | Personal/consent-bound | |
| status_token_hash | Restricted operational | Stored credential verifier — secret-adjacent; never expose, never log, never copy into docs or projections |
| status_token_expires_at | Restricted operational | |
| status_token_revoked_at | Restricted operational | |
| idempotency_key | Restricted operational | |
| decision_reason | Restricted operational | Moderation evidence |
| requested_change_note | Restricted operational | Moderation evidence |
| last_verified_at | Restricted operational | |
| created_at | Restricted operational | |
| updated_at | Restricted operational | |

### property_moderation_events

All eight columns are restricted operational (moderation audit evidence), including `reviewer_id`, which is an internal reviewer identity with no declared foreign key.

### property_reports

| Column | Class | Notes |
| --- | --- | --- |
| id | Restricted operational | |
| property_id | Restricted operational | |
| category | Restricted operational | Trust-and-safety intake |
| note | Restricted operational | T&S evidence; may contain personal text, so it inherits personal-data handling in practice |
| reporter_name | Personal/consent-bound | ADR-014 flag |
| reporter_phone | Personal/consent-bound | ADR-014 flag |
| reporter_email | Personal/consent-bound | ADR-014 flag |
| consent_at | Personal/consent-bound | |
| reference | Restricted operational | |
| idempotency_key | Restricted operational | |
| created_at | Restricted operational | |

### conversation_messages

All eight columns are personal/consent-bound (conversation memory per the security doc), including `whatsapp_id` (ADR-014 flag), `content`, and `metadata` (jsonb, not inspected).

### conversation_summaries

| Column | Class | Notes |
| --- | --- | --- |
| whatsapp_id | Personal/consent-bound | ADR-014 flag |
| summary | Derived AI evidence | Generated summary of personal conversation; must be attributable, versioned, and correctable/deletable per ADR-011, with personal-data handling |
| metadata | Personal/consent-bound | Not inspected |
| created_at | Restricted operational | |
| updated_at | Restricted operational | |

### customer_profiles

All seven columns are personal/consent-bound (buyer preferences and identity), including `whatsapp_id` (ADR-014 flag) and `metadata` (not inspected).

### bot_settings

All five columns are restricted operational (internal configuration). `value` may hold provider configuration; the backlog includes auditing it for credential-like values, which would require secret-class handling.

### request_outbox

All seven columns are restricted operational (internal delivery workflow).

### mpesa_transactions

| Column | Class | Notes |
| --- | --- | --- |
| checkout_request_id | Restricted operational | Payment workflow identifier |
| merchant_request_id | Restricted operational | |
| phone_number | Personal/consent-bound | ADR-014 flag; payer contact within a financial record |
| amount | Restricted operational | Financial record |
| state | Restricted operational | |
| account_reference | Restricted operational | |
| mpesa_receipt | Restricted operational | Financial evidence |
| result_desc | Restricted operational | May contain personal text |
| created_at | Restricted operational | |
| updated_at | Restricted operational | |

### schema_migrations

All three columns are restricted operational (infrastructure metadata).

### Secret class

No inherited column maps to the secret class. Secrets in this system live only in environment files and provider tokens, which were never read. Two columns are secret-adjacent and carry explicit handling rules instead: `property_submissions.status_token_hash` (a stored credential verifier) and `bot_settings.value` (potential provider configuration).

## 4. Simon prototype usage map

From static analysis of the simon repository. The prototype touches exactly five tables through three write paths, all INSERT-only — no UPDATE or DELETE exists anywhere in its source. Conversation state is an in-memory checkpointer; the Supabase client is process-global.

### Tables, operations, and filters

**properties** — four read paths plus one insert. All reads select the same 25-column list: `id, title, description, property_type, listing_type, price_period, status, price, currency, bedrooms, bathrooms, square_meters, lot_size_sqm, location, address, town, city, county, country, amenities, furnished, year_built, video_url, agent_id, external_id`.

| Operation | Kind | Behavior |
| --- | --- | --- |
| `browse` | read | Always filters `status=eq.available` (locked default; the tool layer cannot change it). Optional filters: `listing_type`/`property_type` exact equality, `price` gte/lte, `bedrooms`/`bathrooms` gte (minimums), `city` and `location` ilike substrings, `amenities=cs.{x}` exact single-element array containment. Orders `created_at.desc` (ordering key not selected). Paginates 6 rows/page via HTTP Range (`0-5` first page); no total count requested. |
| `fetch_card` | read | `id=eq.{id}`, limit 1. **No status or visibility filter** — any row, including non-available ones, is fetchable by id. |
| `fetch_cards` | read | `id=in.(...)`, no order, no limit. Caller re-orders results and silently drops ids missing from the database. |
| `post_listing` | insert | Writes title, description, property_type, listing_type, price, price_period (default `one_time`), location, city (default Nairobi), country (hardcoded Kenya), furnished (default False), amenities (default `[]`), plus county, bedrooms, bathrooms, square_meters, lot_size_sqm, address, town, year_built, agent_id only when provided. The returned row feeds a constructor that hard-indexes id, status, currency, location, city — so the database must supply every NOT NULL column the prototype never writes. Per the OpenAPI required list that set is `id`, `status`, `currency`, `created_at`, `updated_at`, and `marketplace_status` — the last is the internal visibility-pipeline state, which the prototype neither selects nor writes anywhere, so the insert path depends entirely on an unseen default or trigger for it. (`external_id` and `video_url` are also never written, but the schema marks both nullable and they are read back as optional, so no default is required.) |

**property_images** — `gallery_for`: `property_id=eq.`, ordered `sort_order` ascending, selects only `url`, unbounded. `url` is direct-indexed, so it must be non-null.

**agents** — `agent_for`: `id=eq.`, limit 1, selects `id, first_name, last_name, email, phone, agency_name, is_verified`. `first_name` is direct-indexed; `is_verified` null-coalesces to False. Read-only; the prototype never writes agents.

**scheduled_viewings** — `book_viewing` (insert): writes `property_id, customer_phone, customer_name, viewing_date, duration_minutes` (default 30)`, notes, status` (hardcoded `confirmed`). No availability, conflict, or uniqueness check. `viewing_date` comes from `normalize_when(day, hour)`, which builds a naive datetime and attaches the server's local timezone before converting to UTC — the "local Nairobi time" contract holds only if the host timezone is Africa/Nairobi; this dependency is encoded nowhere. `viewings_for` (read): `customer_phone=eq.`, ordered `viewing_date` ascending, unbounded — returns all past and future bookings, no status filter.

**property_inquiries** — `save_lead` (insert): writes `customer_phone, inquiry_type` (default `general`) and explicit nulls for `customer_name, customer_email, property_id, agent_id, message` — so those columns must stay nullable. The tool layer never supplies `customer_email` or `agent_id` even though the function accepts them.

### Record shapes (frozen dataclasses)

```text
PropertyCard   id, title, description, property_type, listing_type, price_period, status,
               price: float, currency, bedrooms?, bathrooms?, square_meters?, lot_size_sqm?,
               location, address?, town?, city, county?, country, amenities: list[str],
               furnished: bool, year_built?, video_url?, agent_id?, external_id?
               (derived price_per_sqm = round(price / square_meters, 2) when > 0)
AgentProfile   id, first_name, last_name?, email?, phone?, agency_name?, is_verified: bool
ViewingSlot    id, property_id?, customer_phone, customer_name?, viewing_date,
               duration_minutes, status, notes?
Lead           id, customer_phone, customer_name?, customer_email?, property_id?,
               agent_id?, inquiry_type, message?
PropertyImage  id, property_id, url, sort_order, is_featured — dead code; never constructed
```

### Agent tools (8)

| Tool | Key inputs | Calls |
| --- | --- | --- |
| `search_properties` | deal (`rent`/`sale`/`shortlet`), kind, min/max price, bedrooms/bathrooms minimums, city, area, amenity, 1-based page | `browse` — 6 results/page, status locked to `available` |
| `describe_property` | property_id | `fetch_card` → `gallery_for` → `agent_for` (skipped when agent_id is null) |
| `compare_properties` | up to 4 property ids | `fetch_cards` |
| `search_by_meaning` | natural-language query, limit capped at 6 | `meaning.nearest` → embed query, Qdrant query, `fetch_cards` re-hydration |
| `create_listing` | title, description, type, deal, price, location, city, optionals | `post_listing` insert; never exposes `price_period` (always `one_time`), `agent_id`, `address`, `town`, `county`, `year_built`, `lot_size_sqm` |
| `schedule_viewing` | property_id, customer_phone, day, hour, name, notes | `fetch_card` existence check → `normalize_when` → `book_viewing` insert, status `confirmed` |
| `check_viewings` | customer_phone | `viewings_for` → `fetch_cards` for titles |
| `record_lead` | customer_phone, inquiry_type (`general`/`viewing`/`listing`), name, property_id, message | `save_lead` insert |

### Embedding and Qdrant usage

- **Query side (the only embedding call in the source):** the buyer's natural-language query string is posted as `{"text": [text]}` to Cloudflare Workers AI `@cf/qwen/qwen3-embedding-0.6b`; the first returned vector is the query embedding.
- **Qdrant search:** `query_points(collection_name="properties", query=vector, limit=limit, with_payload=False)` — vector and limit only; no filters, no payload fields requested or read.
- **Point id contract:** Qdrant point ids must equal Supabase `properties.id`; hits are re-hydrated through `fetch_cards`, and stale ids that no longer exist in Postgres are silently dropped. Card content always comes from Postgres, never from the Qdrant payload; Qdrant contributes only id plus similarity score.
- **Document-side embedding fields: not defined in this repository.** No code anywhere in the simon source indexes property rows into Qdrant — there is no ingest, build, or upsert path. Which listing fields form the stored embedding text is therefore unknowable from source; the recipe behind the existing 4,258 points is unrecorded (section 8).

### Implicit schema expectations and dependencies

The prototype silently assumes all of the following; the migration must not carry unverified assumptions forward:

- The 25-column select list exists verbatim; `browse` orders by `created_at` without selecting it.
- `as_card` hard-indexes `id, title, description, property_type, listing_type, price_period, status, price, currency, location, city` — a SQL null in any of these raises at runtime instead of degrading. Its `Nairobi`/`Kenya` defaults only fire when a key is absent, so with the explicit select list a null city or country becomes `None` inside str-typed fields, with no runtime validation.
- `price` must be numeric-coercible unconditionally; `square_meters`/`lot_size_sqm` coerce only when truthy; `amenities` null-coalesces to `[]`; `furnished` null-coalesces to False; `year_built` passes through un-coerced.
- Database-side defaults or triggers must generate `id` and, on the insert path, supply `status`, `currency`, `created_at`, `updated_at`, and `marketplace_status` — `marketplace_status` is NOT NULL, never written by the prototype, and absent from its select list entirely. `external_id` and `video_url` are nullable, so the insert does not depend on defaults for them.
- Vocabulary known only from code: status default filter `available`; `listing_type` rent/sale/shortlet; `price_period` default `one_time` with a monthly-style value implied by the system prompt but never spelled out; prices KES per the system prompt, with `currency` never written.
- Env var names configured in settings (structure only, values never read): `SUPABASE_URL`, `SUPABASE_KEY`, `POSTGRES_DSN`, `QDRANT_URL`, `QDRANT_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, plus LLM/observability keys. Settings define `supabase_url`, `supabase_key`, `qdrant_url`, `qdrant_api_key`, `cloudflare_account_id`, `cloudflare_api_token`; `postgres_dsn` is not defined, so the app has no direct database connection configured. `postgres_dsn` and the asyncpg dependency are declared dead code — REST is the only database path. Missing Qdrant/Cloudflare config degrades `search_by_meaning` only.

## 5. Storage state

`GET /storage/v1/bucket` returned HTTP 200 with an empty JSON array: **zero buckets**. Because the configured key is service-role and bypasses storage RLS, the empty result reflects a genuinely empty bucket list, not a permissions artifact. The storage schema is not exposed through PostgREST (a `storage.buckets` probe returned 404), so it could not be cross-checked that way. There being no buckets, there are no objects to count and no object-level policies to enumerate.

Corroboration from the prototype source: `gallery_for` reads `property_images.url` as complete external URLs with no bucket-path handling, and Cloudflare credentials are defined in settings — inherited media is CDN/URL-referenced, not Supabase Storage. The practical consequence: despite [ADR-004](../architecture/decisions.md) naming Supabase Storage as the media owner, Storage currently owns no media at all, and the entire media lifecycle (private upload, validation, EXIF treatment, derivatives) is greenfield.

## 6. Qdrant state

Single collection named `properties`, with an unnamed single-vector configuration: **1024 dimensions, Cosine distance**. Exact point count **4,258**, obtained both from `GET /collections` and from the pure-read `POST /collections/properties/points/count` with body `{"exact": true}` (the only non-GET request made by any probe). Payloads were not read, so the payload schema and contents are unknown — including whether restricted fields were ever embedded into payloads (backlog item).

The count is one behind the 4,259-row `properties` table: the rebuildable projection is stale by one point relative to the Postgres source of truth. No ingest code exists in the prototype source, so there is no recorded mechanism that even maintains this projection — consistent with [ADR-015](../architecture/decisions.md)'s decision to rebuild rather than patch. The collection's 1024 dimensions would have to match the live query embedding model (`@cf/qwen/qwen3-embedding-0.6b`) for `search_by_meaning` to work, but the model's output dimension is nowhere stated in the audited source — the match is presumed from the query path targeting this collection, not verified.

## 7. Access and authorization observations

### What the configured key can do

- The key is a legacy-format JWT with role claim `service_role`. Service-role requests bypass RLS, so this key can read every exposed relation in full — all fifteen were readable, and all five Simon-touched tables were confirmed with their row counts.
- The PostgREST OpenAPI document itself is served to this key, which is how the inventory was obtained.
- Writes were never attempted by the probes and nothing was mutated. The key's class means writes would bypass RLS wherever PostgREST permits; the prototype's three INSERT paths already rely on exactly that.
- The Storage admin surface (bucket listing) and Qdrant (with its own key) are reachable from this environment.

### Authorization implications

- **The prototype holds a service-role key process-globally and uses it for all reads and writes.** Every tool call in Simon therefore runs with full database authority. This directly conflicts with the security doc's rule that agent tools never receive service-role keys, and it is the single most important authorization finding: today there is no RLS-shaped boundary between the concierge and the database — only the absence of destructive code in the tool list.
- RLS effects are invisible from REST with this key: whether RLS is enabled on any table, and what any policy says, cannot be observed. The `rls_auto_enable` RPC hints at automation intent, nothing more.
- Whether a project anon key exists and what it can read is untested; the current true public exposure of the fifteen relations is unknown. Until verified, the conservative assumption is that any of them could be publicly readable.
- Ten relations are never referenced by the simon repository, and six of them carry rows that nothing in the audited source writes (`conversation_messages`, `customer_profiles`, `property_submissions`, `request_outbox`, `mpesa_transactions`, `schema_migrations`). Some other component — most plausibly a WhatsApp integration, an M-Pesa callback worker, and migration tooling — holds write access to this database from somewhere outside the audited source. Its identity, hosting, and credential scope are unknown, which means the real set of credential holders for this database is unknown.

### Unverifiable without direct database access ([open questions](open-questions.md), item 7)

All of the following require `SUPABASE_DB_PASSWORD`; none are exposed through REST:

- RLS policy SQL (`pg_policies`) — which policies exist on public and storage tables and their exact expressions.
- `auth` schema contents — `auth.users` and related identity tables; whether any accounts exist at all.
- Database triggers and their trigger functions.
- Database functions not exposed as PostgREST RPC endpoints (including the body of `rls_auto_enable`).
- Storage RLS policies on `storage.objects` and `storage.buckets`.
- Table owners and column-level privileges (`information_schema`).
- Database size and per-table storage utilization.

Related REST-level unknowns, also deferred to the backlog: enum value lists, column defaults, jsonb contents, and the identity of the unknown writer described above.

## 8. Migration constraints and risks

Mapping considerations and risks only. This section deliberately contains no target DDL and no final field placement — those decisions belong to the Phase 0 contracts work in the [roadmap](marketplace-roadmap.md).

### ADR-015 staging posture

- No inherited row is grandfathered as published. The 4,259 property rows migrate into the Property / Listing / ListingRevision model as unverified records requiring owner confirmation and moderation approval before publication.
- Legacy tables stay untouched as a staging source — which also protects the ten untouched relations, six of which carry rows written from outside the audited source. Any change to legacy tables before those writers are identified risks breaking a live integration nobody has audited.
- The import itself must be an explicit, auditable path that sets verification status; it must not use the service-role key, and it must emit audit records per the security doc's baseline.

### Flat-to-revisioned mapping considerations

The flat row mixes at least four concerns the target model separates. Candidate homes, as open considerations for Phase 0 — not decisions:

- **Property-like (physical asset):** bedrooms, bathrooms, square_meters, lot_size_sqm, plot_dimensions, land_size_raw, year_built, floor_number, total_floors, property_subtype — and, per ADR-014, the restricted location set: `address`, `latitude`, `longitude` on the Property record, never on public revisions.
- **Listing-like (commercial offer and visibility):** price, currency, price_period, listing_type, marketplace_status, agent_id (ownership — which becomes organization-scoped under ADR-012), last_verified_at.
- **Revision-like (content snapshot):** title, description, amenities, furnished, video_url, and the area-level location fields (location, city, town, county, country) that public revisions carry for display and search.
- **Open tensions:** `status` versus `marketplace_status` overlap is unknown (different vocabularies — `status` is enum-typed (`public.property_status`) while `marketplace_status` is unconstrained free text); whether `created_at` on a flat row means property creation or listing creation; whether `public_contact_*` fields survive as revision content at all, and whether their recorded consent transfers through an import.

### Address-field handling under ADR-014

- `address`, `latitude`, and `longitude` must land as restricted Property fields; public revisions and Qdrant projections carry area-level fields only, and approximate pins must be derived from public fields.
- Per-row precision of the `location` free-text column is unverified; the import must audit it before treating every value as area-level, and any value found to hold precise text must be restricted.
- Simon must decline exact-address disclosure until an accepted viewing request exists; the current `describe_property` tool happily returns whatever `address` holds — the target tool contract has to close this.

### Tenancy gap (ADR-012)

`agents` (13 rows) has no auth linkage and no organization concept exists anywhere in the inherited schema. Import must synthesize organizations (solo-owner mode is the natural mapping) and decide per-agent membership; `properties.agent_id` then resolves through membership, never a bare user id. Transfer semantics do not exist in the inherited data.

### Data-quality unknowns

Enum value lists, text-status vocabularies (`marketplace_status`, and status on viewings/inquiries/submissions), null rates, duplicate listings (`source`/`external_id`), currency consistency, consent coverage for `public_contact_*`, and timestamp semantics are all unmeasured. The import path must treat unmeasured fields as unverified rather than assuming quality.

### Qdrant rebuild implications

- The embedding recipe behind the 4,258 existing points is unrecorded — no ingest code exists in source — so the current projection is unreproducible and its payload contents are unknown. It cannot be trusted as a reference for the new buyer-safe document.
- The one-point drift versus Postgres confirms the projection is not transactionally synced; there is no outbox or indexing job anywhere in the audited code.
- Per ADR-015 the projection is rebuilt from published revisions (never patched), with the document defined per [ADR-010](../architecture/decisions.md) (buyer-safe listing text plus captions). The live model's output dimension is not stated in the audited source, so its compatibility with the current collection's 1024-dimension configuration is presumed from the query path, not verified.
- Before decommissioning the legacy collection, payload keys should be inspected (keys only) to confirm no restricted fields were ever stored.

### Media constraints

12,748 external image-URL references (about 3 per property; distinctness unmeasured), zero Supabase buckets, and no upload lifecycle anywhere. Import must treat inherited URLs as unverified references: fetch-and-validate (liveness, ownership, EXIF/location metadata), copy into private Storage, and only produce public derivatives after moderation. Nothing inherited may become buyer-visible media merely because a row points at it.

### Simon behavioral constraints carried into the target

`fetch_card` has no visibility filter (any row fetchable by id); `browse` hard-locks `status=eq.available`; constructors hard-index fields the prototype never writes, relying on undocumented database defaults; viewings are keyed by raw `customer_phone` (PII as lookup key) with no conflict check and a hardcoded `confirmed` status, versus [ADR-016](../architecture/decisions.md)'s verified-contact requirement; `normalize_when` has a server-timezone dependency; explicit-null inserts require columns to stay nullable. Each of these must be replaced by published-revision-gated, authorized domain operations — none should be ported as-is.

### Moderation lifecycle shape

`property_submissions` (1 row) plus `property_moderation_events` (0 rows) is a different lifecycle shape from the target ModerationCase, and its status-token flow (hash, expiry, revocation) is a public status-check mechanism that predates auth. The target redesign is Phase 0/1 work; the inherited rows are evidence of intent, not a contract.

### Scope and retention for non-marketplace tables

`conversation_messages`, `conversation_summaries`, `customer_profiles`, `mpesa_transactions`, `request_outbox`, and `bot_settings` are WhatsApp/M-Pesa concierge artifacts, likely out of marketplace migration scope. They contain personal data with no documented retention or deletion policy — the security doc requires retention rules by data category before broad collection continues, and these tables are already collecting.

### Ownership of schema_migrations

Two entries exist in a standard-named migration ledger whose tooling ownership is unknown. Before any LUXONN migration is applied, identify what writes it (Supabase CLI or otherwise) to avoid two owners of the same ledger.

## 9. Verification backlog

Checks to run once `SUPABASE_DB_PASSWORD` exists ([open questions](open-questions.md), item 7). Aggregate results only — counts, names, and booleans; never row values in documentation.

1. `pg_policies` dump for `public` and `storage`, plus per-table RLS-enabled flags (`pg_class.relrowsecurity`).
2. Body and coverage of `rls_auto_enable` and every other function in `pg_proc` not exposed as RPC, including any default-setting functions behind `id`, `status`, `currency`, `marketplace_status`, and timestamps.
3. Trigger inventory (`pg_trigger`) — especially on `properties`, `property_submissions`, `request_outbox`, and the moderation event table.
4. `auth.users` and related auth tables — whether any accounts exist.
5. Column defaults and constraints (`information_schema.columns`, check constraints) to confirm or refute the prototype's insert assumptions.
6. Enum value lists via `pg_enum` for `property_type`, `listing_type`, `property_status`, `price_period`.
7. Foreign-key ON DELETE behaviors (`pg_constraint`) for import orphan handling.
8. Index inventory (`pg_indexes`) for import and query planning.
9. Database timezone configuration versus server timezone, to pin down `normalize_when` semantics.
10. Storage RLS policies on `storage.objects` and `storage.buckets`, and any bucket history.
11. Aggregate data-quality audit of `properties`: null counts per column, distinct vocabularies of text-status columns, duplicate `external_id`/`source` counts, currency distinct values, `address`-versus-`location` precision classification, latitude/longitude fill rates, consent coverage of `public_contact_*`.
12. Qdrant payload keys of sample points (keys only, values never printed) to confirm whether restricted fields were ever stored.
13. Anon-key read behavior, if a project anon key exists, to establish the actual current public exposure of the fifteen relations.
14. Whether `property_images` URLs are publicly fetchable without credentials (HEAD requests), and EXIF presence on a sample — external media exposure and privacy.
15. `schema_migrations` entries (filenames only — checksums are row values and stay out of documentation) to identify the owning tool.
16. Identify the writers of the ten untouched relations — the six carrying rows are the direct evidence (application logs, connection stats, Supabase logs) — before any legacy-table change.

## 10. No-secrets attestation

This document contains no credentials, tokens, environment values, or production row data. It records structure (names, types, formats, required-list membership, foreign keys), aggregate row counts from `content-range` headers, and one key class/role label. No `.env`, `Simon.env`, or other environment file was opened, read, copied, printed, or summarized; probe scripts loaded configuration in-process and printed structure only. All probes were read-only (GET/HEAD plus the single documented pure-read Qdrant count POST); nothing in Supabase, Storage, or Qdrant was created, modified, or deleted. No row-level production data — property content, contact details, conversation text, or media — was read, stored, or printed. Temporary probe artifacts live only under `/tmp`; nothing was created or modified inside the simon repository, and the only file changed in this repository is this brief.
