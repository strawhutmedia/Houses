"use strict";
/*
 * Studio alert candidates: filters ../spaces.json (from scraper/spaces.js) down
 * to Ryan's studio criteria and drops anything already alerted
 * (../studios-seen.json). Prints candidates as JSON for the daily Studio
 * Routine, which still verifies each one live before emailing.
 *
 *   node scraper/studio-alert.js            # print candidates
 *   node scraper/studio-alert.js --mark id1,id2   # record ids as alerted
 */
const fs = require("fs");
const path = require("path");

const MIN_SQFT = 800;
const MAX_RENT = 3500;
// Neighborhood centers + radius (miles). Order = email order.
const AREAS = [
  { hood: "Silver Lake", lat: 34.0869, lng: -118.2702, r: 1.6, re: /silver\s?lake/i },
  { hood: "Atwater Village", lat: 34.1164, lng: -118.2566, r: 1.2, re: /atwater/i },
  { hood: "Frogtown", lat: 34.0985, lng: -118.2465, r: 0.9, re: /frogtown|elysian valley/i },
  { hood: "Toluca Lake", lat: 34.1520, lng: -118.3500, r: 1.0, re: /toluca lake/i },
  { hood: "Burbank", lat: 34.1808, lng: -118.3090, r: 3.5, re: /burbank/i },
];

// Not a studio: auto/industrial trades, salons, food, storage.
const NOT_STUDIO = /body\s?shop|smog|auto (repair|shop|body)|mechanic|car wash|tire|salon|barber|restaurant|kitchen for rent|storage unit|parking (space|spot)/i;

const ROOT = path.join(__dirname, "..");
const SEEN = path.join(ROOT, "studios-seen.json");

function miles(a, b, c, d) {
  const R = 3958.8, rad = Math.PI / 180;
  const x = Math.sin(((c - a) * rad) / 2) ** 2 + Math.cos(a * rad) * Math.cos(c * rad) * Math.sin(((d - b) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function areaFor(s) {
  const text = `${s.hood || ""} ${s.title || ""}`;
  for (const a of AREAS) {
    if (s.lat != null && s.lng != null && miles(s.lat, s.lng, a.lat, a.lng) <= a.r) return a.hood;
  }
  // No coords (or outside every circle): trust an explicit name in hood/title.
  if (s.lat == null || s.lng == null) { const a = AREAS.find((x) => x.re.test(text)); return a ? a.hood : null; }
  return null;
}
const readSeen = () => { try { return JSON.parse(fs.readFileSync(SEEN, "utf8")); } catch { return { ids: [] }; } };

function candidates(spaces, seenIds) {
  const seen = new Set(seenIds);
  return spaces
    .filter((s) => !seen.has(s.id))
    .filter((s) => (s.period || "monthly") === "monthly" && s.price > 0 && s.price <= MAX_RENT)
    .filter((s) => !NOT_STUDIO.test(s.title || ""))
    // Many posts omit size; keep those (flagged) so the Routine can read the post.
    .filter((s) => s.sqft == null || s.sqft >= MIN_SQFT)
    .map((s) => ({ ...s, area: areaFor(s) }))
    .filter((s) => s.area)
    // Same post found by two searches (or reposted) → keep one.
    .filter(((keys) => (s) => { const k = `${s.title}|${s.price}`.toLowerCase(); return !keys.has(k) && keys.add(k); })(new Set()))
    .map((s) => ({
      id: s.id, area: s.area, title: s.title, price: s.price, sqft: s.sqft, sizeUnknown: s.sqft == null, url: s.url, source: s.source,
      // Craigslist thumbs are 50x50; the same image exists at 600x450.
      photo: s.thumb ? s.thumb.replace(/_50x50c\.jpg$/, "_600x450.jpg") : null,
    }))
    .sort((a, b) => AREAS.findIndex((x) => x.hood === a.area) - AREAS.findIndex((x) => x.hood === b.area) || a.price - b.price);
}

if (require.main === module) {
  const i = process.argv.indexOf("--mark");
  if (i !== -1) {
    const seen = readSeen();
    const add = (process.argv[i + 1] || "").split(",").filter(Boolean);
    seen.ids = [...new Set([...seen.ids, ...add])];
    seen.updatedAt = new Date().toISOString();
    fs.writeFileSync(SEEN, JSON.stringify(seen, null, 2) + "\n");
    console.log(`marked ${add.length}; ${seen.ids.length} total`);
  } else {
    const { spaces = [] } = JSON.parse(fs.readFileSync(path.join(ROOT, "spaces.json"), "utf8"));
    console.log(JSON.stringify(candidates(spaces, readSeen().ids), null, 2));
  }
}

module.exports = { candidates, areaFor, AREAS, MIN_SQFT, MAX_RENT };
