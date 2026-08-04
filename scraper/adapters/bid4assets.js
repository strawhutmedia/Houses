"use strict";
/*
 * Bid4Assets — County Tax-Deed & Foreclosure Auctions
 * https://www.bid4assets.com
 *
 * The real home of Marc's "$1 / $10K houses." Two live systems, both curl-only:
 *
 *  (A) LIVE real-estate channel — always has individually-priced properties:
 *        POST /channel/auctions/get  (channelCode=22)  -> rows {auctionId, title}
 *        GET  /auction/index/<id>    -> item-specifics table (address, beds,
 *             baths, sqft, county, APN) + current bid + close date.
 *      This is the primary path and yields real tax-deed/sheriff-sale HOUSES
 *      with current bids often in the hundreds/low-thousands.
 *
 *  (B) County tax-sale storefronts (CA/OR/WA) — the scheduled county auctions.
 *      Parcels are published only while a given county sale is OPEN, via
 *        POST /api/storefront/auctions/index  {storefrontId, storefrontCollectionId}
 *      Exposed as listAuctions()/listOpenParcels() so the runner can pull them
 *      when a target-county sale opens (LA / San Bernardino / Riverside / Ventura).
 *
 * Residential only: land, lots, acreage, timeshares and commercial are dropped.
 */
const { fetchText, fetchPost } = require("../lib/http");

const BASE = "https://www.bid4assets.com";
const KEEP_STATES = null; // null = keep all states (channel is national; tag from detail). Set e.g. ["CA","OR","WA"] to restrict.

const RES_POS = /house|home|condo|town\s?home|townhouse|duplex|triplex|fourplex|bungalow|cottage|\b\d\s*bed/i;
const RES_NEG = /\bland\b|\blot\b|acre|vacant|timeshare|parking|commercial|billboard|storage/i;

function clean(s) {
  return String(s || "").replace(/<br\s*\/?>/gi, ", ").replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").replace(/,\s*,/g, ",").trim().replace(/,\s*$/, "");
}
function num(v) { var n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.]/g, "")); return isFinite(n) ? n : null; }

// ---- channel listing rows ----
async function channelRows(page, state) {
  var form = "channelCode=22&categoryCode=&currentPage=" + page +
    "&pageSize=100&lev3=&sortOrderColumn=&sortOrderDirection=&specialtyChannel=&locatedState=" + (state || "");
  var html = await fetchPost(`${BASE}/channel/auctions/get`, { form: form });
  var out = [], seen = {};
  var re = /href="\/auction\/(\d+)"[^>]*>([\s\S]{3,140}?)<\/a>/gi, m;
  while ((m = re.exec(html))) {
    var id = m[1]; if (seen[id]) continue; seen[id] = 1;
    var title = clean(m[2]);
    if (!title) continue;
    if (RES_NEG.test(title)) continue;         // drop land/commercial early
    if (!RES_POS.test(title)) continue;         // keep residential-signal titles
    out.push({ id: id, title: title });
  }
  return out;
}

// ---- detail page ----
function specVal(html, label) {
  var re = new RegExp(">" + label + "<\\/strong>\\s*<\\/td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>", "i");
  var m = html.match(re);
  return m ? clean(m[1]) : "";
}
function mapType(title) {
  var t = (title || "").toLowerCase();
  if (/condo/.test(t)) return "Condo";
  if (/town\s?house|town\s?home/.test(t)) return "Townhouse";
  if (/duplex|triplex|fourplex|multi/.test(t)) return "Multi-Family";
  return "Single Family";
}
function parseCloseDate(html) {
  var m = html.match(/actual-close-time-block"[^>]*>\s*(\d{2})-(\d{2})-(\d{2})/i);
  if (!m) return null;
  return m[1] + "/" + m[2] + "/20" + m[3]; // MM/DD/YYYY
}
function parseAddress(addr) {
  // "10 Louise Ln, Sauget, IL 62206, United States"
  var parts = addr.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  var out = { street: parts[0] || "", city: "", state: "", zip: "" };
  var sz = addr.match(/,\s*([A-Za-z .'-]+),\s*([A-Z]{2})\s*(\d{5})/);
  if (sz) { out.city = sz[1].trim(); out.state = sz[2]; out.zip = sz[3]; }
  return out;
}

async function fetchDetail(id, title) {
  var html = await fetchText(`${BASE}/auction/index/${id}`, { timeout: 35 });
  var addrRaw = specVal(html, "Address");
  var a = parseAddress(addrRaw);
  var bid = (html.match(/current-bid-span"[^>]*>\s*\$([\d,]+)/i) || [])[1];
  var minBid = (html.match(/Minimum Bid[^$]{0,30}\$([\d,]+)/i) || [])[1];
  var type = mapType(title + " " + specVal(html, "Property Type"));
  if (RES_NEG.test(addrRaw + " " + title)) return null;
  return {
    id: "b4a-" + id,
    source: "County Tax Deed",
    state: a.state, city: a.city,
    address: addrRaw || title,
    type: type,
    beds: num(specVal(html, "Number Of Bedrooms")) || 0,
    baths: num(specVal(html, "Number Of Bathrooms")) || 0,
    sqft: num(specVal(html, "Living Space")) || 0,
    year: num(specVal(html, "Year Built")) || null,
    price: num(bid) != null ? num(bid) : num(minBid),
    marketValue: null,
    auctionDate: parseCloseDate(html),
    url: `${BASE}/auction/index/${id}`,
    live: true,
  };
}

async function scrape({ limit = 24, pages = 3 } = {}) {
  var candidates = [];
  for (var p = 1; p <= pages; p++) {
    try { candidates.push.apply(candidates, await channelRows(p, "")); }
    catch (e) { console.error(`  [bid4assets] channel page ${p} failed: ${e.message}`); }
  }
  // de-dupe, cap detail fetches
  var seen = {}, picks = [];
  for (var i = 0; i < candidates.length && picks.length < limit; i++) {
    if (seen[candidates[i].id]) continue; seen[candidates[i].id] = 1; picks.push(candidates[i]);
  }
  var out = [];
  for (var j = 0; j < picks.length; j++) {
    try {
      var l = await fetchDetail(picks[j].id, picks[j].title);
      if (l && l.price != null) {
        if (!KEEP_STATES || KEEP_STATES.indexOf(l.state) !== -1) out.push(l);
      }
    } catch (e) { /* skip bad detail */ }
  }
  return out;
}

// ---- county tax-sale storefronts (the VOLUME source: each county sale posts
// dozens–hundreds of cheap parcels, but only while that sale is OPEN) ----------
// Counties we most want to see first if several sales are open at once. Everyone
// else still gets pulled — this is ranking, not a filter.
const COUNTY_PRIORITY = {
  "los angeles": 1, "san bernardino": 1, "riverside": 1, "kern": 1, "ventura": 1, "orange": 1,
  "imperial": 2, "san diego": 2, "clark": 3, "multnomah": 3, "washington": 3, "clackamas": 3,
};
function countyKey(t) { var m = String(t).match(/^([A-Za-z .'-]+?)\s+County/i); return m ? m[1].trim().toLowerCase() : ""; }

// List every county tax-sale storefront on Bid4Assets, nationwide (the old code
// threw away everything outside CA/OR/WA — that's most of the cheap houses).
async function listAuctions() {
  const index = await fetchText(`${BASE}/county-tax-sales`);
  const out = [], seen = {};
  const re = /href="\/storefront\/([A-Za-z0-9]+)"[^>]*>([\s\S]{0,160}?)<\/a>/gi;
  let m;
  while ((m = re.exec(index))) {
    const slug = m[1]; if (seen[slug]) continue; seen[slug] = 1;
    const text = clean(m[2].replace(/<[^>]+>/g, " "));
    const st = (text.match(/,\s*([A-Z]{2})\b/) || [])[1];
    if (!st) continue;                                  // need a US state to place it
    if (/timeshare|personal|vehicle/i.test(text)) continue;
    out.push({ slug, state: st, title: text, county: countyKey(text), priority: COUNTY_PRIORITY[countyKey(text)] || 9, url: `${BASE}/storefront/${slug}` });
  }
  return out.sort(function (a, b) { return a.priority - b.priority; });
}

// Pull the parcel (auction) IDs for a single storefront. Returns [] when the
// sale isn't open — county sales only publish parcels during their sale window.
async function storefrontParcelIds(slug) {
  const html = await fetchText(`${BASE}/storefront/${slug}`);
  const sid = (html.match(/storefrontId["\s:=]+(\d+)/i) || [])[1];
  const cid = (html.match(/storefrontCollectionId["\s:=]+(\d+)/i) || [])[1];
  const ids = {};
  // (1) JSON API — the reliable path for an open sale; paginate until empty.
  if (sid) {
    for (let page = 1; page <= 30; page++) {
      let txt;
      try {
        txt = await fetchPost(`${BASE}/api/storefront/auctions/index`, {
          json: { storefrontId: +sid, storefrontCollectionId: cid ? +cid : undefined, pageSize: 100, currentPage: page },
        });
      } catch (e) { break; }
      let j; try { j = JSON.parse(txt); } catch (e) { break; }
      const rows = (j && (j.data || j.Data || j.results || j.items)) || [];
      if (!rows.length) break;
      for (const r of rows) {
        const s = JSON.stringify(r);
        const id = (s.match(/"auctionId"\s*:\s*"?(\d+)/i) ||
          s.match(/\/auction\/(?:index\/)?(\d+)/) ||
          s.match(/"(?:itemId|id)"\s*:\s*"?(\d{5,})/i) || [])[1];
        if (id) ids[id] = 1;
      }
      if (rows.length < 100) break;
    }
  }
  // (2) HTML fallback — direct /auction/<id> links printed on an open storefront.
  let m; const re = /\/auction\/(?:index\/)?(\d+)/g;
  while ((m = re.exec(html))) ids[m[1]] = 1;
  return Object.keys(ids);
}

// Walk the storefronts, pull parcels from any that are OPEN, and parse each with
// the same detail reader used for the channel. Bounded so a run stays quick even
// when many sales are open at once.
async function scrapeStorefronts({ maxCounties = 12, maxParcels = 180 } = {}) {
  let sales;
  try { sales = await listAuctions(); } catch (e) { return []; }
  const out = []; let counties = 0, fetched = 0;
  for (const sale of sales) {
    if (counties >= maxCounties || fetched >= maxParcels) break;
    let pids;
    try { pids = await storefrontParcelIds(sale.slug); } catch (e) { continue; }
    if (!pids.length) continue;                          // sale not open right now
    counties++;
    for (const id of pids) {
      if (fetched >= maxParcels) break;
      fetched++;
      try {
        const l = await fetchDetail(id, sale.title);
        if (l && l.price != null) { l.source = "County Tax Deed"; l.county = sale.county || null; out.push(l); }
      } catch (e) { /* skip bad parcel */ }
    }
  }
  if (counties) console.log(`  [bid4assets] storefronts: ${out.length} parcel(s) from ${counties} open county sale(s)`);
  return out;
}

// The adapter entry point: channel homes + any open county-sale parcels, de-duped.
async function scrapeAll(opts) {
  const [channel, store] = await Promise.all([
    scrape(opts).catch(() => []),
    scrapeStorefronts(opts).catch(() => []),
  ]);
  const seen = {}, out = [];
  for (const l of channel.concat(store)) { if (l && l.id && !seen[l.id]) { seen[l.id] = 1; out.push(l); } }
  return out;
}

module.exports = { scrape: scrapeAll, scrapeChannel: scrape, scrapeStorefronts, listAuctions, storefrontParcelIds, id: "bid4assets", label: "Bid4Assets Tax/Foreclosure Auctions", status: "live" };
