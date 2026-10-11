# Marketplace implementation roadmap

This is the approved delivery order. It is intentionally staged so a visually ambitious experience is built on trustworthy listing data instead of temporary marketing objects.

## Phase 0 — Contracts and product foundation

### Deliverables

- Shared TypeScript/Python domain contracts for property, listing, listing revision, media, owner, moderation case, viewing request, handoff request, and page context.
- Public versus restricted field classification.
- Kenya-first/global-ready geography, currency, locale, and address rules.
- Image-analysis output schema and visual-dossier schema.
- Retrieval evaluation dataset with real Kenya-focused search intents and expected property outcomes.
- Reconciled branding/copy plan for removing unsupported global-inventory claims.

### Exit criteria

- The team can define exactly what one published listing is.
- The team knows which facts Simon may state as confirmed.
- No implementation relies on hardcoded homepage card objects as marketplace truth.

## Phase 1 — Authenticated owner and moderated listing lifecycle

### Deliverables

- Supabase Auth and role model.
- Anonymous browsing remains available.
- Owner-only routes and server-side authorization.
- Draft, submit, review, approve, publish, withdraw, and close transitions.
- Immutable listing revisions and published-revision pointer.
- Private media storage paths and authorized uploads.
- Moderator workflow and auditable decisions.
- Transactional outbox for external/async work.

### Exit criteria

An authenticated owner can create a draft and submit it. A moderator can request changes or approve it. A buyer cannot see it until an approved public revision exists.

## Phase 2 — Real buyer discovery and property pages

### Deliverables

- Canonical property/listing read model sourced from Supabase.
- SEO-capable property detail routes.
- Dense visual search grid/list with URL-backed filters, sort, and cursor/page state.
- Save, compare, similar-property, and viewing-request interactions.
- Context-aware “Ask Simon about this” actions.
- Circular/3D gallery relocated to curated collections, shortlists, similar properties, or detail media storytelling.
- Replacement/removal plan for hardcoded global inventory examples.

### Exit criteria

An anonymous buyer can discover, filter, compare, share, and inspect currently published Kenyan inventory without an account.

## Phase 3 — Media intelligence and retrieval quality

### Deliverables

- Resumable/direct media upload flow.
- File validation, scanning, EXIF/privacy treatment, and safe derivatives.
- Structured image captioning, room/feature tagging, and visual dossier generation.
- Versioned text embedding pipeline using buyer-safe property documents plus visual captions.
- Qdrant projection handlers for publish/update/withdraw.
- Postgres hydration and authorization for every search result.
- Retrieval evaluation harness and provider comparison for available free tiers.
- Reconciliation jobs for media and index drift.

### Exit criteria

Search and Simon can use grounded image-derived knowledge without reprocessing media on every conversation, and cannot reveal stale/unpublished/restricted content.

## Phase 4 — Native Simon

### Deliverables

- Native React LUXONN chat surface with the same visual quality as the rest of the product.
- Python FastAPI streaming/service boundary.
- Typed page context for active listing, search, compare, and navigation state.
- Persistent conversation checkpoints.
- Constrained live-concierge tools for search, comparison, navigation, viewings, and handoffs.
- Explicit consent capture and durable lead/handoff records.
- Strong grounding, insufficient-evidence behavior, and tool authorization tests.

### Exit criteria

A visitor can ask “what about this one?” while browsing and Simon accurately resolves the active published listing, explains evidence, and offers safe next actions.

## Phase 5 — Long-horizon agent workflows and operations

### Deliverables

- Deep Agent or LangGraph workflow for owner draft assistance.
- Deep research/report workflow for internal staff and selected buyer relocation use cases.
- Controlled preference memory and conversation summarization.
- Observability, agent/retrieval evaluations, abuse controls, and operational dashboards.
- CRM/calendar/notification integrations through the outbox.
- Privacy retention/export/deletion controls and incident/recovery procedures.

### Exit criteria

Advanced agent capability improves owner/staff work without weakening transactional integrity, permissions, or factual property grounding.

## Cross-phase standards

- Keep the LUXONN visual direction maximal, not minimal.
- Accessibility and reduced-motion alternatives are part of each surface, not a post-launch cleanup.
- All consequential marketplace actions are server-authorized, idempotent where possible, and auditable.
- Do not collapse this sequence by building agent autonomy before the catalog/lifecycle it depends on.
