# Property254 input inventory — search and listing

Research note, 2026-11-01. Reference for LUXONN's buyer search and owner listing
forms. This is a public-surface crawl, not an integration contract.

## Why this exists

LUXONN's marketplace work needs a competitive baseline: what a Kenya-focused
portal actually asks buyers and owners for, which inputs work, and which parts of
its data model leak into the UI. Property254 is a useful comparison because it is
live, Kenya-first, and visibly mid-migration from a legacy schema.

## Method and limits

- Target: `https://property254.co.ke`. The supplied `property254ke.co.ke` does
  not resolve; `property254.co.ke` is the live domain.
- Public pages and the site's own same-origin JSON endpoints, read on
  2026-11-01. No account was created, no form was submitted, and no listing was
  created or modified.
- Sale inventory sampled through the public API: 1,264 rows returned across 106
  pages, 1,252 unique ids. Rent inventory: 55 rows across 5 pages.
- `/add-property` is auth-gated (HTTP 403). The exact form controls, validation
  messages, media limits, and moderation flow could not be observed. The listing
  field inventory in §8 is reconstructed from the public listing JSON and the
  property detail page; it is marked as inferred, not observed.

## 1. Homepage search

The hero has two tabs, Buy and Rent. Each tab has one text input and one button.

| Tab | Input id | Placeholder | Action |
| --- | --- | --- | --- |
| Buy | `#surburb_buy` | `Enter a Location, Town or Estate` | `/properties-for-sale?location=<value>` |
| Rent | `#surburb_rent` | `Enter a Location, Town or Estate` | `/properties-to-let?location=<value>` |

There is no property type, bed count, price, or amenity control on the homepage.
The input is free text: no place picker, no autocomplete, no canonical geography.

## 2. Sale results page — `/properties-for-sale`

Visible controls:

| Control | Element | Options / behaviour |
| --- | --- | --- |
| Location | `#sub_city` text | `Enter a Location, Town or Estate`; submits `?location=<value>` |
| Property type | `<select>` | `Property type` (empty), `Land For Sale` (`land`), `Houses For Sale` (`houses`) |
| Price | dropdown toggle plus `#minprice` / `#maxprice` | `Min. price`, `Max. price`; `Price Search` submits `?maxprice=<>&minprice=<>` |
| Sort | `<select>` | `default`, `1` price low→high, `2` price high→low, `3` newest, `4` oldest |
| View | Map / List tabs | Map uses Leaflet; list is the default |
| Paging | First / Previous / Next / Last | 12 results per page |

The page reads these URL parameters in JavaScript:

```
location, propertyfor, propertytype, beds, maxprice, minprice, page, orderbyp
```

`location` is passed to the API as `city`. The API is:

```
GET /api/properties-for-sale
  ?city=&propertyfor=&propertytype=&beds=&maxprice=&minprice=&orderbyp=&page=
```

Response shape: a GeoJSON `FeatureCollection` with `features` (points) and a
parallel `properties` array, plus `pagination` and `likedProperties`. Each page
holds 12 listings.

Important: the UI does not expose `beds` on this page even though the API accepts
it. The location, property-type, and price controls each navigate with only their
own parameter, so changing one discards the others. The `propertytype` select
sends `land` / `houses`; the older `/land-for-sale` and `/houses-for-sale` links
send numeric ids (`10` / `11`), which the API mishandles (see §9).

## 3. Rent results page — `/properties-to-let`

Same layout and the same location, price, sort, map/list, and paging controls.

| Control | Options |
| --- | --- |
| Property type | `Property For Rent` (`12`), `Furnished Apartments/ Airnb` (`13`) |
| Price | min / max |
| Sort | default, price low→high, price high→low, newest, oldest |

API:

```
GET /api/properties-to-let
  ?city=&propertyfor=&propertytype=&beds=&maxprice=&minprice=&orderbyp=&page=
```

The rent inventory is small (55 listings) and the data is thinner than the sale
side: every returned row had `beds: null` and `city: null`, so every card renders
`- null` where the location should be.

## 4. Alternate land and house pages

`/land-for-sale` and `/houses-for-sale` are older entry points with a slightly
larger filter set:

| Control | Land | Houses |
| --- | --- | --- |
| Location | `Suburb,City` | `Suburb,City` |
| Property type | `10` land, `11` houses, `12` rent, `13` furnished/Airbnb | same |
| Bedrooms | — | `1`–`4` |
| Price | min / max | min / max |
| Sort | default / price / newest / oldest | same |

The bed select exists only here. Its URL builder points at
`/land-for-sale?city=...&propertytype=...&beds=...`, which is another sign that
the sale, rent, land, and house pages grew independently rather than sharing one
search form.

## 5. Results card anatomy

The rendered card is deliberately small:

```
Ksh 9,000.00                 <- price, two decimals, no ISO code
3 bedroom                    <- area_sq_ft, reused as a subtitle
Lovely Furnished 3 brm ...   <- address_line1 (the listing title)
  - Kilimani                 <- " - " + address_line2
[image]                      <- picture; often broken
```

There are no bed/bath icons, no property-type badge, no agent name, and no
verified/published marker on the card. The subtitle is not a room count: it is
whatever the owner typed into `area_sq_ft` (`3 bedroom`, `50x100`, `5660 sqft`,
`5096 sqm`). The card therefore cannot be filtered or compared on that value.

## 6. Property detail page

Example: `/house-for-sale/EAST-VISTA-Residence/1771442005`.

Observed sections and fields:

- Header: title, price (`Ksh 6,600,000`).
- Gallery: five images; all rendered as broken `feature` placeholders in the
  crawl.
- Facts: `Bedrooms` (`1 Bedroom`), `Bathrooms` (`1 bathroom`).
- Description: owner-supplied HTML.
- Location: a map section (not expanded in the crawl).
- Agent card: agent name, phone, WhatsApp link.
- Lead form (`POST /leads/save`): `name`, `email`, `contact`, `message`,
  hidden `user_id`, hidden `full_url`.
- Review form (`POST /review-ratings`): `rating` (0–5 radio), `title`, `review`,
  hidden `property_id`.
- Share bar: WhatsApp, copy link, Facebook, LinkedIn, generic share.

The detail page is the only place the full listing facts appear; the search card
does not carry them.

## 7. Listing flow — auth-gated

The public path to listing is:

1. **Sign up** (`/register`): `first_name`, `last_name`, `telephone`, `email`,
   `password`, `agree` checkbox. Also Facebook and Google OAuth buttons.
2. **Sign in** (`/login`): `email`, `password`, `remember` checkbox, forgot
   password, OAuth buttons.
3. **Dashboard**: `/dashboard` redirects anonymous users to `/login`.
4. **Add property**: `/add-property` is the canonical route. Anonymous requests
   receive HTTP 403 with a page titled `Page Not Found!` and the line
   `Please Login to Continue`. There is no redirect to `/login`, no `next`
   parameter, and no explanation of what the form will ask for.

Route probing (GET, anonymous):

| Route | Result |
| --- | --- |
| `/add-property` | 403, auth required |
| `/add-property/` | redirect to `/public/add-property`, then 403 |
| `/dashboard` | redirect to `/login` |
| `/dashboard/add-property` | 404 |
| `/properties/create` | 404 |
| `/property/create` | 405 (`DELETE` only) |

The exact listing form controls, required-field rules, image count/size limits,
draft behaviour, and moderation states were not observable without an account.
Creating one was deliberately out of scope for this crawl.

## 8. Listing data model exposed by the public JSON (inferred form fields)

The sale/rent JSON returns the full listing row, including fields the card and
detail page do not display. Grouped, these are the inputs the listing form must
collect or derive:

**Identity and location**

| Field | Notes |
| --- | --- |
| `id` | numeric listing id |
| `address_line1` | listing title, also used in the detail URL |
| `address_line2` | estate / town, shown after the title |
| `street` | often a duplicate of `address_line2` |
| `city` | a road/region bucket (`Thika Road`, `Ngong Road`, `Coast`, `Waiyaki Way`), not a town |
| `state` | county, e.g. `Nairobi County` |
| `zipcode`, `zipcode1` | rarely populated |
| `lat`, `lng` | decimal strings; map pin |
| `address_slug` | title slug plus a numeric suffix |

**Offer and price**

| Field | Notes |
| --- | --- |
| `propertyfor` | legacy offer flag; every tested value returned 0 rows |
| `propertytype` | `10` land, `11` houses, `12` rent, `13` furnished/Airbnb |
| `price` | numeric; KES implied |
| `price_string` | display string |
| `lease_duration`, `lease_terms` | rent/shortlet terms |
| `security_deposit` | rent |
| `date_available` | rent |

**Residential facts**

| Field | Notes |
| --- | --- |
| `beds`, `baths` | free-text strings, not integers (`3`, `3 bedrooms`, `2 Bathrooms`) |
| `accommodation_type` | mostly null |
| `area_sq_ft` | free text; also used as the card subtitle |
| `build_up_area`, `floor_size`, `kitchen_size` | free text |
| `year_built` | |
| `flooring_type`, `colling_type` (sic) | |
| `garages`, `servent_quater` (sic) | |
| `services`, `appliances`, `laundry` | |
| `furnished` | |
| `cats`, `smalldogs`, `largedogs`, `no_pets_allowed` | pet policy |

**Land**

| Field | Notes |
| --- | --- |
| `indicate_soil_type` | land-only |

**Media**

| Field | Notes |
| --- | --- |
| `image` | legacy single image URL |
| `pictures[]` | rows with `property_images` paths |
| `property_video`, `property_video_url`, `video`, `video_type` | video |
| `property_banner` | banner image |

**Publishing and moderation**

| Field | Notes |
| --- | --- |
| `draft` | 0/1 |
| `property_approve` | 0/1 |
| `property_active_status` | 0/1 |
| `premium` | 0/1 |
| `close` | 0/1 |
| `property_viewed` | counter |
| `user_id` | owner/agent |
| `created_at`, `updated_at`, `deleted_at` | timestamps |

The field names are the real contract of the legacy system: typos included
(`colling_type`, `servent_quater`), money as a number, beds/baths as text, and
location split across four unnormalised columns.

## 9. Observed behaviour defects

These are user-visible in the crawl and matter as counter-examples for LUXONN.

| Symptom | Evidence | Impact |
| --- | --- | --- |
| Location box searches titles, not locations | `?location=Karen` → 0 results, although the API inventory contains 35 Karen listings; `?location=Kilimani` → 2; `?city=Lovely` → 6; `?city=Kileleshwa Bell` → 1 | A buyer cannot find an estate by name; the primary search input is effectively a title keyword box |
| Numeric property type is ignored | Sale: `propertytype=10`, `11`, `99`, `houses` all → 469; `propertytype=land` → 287. Rent: `12`, `13`, `rent`, `furnished` all → 10 of 55 | The land/house links send `10`/`11` and land up on the houses set; the rent "Property For Rent" filter hides 35 of 45 rental listings |
| Sort is ignored | `orderbyp=1`, `2`, `3`, `4` all return the same first prices | Price/newest sort does nothing |
| Pagination totals disagree | Page 1 reports 756, page 2 reports 1,264; 12 rows per page | Result counts are not trustworthy |
| `propertyfor` is dead | `1`, `2`, `buy`, `rent` all → 0 | The offer filter cannot be used |
| Location is missing on most rows | 675 of 828 sampled sale rows had `city: null`; 482 had `address_line2`/`street: null`; every rent row had both null | Cards show `- null`; location search and map pins are unreliable |
| Beds/baths are free text | `3`, `3 bedrooms`, `2 Bathrooms`, 593/660 null | `beds=3` matches only the numeric strings; filters miss most inventory |
| Images are broken | Card and detail `<img>` URLs under `/blogUploadedImages/uploads/...` render as broken placeholders | The visual marketplace is text-only in practice |
| Area field is overloaded | Card subtitle holds `3 bedroom`, `50x100`, `5660 sqft`, `5096 sqm` | Buyers cannot compare or filter on size |
| Auth gate is a fake 404 | `/add-property` → 403 page titled `Page Not Found!` with `Please Login to Continue` | A legitimate owner is told the page does not exist; no login redirect or return path |
| Filters do not compose | Each control navigates with only its own parameter (`?location=`, `?propertytype=`, `?maxprice=&minprice=`) | Choosing a location discards the price and type; choosing a price discards the location |
| No place autocomplete | Location is a free-text input on every page | Estate names are typed differently (`Karen`, `KAREN`, `Karen.`), so matching is fragile |

## 10. Implications for LUXONN

### Buyer search inputs

- **Location**: a canonical place picker (county → town/estate) plus optional
  free text, matched against the canonical place, not the listing title. Store
  the place id on the listing; do not rely on a `city` string.
- **Deal**: sale / rent / shortlet as a typed enum.
- **Property type**: house, apartment, townhouse, land, commercial, etc. Keep the
  enum separate from the deal type.
- **Price**: min/max with an explicit currency and period; money stays a decimal
  string (ADR-001). A single price control should not silently drop the period.
- **Rooms**: integer beds/baths, with `studio` and `4+` handled explicitly.
- **Amenities and facts**: parking, furnished, pet policy, year built, size with
  a unit (`sqm` vs `sqft`).
- **Sort and paging**: real server-side sort; stable page size; one authoritative
  total.
- **URL state**: every filter lives in the URL and every change preserves the
  others. Shareable, back-button-safe, resettable.
- **Empty state**: say which filter caused zero results and offer to clear it.

### Listing form shape

A staged wizard, not one long page:

1. **Account and role** — owner or agent; email/password plus OAuth; preserve
   `next=/add-property` through login. Never show a 404 for an auth gate.
2. **Offer and type** — sale/rent/shortlet, then property type.
3. **Location** — county, town/estate, street/address, map pin, canonical place
   id, optional lat/lng. Make the estate a picker, not free text.
4. **Facts** — beds, baths, size + unit, year built, parking, amenities,
   furnished, pet policy. Typed inputs with units, not one `area_sq_ft` string.
5. **Price and terms** — amount (decimal), currency (default KES), period
   (total / per_month / per_night), deposit, available date, lease terms.
6. **Media** — required cover image, ordered gallery, captions/alt text, video.
   Show derivative-processing status instead of publishing broken paths.
7. **Review and publish** — preview the buyer card, show a required-field
   checklist, save drafts automatically, explain moderation and expected SLA.

### Card contract

The card should carry the facts a buyer compares, not a single overloaded
subtitle:

```
listingId, title, propertyType, location (canonical),
price, currency, pricePeriod, bedrooms, bathrooms,
area + areaUnit, coverImageUrl, publishedBadge
```

Format money in the host (`formatListingPrice`), not in the service. Do not put
`3 bedroom` in an area field.

### Publish gates

Block publication unless the listing has a canonical location, a positive price,
a valid deal/type, integer beds/baths where applicable, and a cover image.
Validate enums at the boundary; do not let free text into fields the search and
cards depend on. A listing that cannot render a location should not be published
as `- null`.

## 11. Open questions for a follow-up crawl

- Exact `/add-property` fields, required/optional split, validation copy, image
  count and size limits, draft autosave, and moderation states. This needs an
  authorised account; ask the owner before creating one.
- Whether agents and owners see different forms or permissions.
- Premium/featured rules and how `premium`, `property_approve`, and
  `property_active_status` interact.
- Whether the `city` filter's title matching is intentional or a regression.
- Why `propertytype` accepts only `land`/`houses` strings while the land/house
  pages send numeric ids.
- Rent/shortlet taxonomy: why type `11` contains rentals and why the rent
  `12`/`13` filters both return the same 10 rows.

## Reproduction

Public pages:

```
https://property254.co.ke/
https://property254.co.ke/properties-for-sale
https://property254.co.ke/properties-for-sale?location=Karen
https://property254.co.ke/properties-to-let
https://property254.co.ke/land-for-sale
https://property254.co.ke/houses-for-sale
https://property254.co.ke/house-for-sale/EAST-VISTA-Residence/1771442005
https://property254.co.ke/add-property        # 403, anonymous
https://property254.co.ke/register
https://property254.co.ke/login
```

Public JSON:

```
GET /api/properties-for-sale?page=1
GET /api/properties-for-sale?city=Kilimani
GET /api/properties-for-sale?propertytype=land
GET /api/properties-to-let?page=1
```

No writes, no authentication, and no account creation were performed.
