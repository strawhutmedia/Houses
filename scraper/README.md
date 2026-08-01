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
| **Bid4Assets — county tax deeds** | `bid4assets.js` | ✅ **Live (primary)** | The real home of cheap residential auction houses. Live-parses every upcoming **CA/OR/WA county** tax-defaulted auction (29 found in testing: Ventura, Imperial, Alameda, Monterey, San Joaquin…). Per-parcel detail (address, min bid, photos) publishes ~2–4 wks pre-sale and is enriched via the parcel endpoint / a headless render in CI. Residential-only; land & commercial filtered out. |
| **GSA Real Property** | `gsa.js` | ✅ Live | `realestatesales.gov`, server-rendered. Parses type/sqft/year/lot/dates/lat-lng. Inventory skews commercial/land and is small — secondary source. |
| County tax-deed (other platforms) | `countyTaxDeed.js` | 🔨 Stub | GovEase / RealAuction / SRI for counties not on Bid4Assets. |
| U.S. Treasury | `treasury.js` | 🔨 Stub | Real property runs through **CWS Marketing** (`bid.cwsmarketing.com`). Low volume, session-gated SPA — needs the API or a headless render. |
| FDIC ORE | `fdic.js` | 🔨 Stub | Only populated after bank failures; often empty. |
| U.S. Marshals | `usmarshals.js` | ⛔ Stub (blocked) | `usmarshals.gov` returns 403; also flows through CWS. Use a headless browser / the CWS platform. |
| GovDeals | `govdeals.js` | ⛔ Stub (blocked) | `govdeals.com` returns 403. SPA with an internal JSON API — mostly non-real-estate. |

### Reality check (what actually has cheap houses)
The $10K-house volume in the pitch is overwhelmingly **county tax-deed sales** — so `bid4assets.js` is the engine. The four purely-federal sources (Marshals/Treasury/FDIC/GSA) are real but low-volume and skew non-residential; treat them as supplementary.

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
