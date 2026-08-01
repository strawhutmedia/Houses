"use strict";
/*
 * EquityScout scraper runner.
 *
 *   node scraper/run.js            # run all adapters, write ../listings.json
 *   node scraper/run.js --gsa      # run a single adapter by id
 *   node scraper/run.js --states=CA,OR   # keep only these states (default: all)
 *
 * Output: listings.json at the repo root, which index.html loads at runtime.
 * If no live rows are produced, the site falls back to the curated sample set
 * in data.js, so the page is never empty.
 */
const fs = require("fs");
const path = require("path");
const { normalizeListing } = require("./lib/normalize");

const ADAPTERS = [
  require("./adapters/gsa"),
  require("./adapters/treasury"),
  require("./adapters/fdic"),
  require("./adapters/usmarshals"),
  require("./adapters/govdeals"),
  require("./adapters/countyTaxDeed"),
];

function parseArgs(argv) {
  const a = { only: null, states: null };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--states=")) a.states = arg.split("=")[1].split(",").map((s) => s.trim().toUpperCase());
    else if (arg.startsWith("--")) a.only = arg.slice(2);
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv);
  const targets = args.only ? ADAPTERS.filter((a) => a.id === args.only) : ADAPTERS;

  console.log(`EquityScout scraper — running ${targets.length} adapter(s)\n`);
  const all = [];
  const summary = [];

  for (const adapter of targets) {
    process.stdout.write(`• ${adapter.label} [${adapter.status}] … `);
    try {
      const rows = (await adapter.scrape()) || [];
      const norm = rows.map(normalizeListing).filter((r) => r.price != null || r.marketValue != null || r.address);
      all.push(...norm);
      summary.push({ id: adapter.id, status: adapter.status, count: norm.length });
      console.log(`${norm.length} listing(s)`);
    } catch (e) {
      summary.push({ id: adapter.id, status: "error", count: 0, error: e.message });
      console.log(`ERROR: ${e.message}`);
    }
  }

  let listings = all;
  if (args.states) listings = listings.filter((l) => args.states.includes(l.state));

  const payload = {
    generatedAt: new Date().toISOString(),
    liveCount: listings.filter((l) => l.live).length,
    sources: summary,
    listings,
  };

  const outPath = path.join(__dirname, "..", "listings.json");
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));

  console.log(`\n✓ Wrote ${listings.length} listing(s) -> ${outPath}`);
  console.log("  Source status:");
  for (const s of summary) console.log(`    - ${s.id}: ${s.status} (${s.count})`);
  if (listings.length === 0) {
    console.log("\n  No live rows yet — the website will fall back to sample data (data.js).");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
