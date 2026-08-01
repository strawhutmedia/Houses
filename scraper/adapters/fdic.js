"use strict";
/*
 * FDIC Owned Real Estate (ORE)
 * Entry: https://www.fdic.gov/buying/owned/  (asset search for failed-bank ORE)
 *
 * STATUS: STUB. FDIC ORE inventory is intermittent (only populated after bank
 * failures) and served through an asset-search app. When inventory exists it is
 * queryable by state — ideal for a CA/OR filter. Implement by POSTing the state
 * query and parsing the results table into the raw shape below.
 *
 * TODO:
 *   - Confirm the current ORE search endpoint (the /resources/... path 404s;
 *     use the /buying/owned/ app).
 *   - Parse results -> {city,state,address,type,price,marketValue?,url}.
 */
async function scrape() {
  return [];
}
module.exports = { scrape, id: "fdic", label: "FDIC Owned Real Estate", status: "stub" };
