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
// Find the array of postings inside Craigslist's nested json.
function findPostings(o) {
  if (Array.isArray(o)) {
    if (o.length && o[0] && o[0].PostingTitle !== undefined) return o;
    for (const el of o) { const r = findPostings(el); if (r) return r; }
  }
  return null;
}

function toSpace(p, region) {
  const price = p.price != null ? +String(p.price).replace(/[^0-9.]/g, "") : null;
  return {
    id: "cl-" + p.PostingID,
    source: "Craigslist",
    region: region,
    title: (p.PostingTitle || "").trim(),
    price: (price && price > 0) ? price : null,   // monthly lease $
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
      // keep only rows a buyer can act on: a title + a link, and a real geo or price
      if (s.title && s.url && (s.price != null || s.lat != null)) { all.push(s); kept++; }
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
