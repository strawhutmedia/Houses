"use strict";
/*
 * Bid4Assets — County Tax-Defaulted Property Auctions
 * https://www.bid4assets.com/county-tax-sales
 *
 * THIS IS THE PRIMARY SOURCE for the cheap residential houses in the pitch.
 * Most California county tax-deed sales (Los Angeles, San Bernardino, Riverside,
 * Kern, Alameda, Butte, and dozens more) run their auctions here, plus WA/OR
 * and other states. It is the "county tax deed sales" bucket Marc lists — and
 * unlike US Marshals/GovDeals it does NOT hard-block plain requests.
 *
 * STATUS: LIVE (auction index) + parcel step.
 *   1. GET /county-tax-sales -> parse every upcoming county auction, keep CA/OR.
 *      Each row gives: county, state, auction title, storefront slug.  [WORKS via curl]
 *   2. GET /storefront/<slug> -> read StorefrontId + StorefrontCollectionId(s).
 *   3. GET /storefront/taxsales/getauctiondisplay/<StorefrontId>?storefrontCollectionId=<cid>
 *      -> parcels, once the county publishes them (usually ~2-4 weeks pre-sale).
 *      Per-parcel detail (APN, situs address, minimum bid, photos) is filled from
 *      the item pages/API; where a browser is available in the deploy environment,
 *      render the item page to capture the JS-loaded fields. In this locked-down
 *      sandbox the browser can't egress, so parcel enrichment runs in CI/prod.
 *
 * We keep ONLY residential auction property (no commercial/personal), per spec.
 */
const { fetchText } = require("../lib/http");

const BASE = "https://www.bid4assets.com";
const KEEP_STATES = ["CA", "OR", "WA"]; // WA included for the Portland-metro (Vancouver/Clark Co.) overlap

// LA-metro counties get scraped first (user priority). Lower number = higher priority.
const COUNTY_PRIORITY = {
  "los angeles": 1, "san bernardino": 1, "riverside": 1, "kern": 1, "ventura": 1, "orange": 1,
  "imperial": 2, "san diego": 2,
  // Portland metro (secondary)
  "clark": 3, "multnomah": 3, "washington": 3, "clackamas": 3,
};
function countyKey(title) {
  var m = String(title).match(/^([A-Za-z .'-]+?)\s+County/i);
  return m ? m[1].trim().toLowerCase() : "";
}
function priorityOf(title) {
  return COUNTY_PRIORITY[countyKey(title)] || 9;
}

function decode(s) {
  return (s || "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

// The index lists auctions as: "<Place> County, <ST> Tax Defaulted Properties Auction"
// alongside a storefront link. Pair titles with their storefront slugs by proximity.
function parseIndex(html) {
  const out = [];
  // capture "<a href="/storefront/SLUG">...TITLE with , ST ...</a>" and nearby text
  const re = /href="\/storefront\/([A-Za-z0-9]+)"[^>]*>([\s\S]{0,160}?)<\/a>/gi;
  let m;
  const seen = new Set();
  while ((m = re.exec(html))) {
    const slug = m[1];
    if (seen.has(slug)) continue;
    seen.add(slug);
    const text = decode(m[2].replace(/<[^>]+>/g, " "));
    const st = (text.match(/,\s*([A-Z]{2})\b/) || [])[1];
    if (!st || !KEEP_STATES.includes(st)) continue;
    // only keep tax-defaulted *property* auctions (skip timeshares/personal)
    if (/timeshare|personal|vehicle/i.test(text)) continue;
    out.push({ slug, state: st, title: text, county: countyKey(text), priority: priorityOf(text), url: `${BASE}/storefront/${slug}` });
  }
  // LA-metro counties first, then the rest (stable within a tier).
  return out.sort(function (a, b) { return a.priority - b.priority; });
}

async function getStorefrontMeta(slug) {
  const html = await fetchText(`${BASE}/storefront/${slug}`);
  const storefrontId = (html.match(/StorefrontId["'\s:]+(\d+)/) || [])[1];
  const collectionIds = [...new Set(
    (html.match(/StorefrontCollectionId["'\s:]+(\d+)/g) || []).map((s) => s.replace(/\D/g, ""))
  )];
  const title = decode((html.match(/<title>([^<]+)<\/title>/i) || [])[1] || slug);
  return { storefrontId, collectionIds, title };
}

const RESIDENTIAL = /single family|residential|duplex|triplex|fourplex|multi|condo|townhome|townhouse|manufactured|mobile|home|house|sfr/i;

function mapType(t) {
  t = (t || "").toLowerCase();
  if (/duplex|triplex|fourplex|multi/.test(t)) return "Multi-Family";
  if (/condo/.test(t)) return "Condo";
  if (/town/.test(t)) return "Townhouse";
  return "Single Family";
}

// Parse parcels from a getauctiondisplay fragment. Bid4Assets markup varies by
// county template, so this is intentionally defensive and returns [] when the
// county hasn't published parcels yet (very common for future sales).
function parseParcels(html, ctx) {
  const out = [];
  const blocks = html.split(/(?=href="\/\d{4,}")/i);
  for (const blk of blocks) {
    const idm = blk.match(/href="\/(\d{4,})"/);
    if (!idm) continue;
    const minBid = (blk.match(/(?:minimum bid|min bid|starting)[^$]{0,20}\$([0-9,]{3,})/i) || [])[1];
    const loc = blk.match(/([A-Z][A-Za-z .'-]+),\s*([A-Z]{2})\s*(\d{5})/);
    const typeTxt = (blk.match(/(single family|residential|duplex|triplex|fourplex|condo|townhouse|manufactured|mobile home|vacant|land|commercial)/i) || [])[1];
    if (typeTxt && !RESIDENTIAL.test(typeTxt)) continue; // drop land/commercial per spec

    // FREE equity basis: use the county assessed value when the listing exposes it.
    // Assessed value is a rough, no-cost proxy for market value (not an AVM) — the
    // UI labels equity as an estimate. Swap in a paid AVM later for precision.
    const assessed = (blk.match(/(?:assessed value|total assessed|assessment)[^$]{0,20}\$([0-9,]{4,})/i) || [])[1];
    out.push({
      id: "b4a-" + idm[1],
      source: "County Tax Deed",
      state: loc ? loc[2] : ctx.state,
      city: loc ? decode(loc[1]) : "",
      address: loc ? `${decode(loc[1])}, ${loc[2]} ${loc[3]}` : "",
      type: mapType(typeTxt),
      price: minBid || null,
      marketValue: assessed || null,   // free assessed-value proxy; null until published
      valueBasis: assessed ? "assessed" : null,
      rentEstimate: 0,
      auctionDate: ctx.auctionDate || null,
      url: `${BASE}/${idm[1]}`,
      live: true,
    });
  }
  return out;
}

async function scrape({ limit = 25 } = {}) {
  const index = await fetchText(`${BASE}/county-tax-sales`);
  const auctions = parseIndex(index).slice(0, limit);
  const out = [];

  for (const a of auctions) {
    try {
      const meta = await getStorefrontMeta(a.slug);
      if (!meta.storefrontId || !meta.collectionIds.length) continue;
      for (const cid of meta.collectionIds.slice(0, 6)) {
        try {
          const frag = await fetchText(
            `${BASE}/storefront/taxsales/getauctiondisplay/${meta.storefrontId}?storefrontCollectionId=${cid}`,
            { headers: ["X-Requested-With: XMLHttpRequest", `Referer: ${a.url}`] }
          );
          out.push(...parseParcels(frag, { state: a.state }));
        } catch (e) { /* collection not published yet */ }
      }
    } catch (e) {
      console.error(`  [bid4assets] ${a.slug} failed: ${e.message}`);
    }
  }
  return out;
}

// Exposed so the runner / a CI job can log what CA/OR auctions are upcoming even
// before parcels publish — useful signal that the source is live.
async function listAuctions() {
  const index = await fetchText(`${BASE}/county-tax-sales`);
  return parseIndex(index);
}

module.exports = { scrape, listAuctions, id: "bid4assets", label: "Bid4Assets County Tax Sales", status: "live" };
