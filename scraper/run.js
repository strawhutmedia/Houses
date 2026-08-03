"use strict";
/*
 * EquityScout scraper runner.
 *
 *   node scraper/run.js                 # run all adapters, write ../listings.json
 *   node scraper/run.js --hud           # run a single adapter by id
 *   node scraper/run.js --states=CA,OR  # keep only these states (default: all)
 *   node scraper/run.js --noai          # skip AI enrichment even if a key is set
 *
 * AI enrichment (only when ANTHROPIC_API_KEY is set): for the cheapest
 * ES_ENRICH_LIMIT listings, estimate market value + rent (real equity/discount)
 * and rate condition from photos. Costs API tokens; tune with ES_ENRICH_LIMIT
 * and ES_EXTRACT_MODEL (e.g. claude-haiku-4-5). No key -> enrichment is skipped.
 *
 * If no live rows are produced, the site falls back to the sample set in data.js.
 */
const fs = require("fs");
const path = require("path");
const { normalizeListing } = require("./lib/normalize");
const ai = require("./lib/aiExtract");

// Residential-only live feed (no commercial/land, per spec).
const ADAPTERS = [
  require("./adapters/hud"),          // LIVE: cheap FHA foreclosure homes (nationwide)
  require("./adapters/bid4assets"),   // LIVE: cheap county tax-deed / sheriff-sale houses
  require("./adapters/publicsurplus"),// LIVE: gov surplus real estate (thin, land-heavy)
  require("./adapters/cws"),          // Treasury + US Marshals forfeiture (headless; CI only)
  require("./adapters/fdic"),
  require("./adapters/govdeals"),
  require("./adapters/countyTaxDeed"),
];

function parseArgs(argv) {
  const a = { only: null, states: null, noai: false };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--states=")) a.states = arg.split("=")[1].split(",").map((s) => s.trim().toUpperCase());
    else if (arg === "--noai") a.noai = true;
    else if (arg.startsWith("--")) a.only = arg.slice(2);
  }
  return a;
}

const US_STATES = new Set(("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN " +
  "MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY").split(" "));
// A row is publishable only if it has a real US state and something a buyer can
// evaluate (an opening price or an estimated market value).
function isUsable(r) {
  if (!US_STATES.has(r.state)) return false;
  return r.price != null || r.marketValue != null;
}

function condClass(label) {
  return { "Move-in Ready": "good", "Light Rehab": "ok", "Moderate Rehab": "warn",
    "Heavy Rehab": "bad", "Uninhabitable": "bad" }[label] || "warn";
}

async function enrich(rawRows) {
  const limit = +(process.env.ES_ENRICH_LIMIT || 40);
  const priced = rawRows.filter((r) => r.price != null).sort((a, b) => a.price - b.price).slice(0, limit);
  console.log(`\nAI enrichment: ${priced.length} cheapest listings (model ${ai.MODEL})…`);
  let vOk = 0, cOk = 0;
  for (const r of priced) {
    try {
      const v = await ai.estimateValue(r);
      if (v && v.marketValue) {
        r.marketValue = v.marketValue;
        if (v.rentEstimate) r.rentEstimate = v.rentEstimate;
        r.valueBasis = "AI estimate";
        vOk++;
      }
    } catch (e) { /* skip value */ }
    if (process.env.ES_ASSESS_PHOTOS !== "0" && r.photoUrls && r.photoUrls.length) {
      try {
        const c = await ai.assessConditionFromUrls(r.photoUrls);
        if (c) {
          r.condition = { label: c.label, damage: c.damage, pct: c.pct, cls: condClass(c.label) };
          r.photoCount = Math.min(4, r.photoUrls.length);
          cOk++;
        }
      } catch (e) { /* skip condition */ }
    }
  }
  console.log(`  values estimated: ${vOk} | conditions assessed: ${cOk}`);
}

// Read the existing window.VIBES = {...} object out of ../vibes.js (or {}).
function loadVibes(vibesPath) {
  try {
    var txt = fs.readFileSync(vibesPath, "utf8");
    var m = txt.match(/window\.VIBES\s*=\s*(\{[\s\S]*\});?\s*$/);
    return m ? JSON.parse(m[1]) : {};
  } catch (e) { return {}; }
}
// Assess every town in this run's listings that we don't have a vibe for yet,
// in batches, and merge into vibes.js.
async function refreshVibes(listings) {
  const vibesPath = path.join(__dirname, "..", "vibes.js");
  const have = loadVibes(vibesPath);
  const seen = {};
  listings.forEach(function (l) {
    if (l.city && l.state) { var k = l.city + ", " + l.state; if (!have[k]) seen[k] = 1; }
  });
  const missing = Object.keys(seen);
  if (!missing.length) { console.log("  vibes: all towns already assessed."); return; }
  const limit = +(process.env.ES_VIBE_LIMIT || 300); // cap per run to bound cost
  const todo = missing.slice(0, limit);
  console.log(`\nAI town vibes: ${todo.length} new town(s) (model ${ai.MODEL})…`);
  let added = 0;
  for (let i = 0; i < todo.length; i += 40) {
    const batch = todo.slice(i, i + 40);
    try {
      const map = await ai.assessTowns(batch);
      Object.keys(map).forEach(function (k) { have[k] = map[k]; added++; });
    } catch (e) { console.log("  vibe batch failed: " + e.message); }
  }
  const header = "/* AI-generated town \"vibe\" reads for a private family home search. " +
    "s = cool score 1-5, v = blurb, t = tags. Auto-extended by the scraper as new towns appear. Estimates. */\n";
  fs.writeFileSync(vibesPath, header + "window.VIBES=" + JSON.stringify(have) + ";\n");
  console.log(`  vibes: added ${added}, total ${Object.keys(have).length}.` +
    (missing.length > todo.length ? ` (${missing.length - todo.length} left for next run)` : ""));
}

async function main() {
  const args = parseArgs(process.argv);
  const targets = args.only ? ADAPTERS.filter((a) => a.id === args.only) : ADAPTERS;

  console.log(`EquityScout scraper — running ${targets.length} adapter(s)\n`);
  const raw = [];
  const summary = [];

  for (const adapter of targets) {
    process.stdout.write(`• ${adapter.label} [${adapter.status}] … `);
    try {
      const rows = (await adapter.scrape()) || [];
      raw.push(...rows);
      summary.push({ id: adapter.id, status: adapter.status, count: rows.length });
      console.log(`${rows.length} listing(s)`);
    } catch (e) {
      summary.push({ id: adapter.id, status: "error", count: 0, error: e.message });
      console.log(`ERROR: ${e.message}`);
    }
  }

  // AI enrichment (value + condition) when a key is present.
  if (ai.hasCreds() && !args.noai) {
    try { await enrich(raw); } catch (e) { console.log("  enrichment error: " + e.message); }
  } else {
    console.log("\n(AI enrichment skipped — set ANTHROPIC_API_KEY to enable real equity + photo condition.)");
  }

  // Quality gate: only publish rows a buyer can actually act on — a real US
  // state AND a price or estimated value. This is what keeps half-parsed junk
  // (e.g. auction-catalog fragments with no location/price) out of the feed.
  let listings = raw.map(normalizeListing).filter(isUsable);
  if (args.states) listings = listings.filter((l) => args.states.includes(l.state));
  const dropped = raw.length - listings.length;
  if (dropped > 0) console.log(`  (quality gate dropped ${dropped} row(s) with no US state or no price)`);

  const payload = {
    generatedAt: new Date().toISOString(),
    liveCount: listings.filter((l) => l.live).length,
    enriched: ai.hasCreds() && !args.noai,
    sources: summary,
    listings,
  };

  const outPath = path.join(__dirname, "..", "listings.json");
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));

  // AI "town vibe" reads: assess any NEW town that showed up this run and cache
  // it into ../vibes.js so it's a one-time cost per town. No key -> keep the
  // hand-seeded set as-is.
  if (ai.hasCreds() && !args.noai) {
    try { await refreshVibes(listings); } catch (e) { console.log("  vibe refresh error: " + e.message); }
  }

  console.log(`\n✓ Wrote ${listings.length} listing(s) -> ${outPath}`);
  console.log("  Source status:");
  for (const s of summary) console.log(`    - ${s.id}: ${s.status} (${s.count})`);
  if (listings.length === 0) console.log("\n  No live rows yet — the website falls back to sample data (data.js).");
}

main().catch((e) => { console.error(e); process.exit(1); });
