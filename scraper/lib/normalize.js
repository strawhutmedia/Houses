"use strict";
/*
 * Shared normalization: every adapter returns raw-ish objects; we push them
 * through normalizeListing() so the website only ever sees one schema.
 *
 * Canonical listing shape (matches ../../data.js):
 *   id, source, state, metro, city, address, type,
 *   beds, baths, sqft, year, lotAcres,
 *   price, marketValue, rentEstimate, equity, equityPct, grossYield,
 *   auctionDate (YYYY-MM-DD), status, lat, lng, url, live
 */

// Metro tagging — extend as coverage grows. Keyed by "ST".
const METRO_BY_CITY = {
  CA: {
    "los angeles": "Los Angeles", "long beach": "Los Angeles", "inglewood": "Los Angeles",
    "compton": "Los Angeles", "pomona": "Los Angeles", "el monte": "Los Angeles",
    "palmdale": "Los Angeles", "lancaster": "Los Angeles", "san bernardino": "Los Angeles",
    "riverside": "Los Angeles", "ontario": "Los Angeles", "victorville": "Los Angeles",
    "bakersfield": "Los Angeles",
  },
  OR: {
    "portland": "Portland", "gresham": "Portland", "beaverton": "Portland",
    "hillsboro": "Portland", "tigard": "Portland", "milwaukie": "Portland",
    "oregon city": "Portland", "salem": "Portland", "vancouver": "Portland",
  },
};

function metroFor(state, city) {
  const s = (METRO_BY_CITY[state] || {});
  return s[(city || "").trim().toLowerCase()] || "";
}

function toISODate(input) {
  if (!input) return null;
  // accept "2026-09-08", "09/08/2026", ms epoch, Date
  if (input instanceof Date) return input.toISOString().slice(0, 10);
  const s = String(input).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

function num(v) {
  if (v == null) return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : null;
}

function normalizeListing(raw) {
  const price = num(raw.price);
  const marketValue = num(raw.marketValue);
  const rentEstimate = num(raw.rentEstimate) || 0;
  const equity = (marketValue != null && price != null) ? Math.max(0, marketValue - price) : null;
  const equityPct = (equity != null && marketValue) ? Math.round((equity / marketValue) * 100) : null;
  const grossYield = (rentEstimate && price) ? +(((rentEstimate * 12) / price) * 100).toFixed(1) : 0;
  const state = (raw.state || "").toUpperCase();
  const city = raw.city || "";

  return {
    id: raw.id,
    source: raw.source,
    state,
    metro: raw.metro || metroFor(state, city),
    city,
    address: raw.address || "",
    type: raw.type || "Other",
    beds: raw.beds ?? 0,
    baths: raw.baths ?? 0,
    sqft: num(raw.sqft) || 0,
    year: raw.year || null,
    lotAcres: raw.lotAcres || null,
    price,
    marketValue,
    valueBasis: raw.valueBasis || (marketValue != null ? "listed" : null),
    rentEstimate,
    equity,
    equityPct,
    grossYield,
    auctionDate: toISODate(raw.auctionDate),
    postedDate: toISODate(raw.postedDate),
    status: raw.status || "Live",
    lat: raw.lat ?? null,
    lng: raw.lng ?? null,
    url: raw.url || "",
    photoUrls: raw.photoUrls || [],
    live: raw.live !== false, // real-scraped unless explicitly marked sample
  };
}

module.exports = { normalizeListing, metroFor, toISODate, num };
