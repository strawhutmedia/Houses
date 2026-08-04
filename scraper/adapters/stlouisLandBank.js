"use strict";
/*
 * St. Louis Land Reutilization Authority (LRA) — city land bank
 * https://www.stlouis-mo.gov/ (SLDC / LRA open data)
 *
 * The LRA holds ~9,400 tax-foreclosed parcels and sells them cheaply to get
 * them back on the tax rolls. Roughly a thousand are actual RESIDENTIAL
 * BUILDINGS (the rest are vacant lots we skip). LRA houses commonly sell for
 * ~$1,000–$25,000 — genuinely the cheapest move-in / fix-up stock in the feed.
 *
 * IMPORTANT: the public dataset publishes NO per-parcel price (the LRA sets it
 * on application), and neither does the parcel page. So we DON'T invent one —
 * these rows carry priceOnInquiry:true and the site shows "Price on inquiry"
 * instead of a fake number. The user explicitly opted into this trade-off.
 *
 * Data: a single CSV of available LRA inventory, no key required (curl-safe).
 */
const { fetchText } = require("../lib/http");

const CSV_URL = "https://static.stlouis-mo.gov/open-data/SLDC/REAL-ESTATE/LRA_INVENTORY_AVAILABLE.csv";
// Every LRA parcel is inside the City of St. Louis; we don't have per-address
// geocoding here, so all rows share the city centroid (honest: they ARE all in
// St. Louis). Distance/“near me” stays correct at metro resolution.
const STL = { lat: 38.6270, lng: -90.1994 };

// Minimal RFC-4180 CSV parser: handles quoted fields with commas and "" quotes.
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r") { /* ignore */ }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function titleCase(s) {
  return String(s || "").toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\s+/g, " ").trim();
}

async function scrape() {
  const csv = await fetchText(CSV_URL, { timeout: 40, retries: 2 });
  const rows = parseCSV(csv);
  if (rows.length < 2) return [];
  const H = rows[0];
  const col = (name) => H.indexOf(name);
  const iParcel = col("ParcelId"), iAddr = col("Address"), iUsage = col("Usage"),
    iType = col("PropertyType"), iHood = col("NeighborhoodName"),
    iUnits = col("NbrOfUnits"), iStories = col("Stories");

  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const c = rows[r];
    if (!c || !c[iParcel]) continue;
    const usage = (c[iUsage] || "").toLowerCase();
    const ptype = (c[iType] || "").toLowerCase();
    // Keep only residential BUILDINGS — skip vacant lots and non-residential.
    if (ptype !== "building") continue;
    if (!/residential/.test(usage)) continue;

    const units = parseInt(c[iUnits], 10) || 0;
    const hood = titleCase(c[iHood]);
    const addr = titleCase(c[iAddr]);
    out.push({
      id: "stl-lra-" + c[iParcel],
      source: "St. Louis Land Bank",
      state: "MO",
      city: "St. Louis",
      metro: "St. Louis",
      address: addr + (hood ? ", " + hood : ""),
      type: units > 1 ? "Multi-Family" : "Single Family",
      beds: 0, baths: 0, sqft: 0,           // not published per-parcel — don't fake it
      year: null, lotAcres: null,
      price: null, marketValue: null,
      priceOnInquiry: true,                 // LRA sets price on application
      auctionDate: null,
      lat: STL.lat, lng: STL.lng,
      url: "https://www.stlouis-mo.gov/government/property/parcel-information.cfm?parcelId=" + c[iParcel],
      live: true,
    });
  }
  return out;
}

module.exports = { scrape, parseCSV, id: "stlouisLandBank", label: "St. Louis Land Bank (LRA)", status: "live" };
