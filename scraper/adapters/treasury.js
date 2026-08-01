"use strict";
/*
 * U.S. Treasury Real Property Auctions
 * Entry: https://www.treasury.gov/auctions/treasury/rp/  (302 -> current vendor)
 * Treasury forfeited real property is sold through a rotating contractor
 * (historically CWS Asset Management & Sales — cwsams.com / cwsmarketing.com).
 *
 * STATUS: STUB. The vendor site is reachable but listing markup changes with
 * each contract award, so this needs a maintained parser against the *current*
 * vendor. Wire it the same way as gsa.js: fetch the listing index, then parse
 * each property page into the raw shape below and return an array.
 *
 * TODO:
 *   - Resolve the live 302 target and confirm the current vendor.
 *   - Map their listing grid -> {city,state,address,type,price,auctionDate,url}.
 */
async function scrape() {
  // return []  <-- until the current vendor parser is implemented
  return [];
}
module.exports = { scrape, id: "treasury", label: "U.S. Treasury Real Property", status: "stub" };
