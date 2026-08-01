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

async function scrape({ limit = 40 } = {}) {
  const list = await fetchText(`${BASE}/our-listing/`);
  const ids = [...new Set((list.match(/property_id=(\d+)/g) || [])
    .map((s) => s.replace("property_id=", "")))].slice(0, limit);

  const out = [];
  for (const id of ids) {
    try {
      out.push(await parseDetail(id));
    } catch (e) {
      console.error(`  [gsa] property ${id} failed: ${e.message}`);
    }
  }
  return out;
}

module.exports = { scrape, id: "gsa", label: "GSA Real Property Sales", status: "live" };
