"use strict";
/*
 * AI extraction stage — "the AI that scrapes every source."
 * ------------------------------------------------------------------
 * Every government/county source formats listings differently (messy HTML,
 * PDFs, JS-rendered grids, plain screenshots). Instead of a brittle hand-written
 * parser per site, this stage hands the raw page (or a screenshot image) to
 * Claude and gets back clean, structured listings that match our schema.
 *
 * Two entry points:
 *   extractListingsFromHtml(html, ctx)   -> [listing, ...]
 *   extractListingsFromImage(b64, media, ctx) -> [listing, ...]   (screenshots)
 *   assessConditionFromPhotos([b64...], ctx)  -> { label, damage, pct }
 *
 * Auth: reads ANTHROPIC_API_KEY (or an `ant auth login` profile via ANTHROPIC_AUTH_TOKEN).
 * With no credentials it NO-OPS (returns [] / null) so the scraper still runs.
 *
 * Model: defaults to claude-opus-5; override with ES_EXTRACT_MODEL (e.g.
 * claude-haiku-4-5 for cheap high-volume extraction).
 * ------------------------------------------------------------------
 */
const { execFile } = require("child_process");

const API = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.ES_EXTRACT_MODEL || "claude-opus-5";
const KEY = process.env.ANTHROPIC_API_KEY || "";

function hasCreds() { return !!KEY; }

// JSON schema the model must return — matches lib/normalize.js input shape.
const LISTING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    listings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          address: { type: "string" },
          city: { type: "string" },
          state: { type: "string" },
          zip: { type: "string" },
          county: { type: "string" },
          type: { type: "string", enum: ["Single Family", "Multi-Family", "Townhouse", "Condo", "Land", "Commercial / Other"] },
          beds: { type: "integer" },
          baths: { type: "number" },
          sqft: { type: "integer" },
          year: { type: "integer" },
          price: { type: "integer" },
          marketValue: { type: "integer" },
          auctionDate: { type: "string" },
          url: { type: "string" },
          isResidential: { type: "boolean" },
        },
        required: ["address", "city", "state", "type", "price", "isResidential"],
      },
    },
  },
  required: ["listings"],
};

const VALUE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    marketValue: { type: "integer" },
    rentEstimate: { type: "integer" },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
  },
  required: ["marketValue", "confidence"],
};

const CONDITION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    label: { type: "string", enum: ["Move-in Ready", "Light Rehab", "Moderate Rehab", "Heavy Rehab", "Uninhabitable"] },
    damage: { type: "string", enum: ["Minimal", "Cosmetic", "Moderate", "Significant", "Severe"] },
    pct: { type: "integer" },
    notes: { type: "string" },
  },
  required: ["label", "damage", "pct"],
};

function callClaude(userContent, schema, maxTokens) {
  return new Promise((resolve, reject) => {
    var body = JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens || 4096,
      output_config: { format: { type: "json_schema", schema: schema } },
      messages: [{ role: "user", content: userContent }],
    });
    var args = [
      "-sS", "-m", "120", API,
      "-H", "content-type: application/json",
      "-H", "x-api-key: " + KEY,
      "-H", "anthropic-version: 2023-06-01",
      "-d", "@-",
    ];
    var cp = execFile("curl", args, { maxBuffer: 1024 * 1024 * 20 }, function (err, stdout, stderr) {
      if (err) return reject(new Error("claude call failed: " + (stderr || err.message)));
      try {
        var res = JSON.parse(stdout);
        if (res.type === "error") return reject(new Error(res.error && res.error.message));
        if (res.stop_reason === "refusal") return resolve(null); // classifier declined
        var textBlock = (res.content || []).find(function (b) { return b.type === "text"; });
        resolve(textBlock ? JSON.parse(textBlock.text) : null);
      } catch (e) { reject(new Error("bad response: " + e.message + " :: " + stdout.slice(0, 200))); }
    });
    cp.stdin.write(body);
    cp.stdin.end();
  });
}

var EXTRACT_INSTRUCTIONS =
  "You are extracting REAL cheap residential auction/foreclosure home listings from a government or county " +
  "property-auction page. Return ONLY residential homes that are actually for sale at auction (single family, " +
  "duplex/triplex/fourplex, condo, townhouse, manufactured/mobile). EXCLUDE vacant land, commercial buildings, " +
  "timeshares, and anything that is not an auctioned house. Set isResidential=false for anything you're unsure " +
  "about and it will be dropped. Extract the opening/minimum bid as `price`. Only include listings you can " +
  "actually see in the content — never invent addresses or prices. If the page has no qualifying homes, return " +
  "an empty listings array.";

async function extractListingsFromHtml(html, ctx) {
  if (!hasCreds()) return [];
  ctx = ctx || {};
  // Trim obvious noise to keep token cost down; the model handles the rest.
  var trimmed = String(html).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").slice(0, 120000);
  var content = [{ type: "text", text: EXTRACT_INSTRUCTIONS + "\n\nSource: " + (ctx.source || "unknown") + "\nPage content:\n" + trimmed }];
  var out = await callClaude(content, LISTING_SCHEMA, 8192);
  return normalizeExtracted(out, ctx);
}

// The user's own idea, automated: read a screenshot of the listing page.
async function extractListingsFromImage(base64, mediaType, ctx) {
  if (!hasCreds()) return [];
  ctx = ctx || {};
  var content = [
    { type: "image", source: { type: "base64", media_type: mediaType || "image/png", data: base64 } },
    { type: "text", text: EXTRACT_INSTRUCTIONS + "\n\nSource: " + (ctx.source || "screenshot") },
  ];
  var out = await callClaude(content, LISTING_SCHEMA, 8192);
  return normalizeExtracted(out, ctx);
}

// Vision condition/damage assessment from listing photos.
async function assessConditionFromPhotos(base64Images, ctx) {
  if (!hasCreds() || !base64Images || !base64Images.length) return null;
  var content = base64Images.slice(0, 8).map(function (b64) {
    return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } };
  });
  content.push({
    type: "text",
    text: "These are listing photos of a home being sold at a government/tax auction. Assess its overall condition " +
      "and how much rehab/repair it likely needs from what you can see (roof, siding, windows, interior, yard, " +
      "visible damage). Give a single overall rating, a damage level, an approximate rehab-severity percentage " +
      "(0=pristine, 100=needs full gut), and a one-line note on the most notable issues.",
  });
  return callClaude(content, CONDITION_SCHEMA, 1024);
}

// Rough market-value + rent estimate from the property facts (a free "AVM"
// using the model instead of a paid comps API). Powers real equity/discount.
async function estimateValue(listing) {
  if (!hasCreds()) return null;
  var facts = [
    "Address: " + (listing.address || ""),
    "City/State/ZIP: " + [listing.city, listing.state, listing.zip].filter(Boolean).join(" "),
    "Type: " + (listing.type || ""),
    "Beds: " + (listing.beds || "?") + ", Baths: " + (listing.baths || "?") + ", Sqft: " + (listing.sqft || "?"),
    "Year built: " + (listing.year || "?"),
    "Auction opening price: $" + (listing.price != null ? listing.price : "?"),
  ].join("\n");
  return callClaude([{
    type: "text",
    text: "Estimate the current retail market value (what it would sell for on the open MLS in decent condition) " +
      "and a realistic monthly market rent for this U.S. home, based on the location and specs. Use your knowledge " +
      "of that area's price levels. Give whole-dollar integers and a confidence level. If you truly cannot estimate, " +
      "use confidence 'low'.\n\n" + facts,
  }], VALUE_SCHEMA, 512);
}

function normalizeExtracted(out, ctx) {
  if (!out || !out.listings) return [];
  return out.listings
    .filter(function (l) { return l.isResidential !== false; })
    .map(function (l, i) {
      return {
        id: (ctx.idPrefix || "ai") + "-" + (l.zip || "") + "-" + (l.price || i),
        source: ctx.source || "AI-extracted",
        state: (l.state || "").toUpperCase(),
        city: l.city || "",
        address: l.address || "",
        type: l.type || "Single Family",
        beds: l.beds || 0, baths: l.baths || 0, sqft: l.sqft || 0, year: l.year || null,
        price: l.price || null,
        marketValue: l.marketValue || null,
        auctionDate: l.auctionDate || null,
        url: l.url || ctx.url || "",
        live: true,
      };
    });
}

// Fetch an image URL and return base64 (best-effort; null on failure).
function fetchImageB64(url) {
  return new Promise(function (resolve) {
    execFile("curl", ["-sSL", "-m", "25", "--output", "-", url],
      { maxBuffer: 1024 * 1024 * 15, encoding: "buffer" },
      function (err, stdout) {
        if (err || !stdout || !stdout.length) return resolve(null);
        resolve(Buffer.from(stdout).toString("base64"));
      });
  });
}

// Condition from a list of photo URLs (downloads up to 4, then runs vision).
async function assessConditionFromUrls(urls) {
  if (!hasCreds() || !urls || !urls.length) return null;
  var b64s = [];
  for (var i = 0; i < urls.length && b64s.length < 4; i++) {
    var b = await fetchImageB64(urls[i]);
    if (b) b64s.push(b);
  }
  if (!b64s.length) return null;
  return assessConditionFromPhotos(b64s);
}

// ---- Town "vibe" reads (private home-search tool, not a public listing service) ----
var TOWN_SCHEMA = {
  type: "object", additionalProperties: false, properties: {
    towns: {
      type: "array", items: {
        type: "object", additionalProperties: false,
        properties: {
          key: { type: "string" },                 // echo back "City, ST"
          s: { type: "integer" },                    // cool/desirability 1-5
          v: { type: "string" },                     // one-sentence vibe
          t: { type: "array", items: { type: "string" } }, // 2-4 tags
        },
        required: ["key", "s", "v", "t"],
      },
    },
  }, required: ["towns"],
};
// Assess a batch of "City, ST" strings. Private tool for one family's home hunt,
// so the read can be candid about character/energy/trajectory (up-and-coming,
// artsy, family, retiree, outdoorsy). Returns { "City, ST": {s,v,t} }.
async function assessTowns(keys) {
  if (!hasCreds() || !keys || !keys.length) return {};
  var instr =
    "You are helping ONE family privately decide where to buy a home (this is not a public real-estate service). " +
    "For each US town given as \"City, ST\", return a candid lifestyle read:\n" +
    "- s: overall desirability/cool score 1-5 (5 = very desirable).\n" +
    "- v: one plain-English sentence on what it's actually like and what's around it — mention coast/lake/mountains/" +
    "wine/college/nightlife/downtown, the general energy (young & artsy, family, quiet/retiree, outdoorsy), and whether " +
    "it's up-and-coming/gentrifying or sleepy.\n" +
    "- t: 2-4 short lowercase tags.\n" +
    "Use general knowledge of the place. If you don't know it, give a neutral read with s=2. Echo the exact key you were given.";
  var content = [{ type: "text", text: instr + "\n\nTowns:\n" + keys.join("\n") }];
  var out = await callClaude(content, TOWN_SCHEMA, 8192);
  var map = {};
  if (out && out.towns) out.towns.forEach(function (t) { if (t.key && t.s) map[t.key] = { s: t.s, v: t.v, t: t.t || [] }; });
  return map;
}

module.exports = {
  hasCreds,
  extractListingsFromHtml,
  extractListingsFromImage,
  assessConditionFromPhotos,
  assessConditionFromUrls,
  estimateValue,
  assessTowns,
  MODEL,
};
