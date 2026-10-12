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

// Real listing sentences (10/12). Ryan: a house only counts if its description
// describes a real, separate second unit — read, not keyword-matched.
const { aduVerdict } = require("../scraper/scout-alerts");
const yes = {
  "6190 Mesa (detached 1+1)": "The front residence is a thoughtfully updated 3-bedroom, 2-bath Craftsman with a bright, functional floor plan, while the detached 1-bedroom, 1-bath ADU provides incredible flexibility for rental income, extended family, guests, or a private home office.",
  "6901 SE Oaks Park (back house, rented)": "1650 SF of living space, including a separate currently-income-producing ADU back tender, plus approx. 650 SF ADU back tender house includes one bedroom, one full bathroom, a full kitchen with dining area, laundry area, and separate living room.",
  "1524 SE 24th (legal duplex)": "A rare side-by side legal duplex that lives like a home. Built in 1949, this distinctive mid-century duplex offers something increasingly hard to find: two move-in ready units, each with its own backyard.",
  "2226 SW Iowa (permitted apartment)": "Updated Hillsdale home with a permitted separate apartment that can help offset your housing costs. The basement apartment rents for approximately $2,400 per month and features its own entrance and deck.",
  "2213 SE 60th ('possibilities' is not hypothetical)": "Upstairs, three large bedrooms. Then there's the ADU, where the possibilities really open up. With its own entrance, full kitchen, living room and bath, it lives like its own home.",
};
const no = {
  "3060 Silver Lake (bonus space, no kitchen/bath)": "This sweet, light-filled two-bedroom, two-bath home is further complemented by an impeccably finished, nearly 300-square-foot bonus space with its own front and rear entrances. With its own distinct sense of place, the space lends itself beautifully to an artist's studio, office, gym, lounge, or private retreat.",
  "5140 Miriam (main-house kitchen ≠ unit kitchen)": "This home invites you in with a beautifully renovated kitchen, while a private guest apartment with its own separate entrance offers flexibility. The open living and dining spaces flow seamlessly into the updated kitchen. Privately tucked below the main house with its own separate entrance, the guest apartment includes a living area, bedroom, walk-in closet and a full bathroom.",
  "3110 Gracia (ADU potential)": "The detached garage features custom built-in cabinetry and ample storage, while also offering excellent ADU potential (buyer to verify).",
  "2021 N Sumner (ideal for an ADU)": "Enjoy the deck that overlooks the large yard, ideal for an ADU.",
  "6028 SW 18th (unfinished)": "It features 4 bedrooms plus a den and an unfinished ADU with separate entrance, ideal for guests, rental income, or extended family living.",
  "6234 Roy (bare 'bonus ADU')": "A detached garage and bonus ADU add valuable flexibility for guests, a home office, studio, or additional living space.",
  "853 Tipton (half-bath studio)": "Head downstairs to find a bonus studio space with its own separate entrance; comprising two rooms and a half-bath, it's perfect as a workshop, artist studio, or gym.",
};
test("ADU: real separate units pass, with the sentence quoted", () => {
  for (const [name, text] of Object.entries(yes)) {
    const v = aduVerdict(text);
    assert.ok(v.ok, `${name}: ${v.reason}`);
    assert.ok(v.evidence && v.evidence.length > 20, name);
  }
  assert.match(aduVerdict(yes["6190 Mesa (detached 1+1)"]).tier, /^Detached/);
  assert.match(aduVerdict(yes["1524 SE 24th (legal duplex)"]).tier, /^Duplex/);
  assert.match(aduVerdict(yes["2226 SW Iowa (permitted apartment)"]).tier, /permitted/);
});
test("ADU: potential / bonus rooms / bare mentions are rejected", () => {
  for (const [name, text] of Object.entries(no)) assert.ok(!aduVerdict(text).ok, name);
  assert.ok(!aduVerdict("").ok);
});
test("why-line quotes the ADU evidence and flags missing permits", () => {
  const c = { beds: 3, baths: 2, sqft: 1500, hood: "Highland Park", mls: "123" };
  const d = { adu: aduVerdict(yes["6190 Mesa (detached 1+1)"]) };
  assert.match(houseWhy(c, d), /Detached ADU .*"The front residence/);
  assert.match(houseWhy(c, d), /Confirm permits/);
  assert.match(houseWhy({ ...c, price: 999000, wasPrice: 1100000 }, d), /PRICE CUT \$1,100,000 → \$999,000/);
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
