"use strict";
/*
 * CWS Marketing — U.S. Treasury + U.S. Marshals forfeited real property
 * https://bid.cwsmarketing.com  (the contractor platform behind BOTH agencies)
 *
 * STATUS: EXPERIMENTAL (headless). The bid platform returns an HTTP 202
 * bot-challenge to plain requests, so it can't be scraped with curl — it needs
 * a real browser. This adapter uses Playwright, which:
 *   - is NOT available in the dev sandbox (browser egress is blocked there), and
 *   - runs in CI/production where Chromium is installed.
 * It safely returns [] whenever Playwright is missing or the render fails, so it
 * never breaks a scrape run. It still needs one verification pass in a live
 * browser environment to confirm the selectors/URL — treat output as unconfirmed
 * until then.
 *
 * Approach: render the auctions page, capture any JSON the SPA fetches (lot data
 * usually arrives as JSON), and fall back to parsing rendered lot cards. Keep
 * only residential real estate; drop land/commercial/personal property.
 */
let chromium = null;
try { chromium = require("playwright").chromium; } catch (e) { /* not installed here */ }

const LIST_URL = "https://bid.cwsmarketing.com/auctions/?status=2";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const RES_NEG = /\bland\b|\blot\b|acre|vacant|commercial|vehicle|jewelry|watch|coin|firearm|equipment|personal property/i;

async function scrape() {
  if (!chromium) return []; // headless not available (dev sandbox) — no-op
  let browser;
  try {
    browser = await chromium.launch({ args: ["--no-sandbox"] });
    const ctx = await browser.newContext({ userAgent: UA });
    const page = await ctx.newPage();

    // Capture JSON payloads the SPA loads (best signal for structured lot data).
    const jsonBlobs = [];
    page.on("response", async (r) => {
      const ct = (r.headers()["content-type"] || "");
      if (/json/i.test(ct)) { try { jsonBlobs.push(await r.json()); } catch (e) {} }
    });

    await page.goto(LIST_URL, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(3000);

    // Find the real-estate auction catalogs, then open each and drill into the
    // individual property lots. The listing page only links to auction *events*
    // (e.g. "US Treasury Real Estate Auction"), NOT to homes — so we must go one
    // level deeper to the lots inside each catalog.
    let catalogs = await page.$$eval("a[href*='/auctions/catalog/']", (els) =>
      Array.from(new Set(els
        .filter((e) => /real\s*estate|home|residential|property/i.test(e.textContent || ""))
        .map((e) => e.href)))).catch(() => []);
    if (!catalogs.length) {
      catalogs = await page.$$eval("a[href*='/auctions/catalog/']", (els) =>
        Array.from(new Set(els.map((e) => e.href)))).catch(() => []);
    }

    let lots = [];
    for (const blob of jsonBlobs) collectLots(blob, lots);

    // Visit each catalog and capture the JSON its lot grid loads.
    for (const cat of catalogs.slice(0, 8)) {
      try {
        await page.goto(cat, { waitUntil: "networkidle", timeout: 45000 });
        await page.waitForTimeout(2500);
        for (const blob of jsonBlobs) collectLots(blob, lots);
      } catch (e) { /* skip this catalog */ }
    }

    await browser.close();

    // Emit ONLY rows that look like a real property: a street-number address and
    // a 2-letter state. If parsing didn't yield structured lots, we emit nothing
    // rather than dumping catalog fragments into the feed.
    const seen = {};
    return lots
      .filter((l) => l && l.address && /\d/.test(String(l.address)) && /^[A-Z]{2}$/.test(String(l.state || "").toUpperCase()))
      .filter((l) => !RES_NEG.test(String(l.title || "") + " " + String(l.address || "")))
      .map((l, i) => ({
        id: "cws-" + (l.id || i),
        source: "US Treasury / Marshals",
        state: String(l.state).toUpperCase(),
        city: l.city || "",
        address: l.address,
        type: "Single Family",
        price: l.price != null ? l.price : null,
        marketValue: null,
        auctionDate: l.closeDate || null,
        url: l.url || cat0(catalogs) || LIST_URL,
        live: true,
      }))
      .filter((l) => { if (seen[l.id]) return false; seen[l.id] = 1; return true; });
  } catch (e) {
    try { if (browser) await browser.close(); } catch (e2) {}
    console.error("  [cws] headless scrape failed: " + e.message);
    return [];
  }
}

// Recursively pull objects that look like real-estate lots out of arbitrary JSON.
function collectLots(node, out, depth) {
  depth = depth || 0;
  if (!node || depth > 6) return;
  if (Array.isArray(node)) { node.forEach((n) => collectLots(n, out, depth + 1)); return; }
  if (typeof node === "object") {
    const keys = Object.keys(node).join(" ").toLowerCase();
    if (/address|situs|propertyaddress/.test(keys) && /bid|price|amount|minimum/.test(keys)) {
      out.push({
        id: node.id || node.lotId || node.assetId,
        title: node.title || node.name || node.description,
        address: node.address || node.situsAddress || node.propertyAddress,
        city: node.city, state: node.state, price: num(node.currentBid || node.minimumBid || node.price),
        closeDate: node.closeDate || node.endDate || node.auctionEnd, url: node.url,
      });
    }
    Object.keys(node).forEach((k) => collectLots(node[k], out, depth + 1));
  }
}
function num(v) { const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.]/g, "")); return isFinite(n) ? n : null; }
function cat0(cats) { return cats && cats.length ? cats[0] : null; }

module.exports = { scrape, id: "cws", label: "CWS (Treasury + US Marshals)", status: "headless-experimental" };
