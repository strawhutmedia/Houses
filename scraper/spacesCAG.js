"use strict";
/*
 * Commercial Asset Group (CAG) — LA commercial listings for lease.
 * https://cag-re.com/for-lease
 *
 * A broker source for the Studio Spaces page (most broker listings never touch
 * Craigslist). The listing page embeds a `mapsListings` JSON array — every
 * space with lat/lng, address, SF, type, and (for some) a published rate. Rates
 * are usually quoted "$X PSF/Mo" (per square foot per month, the LA convention);
 * we compute an estimated monthly from that and label it as an estimate. Spaces
 * with no published rate are shown honestly as "price on inquiry" with the CAG
 * contact — never a made-up number.
 */
const { fetchText } = require("../scraper/lib/http");

const LIST_URL = "https://cag-re.com/for-lease";
const BROKER = { name: "Commercial Asset Group", phone: "310-275-8222" };
// Not a private move-in space (coworking/shared/desk) — same bar as Craigslist.
const COWORK = /coworking|co-?working|shared\s?(desk|office|space|suite)|hot\s?desk|dedicated desk|day\s?pass|membership|virtual office/i;

function decode(s) {
  return String(s || "").replace(/<\/?br\s*\/?>/gi, " ").replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/&plusmn;/g, "±")
    .replace(/\s+/g, " ").trim();
}
function num(s) { const n = parseFloat(String(s == null ? "" : s).replace(/[^0-9.]/g, "")); return isFinite(n) ? n : null; }

function extractArray(html) {
  const start = html.indexOf('[{"Title"');
  if (start < 0) return [];
  let depth = 0, end = -1;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return [];
  try { return JSON.parse(html.slice(start, end + 1)); } catch (e) { return []; }
}

function mapType(types) {
  const t = (types || []).map((x) => (x.type_name || "").toLowerCase()).join(" ");
  if (/retail/.test(t)) return "Retail";
  if (/medical/.test(t)) return "Medical";
  if (/industrial|warehouse/.test(t)) return "Industrial";
  if (/office|creative/.test(t)) return "Office";
  return "Commercial";
}

// Pull a monthly figure out of the description when the rate is published.
// Rates must be anchored to a rent label so we never grab a parking/deposit fee
// (e.g. "Parking: $220/month"), and a per-SF sanity check rejects bad parses.
function sane(price, sqft) {
  if (price == null) return null;
  if (sqft) { const psf = price / sqft; if (psf < 0.75 || psf > 60) return null; }  // LA commercial ≈ $1–8/SF/mo
  return price;
}
function rateFrom(desc, sqft) {
  const d = decode(desc);
  // Explicit "negotiable / call" → price on inquiry, never a number.
  if (/(?:lease|rental|asking)?\s*rate\s*:?\s*negotiable/i.test(d)) return { price: null, est: false, note: null };
  // Direct monthly rent (must be labeled as the rate/rent, not a parking fee).
  let m = d.match(/(?:lease rate|rental rate|asking rate|\brent)\s*:?\s*\$([\d,]+(?:\.\d+)?)\s*\/?\s*(?:per\s*)?mo(?:nth)?\b/i);
  if (m) { const p = sane(Math.round(num(m[1])), sqft); if (p != null) return { price: p, est: false, note: "monthly rate" }; }
  // Per-square-foot rate → estimate the monthly.
  m = d.match(/(?:lease rate|rental rate|asking rate|\brate|\brent)\s*:?\s*\$([\d.]+)\s*(?:PSF|\/\s*SF|per\s*sf)/i);
  if (m && sqft) {
    const psf = num(m[1]);
    const nnn = (d.match(/NNN\s*est\.?\s*\$([\d.]+)\s*PSF/i) || [])[1];
    const total = psf + (nnn ? num(nnn) : 0);
    const p = sane(Math.round(total * sqft), sqft);
    if (p != null) return { price: p, est: true, note: "$" + psf + "/SF/mo" + (nnn ? " + NNN" : "") };
  }
  return { price: null, est: false, note: null };
}

async function scrape() {
  const html = await fetchText(LIST_URL, { timeout: 30, retries: 2 }).catch(() => "");
  const arr = extractArray(html);
  const out = [];
  for (const L of arr) {
    const addr = decode(L.Address);
    const csz = addr.match(/([A-Za-z][A-Za-z .'-]+),\s*([A-Z]{2})\s+(\d{5})/);
    if (!csz) continue;                       // need a real US location
    const title = decode(L.Title);
    if (COWORK.test(title + " " + decode(L.DescTitle) + " " + decode(L.Description))) continue;
    const sqft = num((String(L.SQF || "").split("-")[0])) || null;   // min of a range
    const r = rateFrom(L.Description, sqft);
    const slug = L.URL || "";
    const link = L.PageLink ? ("https://cag-re.com" + (L.PageLink[0] === "/" ? "" : "/") + L.PageLink)
      : ("https://cag-re.com/for-lease/" + slug);
    out.push({
      id: "cag-" + (slug || title).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40),
      source: "Commercial Asset Group",
      broker: BROKER.name,
      brokerPhone: BROKER.phone,
      region: "Los Angeles",
      title: title + (L.DescTitle ? " — " + decode(L.DescTitle) : ""),
      hood: csz[1].trim(),
      type: mapType(L.listing_types),
      price: r.price,
      priceEstimated: r.est,
      rateNote: r.note,
      priceOnInquiry: r.price == null,
      period: "monthly",
      sqft: sqft,
      lat: L.Latitude != null ? +L.Latitude : null,
      lng: L.Longitude != null ? +L.Longitude : null,
      postedDate: null,
      url: link,
      thumb: L.Photo ? ("https://cag-re.com" + (String(L.Photo)[0] === "/" ? "" : "/") + L.Photo) : "",
    });
  }
  return out;
}

module.exports = { scrape, extractArray, rateFrom, id: "cag", label: "Commercial Asset Group" };
