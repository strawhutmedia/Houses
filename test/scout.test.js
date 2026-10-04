// Self-test run by .github/workflows/scout-alerts.yml before every scout.
// The IRON RULE (verify on the live page today) is code now — these pin it.
const test = require("node:test");
const assert = require("node:assert");
const { parseCbDetail, daysSince, houseWhy, GONE, POST_GONE } = require("../scraper/scout-alerts");
const { parseDetail } = require("../scraper/spaces");
const { candidates } = require("../scraper/studio-alert");

const cbPage = `<li><strong>Status: </strong> Active</li><li><strong>Updated: </strong> 10/2/2026</li>
  {"@type": "LocationFeatureSpecification", "name": "Year Built", "value": "1925"},
  {"@type": "LocationFeatureSpecification", "name": "Lot Size (Acres)", "value": "0.1646"}
  <meta property="og:image" content="https://m.cbhomes.com/p/510/1/original.webp">`;

test("Coldwell Banker detail page: status, updated date, facts", () => {
  const d = parseCbDetail(cbPage);
  assert.strictEqual(d.status, "Active");
  assert.strictEqual(d.updated, "10/2/2026");
  assert.strictEqual(d.yearBuilt, 1925);
  assert.strictEqual(d.lotAcres, 0.1646);
  assert.match(d.photo, /original\.webp$/);
  assert.strictEqual(parseCbDetail(""), null);
});

test("verified = updated within 2 days (Pacific)", () => {
  assert.strictEqual(daysSince("10/2/2026", "2026-10-04"), 2);
  assert.strictEqual(daysSince("9/28/2026", "2026-10-04"), 6);
  assert.strictEqual(daysSince("Today", "2026-10-04"), 0);
  assert.strictEqual(daysSince("18 hours ago", "2026-10-04"), 0);
  assert.strictEqual(daysSince("3 day(s) ago", "2026-10-04"), 3);
  assert.strictEqual(daysSince("", "2026-10-04"), null);
});

test("pending / sold / contract leave the board; Active does not", () => {
  for (const s of ["Pending", "Active Under Contract", "Contingent", "Sold", "Contract Signed", "Closed"]) assert.match(s, GONE, s);
  assert.doesNotMatch("Active", GONE);
  assert.match("This posting has been deleted by its author.", POST_GONE);
});

test("ADU claims are always flagged unverified", () => {
  const c = { beds: 3, baths: 2, sqft: 1500, hood: "Highland Park", mls: "123" };
  assert.match(houseWhy(c, { aduMention: true }), /UNVERIFIED/);
  assert.match(houseWhy(c, {}), /unverified/);
  assert.match(houseWhy({ ...c, price: 999000, wasPrice: 1100000 }, {}), /PRICE CUT \$1,100,000 → \$999,000/);
});

test("Craigslist size in every form it is written", () => {
  for (const [h, n] of [["1000ft<sup>2</sup>", 1000], ["1,400 ft²", 1400], ["950ft2", 950], ["approx 1000 ft.² total", 1000], ["1,200 sq ft", 1200]]) {
    assert.strictEqual(parseDetail(h, "x").sqft, n, h);
  }
});

test("studio candidates: area, rent cap, size, not coworking", () => {
  const base = { id: "a", title: "Creative office", price: 2500, sqft: 1000, period: "monthly", lat: 34.1164, lng: -118.2566, url: "u", source: "Craigslist" };
  const out = candidates([base, { ...base, id: "b", price: 4000 }, { ...base, id: "c", sqft: 500 }, { ...base, id: "d", lat: 34.0, lng: -118.5 }], []);
  assert.deepStrictEqual(out.map((x) => [x.id, x.area]), [["a", "Atwater Village"]]);
  assert.deepStrictEqual(candidates([base], ["a"]), []);
});
