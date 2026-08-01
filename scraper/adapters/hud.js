"use strict";
/*
 * HUD Home Store — https://www.hudhomestore.gov
 * STATUS: LIVE. Real government (FHA-foreclosure) homes sold via bid periods —
 * exactly the "government sells you a house cheap" inventory, and all residential.
 *
 * How it works (no browser, no auth, single GET per state):
 *   GET /searchresult?citystate=CA  (or OR, or "City, ST")
 *   The full listing array is server-rendered as JSON into a hidden input
 *   <input id="available_prop" value="[ ...JSON... ]">. We parse that blob.
 *
 * Residential only (HUD sells no commercial/land); we still guard the type map.
 */
const { fetchText } = require("../lib/http");

const BASE = "https://www.hudhomestore.gov";
// Nationwide coverage. Override with env HUD_STATES="CA,OR,TX" to narrow.
const ALL_STATES = ("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN " +
  "MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC").split(" ");
const STATES = (process.env.HUD_STATES ? process.env.HUD_STATES.split(",") : ALL_STATES)
  .map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean);

function unescapeHtml(s) {
  return String(s || "")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function mapType(t) {
  t = (t || "").toLowerCase();
  if (/condo/.test(t)) return "Condo";
  if (/town/.test(t)) return "Townhouse";
  if (/multi|duplex|triplex|fourplex/.test(t)) return "Multi-Family";
  // Single Family Home, Manufactured Home, Mobile Home -> Single Family
  return "Single Family";
}

function num(v) { var n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.]/g, "")); return isFinite(n) ? n : null; }

function parseBlob(html) {
  var m = html.match(/id="available_prop"[^>]*value="([\s\S]*?)"\s*\/?>/i);
  if (!m) return [];
  try { return JSON.parse(unescapeHtml(m[1])); } catch (e) { return []; }
}

function toListing(p) {
  var caseNo = p.propertyCaseNumber || "";
  return {
    id: "hud-" + caseNo.replace(/[^0-9]/g, ""),
    source: "HUD Home Store",
    state: (p.propertyState || "").toUpperCase(),
    city: p.propertyCity || "",
    address: [p.propertyAddress, p.propertyCity, p.propertyState, p.propertyZip].filter(Boolean).join(", "),
    type: mapType(p.propertyType),
    beds: num(p.bedrooms) || 0,
    baths: num(p.bathroomsdecimal || p.bathrooms) || 0,
    sqft: num(p.squareFootage) || 0,
    year: num(p.yearBuilt) || null,
    price: num(p.listPrice),
    marketValue: null,          // HUD lists an FHA appraisal-based price; no separate AVM
    rentEstimate: 0,
    postedDate: p.listDate || null,
    auctionDate: p.periodDeadlineDate || p.bidOpenDate || null, // offer/bid deadline
    lat: num(p.latitude), lng: num(p.longitude),
    url: caseNo ? `${BASE}/PropertyDetails?caseNumber=${encodeURIComponent(caseNo)}` : BASE,
    photoUrls: (p.galleryImages && String(p.galleryImages).split(/[|,]/).filter(Boolean)) || (p.propertyThumb ? [p.propertyThumb] : []),
    live: true,
  };
}

async function fetchState(st) {
  try {
    var html = await fetchText(`${BASE}/searchresult?citystate=${st}`, { timeout: 45 });
    return parseBlob(html).map(toListing).filter(function (l) { return l.price != null && l.address; });
  } catch (e) {
    console.error(`  [hud] ${st} failed: ${e.message}`);
    return [];
  }
}

async function scrape({ concurrency = 8 } = {}) {
  var out = [];
  for (var i = 0; i < STATES.length; i += concurrency) {
    var batch = STATES.slice(i, i + concurrency);
    var results = await Promise.all(batch.map(fetchState));
    results.forEach(function (r) { out.push.apply(out, r); });
  }
  return out;
}

module.exports = { scrape, id: "hud", label: "HUD Home Store", status: "live" };
