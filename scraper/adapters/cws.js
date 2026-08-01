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

    // 1) Try to pull lots out of captured JSON.
    let lots = [];
    for (const blob of jsonBlobs) collectLots(blob, lots);

    // 2) Fallback: parse rendered lot cards for a real-estate auction.
    if (!lots.length) {
      lots = await page.$$eval("a[href*='/auctions/catalog/']", (els) =>
        els.map((e) => ({ title: (e.textContent || "").trim(), url: e.href }))).catch(() => []);
    }

    await browser.close();
    return lots
      .filter((l) => l.title && !RES_NEG.test(l.title))
      .map((l, i) => ({
        id: "cws-" + (l.id || i),
        source: l.agency || "US Treasury / Marshals",
        state: l.state || "",
        city: l.city || "",
        address: l.address || l.title || "",
        type: "Single Family",
        price: l.price != null ? l.price : (l.currentBid != null ? l.currentBid : null),
        marketValue: null,
        auctionDate: l.closeDate || null,
        url: l.url || LIST_URL,
        live: true,
      }))
      .filter((l) => l.price != null || l.address);
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

module.exports = { scrape, id: "cws", label: "CWS (Treasury + US Marshals)", status: "headless-experimental" };
