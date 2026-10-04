"use strict";
/*
 * House-alert discovery. Compass search pages started bot-blocking (HTTP 202,
 * empty body) on 2026-10-01, so discovery reads Coldwell Banker's IDX search
 * pages instead (full MLS inventory, not just CB listings), by ZIP, every page.
 * Each card carries type, status, MLS #, beds, baths, sqft, lat/lng and photos.
 *
 *   node scraper/house-discover.js > /tmp/cands.json   # candidates for the Routine
 *   node scraper/house-discover.js --mark /tmp/cands.json  # remember them (houses-seen.json)
 *
 * Filters: Single Family, Active, 1.5+ baths, under the city cap, inside one of
 * Ryan's neighborhoods (nearest center within its radius), and not already on
 * the board (finds.json) or already seen (houses-seen.json: MLS pid → price)
 * unless the price dropped since.
 * The Routine must still open each candidate's live page the same day.
 */
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const BASE = "https://www.coldwellbankerhomes.com";
const MAX_PAGES = 12;

const CITIES = {
  "Los Angeles": {
    cap: 1250000, state: "ca",
    zips: ["90042", "90039", "90065", "90041", "90026", "90027", "90031"],
    hoods: [
      ["Highland Park", 34.1115, -118.1920, 1.3], ["Atwater Village", 34.1164, -118.2566, 1.0],
      ["Frogtown", 34.0985, -118.2465, 0.8], ["Eagle Rock", 34.1390, -118.2130, 1.5],
      ["Mt. Washington", 34.1000, -118.2160, 0.9], ["Glassell Park", 34.1160, -118.2330, 1.0],
      ["Silver Lake", 34.0869, -118.2702, 1.3], ["Echo Park", 34.0782, -118.2606, 1.0],
      ["Los Feliz", 34.1066, -118.2848, 1.2],
    ],
  },
  Portland: {
    cap: 1000000, state: "or",
    zips: ["97210", "97221", "97239", "97201", "97211", "97217", "97227", "97215", "97214", "97202", "97212", "97232"],
    hoods: [
      ["West Hills", 45.5230, -122.7150, 1.8], ["SW Portland", 45.4800, -122.7050, 1.8],
      ["Alberta", 45.5590, -122.6450, 0.8], ["Mississippi", 45.5530, -122.6750, 0.6],
      ["Overlook", 45.5540, -122.6850, 0.7], ["Mt. Tabor", 45.5120, -122.5940, 1.0],
      ["Hawthorne", 45.5120, -122.6250, 0.8], ["Division", 45.5050, -122.6300, 0.8],
      ["Sellwood", 45.4650, -122.6530, 1.0], ["Irvington", 45.5410, -122.6470, 0.7],
      ["Laurelhurst", 45.5270, -122.6230, 0.7],
    ],
  },
};

const curl = (url) => new Promise((resolve) =>
  execFile("curl", ["-sSL", "-m", "30", "-A", UA, url], { maxBuffer: 1024 * 1024 * 40 }, (err, out) => resolve(err ? "" : out)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function miles(a, b, c, d) {
  const R = 3958.8, rad = Math.PI / 180;
  const x = Math.sin(((c - a) * rad) / 2) ** 2 + Math.cos(a * rad) * Math.cos(c * rad) * Math.sin(((d - b) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function hoodFor(hoods, lat, lng) {
  let best = null;
  for (const [name, hlat, hlng, r] of hoods) {
    const d = miles(lat, lng, hlat, hlng);
    if (d <= r && (!best || d < best.d)) best = { name, d };
  }
  return best && best.name;
}
const text = (h) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const num = (s) => (s == null ? null : +String(s).replace(/[^0-9.]/g, "") || null);
// "941 Fortune Way" / "941 FORTUNE WY." → "941 fortune" (number + first word)
const addrKey = (a) => String(a || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 2).join(" ");

function parseCards(html) {
  return html.split('<div class="property-snapshot-psr-panel"').slice(1).map((c) => {
    const attr = (k) => (c.match(new RegExp(`data-${k}="([^"]*)"`)) || [])[1];
    const vals = {};
    for (const m of c.matchAll(/<div class="val">([^<]*)<\/div><div class="lbl">([^<]*)<\/div>/g)) vals[m[2].trim()] = m[1].trim();
    const summary = text((c.match(/<div class="description-summary">([\s\S]*?)<\/div>/) || [])[1] || "");
    return {
      pid: attr("pid"),
      lat: +attr("lat"), lng: +attr("lng"),
      url: BASE + (attr("detailurl") || ""),
      address: text((c.match(/<span class="street-address">([\s\S]*?)<\/span>/) || [])[1] || ""),
      cityZip: text((c.match(/<span class="city-st-zip[^"]*">([\s\S]*?)<\/span>/) || [])[1] || ""),
      price: num((c.match(/<div class="price-normal">([^<]*)</) || [])[1]),
      summary, // e.g. "Single Family Active MLS # 26991731 Updated 18 hours ago"
      beds: num(vals["Beds"]),
      baths: num(vals["Total Baths"]) ?? num(vals["Full Baths"]),
      halfBaths: num(vals["Half Baths"]),
      sqft: num(vals["Sq. Ft."]),
      photo: ((c.match(/data-src-psr="([^"]+)"/) || [])[1] || "").replace(/\/s(\w+)\.webp$/, "/m$1.webp") || null,
    };
  }).filter((x) => x.pid);
}

async function scrapeZip(state, zip) {
  const seen = new Map();
  for (let p = 1; p <= MAX_PAGES; p++) {
    const html = await curl(`${BASE}/${state}/${zip}/${p > 1 ? `p_${p}/` : ""}`);
    const cards = parseCards(html);
    const before = seen.size;
    for (const c of cards) seen.set(c.pid, c);
    if (!cards.length || seen.size === before) break;
    await sleep(400);
  }
  return [...seen.values()];
}

function boardIndex() {
  try {
    const f = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "finds.json"), "utf8"));
    const idx = new Map();
    for (const x of [...(f.finds || []), ...(f.corrections || [])]) if (x.address) idx.set(addrKey(x.address), x.price || null);
    return idx;
  } catch { return new Map(); }
}

const SEEN = path.join(__dirname, "..", "houses-seen.json");
const readSeen = () => { try { return JSON.parse(fs.readFileSync(SEEN, "utf8")).pids || {}; } catch { return {}; } };

async function discover() {
  const board = boardIndex();
  const seen = readSeen();
  const out = [];
  const stats = {};
  for (const [city, cfg] of Object.entries(CITIES)) {
    const all = new Map();
    for (const zip of cfg.zips) for (const c of await scrapeZip(cfg.state, zip)) all.set(c.pid, c);
    stats[city] = { scanned: all.size };
    for (const c of all.values()) {
      if (!/single family/i.test(c.summary) || !/\bactive\b/i.test(c.summary)) continue;
      if (!c.price || c.price >= cfg.cap) continue;
      const baths = (c.baths || 0) + (c.halfBaths && !c.baths ? 0.5 * c.halfBaths : 0);
      if (baths < 1.5) continue;
      const hood = hoodFor(cfg.hoods, c.lat, c.lng);
      if (!hood) continue;
      const prior = board.has(addrKey(c.address)) ? board.get(addrKey(c.address)) : undefined;
      if (prior !== undefined && !(prior && c.price < prior)) continue; // already on board, no price drop
      const seenPrice = seen[c.pid];
      if (seenPrice !== undefined && !(c.price < seenPrice)) continue;   // already alerted/rejected, no price drop
      out.push({
        pid: c.pid, address: c.address, price: c.price, wasPrice: prior ?? seenPrice ?? null, beds: c.beds, baths: c.baths, sqft: c.sqft,
        city, hood, url: c.url, photo: c.photo, mls: (c.summary.match(/MLS #\s*(\S+)/) || [])[1] || null,
      });
    }
    stats[city].matches = out.filter((x) => x.city === city).length;
  }
  return { candidates: out, stats };
}

async function main() {
  const { candidates, stats } = await discover();
  console.error(JSON.stringify(stats));
  console.log(JSON.stringify(candidates, null, 2));
}

function mark(file) { markCandidates(JSON.parse(fs.readFileSync(file, "utf8"))); }
function markCandidates(cands) {
  const pids = readSeen();
  for (const c of cands) if (c.pid) pids[c.pid] = c.price;
  fs.writeFileSync(SEEN, JSON.stringify({ updatedAt: new Date().toISOString(), pids }, null, 0) + "\n");
  console.log(`marked ${cands.length}; ${Object.keys(pids).length} seen`);
}

if (require.main === module) {
  const i = process.argv.indexOf("--mark");
  if (i !== -1) mark(process.argv[i + 1]); else main();
}
module.exports = { parseCards, hoodFor, addrKey, CITIES, discover, markCandidates, curl };
