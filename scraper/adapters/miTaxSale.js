"use strict";
/*
 * Michigan Public Land Auction — tax-sale.info
 *
 * The statewide platform for Michigan county tax-foreclosure auctions (the
 * Bid4Assets of Michigan, run by Title Check LLC). Season runs Aug–Oct with
 * a county catalog per sale day. Two things make it a first-class source:
 *   1. Every catalog has a clean CSV export (/catalog/getCsv/id/{id}) with
 *      minimum bid, address, lat/lng and a frank condition write-up.
 *   2. Each row carries the parcel's SEV — Michigan's State Equalized Value,
 *      defined as HALF of assessed market value — so marketValue = SEV × 2
 *      gives REAL equity math with no AI estimation.
 * We scan /auctions for upcoming sale dates, pull each county's CSV, and keep
 * rows whose description says there's an actual dwelling on the parcel.
 */
const { fetchText } = require("../lib/http");

const BASE = "https://www.tax-sale.info";
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const HOME_RE = /\b(home|house|cottage|cabin|duplex|bungalow|farmhouse|residence)\b/i;

// Minimal CSV parser: quoted fields, "" escapes, newlines inside quotes.
function parseCsv(text) {
  const rows = []; let row = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => { const o = {}; head.forEach((h, i) => { o[h] = (r[i] || "").trim(); }); return o; });
}

function num(v) {
  const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : null;
}
// Longitude comes as "W86.0847" — west means negative.
function lng(v) {
  const s = String(v || "").trim();
  const n = num(s);
  if (n == null) return null;
  return /^w/i.test(s) ? -Math.abs(n) : n;
}
function titleCase(s) {
  return String(s || "").toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).trim();
}

// The /auctions page interleaves "Month DD, YYYY" headers with that sale's
// "Ready to Browse" catalog links; pair each catalog with the last date seen.
function upcomingCatalogs(html, today) {
  const out = {};
  const re = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})|\/listings\/catalog\/(\d+)/gi;
  let cur = null, m;
  while ((m = re.exec(html))) {
    if (m[4]) { if (cur && cur >= today && !out[m[4]]) out[m[4]] = cur; }
    else {
      const mo = MONTHS[m[1].toLowerCase()];
      cur = `${m[3]}-${String(mo).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
    }
  }
  return out; // { catalogId: "YYYY-MM-DD" }
}

function toListing(r, catId, saleDate) {
  const desc = r["Comment 2"] || "";
  const addr = r["Address"] || "";
  if (!HOME_RE.test(desc + " " + addr)) return null; // vacant land / commercial
  const lot = r["Lot Number"]; if (!lot) return null;
  const minBid = num(r["Minimum Bid"]); if (minBid == null) return null;
  const sev = num(r["SEV"]);
  // Address format is "STREET  CITY" (double space); Local Unit as fallback.
  const parts = addr.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
  const city = titleCase(parts.length > 1 ? parts[parts.length - 1]
    : (r["Local Unit"] || "").replace(/\s+(TOWNSHIP|TWP|CITY|VILLAGE)\s*$/i, ""));
  const isMobile = /\b(mobile|manufactured)\s+home\b/i.test(desc);
  return {
    id: `mtsi-${catId}-${lot}`,
    source: "MI Tax Auction",
    state: "MI",
    city,
    address: titleCase(parts[0] || addr) + (city ? ", " + city + ", MI" : ", MI"),
    type: isMobile ? "Mobile/Manufactured" : "Single Family",
    beds: 0, baths: 0, sqft: 0, year: null, lotAcres: null,
    price: minBid,
    // SEV is statutorily half of market value — real, assessor-grade equity.
    marketValue: sev ? sev * 2 : null,
    valueBasis: sev ? "assessed (SEV × 2)" : null,
    auctionDate: saleDate,
    lat: num(r["Latitude"]), lng: lng(r["Longitude"]),
    url: `${BASE}/listings/catalog/${catId}`,
    live: true,
  };
}

async function scrape() {
  const today = new Date().toISOString().slice(0, 10);
  const page = await fetchText(`${BASE}/auctions`, { timeout: 40, retries: 2 });
  const cats = upcomingCatalogs(page, today);
  const ids = Object.keys(cats).slice(0, 60); // safety cap
  const out = [];
  for (let i = 0; i < ids.length; i += 8) {
    const batch = ids.slice(i, i + 8);
    const csvs = await Promise.all(batch.map((id) =>
      fetchText(`${BASE}/catalog/getCsv/id/${id}`, { timeout: 40, retries: 2 }).catch(() => "")));
    batch.forEach((id, j) => {
      for (const row of parseCsv(csvs[j])) {
        const l = toListing(row, id, cats[id]);
        if (l) out.push(l);
      }
    });
  }
  return out;
}

module.exports = { scrape, id: "miTaxSale", label: "Michigan Tax Auctions (tax-sale.info)", status: "live" };
