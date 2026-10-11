# Security and data boundaries

This document defines the security posture that future marketplace work must preserve. It is a design contract, not a replacement for a threat model, legal review, or implemented authorization policy.

## Threat boundary

A premium property marketplace processes sensitive material: owner identities, restricted property locations, interior images, price negotiations, viewing schedules, buyer preferences, and human handoff requests. The browser, LLM, vector index, background job payload, and third-party provider are all untrusted or lower-authority relative to server-validated Postgres records.

## Field classification

| Classification | Examples | Storage and access rule |
| --- | --- | --- |
| Public published | listing title, approved public price, broad area, bedrooms, buyer-safe amenities, approved public media | Readable only through a current published revision |
| Restricted operational | precise address, owner legal identity, internal notes, moderation evidence, unpublished media, supplier cost | Server-side role checks; never in public Qdrant projections or general Simon context |
| Personal/consent-bound | contact details, phone, email, approximate location, viewing preferences, conversation memory | Purpose-limited, consent-aware access and retention |
| Derived AI evidence | image caption, room classification, visual feature, retrieval score, generated summary | Versioned, attributable, never a canonical business fact |
| Secret | service keys, database credentials, provider tokens, private URLs | Environment/secret manager only; never source, logs, chat context, or documentation |

## Trust rules

### Browser requests

The browser may provide intent, not authority. Treat these as untrusted until validated:

```text
listing_id
published_revision_id
visible_listing_ids
filter values
compare selection
route and result position
```

The server must resolve the current listing record, actor authorization, and published revision independently. It must not trust a browser-provided price, owner, status, address, or availability claim.

### Qdrant and retrieval

Only buyer-safe, published-revision projections enter Qdrant. Each projection needs an explicit listing/revision/version reference and must be removed or made unreachable on withdrawal, closure, or visibility change.

Every search result and every Simon claim must hydrate current Postgres facts before reaching the buyer. Similarity score is a ranking signal, not evidence that a property is current, available, or allowed to be shown.

### AI and agent tools

Simon and subordinate agents receive least-privilege, typed domain operations. Disallow raw SQL, service-role keys, unrestricted storage access, direct moderation transitions, and arbitrary Qdrant queries from model-controlled tool input.

Consequential actions require all of the following:

1. A server-authenticated actor or allowed anonymous flow.
2. Authorization scoped to the object and role.
3. Validated input against a server-owned schema.
4. Explicit user confirmation when the action contacts a person, books something, or changes business state.
5. An auditable command record with outcome and idempotency protection.

## Auth and authorization model

| Actor | Minimum authority |
| --- | --- |
| Anonymous visitor | Read buyer-safe published catalog; submit limited inquiry/viewing intent with rate limits and abuse checks |
| Authenticated buyer | Own account, saved items, alerts, own requests and consent records |
| Authenticated owner | Their organization/property/listing drafts and uploads only |
| Moderator | Assigned review queue, review decisions, restricted evidence required for review |
| Administrator | Explicit operational scope, not a blanket client-side bypass |
| Worker/service | Narrow job-specific authority with idempotency and audit data |

Supabase Row Level Security must enforce the database portion of these relationships. Backend service authorization must still be explicit; RLS is not a substitute for application-level policy.

## Listing publication controls

- A public listing is one whose canonical Postgres record points at an approved published revision.
- Drafts, submitted revisions, rejected media, private originals, internal notes, and moderation evidence never enter public routes or buyer-safe Qdrant payloads.
- Owners edit a new draft revision rather than mutating published facts in place.
- Publication/revision changes emit durable outbox events. Indexing, media transformations, notifications, and integrations consume those events idempotently.

## Media controls

1. Upload into private, authorization-scoped storage paths.
2. Validate type, size, and content before processing.
3. Strip or explicitly control EXIF/location metadata before producing public derivatives.
4. Scan and moderate before public availability.
5. Preserve processing/moderation status and model/version provenance.
6. Serve public media only from approved/published revision links.

## Audit record baseline

For consequential commands, retain a server-generated audit record with conceptual fields:

```text
audit_id
occurred_at              ISO-8601 UTC, for example 2026-10-11T14:30:00Z
actor_type               anonymous | buyer | owner | moderator | service
actor_id                 nullable stable server identity
organization_id          nullable stable server identity
action                   e.g. listing.submit
resource_type            e.g. listing_revision
resource_id              opaque identifier
request_id               idempotency/correlation identifier
outcome                  accepted | rejected | completed | failed
reason_code              stable policy or validation code
```

Do not put secrets, raw sensitive media, or unbounded free-text prompts into an audit record by default.

## Privacy and retention requirements

- Request consent before collecting precise or approximate location for Simon.
- Explain why contact details are collected before a viewing or handoff request is submitted.
- Make stored preferences and durable memories correctable and deletable.
- Set retention rules by data category before broad production collection begins.
- Separate analytics from operational identity data; do not make chat transcripts a hidden profile store.

## Security verification before launch

- RLS policy tests for every actor and restricted field.
- Authorization tests for all marketplace commands and Simon tools.
- Public-search tests proving unpublished and withdrawn records do not appear.
- Media access tests for originals, derivatives, cross-owner access, and EXIF stripping.
- Rate-limit and abuse-control tests for anonymous chat and inquiry flows.
- Audit/idempotency tests for publication, handoff, and viewing actions.
- Secret scanning and log-redaction checks in CI and deployment pipelines.
