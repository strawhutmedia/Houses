"use strict";
/*
 * PublicSurplus — https://www.publicsurplus.com  (government surplus auctions)
 * STATUS: LIVE (curl-scrapable). Real Estate category (catid=15).
 *   GET /sms/browse/cataucs?catid=15      -> grid of auctions (id + title)
 *   GET /sms/auction/view?auc=<id>        -> Address + Current Price / Minimum bid
 * Low, rotating volume and skews to tax-forfeit land / mobile homes, so we keep
 * only residential (mobile/manufactured homes, houses, condos) and drop land.
 */
const { fetchText } = require("../lib/http");

const BASE = "https://www.publicsurplus.com";
const RES_POS = /mobile|manufactured|trailer|\bhouse\b|\bhome\b|condo|duplex|cabin|residence|bungalow/i;
const RES_NEG = /\bland\b|parcel|\blot\b|acre|vacant|waterfront parcel|timber|farmland/i;

function clean(s) {
  return String(s || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}
function num(v) { var n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.]/g, "")); return isFinite(n) ? n : null; }

function parseGrid(html) {
  var out = [], seen = {};
  var re = /auc=(\d+)"[^>]*>([\s\S]{4,90}?)<\/a>/gi, m;
  while ((m = re.exec(html))) {
    var id = m[1]; if (seen[id]) continue; seen[id] = 1;
    var title = clean(m[2]);
    if (!title) continue;
    if (RES_NEG.test(title)) continue;
    if (!RES_POS.test(title)) continue;
    out.push({ id: id, title: title });
  }
  return out;
}

function mapType(title) {
  var t = (title || "").toLowerCase();
  if (/mobile|manufactured|trailer/.test(t)) return "Single Family"; // manufactured/mobile -> residential
  if (/condo/.test(t)) return "Condo";
  if (/duplex/.test(t)) return "Multi-Family";
  return "Single Family";
}

function parseAddress(html) {
  // "Address: 1383 Highway 107 Grasston, Mn. 55030"
  var m = html.match(/Address:\s*([^<\n]{6,120})/i);
  if (!m) return null;
  var raw = clean(m[1]);
  var sz = raw.match(/([A-Za-z .'-]+),\s*([A-Za-z]{2})\.?\s*(\d{5})/);
  return {
    address: raw,
    city: sz ? sz[1].trim() : "",
    state: sz ? sz[2].toUpperCase() : "",
    zip: sz ? sz[3] : "",
  };
}

async function fetchDetail(id, title) {
  var html = await fetchText(`${BASE}/sms/auction/view?auc=${id}`, { timeout: 30 });
  var a = parseAddress(html) || { address: title, city: "", state: "" };
  var price = (html.match(/(?:Current Price|Minimum bid|Current bid)\s*:?\s*[^$]{0,20}\$([\d,]+)/i) || [])[1];
  return {
    id: "ps-" + id,
    source: "PublicSurplus",
    state: a.state, city: a.city,
    address: a.address || title,
    type: mapType(title),
    price: num(price),
    marketValue: null,
    auctionDate: null,
    url: `${BASE}/sms/auction/view?auc=${id}`,
    live: true,
  };
}

async function scrape({ limit = 20 } = {}) {
  var grid;
  try { grid = parseGrid(await fetchText(`${BASE}/sms/browse/cataucs?catid=15`, { timeout: 35 })); }
  catch (e) { console.error("  [publicsurplus] grid failed: " + e.message); return []; }
  var out = [];
  for (var i = 0; i < grid.length && out.length < limit; i++) {
    try { var l = await fetchDetail(grid[i].id, grid[i].title); if (l) out.push(l); }
    catch (e) { /* skip */ }
  }
  return out;
}

module.exports = { scrape, id: "publicsurplus", label: "PublicSurplus Real Estate", status: "live" };
