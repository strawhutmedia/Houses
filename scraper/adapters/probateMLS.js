"use strict";
/*
 * Probate / Trust / Estate sales on the open MLS — via Redfin's public GIS API.
 * STATUS: LIVE. This is where "grandma's 1938 house, priced by out-of-state
 * heirs" deals actually concentrate: listings whose remarks say "probate",
 * "trust sale", "estate sale", "court confirmation", etc. They sit on the
 * normal MLS but get discounted because the sellers want speed, the homes
 * show dated, and court-confirmation scares off casual buyers.
 *
 * How it works (no browser, no auth):
 *   GET https://www.redfin.com/stingray/api/gis?al=1&v=8&market=<m>&poly=<box>...
 *   returns up to 350 active listings per bounding box WITH full listing
 *   remarks. The API's own `keyword` param is silently ignored, so we tile
 *   each target area into boxes, pull everything, and grep the remarks
 *   ourselves. A box that saturates (350 rows) is split into quadrants and
 *   re-fetched, up to MAX_DEPTH, so dense areas don't truncate.
 *
 * Focused on the family's actual target areas (San Gabriel Valley + NE LA /
 * Glendale / Burbank, plus Portland). Extend TARGETS to widen. Keep the tile
 * count modest — this is a personal feed, not a crawler; ~10-40 requests/run.
 */
const { fetchText } = require("../lib/http");

const API = "https://www.redfin.com/stingray/api/gis";

// Phrases in listing remarks that mark a probate/estate-motivated seller.
// Override with ES_PROBATE_KEYWORDS="probate,trust sale,..." (comma-separated).
const DEFAULT_KEYWORDS = [
  "probate", "trust sale", "estate sale", "sold as part of an estate",
  "court confirmation", "conservatorship", "executor", "administrator of the estate",
];
const KEYWORDS = (process.env.ES_PROBATE_KEYWORDS
  ? process.env.ES_PROBATE_KEYWORDS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  : DEFAULT_KEYWORDS);

// Target areas: [west, south, east, north] lng/lat boxes + the Redfin market code.
const TARGETS = [
  // San Gabriel Valley west: Pasadena, Altadena, South Pasadena, San Marino,
  // Alhambra, San Gabriel, Sierra Madre, Arcadia, Monrovia.
  { name: "SGV-west", market: "socal", box: [-118.20, 34.05, -117.98, 34.24] },
  // NE LA + Glendale/Burbank: Eagle Rock, Highland Park, Mt Washington,
  // Glassell Park, Atwater, Glenoaks Canyon, La Cañada.
  { name: "NELA-Glendale-Burbank", market: "socal", box: [-118.40, 34.05, -118.20, 34.25] },
  // Portland core (both sides of the river).
  { name: "Portland", market: "portland", box: [-122.85, 45.40, -122.45, 45.65] },
];

const NUM_HOMES = 350;        // API hard cap per request
const MAX_DEPTH = 3;          // saturated boxes split into quadrants this many times
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function polyParam([w, s, e, n]) {
  // Redfin wants a closed "lng lat,lng lat,..." ring.
  return encodeURIComponent(`${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}`);
}

function apiUrl(market, box) {
  // status=9 active+coming-soon; uipt=1,3 houses + townhomes; sf=1,2,3 for-sale types.
  return `${API}?al=1&v=8&market=${market}&num_homes=${NUM_HOMES}` +
    `&status=9&uipt=1,3&sf=1,2,3&poly=${polyParam(box)}`;
}

function parse(jsonp) {
  // Responses are prefixed with "{}&&".
  const i = jsonp.indexOf("&&");
  const data = JSON.parse(i >= 0 ? jsonp.slice(i + 2) : jsonp);
  if (data.resultCode !== 0) throw new Error(data.errorMessage || "resultCode " + data.resultCode);
  return (data.payload && data.payload.homes) || [];
}

function val(field) { return field && typeof field === "object" ? field.value : field; }

function matchKeyword(remarks) {
  const t = (remarks || "").toLowerCase();
  for (const k of KEYWORDS) if (t.includes(k)) return k;
  return null;
}

function quadrants([w, s, e, n]) {
  const mx = (w + e) / 2, my = (s + n) / 2;
  return [[w, s, mx, my], [mx, s, e, my], [w, my, mx, n], [mx, my, e, n]];
}

// Fetch one box; if it saturates the 350-row cap, recurse into quadrants so
// dense areas don't silently truncate.
async function fetchBox(market, box, depth, out) {
  let homes;
  try {
    homes = parse(await fetchText(apiUrl(market, box), { ua: UA, timeout: 45, retries: 2 }));
  } catch (e) {
    console.error(`  [probateMLS] box ${box.join(",")} failed: ${e.message}`);
    return;
  }
  if (homes.length >= NUM_HOMES && depth < MAX_DEPTH) {
    for (const q of quadrants(box)) await fetchBox(market, q, depth + 1, out);
    return;
  }
  out.push(...homes);
}

function toListing(h, keyword) {
  const street = val(h.streetLine) || "";
  const city = h.city || "";
  const state = (h.state || "").toUpperCase();
  const zip = h.zip || h.postalCode || "";
  const lot = val(h.lotSize);
  const ll = val(h.latLong) || {};
  return {
    id: "probate-" + (h.propertyId || val(h.mlsId) || street.replace(/\W+/g, "")),
    source: "Probate / Trust Sale (MLS)",
    state,
    city,
    address: [street, city, state, zip].filter(Boolean).join(", "),
    type: h.propertyType === 13 ? "Townhouse" : "Single Family",
    beds: h.beds || 0,
    baths: h.baths || 0,
    sqft: val(h.sqFt) || 0,
    year: val(h.yearBuilt) || null,
    lotAcres: lot ? +(lot / 43560).toFixed(2) : null,
    price: val(h.price),
    marketValue: null,          // AI enrichment fills this in
    rentEstimate: 0,
    status: `Live — "${keyword}" sale`,
    lat: ll.latitude ?? null,
    lng: ll.longitude ?? null,
    url: h.url ? "https://www.redfin.com" + h.url : "",
    photoUrls: [],
    live: true,
  };
}

async function scrape() {
  const raw = [];
  for (const t of TARGETS) await fetchBox(t.market, t.box, 0, raw);

  const out = [], seen = {};
  for (const h of raw) {
    const key = h.propertyId || val(h.mlsId);
    if (!key || seen[key]) continue;
    seen[key] = 1;
    const kw = matchKeyword(h.listingRemarks);
    if (!kw) continue;
    const l = toListing(h, kw);
    if (l.price != null && l.address) out.push(l);
  }
  return out;
}

module.exports = { scrape, id: "probateMLS", label: "Probate / Trust Sales (MLS)", status: "live" };
