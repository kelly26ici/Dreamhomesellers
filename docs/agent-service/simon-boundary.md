# Simon service boundary

## Goal

Simon becomes a native LUXONN concierge experience, not an iframe-contained chat product. The frontend owns interaction design and page context. A Python service owns streaming, agent execution, retrieval orchestration, and constrained marketplace actions.

## Transitional state

The existing Python prototype is in `../simon` and currently uses LangChain, Chainlit, Supabase REST, Qdrant, and authored tools. Keep it operational while the native integration is designed. Do not merge repositories or remove Chainlit until an equivalent native path works.

## Target API role

FastAPI is the preferred boundary for the Python service because it can expose typed HTTP and streaming endpoints to the native Next.js UI.

Illustrative capability boundaries:

```text
chat stream
listing search/read operations
owner draft commands
viewing and human-handoff commands
media-processing job endpoints/workers
internal research workflows
```

Exact endpoint shapes must follow the marketplace domain model and authorization rules; this document is not an API specification.

## Agent selection

### Use `create_agent` for live concierge turns

Suitable for low-latency, bounded conversations:

- “Show me two-bedroom homes in Westlands below KSh 18m.”
- “Compare these two listings.”
- “What does this property’s photo evidence show?”
- “Find similar published homes.”
- “Request a viewing.”

The agent receives typed runtime/page context and only uses constrained marketplace tools.

### Use Deep Agents or explicit LangGraph workflows selectively

Suitable for longer work where planning, delegation, artifact creation, or compaction are valuable:

- helping an owner assemble a complete listing draft;
- preparing a buyer relocation or investment brief;
- internal neighborhood/market research with citations;
- staff research or report generation.

Do not make ordinary catalog search invoke a Deep Agent. It increases latency, cost, and action unpredictability without improving a simple answer.

### Use deterministic workers for ingestion and state changes

Image processing, embedding generation, Qdrant indexing, publication, moderation transitions, notifications, and booking state changes must be explicit idempotent jobs or domain services. They are not agentic tasks.

## Page context contract principles

Native Simon should receive transient context directly from the LUXONN app on each relevant chat turn or context update.

```text
contract version
monotonic sequence number
route and view mode
active listing ID + published revision ID
search filters/sort
active result position/result count
visible IDs and compare selection
optional approximate location only after consent
```

The context declares what the visitor means. The Python service retrieves what is true.

## Retrieval rules

1. Apply structured constraints such as city, price, bedrooms, property type, status, and visibility.
2. Retrieve semantic candidates from a buyer-safe Qdrant projection.
3. Group candidates by listing/revision, never by loose chunk similarity.
4. Hydrate authoritative current facts from Postgres.
5. Return a small number of clearly attributed property bundles.
6. State uncertainty rather than inventing property-specific facts when evidence is insufficient.

## Memory and persistence

The current prototype’s `InMemorySaver` is not suitable for product continuity.

Target progression:

1. Persistent Postgres-backed LangGraph checkpointing for conversation thread state.
2. Redis only when a hot session cache, rate limit, or short-lived coordination need is demonstrated.
3. Explicit conversation summaries/compaction for lengthy threads, saved with provenance and revision metadata.
4. User-controlled structured preferences in Postgres.
5. Optional Qdrant semantic recall only for approved, non-authoritative summaries or knowledge.

Do not create invisible permanent memory from all chat content. Respect consent, purpose limitation, retention, correction, and deletion.

## Image knowledge pipeline

### Per image

Store a stable media ID, owning revision ID, ordered position, private storage reference, safe public derivative references, processing status, content hash, caption, room classification, visual features, quality/moderation flags, analysis model/version, and processing timestamp.

### Per property/listing revision

Generate a visual dossier that summarizes coverage and groups image evidence by room/feature. This prevents the model from seeing an unstructured pile of captions every turn.

### Evidence language

- Listing facts are sourced from the published Postgres revision.
- Visual observations are labeled as photo-derived.
- Incomplete/processing media results in transparent uncertainty.
- Original images are retrieved only for questions that cannot be answered from the stored dossier, and only when policy permits.

## Model/provider policy

The user currently has free-tier access across Cloudflare, NVIDIA, Groq, and Gemini. Do not hardcode a provider choice based only on benchmarks or free-tier claims. Build a small Kenya-focused evaluation set before replacing working models.

Evaluate model choices against:

- Kenyan locations, neighbourhood spelling, and local property terminology;
- KSh and buyer budget language;
- constrained tool-call accuracy;
- caption schema compliance and visual-feature accuracy;
- retrieval quality, latency, quota behavior, and failure fallback.

The current Cloudflare embedding model is text-only. It can embed listing documents, captions, and visual dossiers. A multimodal/image embedding model is a later, separately evaluated addition using a named vector space.
