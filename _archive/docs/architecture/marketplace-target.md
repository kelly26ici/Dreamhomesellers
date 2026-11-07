# Target marketplace architecture

## Product statement

LUXONN is a Kenya-focused premium property marketplace. Authenticated owners submit and manage listings. Anonymous buyers discover verified published inventory, compare choices, and receive concierge assistance from Simon without forced registration.

The system is global-ready in its data primitives, but Kenya is the live product scope.

## Authority boundaries

| Concern | Authority | Rule |
| --- | --- | --- |
| Identity and roles | Supabase Auth + Postgres | Owners and staff are authorized server-side. |
| Listing facts and lifecycle | Supabase Postgres | Canonical, revisioned, moderated, auditable. |
| Original media and derivatives | Supabase Storage | Private upload paths; buyer-safe derivatives exposed after approval. |
| Semantic discovery | Qdrant | Derived and rebuildable; only buyer-safe public projections. |
| Chat/agent execution | Python Simon service | May retrieve and request actions; never becomes business authority. |
| Current visitor intent | Native LUXONN client | Useful context only; all IDs and facts are revalidated server-side. |

## Target components

```text
Native Next.js application
  ├── public buyer discovery and property detail surfaces
  ├── authenticated owner workspace
  ├── staff/moderation workspace
  └── native Simon chat and contextual actions
          │
          ▼
Python FastAPI Simon/domain service
  ├── streaming concierge endpoint
  ├── constrained marketplace command/read APIs
  ├── LangChain live agent and Deep Agent workflows
  └── async workers / job consumers
          │
          ├── Supabase Postgres + Auth + Storage
          └── Qdrant buyer-safe search projections
```

## Listing domain model

```text
Property
  Stable physical asset and restricted address/geography

Listing
  Commercial offer for a property, including visibility and listing status

ListingRevision
  Immutable content snapshot: price, public description, features, media references

ListingMedia
  Ordered media attached to a revision, with processing and moderation state

ModerationCase / Decision
  Human review workflow and audit evidence
```

A public listing always resolves through `listing.published_revision_id`. Owners never mutate a currently published revision in place.

## Publication pipeline

```text
Owner draft
  → submit stable revision
  → automated pre-checks
  → human review
  → approved
  → media/index readiness checks
  → published
  → buyer-safe Qdrant projection
```

Use a transactional outbox whenever a listing changes state. Media generation, captioning, embedding, Qdrant projection, notifications, and CRM delivery must be idempotent background jobs, not chained browser requests.

## Buyer discovery

### Primary search

- Dense visual property grid/list.
- Server-backed search with URL-backed filters, sort, cursor/page state, and direct property URLs.
- Search cards expose: open, save, compare, ask Simon, find similar, request viewing.
- Use static/filter constraints and semantic discovery together, but hydrate every result from Postgres before display.

### Gallery placement

Use the 3D/circular visual system only for constrained editorial experiences:

- curated collections;
- shortlist comparison;
- similar properties;
- developer/building portfolios;
- property-detail media storytelling.

It must not be used as broad search results or infinite scrolling database navigation.

## Native Simon

### Request context

Every chat turn can receive typed transient context:

```text
route
view mode
active listing ID and published revision ID
active result position and result count
visible listing IDs
search filters and sort
comparison list
consented approximate location, if requested
```

The frontend sends stable identifiers, not authoritative property facts. Simon retrieves buyer-safe, current records server-side.

### Live agent

Use `create_agent` for bounded concierge work:

- search and refine inventory;
- describe and compare listings;
- explain buyer-safe visual evidence;
- navigate/filter the site;
- create viewing requests and human handoffs.

### Long-horizon workflows

Use Deep Agents or explicit LangGraph flows for:

- owner draft preparation and completeness help;
- internal market or neighbourhood research;
- long-form relocation/shortlist reports;
- artifact-producing work that benefits from planning and context compaction.

### Tool constraints

Tools are domain operations such as `search_published_listings`, `get_listing`, `create_draft`, `submit_for_review`, `request_viewing`, and `create_handoff`. They are never raw SQL, service-role database access, or unconstrained Qdrant access.

## Media intelligence

```text
Authenticated owner upload
  → private Storage object
  → validation, scanning, EXIF stripping, safe derivatives
  → vision model structured analysis
  → Postgres image facts and processing status
  → property visual dossier
  → text embedding/index projection
```

### Evidence classes

| Class | Examples | How Simon presents it |
| --- | --- | --- |
| Verified/public listing fact | published price, rooms, policy-approved location | Stated as confirmed listing information |
| Owner-supplied claim | newly submitted amenity before verification | Identified as owner-provided until published/verified |
| AI visual observation | island kitchen visible in photos | Clearly labeled as photo-derived and subject to viewing confirmation |

Initial retrieval uses text embeddings over buyer-safe listing text plus visual captions/dossiers. Evaluate a separate multimodal image vector only after real user demand justifies it.

## Identity and permissions

| Visitor type | Capabilities |
| --- | --- |
| Anonymous buyer | browse, search, compare, use Simon, start an inquiry subject to anti-abuse controls |
| Authenticated buyer | cross-device saves, alerts, viewing management, documents/offer workflows when enabled |
| Authenticated owner | create and manage only their authorized drafts/listings and upload media |
| Moderator/staff | review, publish, suspend, route leads, access restricted data according to role |

## Memory

| Layer | Storage | Purpose |
| --- | --- | --- |
| Turn/page context | chat request | immediate UI intent |
| Thread state | persistent LangGraph checkpointer | conversation continuity and tool state |
| Hot session/cache | Redis when needed | low-latency active state and rate limits |
| Durable structured user facts | Supabase Postgres | saves, preferences, consent, viewings, owner data |
| Semantic optional recall | Qdrant | retrieval of approved summaries or knowledge, never authority |

## Non-negotiable invariants

1. Only Postgres says whether a listing is published, available, visible, or correctly priced.
2. Qdrant never exposes unpublished, withdrawn, confidential, or restricted information.
3. A model cannot publish a listing, change a price, disclose restricted information, or make a binding booking without server-enforced authorization and explicit confirmation.
4. Public content is derived from the published revision only.
5. Every consequential transition has an auditable record.
