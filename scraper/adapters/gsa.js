"use strict";
/*
 * GSA Real Property Sales — https://realestatesales.gov
 * STATUS: LIVE. Server-rendered listing + detail pages, no bot blocking.
 *
 * Flow:
 *   1. GET /our-listing/  -> collect property_id values
 *   2. GET /asset-details/?property_id=N -> parse fields per property
 *
 * Note: GSA typically carries a small number of nationwide parcels at a time,
 * skewed toward commercial / land / former-federal buildings rather than the
 * cheap residential homes. We still ingest everything and let the site filter.
 */
const { fetchText } = require("../lib/http");

const BASE = "https://realestatesales.gov";

function decode(s) {
  return (s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}

// value that follows a "<strong>Label:</strong> value" pattern
function afterLabel(html, label) {
  const re = new RegExp("<strong>\\s*" + label + "\\s*:?\\s*</strong>\\s*([^<]{1,60})", "i");
  const m = html.match(re);
  return m ? decode(m[1]) : null;
}

function firstMatch(html, re) {
  const m = html.match(re);
  return m ? m[1] : null;
}

// Coarse offline state tagging for our two target markets (enough to drive the
// CA/OR filter). Everything else returns "" and shows as national inventory.
function stateFromLatLng(lat, lng) {
  if (lat >= 32.5 && lat <= 42.05 && lng >= -124.5 && lng <= -114.1) return "CA";
  if (lat >= 41.9 && lat <= 46.3 && lng >= -124.7 && lng <= -116.4) return "OR";
  return "";
}

function mapGsaType(assetType, propType) {
  const t = ((assetType || "") + " " + (propType || "")).toLowerCase();
  if (/land|vacant|acre/.test(t)) return "Land";
  if (/multi|apartment|residential income/.test(t)) return "Multi-Family";
  if (/condo/.test(t)) return "Condo";
  if (/town/.test(t)) return "Townhouse";
  if (/single|residential|home|house/.test(t)) return "Single Family";
  return "Commercial / Other";
}

async function parseDetail(id) {
  const html = await fetchText(`${BASE}/asset-details/?property_id=${id}`);

  const propType = afterLabel(html, "Property Type");
  const assetType = afterLabel(html, "Asset Type");
  const sqft = afterLabel(html, "Square Footage");
  const year = afterLabel(html, "Year Built");
  const lot = afterLabel(html, "Lot Size");
  const caseNo = afterLabel(html, "Case Number");

  const lat = firstMatch(html, /lat\s*=\s*'?\s*(-?\d{1,3}\.\d{3,})/i);
  const lng = firstMatch(html, /(?:lng|lon|long)\s*=\s*'?\s*(-?\d{1,3}\.\d{3,})/i);
  const endDate = firstMatch(html, /end_date\s*=?["'\s]+((?:20\d{2}[-/]\d{1,2}[-/]\d{1,2})|(?:\d{1,2}\/\d{1,2}\/20\d{2}))/i);
  // NOTE: offer_offer_price_text is a static form placeholder ($2,000,000.00) —
  // do NOT treat it as the bid. Real current/min bids are pushed over a socket
  // and are not in the static HTML, so price stays null until that's wired.
  const bid = firstMatch(html, /(?:current|minimum|min)\s*bid[^$]{0,20}\$([0-9,]{4,})/i);

  // Location: try "City, ST 00000"
  const loc = firstMatch(html, /([A-Z][A-Za-z .'-]+),\s*([A-Z]{2})\s*(\d{5})/);
  let city = "", state = "";
  const locM = html.match(/([A-Z][A-Za-z .'-]+),\s*([A-Z]{2})\s*\d{5}/);
  if (locM) { city = decode(locM[1]); state = locM[2]; }

  const title = firstMatch(html, /<title>\s*([^<]+?)\s*<\/title>/i);

  // Fall back to a coarse lat/lng bounding box when no "City, ST zip" is present
  // (GSA parcels are often described by name, not street address).
  if (!state && lat && lng) state = stateFromLatLng(+lat, +lng);

  return {
    id: "gsa-" + id,
    source: "GSA Auctions",
    state,
    city,
    address: (title && !/home page/i.test(title)) ? decode(title) : city,
    type: mapGsaType(assetType, propType),
    sqft: sqft,
    year: year && /^\d{4}$/.test(year) ? +year : null,
    lotAcres: lot && /acre/i.test(lot) ? parseFloat(lot) : null,
    price: bid,
    marketValue: null,          // GSA does not publish an independent AVM; enrich later
    rentEstimate: 0,
    auctionDate: endDate,
    lat: lat ? +lat : null,
    lng: lng ? +lng : null,
    url: `${BASE}/asset-details/?property_id=${id}`,
    live: true,
    _caseNo: caseNo,
  };
}

// Parse the listing grid directly — every card carries the real Current Bid,
// the address, and the close date (the detail page hides the live bid behind a
// socket, so the card is the only reliable price). One card = one property.
function parseCards(html) {
  const out = [];
  const cards = html.split(/<li class="[^"]*"\s*>\s*<div class="itemm">/).slice(1);
  for (const c of cards) {
    const id = firstMatch(c, /property_id=(\d+)/);
    if (!id) continue;
    const price = firstMatch(c, /property-price[\s\S]*?\$\s*([0-9,]{3,})/i);
    const title = decode(firstMatch(c, /<h2>\s*([\s\S]*?)\s*<\/h2>/i) || "");
    const h5 = firstMatch(c, /<h5[^>]*>([\s\S]*?)<\/h5>/i) || "";
    const loc = h5.replace(/<[^>]+>/g, " ");
    const cs = loc.match(/([A-Za-z][A-Za-z .'-]+),\s*([A-Z]{2})\s*(\d{5})/);
    const street = decode((firstMatch(c, /<h5[^>]*title="([^"]+)"/i) || "").trim());
    const endDate = firstMatch(c, /data-end-date="([^"]+)"/i);
    out.push({
      id: "gsa-" + id,
      source: "GSA Auctions",
      state: cs ? cs[2] : "",
      city: cs ? decode(cs[1]) : "",
      address: street || title || (cs ? decode(cs[1]) : ""),
      type: mapGsaType(title, ""),
      sqft: null,
      year: null,
      lotAcres: /(\d+(?:\.\d+)?)\s*acre/i.test(title) ? parseFloat(RegExp.$1) : null,
      price: price ? +price.replace(/[^0-9]/g, "") : null,
      marketValue: null,
      rentEstimate: 0,
      auctionDate: endDate || null,
      lat: null, lng: null,
      url: `${BASE}/asset-details/?property_id=${id}`,
      live: true,
    });
  }
  return out;
}

async function scrape({ limit = 60 } = {}) {
  const list = await fetchText(`${BASE}/our-listing/`);
  let rows = parseCards(list);
  if (rows.length > limit) rows = rows.slice(0, limit);
  // Only publishable rows have a real price; drop the rest (the site quality
  // gate would anyway). Residential is rare on GSA — we ingest everything and
  // let the site's type/price filters do the work.
  return rows.filter((r) => r.price != null);
}

module.exports = { scrape, parseCards, parseDetail, id: "gsa", label: "GSA Real Property Sales", status: "live" };
