# Current state — 2026-10-11

## Repository ownership

`dreamhomesellers/` is a Next.js 16.4.0, React 19.3.0, TypeScript, Tailwind CSS 4 frontend. It currently owns the LUXONN visual experience and portable product documentation.

`../simon` is a separate Python 3.13 service repository. It contains the current LangChain/Chainlit Simon prototype and shares the intended Supabase/Qdrant property infrastructure. It is not yet a native LUXONN backend API.

## What works now

- Dark/gold LUXONN visual system using Bebas Neue and Inter.
- GSAP, Framer Motion, Lenis, React Three Fiber, Drei, and Three.js are available for high-motion and 3D surfaces.
- A homepage with luxury marketing sections.
- A floating Simon launcher and direct `/simon` route that embed the Chainlit service through a server-configured URL.
- A native horizontally scrollable `PropertyShowcase`; the previous scroll-pinned implementation was removed because it blocked lower-page scrolling.
- The existing Python Simon prototype can search the existing Supabase-backed Kenyan property pool, compare properties, book viewings, and create listing/lead records through authored tools.

## What is provisional or incomplete

### Frontend

- Property cards and homepage property material are hardcoded marketing content, not inventory from a canonical catalog.
- The site still contains global-luxury marketing references. LUXONN is now Kenya-focused; those references must be replaced with real Kenyan inventory or clearly editorial, non-inventory material during the marketplace build.
- Root metadata still describes a global luxury market and must be corrected when the real marketplace information architecture is implemented.
- No real buyer search route, filter state, property detail pages, saved listings, comparison state, owner portal, moderator portal, or map experience exists.
- The login page is presentation-only; there is no Supabase Auth integration or protected route enforcement.
- The circular gallery is an unrelated animal-photo demo on `/gallery`. It is not property data and must not be used as broad search results.
- There are no application tests, retrieval evaluations, or CI checks beyond ad hoc local lint/build verification.

### Simon service

- Simon currently uses LangChain `create_agent` and authored async tools. This remains suitable for short live buyer-concierge turns.
- Its public UI is Chainlit inside an iframe. This is transitional and will be replaced by native React chat backed by Python streaming APIs.
- Conversation state uses `InMemorySaver`, so state is lost across process restarts.
- The agent is Kenya/Nairobi/KES oriented, unlike old global marketing copy in the frontend.
- The current Supabase REST catalog and Qdrant text search are working prototype integrations, but they are not yet a revisioned, moderated marketplace architecture.
- The current Cloudflare embedding path is text-only. It cannot directly embed raw property images.

## Current technical facts

| Area | Current state | Target direction |
| --- | --- | --- |
| Frontend | Next.js App Router, static marketing content | Keep framework and visual system; replace static property data with marketplace data |
| Auth | No functional authentication | Supabase Auth; owner-only listing management; anonymous buyer discovery |
| Catalog authority | Existing Supabase prototype data | Revisioned Supabase Postgres marketplace domain model |
| Media | No website upload/processing lifecycle | Private Storage uploads, async enrichment, moderated public derivatives |
| Search | Static cards and prototype Simon tools | Dense URL-backed search grid, Postgres hydration, Qdrant projection |
| Simon UI | Chainlit iframe | Native React surface + Python streaming API |
| Agent persistence | In-memory checkpoints | Persistent Postgres checkpointer, optional Redis cache |
| Circular gallery | Animal demo only | Curated collections, shortlists, similar-property surfaces |

## Files that remain intentionally untouched

- `Simon.env` is local secret material and is ignored. Never inspect or copy it.
- `.claude-flow/` and `prompt.txt` are unrelated untracked local artifacts. Do not stage or modify them as part of marketplace work.
- The old sibling projects `../Simon` and `../Simon-Langchain` remain outside this project and are not sources for the new architecture.
