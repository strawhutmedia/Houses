"use strict";
/*
 * VRM Properties — VA (Veterans Affairs) foreclosure REO
 * https://www.vrmproperties.com
 *
 * VRM Mortgage Services is the contractor that manages and sells real estate
 * owned (REO) for the U.S. Dept. of Veterans Affairs. Server-rendered, curl-safe,
 * nationwide, with real prices and CA/OR coverage — genuine federal-source homes
 * that are often cheaper than the surrounding market.
 *
 * The all-listings grid paginates at /Properties-For-Sale?currentPage=N. Each
 * card carries price, beds, baths, and an address ("146 isle royale cir
 * vacaville, CA 95687"); the state comes straight off that address.
 */
const { fetchText } = require("../lib/http");

const BASE = "https://www.vrmproperties.com";

function titleCase(s) {
  return String(s || "").toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\s+/g, " ").trim();
}
function num(s) { const n = parseInt(String(s == null ? "" : s).replace(/[^0-9]/g, ""), 10); return isFinite(n) ? n : null; }

function parseCards(html) {
  const out = [], seen = {};
  const cards = html.split(/prop-card-container/).slice(1);
  for (const c of cards) {
    const link = c.match(/\/Property-For-Sale\/(\d+)\/([a-z0-9\-]*)/i);
    if (!link) continue;
    const id = link[1];
    if (seen[id]) continue; seen[id] = 1;
    // The detail-URL slug is the clean address ("720-s-sunset-st-ridgecrest-ca-93555")
    // — no sqft/bed/bath numbers mixed in like the card text has.
    const parts = (link[2] || "").split("-").filter(Boolean);
    let state = "", full = "";
    if (parts.length >= 3 && /^\d{5}$/.test(parts[parts.length - 1]) && /^[a-z]{2}$/i.test(parts[parts.length - 2])) {
      state = parts[parts.length - 2].toUpperCase();
      full = titleCase(parts.slice(0, -2).join(" "));   // street + city
    } else {
      // truncated slug — fall back to the flattened card text for the state
      const text = c.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
      const a = text.match(/,\s*([A-Z]{2})\s+\d{5}/);
      if (!a) continue;
      state = a[1];
    }
    if (!state || !full) continue;
    const price = (c.match(/\$([\d,]{4,})/) || [])[1];
    if (!price) continue;                    // only publish priced homes
    const nums = (c.match(/(\d+)&nbsp;/g) || []).map((x) => num(x));
    out.push({
      id: "vrm-" + id,
      source: "VA Foreclosure (VRM)",
      state,
      city: "",                              // VRM merges street+city; keep the full line as address
      address: full,
      type: "Single Family",
      beds: nums[0] || 0,
      baths: nums[1] || 0,
      sqft: 0, year: null, lotAcres: null,
      price: num(price),
      marketValue: null,
      auctionDate: null,
      lat: null, lng: null,
      url: `${BASE}/Property-For-Sale/${id}/${link[2]}`,
      live: true,
    });
  }
  return out;
}

const STATES = ("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT " +
  "NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY").split(" ");

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  async function worker() { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
async function scrapeState(st, maxPages) {
  const rows = [], seen = {};
  for (let page = 1; page <= maxPages; page++) {
    let html;
    try { html = await fetchText(`${BASE}/Properties-For-Sale?state=${st}&currentPage=${page}`, { timeout: 20, retries: 1 }); }
    catch (e) { break; }
    const got = parseCards(html);
    if (!got.length) break;
    let added = 0;
    for (const r of got) { if (!seen[r.id]) { seen[r.id] = 1; rows.push(r); added++; } }
    if (!added) break;
  }
  return rows;
}

// The all-listings page is too heavy to fetch; pull states in parallel (fast) and
// paginate each until its cards run out.
async function scrape({ maxPagesPerState = 6, concurrency = 8 } = {}) {
  const perState = await mapLimit(STATES, concurrency, (st) => scrapeState(st, maxPagesPerState).catch(() => []));
  const out = [], seen = {};
  for (const rows of perState) for (const r of rows) { if (!seen[r.id]) { seen[r.id] = 1; out.push(r); } }
  return out;
}

module.exports = { scrape, parseCards, id: "vrmVA", label: "VA Foreclosures (VRM)", status: "live" };
