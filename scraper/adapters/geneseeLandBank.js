"use strict";
/*
 * Genesee County Land Bank — Flint, MI (thelandbank.org)
 *
 * The largest, best-run land bank in the country and, unlike most, it publishes
 * PRICES. Two tracks:
 *   1. realtor_listed.asp  — renovated homes listed with a realtor, real asking
 *      price (often $20k–$70k, some higher).
 *   2. find_properties.asp?LRCsearch=do — the raw catalog (a table of parcels
 *      with class/sale-type). We keep only actual STRUCTURES (drop vacant lots)
 *      and mark them price-on-inquiry, since the catalog list carries no price.
 *
 * Only runtime dep is curl. No key required.
 */
const { fetchText } = require("../lib/http");

const BASE = "https://www.thelandbank.org";
// All parcels are in Genesee County; without per-address geocoding we anchor to
// the Flint city centroid (honest at metro resolution for "near me" distance).
const FLINT = { lat: 43.0125, lng: -83.6875 };

function decode(s) {
  return String(s || "")
    .replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}
function titleCase(s) {
  return decode(s).toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

// Track 1: realtor-listed homes with a real asking price.
async function realtorListed() {
  const html = await fetchText(`${BASE}/realtor_listed.asp`, { timeout: 30, retries: 2 }).catch(() => "");
  const out = [];
  const cards = html.split(/featuredprop_fm\.asp\?pid=/).slice(1);
  for (const c of cards) {
    const pid = (c.match(/^(\d+)/) || [])[1];
    if (!pid) continue;
    const price = (c.match(/pcardoffer[^$]*\$([\d,]+)/i) || [])[1];
    const addr = decode((c.match(/pcardaddr1"?>([^<]+)/i) || [])[1] || "").replace(/\s*,\s*$/, "");
    if (!addr) continue;
    const m = addr.match(/^(.*?),\s*([A-Za-z .'-]+)$/);
    out.push({
      id: "gclb-" + pid,
      source: "Genesee Land Bank",
      state: "MI",
      city: m ? titleCase(m[2]) : "Flint",
      address: titleCase(m ? m[1] : addr) + (m ? ", " + titleCase(m[2]) : ""),
      type: "Single Family",
      beds: 0, baths: 0, sqft: 0, year: null, lotAcres: null,
      price: price ? +price.replace(/[^0-9]/g, "") : null,
      marketValue: null,
      priceOnInquiry: !price,
      auctionDate: null,
      lat: FLINT.lat, lng: FLINT.lng,
      url: `${BASE}/featuredprop_fm.asp?pid=${pid}`,
      live: true,
    });
  }
  return out;
}

// Track 2: the raw catalog table. Rows carry PID|ADDRESS|CITY|ZIP on a checkbox,
// plus a class + sale-type. Keep structures, drop vacant land (no price on list).
async function catalog() {
  const html = await fetchText(`${BASE}/find_properties.asp?LRCsearch=do`, { timeout: 30, retries: 2 }).catch(() => "");
  const out = [];
  // Each row starts at the checkbox; grab everything up to the next checkbox so
  // we can read the class/sale-type text that follows.
  const rows = html.split(/<input type="checkbox" name="LRClistChk"/i).slice(1);
  for (const r of rows) {
    const v = (r.match(/value="(\d+)\|([^"]*)\|([^"]*)\|(\d{5})"/) || []);
    const pid = v[1]; if (!pid) continue;
    const addr = decode(v[2]); const city = decode(v[3]); const zip = v[4];
    // Skip anything that isn't a real building.
    const seg = r.slice(0, 1200);
    if (/vacant|vac lot|no frontage|\blot\b/i.test(seg + " " + addr)) continue;
    if (!addr || /^0\b/.test(addr)) continue;
    out.push({
      id: "gclb-" + pid,
      source: "Genesee Land Bank",
      state: "MI",
      city: titleCase(city) || "Flint",
      address: titleCase(addr) + (city ? ", " + titleCase(city) : ""),
      type: "Single Family",
      beds: 0, baths: 0, sqft: 0, year: null, lotAcres: null,
      price: null, marketValue: null,
      priceOnInquiry: true,
      auctionDate: null,
      lat: FLINT.lat, lng: FLINT.lng,
      url: `${BASE}/property_sheet.asp?pid=${pid}&loc=1&from=main`,
      live: true,
    });
  }
  return out;
}

async function scrape() {
  const [listed, cat] = await Promise.all([realtorListed(), catalog()]);
  // Prefer the priced realtor record when a parcel appears in both tracks.
  const seen = {}, out = [];
  for (const l of listed.concat(cat)) { if (l && l.id && !seen[l.id]) { seen[l.id] = 1; out.push(l); } }
  return out;
}

module.exports = { scrape, realtorListed, catalog, id: "geneseeLandBank", label: "Genesee County Land Bank (Flint)", status: "live" };
