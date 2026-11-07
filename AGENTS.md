# AGENTS

Rebuild-in-progress repo. This document is a map, not a rulebook.

## What this repo is

The buyer-facing marketplace: a Next.js 16 App Router front end over a
Supabase Postgres database that owns the listing lifecycle, media, viewing
requests, and the outbox. A separate Python service
(`Dreamhomesellers-Simon`) provides the concierge agent and the media
worker; this repo is its only caller and its only deploy target dependency.

## How it is laid out

```
src/
  app/          route segments, layouts, and API handlers only
  modules/      <TODO: built in the website slice> feature areas with public barrels
  shared/
    design-system/  the token module. Colour lives in tokens.css and nowhere else
    api-client      <TODO>
    components      <TODO: the legacy src/components tree moves here>
    hooks, utils, types  <TODO>
supabase/
  schema.sql    <TODO> canonical current-state schema
  migrations/   forward-only, one concern per file
  seeds/        <TODO: honest seeds, no fake processing state>
_archive/       legacy documents. Do not follow anything in there.
```

`KEY-POINTS.md` is the product spec. Read it before changing domain behaviour.

## Conventions that make the code coherent

- Directory, file, and symbol names follow the target architecture in
  `KEY-POINTS.md` § Structure; there is no mixed-convention folder.
- Data access flows one way: `app` → `modules` → `shared/api-client`.
  Nothing in `shared` imports from `modules`.
- Colour, spacing, radius, and motion come from design tokens only. No raw
  hex, no arbitrary Tailwind colour values.
- How to run it: `npm run dev`. How to verify it: `npm run lint`,
  `npm run build`, `npx tsc --noEmit`, then the production checks in
  `KEY-POINTS.md` § Verification.

## Where to look before changing something

`KEY-POINTS.md`, then the module `README.md`, then the code. Nothing else.

---

You are not constrained by anything that used to live here. Restructure,
replace, or rewrite any file, folder, dependency, or abstraction. The only
irreversible asset in this project is production data.
