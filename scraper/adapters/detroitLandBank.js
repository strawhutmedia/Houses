"use strict";
/*
 * Detroit Land Bank Authority — buildingdetroit.org
 *
 * The best-known cheap-house program in the country: $1,000-start Auctions,
 * fixed-price "Own It Now" homes, and renovated "Rehabbed & Ready" houses with
 * real asking prices. The site is a Magento/Angular app, but the listings grid
 * has a clean JSON mode: POST /properties with isJson=1 returns
 * { pagination, listings } with price, beds/baths/sqft, lat/lng, sale date,
 * photo, and a stable slug for the deep link. No key, no browser — curl only.
 *
 * Categories (the "name" field): Auction | Own It Now | Rehabbed & Ready |
 * Side Lot. Side lots are vacant land, so they're dropped per the houses-only
 * spec. Everything else is a real Detroit house with a real price.
 */
const { fetchPost } = require("../lib/http");

const BASE = "https://buildingdetroit.org";
const PAGE_LIMIT = 100; // server caps at its own per_page if lower

function num(v) {
  const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : null;
}

async function fetchPage(page) {
  const form =
    "location=&category=&bedrooms=&bathrooms=&district=&minsqft=&maxsqft=" +
    `&fromsaledate=&tosaledate=&sortorder=&limit=${PAGE_LIMIT}&page=${page}&isJson=1`;
  const body = await fetchPost(`${BASE}/properties`, { form, timeout: 45, retries: 2 });
  const data = JSON.parse(body);
  if (!data || !Array.isArray(data.listings)) throw new Error("unexpected DLBA response shape");
  return data;
}

function toListing(p) {
  const category = String(p.name || "").trim();
  if (/side\s*lot/i.test(category)) return null; // vacant land, not a house
  if (!p.property_id || !p.property_name) return null;

  const price = num(p.price) != null ? num(p.price) : num(p.minimum_offer);
  const isAuction = /auction/i.test(category) || /auction/i.test(String(p.category_type || ""));
  const underContract = /under contract/i.test(String(p.marketable_feature || ""));
  const addr = String(p.property_name).trim() +
    ", Detroit, MI" + (p.zipcode ? " " + p.zipcode : "");

  return {
    id: "dlba-" + p.property_id,
    source: "Detroit Land Bank",
    state: "MI",
    city: p.city || "Detroit",
    address: addr,
    type: "Single Family",
    beds: num(p.bedrooms) || 0,
    baths: num(p.bathrooms) || 0,
    sqft: num(p.area) || 0,
    year: null,
    lotAcres: null,
    price,
    marketValue: null,
    rentEstimate: null,
    // sale_date is the live auction date for Auctions; for Own It Now /
    // Rehabbed & Ready it's a historical listing date, so leave those open.
    auctionDate: isAuction ? p.sale_date || null : null,
    status: underContract ? "Under Contract" : "Live",
    lat: num(p.latitude),
    lng: num(p.longitude),
    url: p.property_identifier
      ? `${BASE}/properties/${p.property_identifier}`
      : `${BASE}/properties`,
    photoUrls: p.file_path ? [p.file_path] : [],
    live: true,
  };
}

async function scrape() {
  const out = [];
  const seen = {};
  const first = await fetchPage(1);
  const lastPage = Math.min(+((first.pagination || {}).last_page) || 1, 40);
  let pages = [first];
  for (let pg = 2; pg <= lastPage; pg++) pages.push(await fetchPage(pg));
  for (const data of pages) {
    for (const p of data.listings) {
      const l = toListing(p);
      if (l && !seen[l.id]) { seen[l.id] = 1; out.push(l); }
    }
  }
  return out;
}

module.exports = { scrape, id: "detroitLandBank", label: "Detroit Land Bank (Auction / Own It Now)", status: "live" };
