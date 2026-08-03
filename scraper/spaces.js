"use strict";
/*
 * Commercial / studio space scraper (separate vertical from the houses feed).
 *
 * Pulls LA-area commercial + office listings FOR LEASE from Craigslist, then
 * OPENS EACH POST to read the true rent period (daily/weekly/monthly), the real
 * price, and square footage — because the search feed lies (placeholder $1
 * prices, and daily rates that look monthly). Only genuinely MONTHLY spaces with
 * a real price are kept. Writes ../spaces.json, which spaces.html loads.
 *
 *   node scraper/spaces.js
 *
 * Only runtime dep is curl. Craigslist blocks datacenter IPs, so this can 403
 * from CI; when it does, the last good spaces.json stays in place.
 */
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const REGIONS = [{ sub: "losangeles", label: "Los Angeles" }];

// Not a real, move-in monthly space (virtual/mail-only, hourly/daily services).
const NOT_SPACE = /virtual office|business address|mailing address|office address|mail plan|mailbox|po box|by the hour|per hour|\/\s?hr\b|hourly|by the day|day rate|\/\s?day\b|per day/i;
// Coworking / shared-desk / membership — a seat, not a space you lease. Its cheap
// "monthly" price is per-desk and misleading for someone renting an actual studio.
const COWORK = /coworking|co-working|hot\s?desks?|dedicated desks?|shared desks?|desks?\s+(are\s+)?(shared|not assigned)|not assigned|any available seat|day\s?pass|on-?demand|hybrid schedule|\bmemberships?\b|work anywhere|reserve your access/i;

function curl(url) {
  return new Promise((resolve) => {
    execFile("curl", ["-sS", "-m", "30", "-A", UA, url], { maxBuffer: 1024 * 1024 * 20 },
      (err, stdout) => resolve(err ? null : stdout));
  });
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  async function worker() { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); } }
  await Promise.all(Array.from({ length: limit }, worker));
  return out;
}
function findPostings(o) {
  if (Array.isArray(o)) {
    if (o.length && o[0] && o[0].PostingTitle !== undefined) return o;
    for (const el of o) { const r = findPostings(el); if (r) return r; }
  }
  return null;
}

// Read the truth off the actual post page.
function parseDetail(html, title) {
  if (!html) return {};
  let rp = (html.match(/rent_period=\d">\s*(daily|weekly|monthly)\s*<\/a>/i) || [])[1];
  if (!rp) { const m = html.match(/rent period:<\/span>[\s\S]{0,200}?>(daily|weekly|monthly)</i); rp = m ? m[1] : null; }
  const pr = (html.match(/class="price">\s*\$?([\d,]+)/i) || [])[1];
  const sf = (html.match(/([\d,]{2,6})\s*ft2/i) || [])[1] || (html.match(/(\d[\d,]{2,5})\s*(?:sq\.?\s?ft|sqft|square\s?feet)/i) || [])[1];
  const bodyM = html.match(/id="postingbody"[^>]*>([\s\S]*?)<\/section>/i);
  const body = bodyM ? bodyM[1].replace(/<[^>]+>/g, " ") : "";
  // Real city from the CL breadcrumb / URL area, for honest location labels.
  const hood = (html.match(/<small>\s*\(([^)]{2,40})\)\s*<\/small>/i) || [])[1] || null;
  return {
    rentPeriod: rp ? rp.toLowerCase() : null,
    price: pr ? +pr.replace(/[^0-9]/g, "") : null,
    sqft: sf ? +sf.replace(/[^0-9]/g, "") : null,
    cowork: COWORK.test(title || "") || COWORK.test(body),
    hood: hood ? hood.trim() : null,
  };
}

async function scrapeRegion(r) {
  const j = await curl(`https://${r.sub}.craigslist.org/jsonsearch/off?sort=priceasc`).then((t) => { try { return JSON.parse(t); } catch (e) { return null; } });
  let posts = j ? (findPostings(j) || []) : [];
  // de-dupe + drop obvious non-spaces before spending fetches on them
  const seen = {}; posts = posts.filter((p) => p && p.PostingID && p.PostingURL && p.PostingTitle &&
    !seen[p.PostingID] && (seen[p.PostingID] = 1) && !NOT_SPACE.test(p.PostingTitle));
  const cap = +(process.env.ES_SPACE_LIMIT || 400);
  posts = posts.slice(0, cap);
  console.log(`  ${r.label}: ${posts.length} candidate post(s), reading each for the true rent period…`);

  const spaces = [];
  await mapLimit(posts, 8, async (p) => {
    const d = parseDetail(await curl(p.PostingURL), p.PostingTitle);
    // MONTHLY only. Daily/weekly rates are not a monthly lease -> drop.
    if (d.rentPeriod === "daily" || d.rentPeriod === "weekly") return;
    if (d.cowork) return;                            // shared desk / coworking, not a leasable space
    const price = (d.price && d.price >= 50 && d.price <= 60000) ? d.price : null;
    if (price == null && p.Latitude == null) return; // nothing usable
    spaces.push({
      id: "cl-" + p.PostingID,
      source: "Craigslist",
      region: r.label,
      title: (p.PostingTitle || "").trim(),
      hood: d.hood || null,                          // real CL neighborhood, if the post gives one
      price: price,                                  // verified MONTHLY rent, or null
      period: d.rentPeriod || "monthly",
      sqft: d.sqft || null,
      lat: p.Latitude != null ? +p.Latitude : null,
      lng: p.Longitude != null ? +p.Longitude : null,
      postedDate: p.PostedDate || null,
      url: p.PostingURL || "",
      thumb: p.ImageThumb || "",
    });
  });
  return spaces;
}

async function main() {
  let all = [];
  for (const r of REGIONS) {
    try { all = all.concat(await scrapeRegion(r)); }
    catch (e) { console.error(`  [${r.label}] failed: ${e.message}`); }
  }
  const outPath = path.join(__dirname, "..", "spaces.json");
  if (!all.length) { console.log("No spaces pulled (likely IP-blocked) — keeping existing spaces.json."); return; }
  const priced = all.filter((s) => s.price != null).length;
  // If almost nothing came back with a verified price, the detail fetches were
  // likely IP-blocked (common in CI) — don't overwrite good data with blanks.
  if (priced < all.length * 0.3) {
    console.log(`Only ${priced}/${all.length} verified — likely blocked; keeping existing spaces.json.`);
    return;
  }
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), count: all.length, spaces: all }, null, 2));
  console.log(`\n✓ Wrote ${all.length} monthly space(s) (${priced} with a verified price) -> ${outPath}`);
}

main();
