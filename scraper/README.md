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
| **GSA Real Property** | `gsa.js` | ✅ **Live** | `realestatesales.gov` is server-rendered and un-blocked. Parses type, sqft, year, lot, dates, lat/lng. Inventory skews commercial/land and is small (~12 nationwide); live bid amounts are pushed over a socket and aren't in static HTML yet. |
| County tax-deed | `countyTaxDeed.js` | 🔨 Stub (per-county) | **Highest-value target for cheap residential.** Best path: one **Bid4Assets** adapter for LA / San Bernardino / Riverside / Kern counties. |
| U.S. Treasury | `treasury.js` | 🔨 Stub | Sold through a rotating contractor (e.g. CWS). Needs a parser against the current vendor. |
| FDIC ORE | `fdic.js` | 🔨 Stub | Only populated after bank failures; queryable by state when inventory exists. |
| U.S. Marshals | `usmarshals.js` | ⛔ Stub (blocked) | `usmarshals.gov` returns 403. Use a headless browser, or scrape the downstream contractor site. |
| GovDeals | `govdeals.js` | ⛔ Stub (blocked) | `govdeals.com` returns 403. SPA with an internal JSON search API — capture and call it directly, or use a headless browser. |

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
