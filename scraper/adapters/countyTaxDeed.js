"use strict";
/*
 * County Tax-Deed / Tax-Lien Sales  (the richest source of cheap residential)
 *
 * STATUS: STUB — PER-COUNTY. There is no single feed; each county runs its own
 * sale, often through a handful of shared auction platforms:
 *   - Bid4Assets (bid4assets.com) hosts many CA county tax sales
 *     (e.g. Los Angeles, San Bernardino, Riverside, Kern).
 *   - GovEase / RealAuction / SRI host others.
 *   - Oregon counties (Multnomah, Washington, Clackamas) sell foreclosed
 *     tax-delinquent property directly or via sealed bid.
 *
 * Best ROI: implement ONE Bid4Assets adapter keyed to the target CA counties —
 * that alone surfaces most of the LA-metro residential deals in the pitch.
 *
 * TODO:
 *   - Bid4Assets: county auction pages list parcels with APN, min bid, address.
 *   - Parse -> {county,city,state,address,type,price,auctionDate,url}.
 */
async function scrape() {
  return [];
}
module.exports = { scrape, id: "countyTaxDeed", label: "County Tax-Deed Sales", status: "stub-per-county" };
