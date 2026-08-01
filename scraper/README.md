# EquityScout scraper

Pulls government home-auction listings from multiple sources, normalizes them
into one schema, and writes `../listings.json` — which the website loads at
runtime. If `listings.json` is missing or empty, the site falls back to the
curated sample set in `../data.js`, so the page is never blank.

## Run it

```bash
node scraper/run.js                 # all adapters -> listings.json
node scraper/run.js --gsa           # a single adapter by id
node scraper/run.js --states=CA,OR  # keep only these states
```

No npm install required — the only runtime dependency is the `curl` binary
(used by `lib/http.js` so it works behind proxies/CI without extra packages).

## Source status

| Source | Adapter | Status | Notes |
|---|---|---|---|
| **HUD Home Store** | `hud.js` | ✅ **Live** | Real FHA-foreclosure homes, **all 50 states** (one GET per state, parallel batches). ~930 homes/run. Best breadth of cheap residential. `HUD_STATES=CA,OR` to narrow. |
| **Bid4Assets** | `bid4assets.js` | ✅ **Live** | County tax-deed / sheriff-sale **houses** via the live real-estate channel (`POST /channel/auctions/get` + detail pages). The rock-bottom prices ($1–$2K). Also lists upcoming CA/OR/WA county tax sales (`listAuctions()`) for when those windows open. |
| **PublicSurplus** | `publicsurplus.js` | ✅ Live (thin) | Gov surplus real estate (`catid=15`). Curl-scrapable but low volume and land-heavy; residential-only keeps mobile/manufactured homes. |
| **CWS (Treasury + US Marshals)** | `cws.js` | 🧪 Experimental (headless) | Contractor platform for **both** agencies' forfeiture homes. Returns HTTP 202 bot-challenge to curl → needs a real browser (Playwright). No-ops in the dev sandbox; runs in CI. Selectors need one live-verification pass. |
| GSA Real Property | `gsa.js` | ⚪ Live but excluded | `realestatesales.gov` parses fine but is commercial/land — kept out of the default run per the houses-only spec. |
| FDIC ORE | `fdic.js` | 🔨 Stub | ORE listing app is empty/offline right now (few bank failures). |
| GovDeals | `govdeals.js` | ⛔ Stub (blocked) | `govdeals.com` 403s; mostly non-real-estate. |

### AI enrichment (`lib/aiExtract.js`, wired in `run.js`)
When `ANTHROPIC_API_KEY` is set, the runner enriches the cheapest
`ES_ENRICH_LIMIT` (default 40) listings: **market-value + rent estimate** (real
built-in equity / discount, powering the "Best deals" sort) and **photo-based
condition ratings** (vision). No key → enrichment is skipped and the scrape
still runs. Model via `ES_EXTRACT_MODEL` (default `claude-opus-5`; use
`claude-haiku-4-5` for cheap high-volume). Set the key as a repo Actions secret
to activate it in the scheduled deploy.

### Reality check (what actually has cheap houses)
The $10K-house volume in the pitch is overwhelmingly **county tax-deed sales** — so `bid4assets.js` is the engine. The four purely-federal sources (Marshals/Treasury/FDIC/GSA) are real but low-volume and skew non-residential; treat them as supplementary.

### AI extraction stage (`lib/aiExtract.js`)
"The AI that scrapes every source." Every county/agency formats listings
differently, so instead of a brittle parser per site, this stage hands a raw
page — **or a screenshot** — to Claude and gets back clean, structured
residential listings that match our schema. It also does **photo condition
assessment** (vision → Move-in Ready … Heavy Rehab).

- `extractListingsFromHtml(html, ctx)` — messy HTML → structured homes
- `extractListingsFromImage(b64, media, ctx)` — a screenshot of a listing page → homes (the "just screenshot the site" idea, automated)
- `assessConditionFromPhotos([b64...], ctx)` — listing photos → condition/damage rating

Auth: set `ANTHROPIC_API_KEY` (or use an `ant auth login` profile). With no key
it no-ops (returns `[]`/`null`) so the scraper still runs. Model defaults to
`claude-opus-5`; set `ES_EXTRACT_MODEL=claude-haiku-4-5` for cheap high-volume
extraction. Residential-only is enforced in the prompt and schema.

### Automated refresh
`.github/workflows/refresh.yml` runs the scraper every 3 hours and redeploys the
site to GitHub Pages. A real Chromium is available in Actions (unlike the dev
sandbox), so parcel-detail enrichment that needs JS rendering runs there.

## Adding / finishing an adapter

Each adapter exports `{ id, label, status, scrape() }`. `scrape()` returns an
array of raw listing objects; `run.js` pushes them through
`lib/normalize.js` → `normalizeListing()`, so you only need to fill in the
fields you can get:

```js
{
  id: "b4a-la-12345",          // unique, stable
  source: "County Tax Deed",
  city: "Palmdale", state: "CA",
  address: "3742 Sunburst Ave, Palmdale, CA 93550",
  type: "Single Family",        // Single Family | Multi-Family | Townhouse | Condo | Land | Commercial / Other
  beds: 3, baths: 2, sqft: 1620, year: 1988,
  price: 62000,                 // opening / min bid
  marketValue: 398000,          // optional; enables the equity score
  rentEstimate: 2500,           // optional; enables gross-yield sort
  auctionDate: "2026-08-12",    // any parseable date; normalized to YYYY-MM-DD
  lat: 34.57, lng: -118.11,     // optional
  url: "https://www.bid4assets.com/..."  // deep link back to the source
}
```

`marketValue`/`rentEstimate` power the equity + yield features. Where a source
doesn't publish them, leave them null and enrich later with an AVM/rent API —
the site degrades gracefully (shows "See source" / hides the equity bar).
