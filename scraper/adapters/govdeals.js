"use strict";
/*
 * GovDeals (Liquidity Services) — surplus government assets incl. real estate
 * Entry: https://www.govdeals.com/  (category: Real Estate / Land & Buildings)
 *
 * STATUS: STUB — BOT-BLOCKED. govdeals.com returned HTTP 403 to a plain
 * request. Options:
 *   (a) headless browser with real UA + JS execution, or
 *   (b) their internal search JSON endpoint (the site is a SPA that calls a
 *       JSON API for results) — capture it from the network tab and call it
 *       directly with the right headers/cookies.
 *
 * TODO:
 *   - Filter category = Real Estate, location = CA / OR.
 *   - Parse -> {city,state,address,type,price,auctionDate,url}.
 */
async function scrape() {
  return [];
}
module.exports = { scrape, id: "govdeals", label: "GovDeals Real Estate", status: "stub-blocked" };
