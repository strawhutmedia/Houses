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

  let listings = raw.map(normalizeListing).filter((r) => r.price != null || r.marketValue != null || r.address);
  if (args.states) listings = listings.filter((l) => args.states.includes(l.state));

  const payload = {
    generatedAt: new Date().toISOString(),
    liveCount: listings.filter((l) => l.live).length,
    enriched: ai.hasCreds() && !args.noai,
    sources: summary,
    listings,
  };

  const outPath = path.join(__dirname, "..", "listings.json");
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));

  console.log(`\n✓ Wrote ${listings.length} listing(s) -> ${outPath}`);
  console.log("  Source status:");
  for (const s of summary) console.log(`    - ${s.id}: ${s.status} (${s.count})`);
  if (listings.length === 0) console.log("\n  No live rows yet — the website falls back to sample data (data.js).");
}

main().catch((e) => { console.error(e); process.exit(1); });
