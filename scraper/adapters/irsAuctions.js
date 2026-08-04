"use strict";
/*
 * IRS Seized Real Property Auctions — https://www.irsauctions.gov
 *
 * The IRS sells real property seized for unpaid federal taxes. Server-rendered
 * (Drupal), curl-safe. The listing page links to each property at /ad/<slug>;
 * the detail page carries the Minimum Bid, sale date/location, and an address +
 * bed/bath/sqft embedded in the description ("...more commonly known as 3512 N.
 * Front St. Philadelphia PA 19140"). Nationwide but thin — usually a handful
 * live at a time; this fills in automatically as the IRS posts more.
 */
const { fetchText } = require("../lib/http");

const BASE = "https://www.irsauctions.gov";

function strip(h) {
  return String(h || "").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ").trim();
}
function num(s) { const n = parseFloat(String(s == null ? "" : s).replace(/[^0-9.]/g, "")); return isFinite(n) ? n : null; }

function mapType(s) {
  const t = (s || "").toLowerCase();
  if (/rowhouse|row house|single|residence|house|home|bungalow|cottage|dwelling/.test(t)) return "Single Family";
  if (/condo/.test(t)) return "Condo";
  if (/duplex|triplex|multi|apartment/.test(t)) return "Multi-Family";
  if (/town\s?home|town\s?house/.test(t)) return "Townhouse";
  if (/\bland\b|\blot\b|acre|vacant/.test(t)) return "Land";
  if (/commercial|warehouse|office|retail|building/.test(t)) return "Commercial / Other";
  return "Single Family";
}

async function parseDetail(slug) {
  const html = await fetchText(`${BASE}${slug}`, { timeout: 25, retries: 1 });
  const s = strip(html);
  // Address is written as "...known as 3512 N. Front St., Philadelphia, PA 19140".
  // Prefer that phrase; fall back to any "<street>, <City>, ST 00000" in the body.
  let a = s.match(/(?:known as|located at|property address[:\s]+)\s*(.+?),\s*([A-Za-z .'-]+?),\s*([A-Z]{2})\s+(\d{5})/i);
  if (!a) {
    const re = /([0-9][^,]{3,45}?),\s*([A-Za-z][A-Za-z .'-]+?),\s*([A-Z]{2})\s+(\d{5})/g;
    let m, last = null; while ((m = re.exec(s))) last = m; a = last;
  }
  if (!a) return null;
  const street = a[1].replace(/^(?:is|are|at|as)\b[:\s]*/i, "").replace(/^[:\s]+/, "").replace(/\s*,\s*$/, "").trim();
  const city = a[2].trim();
  const state = a[3];
  const zip = a[4];
  const bid = (s.match(/Minimum Bid\s*\$?([\d,]+(?:\.\d+)?)/i) || [])[1];
  const saleDate = (s.match(/Sale Date[:\s]*([A-Za-z]{3,9}\s+\d{1,2},?\s+20\d{2})/i) || [])[1] ||
    (s.match(/([A-Za-z]{3,9}\s+\d{1,2},?\s+20\d{2})\s+\d{1,2}:\d{2}\s*[AP]M\s*Bidder Registration/i) || [])[1];
  const title = strip((html.match(/<title>([^<]+)/i) || [])[1] || "");
  const desc = s.slice(0, 1500);
  return {
    id: "irs-" + slug.split("/").pop(),
    source: "IRS Seized Property",
    state, city,
    address: street + ", " + city,
    type: mapType(title + " " + desc),
    beds: num((desc.match(/(\d+)\s*bed/i) || [])[1]) || 0,
    baths: num((desc.match(/(\d+)\s*bath/i) || [])[1]) || 0,
    sqft: num((desc.match(/([\d,]{3,6})\s*(?:sq\.?\s?ft|square\s?f)/i) || [])[1]) || 0,
    year: num((desc.match(/built in (\d{4})/i) || [])[1]) || null,
    lotAcres: null,
    price: bid ? num(bid) : null,
    marketValue: null,
    auctionDate: saleDate || null,
    lat: null, lng: null,
    url: `${BASE}${slug}`,
    live: true,
  };
}

async function scrape() {
  const list = await fetchText(`${BASE}/auction/items`, { timeout: 25, retries: 2 }).catch(() => "");
  const slugs = [...new Set((list.match(/href="(\/ad\/[a-z0-9\-]+)"/gi) || [])
    .map((h) => h.replace(/href="|"/g, "")))];
  const out = [];
  for (const slug of slugs) {
    try { const l = await parseDetail(slug); if (l && l.state && l.price != null) out.push(l); }
    catch (e) { /* skip bad detail */ }
  }
  return out;
}

module.exports = { scrape, parseDetail, id: "irsAuctions", label: "IRS Seized Real Property", status: "live" };
