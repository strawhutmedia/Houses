"use strict";
/*
 * Commercial / studio space scraper (separate vertical from the houses feed).
 *
 * Pulls LA-area commercial + office listings FOR LEASE from Craigslist's public
 * jsonsearch endpoint and writes ../spaces.json, which spaces.html loads.
 *
 *   node scraper/spaces.js
 *
 * Only runtime dep is curl. Craigslist blocks datacenter IPs aggressively, so
 * this can 403 from some CI runners; when it does, the last good spaces.json
 * stays in place (the page always has data).
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Craigslist regions to pull (subdomain -> label). LA first; add more later.
const REGIONS = [
  { sub: "losangeles", label: "Los Angeles" },
];
// "off" = office & commercial (lease). Grab the cheapest first.
function fetchRegion(sub) {
  const url = `https://${sub}.craigslist.org/jsonsearch/off?sort=priceasc`;
  try {
    const out = execFileSync("curl", ["-sS", "-m", "40", "-A", UA, url], { maxBuffer: 1024 * 1024 * 40 }).toString();
    return JSON.parse(out);
  } catch (e) { console.error(`  [craigslist ${sub}] failed: ${e.message}`); return null; }
}
// Not a real, move-in monthly space: virtual/mail-only addresses and
// hourly/daily rentals (their "price" isn't a real monthly rent).
const NOT_SPACE = /virtual office|business address|mailing address|office address|mail plan|mailbox|po box|by the hour|per hour|\/\s?hr\b|hourly|by the day|day rate|\/\s?day\b|per day/i;

// Find the array of postings inside Craigslist's nested json.
function findPostings(o) {
  if (Array.isArray(o)) {
    if (o.length && o[0] && o[0].PostingTitle !== undefined) return o;
    for (const el of o) { const r = findPostings(el); if (r) return r; }
  }
  return null;
}

// Craigslist commercial posts are full of placeholder prices ($1, $0, and spam
// like 1234/12345) — the real monthly rent lives in the post body. Trust the
// CL price only when it's a normal monthly figure; otherwise try to read a real
// price out of the title; otherwise leave it null ("price in listing").
function realMonthly(clPrice, title) {
  const cl = clPrice != null ? +String(clPrice).replace(/[^0-9.]/g, "") : null;
  const SPAM = { 1234: 1, 2345: 1, 3456: 1, 4567: 1, 12345: 1, 11111: 1, 22222: 1, 99999: 1, 1111: 1, 2222: 1 };
  if (cl != null && cl >= 50 && cl <= 60000 && !SPAM[cl]) return Math.round(cl);
  const nums = (String(title).match(/\$\s?[\d,]{2,7}/g) || [])
    .map((x) => +x.replace(/[^0-9]/g, "")).filter((n) => n >= 100 && n <= 60000 && !SPAM[n]);
  return nums.length ? Math.min.apply(null, nums) : null;
}

function toSpace(p, region) {
  const title = (p.PostingTitle || "").trim();
  return {
    id: "cl-" + p.PostingID,
    source: "Craigslist",
    region: region,
    title: title,
    price: realMonthly(p.price, title),   // validated monthly lease $, or null
    lat: p.Latitude != null ? +p.Latitude : null,
    lng: p.Longitude != null ? +p.Longitude : null,
    postedDate: p.PostedDate || null,
    url: p.PostingURL || "",
    thumb: p.ImageThumb || "",
  };
}

function main() {
  const all = [];
  const seen = {};
  for (const r of REGIONS) {
    const j = fetchRegion(r.sub);
    const posts = j ? (findPostings(j) || []) : [];
    let kept = 0;
    for (const p of posts) {
      if (!p.PostingID || seen[p.PostingID]) continue;
      seen[p.PostingID] = 1;
      const s = toSpace(p, r.label);
      if (!s.title || !s.url) continue;
      if (NOT_SPACE.test(s.title)) continue;            // drop virtual/mail/hourly
      if (s.price == null && s.lat == null) continue;    // nothing to show
      all.push(s); kept++;
    }
    console.log(`  ${r.label}: ${kept} space(s)`);
  }

  const outPath = path.join(__dirname, "..", "spaces.json");
  if (!all.length) {
    console.log("No spaces pulled (likely IP-blocked) — keeping existing spaces.json.");
    return;
  }
  const payload = { generatedAt: new Date().toISOString(), count: all.length, spaces: all };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`\n✓ Wrote ${all.length} space(s) -> ${outPath}`);
}

main();
