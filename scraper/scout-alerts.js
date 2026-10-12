"use strict";
/*
 * Daily house + studio scouts — run by .github/workflows/scout-alerts.yml.
 *
 * These replaced two Claude Routines on 2026-10-03 (owner rule: nothing
 * recurring may live in a Claude session — sessions get deleted, and the
 * studio Routine had in fact been failing silently: its email was blocked and
 * it could not push, so nothing reached Ryan). Everything the Routines did by
 * judgment is code here, including the IRON RULE: nothing is emailed or put on
 * the board unless its live page was read TODAY and confirms it.
 *
 *   node scraper/scout-alerts.js gate              # prints house=1|0 studio=1|0
 *   node scraper/scout-alerts.js house [--dry-run] [--force]
 *   node scraper/scout-alerts.js studio [--dry-run] [--force]
 *
 * Email goes through strawhutmedia.com (/api/houses/alert, /api/studios/alert,
 * AWS SES, to Ryan only). In GitHub Actions the request carries a GitHub OIDC
 * token the site verifies — no secret lives in this public repo. Outside
 * Actions, SCOUT_TOKEN (the site's newsletter token) works for a manual run.
 *
 * Every run writes its own verdict to scout-state.json (committed), so "did
 * the scout run, what did it see, why did it reject X" is answered by reading.
 */
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const ROOT = path.join(__dirname, "..");
const STATE = path.join(ROOT, "scout-state.json");
const FINDS = path.join(ROOT, "finds.json");
const SITE = process.env.SCOUT_SITE || "https://www.strawhutmedia.com";
const AUDIENCE = "strawhutmedia-site";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const FRESH_DAYS = 2;   // CB "Updated" within this many days = verified Active
const RUN_FROM_HOUR = 7; // never before 7 AM Pacific

// ── small helpers ────────────────────────────────────────────────────────
const curl = (url) => new Promise((resolve) =>
  execFile("curl", ["-sSL", "-m", "30", "-A", UA, url], { maxBuffer: 1024 * 1024 * 40 }, (err, out) => resolve(err ? "" : out)));
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  async function worker() { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, worker));
  return out;
}
function ptNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: +p.hour };
}
const readJson = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return dflt; } };
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2) + "\n");
const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Days from an "Updated" value to `today` (YYYY-MM-DD, Pacific). Accepts
// "10/2/2026", "Today", "Yesterday", "3 day(s) ago", "18 hours ago".
function daysSince(updated, today) {
  const u = String(updated || "").trim();
  if (/^today$|hours? ago|minutes? ago/i.test(u)) return 0;
  if (/^yesterday$/i.test(u)) return 1;
  const ago = u.match(/(\d+)\s*day/i);
  if (ago) return +ago[1];
  const m = u.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const a = Date.UTC(+m[3], +m[1] - 1, +m[2]);
  const [y, mo, d] = today.split("-").map(Number);
  return Math.round((Date.UTC(y, mo - 1, d) - a) / 86400000);
}

// ── Coldwell Banker detail page ──────────────────────────────────────────
function parseCbDetail(html) {
  if (!html) return null;
  const field = (k) => (html.match(new RegExp(`${k}:\\s*</strong>\\s*([^<]+)`, "i")) || [])[1];
  const ld = (k) => (html.match(new RegExp(`"name":\\s*"${k}",\\s*"value":\\s*"([^"]*)"`)) || [])[1];
  const remarks = decode(((html.match(/<div[^>]*class="[^"]*(?:remarks|description)[^"]*"[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || "")
    .replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return {
    status: (field("Status") || "").trim() || null,
    updated: (field("Updated") || "").trim() || null,
    yearBuilt: +ld("Year Built") || null,
    lotAcres: +ld("Lot Size \\(Acres\\)") || null,
    photo: (html.match(/property="og:image" content="([^"]+)"/) || html.match(/og:image" content="([^"]+)"/) || [])[1] || null,
    remarks,
    fields: pageFields(html),
  };
}
// Every "Label: value" fact on the page (70+ on a typical CB listing) + price history.
function pageFields(html) {
  const t = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "");
  const o = {};
  for (const m of t.matchAll(/<strong>\s*([^<:]{2,40}):\s*<\/strong>\s*([^<]{1,160})/g)) { const k = m[1].trim(); if (!(k in o)) o[k] = decode(m[2]).trim(); }
  const hist = t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").match(/Date Details Price Change Source (.{0,400})/);
  o._priceCuts = hist ? (hist[1].match(/Price Reduced \$[\d,]+/g) || []).length : 0;
  return o;
}
// Ryan + Maggie own 2/3, Steve 1/3 (10/12). 20% down; monthly is an estimate.
const RATE = 0.0625;
function finance(price, city) {
  const down = price * 0.2, loan = price - down, r = RATE / 12, n = 360;
  const pi = loan * r / (1 - Math.pow(1 + r, -n));
  const total = pi + price * (city === "Portland" ? 0.011 : 0.012) / 12 + (city === "Portland" ? 150 : 250);
  return { down, us: down * 2 / 3, steve: down / 3, pi, total, usMo: total * 2 / 3, steveMo: total / 3 };
}
// Shape the site's green money box expects (site src/houseAlert.js moneyBox).
function moneyFor(price, city) {
  const m = finance(price, city);
  return { down: m.down, us: m.us, steve: m.steve, monthly: m.total, usMo: m.usMo, steveMo: m.steveMo };
}
// Readable one-per-line facts for the email's "Details" list.
function pageFacts(x = {}) {
  const f = [];
  if (x["Year Built"]) f.push(`Built ${x["Year Built"]}`);
  if (x["Lot Size (Sq. Ft.)"]) f.push(`Lot: ${x["Lot Size (Sq. Ft.)"]} sq ft`);
  const park = x["Garage Description"] || x["Parking"]; if (park) f.push(`Parking: ${park.slice(0, 50)}`);
  if (x["Cooling Type"] && !/none|see remarks/i.test(x["Cooling Type"])) f.push(`Cooling: ${x["Cooling Type"].slice(0, 30)}`);
  if (x["View"] && !/none/i.test(x["View"])) f.push(`View: ${x["View"].slice(0, 40)}`);
  if (/yes/i.test(x["Pool"] || "")) f.push("Pool");
  if (x["Property Condition"]) f.push(`Condition: ${x["Property Condition"].slice(0, 30)}`);
  if (x["Added to Site"]) f.push(`On market: ${x["Added to Site"].replace(/\(s\)/, "s").replace(/ ago$/, "")}`);
  if (x._priceCuts) f.push(`${x._priceCuts} price cut${x._priceCuts > 1 ? "s" : ""}`);
  return f;
}
// Structured card fields for the site's stacked email card (site src/houseAlert.js).
function houseCard(c, d) {
  const a = d.adu || aduVerdict(d.remarks);
  const facts = pageFacts(d.fields);
  if (c.mls) facts.push(`MLS #${c.mls}`);
  return {
    adu: a.ok ? { tier: a.tier, quote: a.evidence } : null,
    facts,
    note: a.ok && /permits not stated/.test(a.tier) ? "Permits for the ADU aren't stated — confirm before making an offer." : null,
  };
}
const decode = (t) => t.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&").replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

// ── ADU: Ryan's hard requirement (10/12) ─────────────────────────────────
// A house only alerts if its listing DESCRIPTION describes a real, separate
// second unit — read sentence by sentence, never keyword-matched. "ADU
// potential", "room for an ADU", a "bonus room", or a converted garage with no
// kitchen/bath is NOT an ADU (3060 Silver Lake's 300 sf "bonus space" taught
// that; 5140 Miriam's "guest apartment" was a shed).
// Strong terms name a dwelling outright; weak ones ("guest suite") are often
// just a spare room, so they need a kitchen, rent, or a detached structure.
const STRONG = /\b(J?ADUs?|accessory dwelling( units?)?|guest ?house|back ?house|back tender( house)?|second (unit|dwelling)|2nd unit|granny flat|casita|in-?law unit|duplex|legal (rental )?unit|rental unit|income unit|bonus unit|separate apartment|basement apartment|(lower[- ]level|rear|back|downstairs|upstairs|basement) (unit|apartment)|two (separate |move-in[- ]ready )?(units|living areas|residences))\b/gi;
const WEAK = /\b(guest (unit|cottage|quarters|apartment|suite)|rear (house|unit|cottage|studio|dwelling)|back (cottage|unit|studio)|detached (studio|unit|cottage)|in-?law (suite|apartment|quarters)|studio apartment|separate (living )?quarters|separate living (area|space)s?|(own|private|separate) (entrance|entry))\b/gi;
// Hypothetical if one of these sits just BEFORE the unit word…
const HYPO_BEFORE = /(potential|possib\w*|future|proposed|plans? (for|to)\b|approved plans|planned|ideal for|perfect for|great for|room for|space for|opportunit\w*|investigat\w*|addition of|could|would|can be|to build|to add|build(ing)? an?|add(ing)? an?|conver\w*|serve as|serves as|function(s)? as|use as|used as|flex (space|room))\W+(\w+\W+){0,14}$/i;
// …or straight after it ("ADU potential"), or the unit isn't built yet.
const HYPO_AFTER = /^\W*(potential|conversion|opportunit|possib)/i;
const UNBUILT = /\b(unfinished|can be finished|to be finished|not yet (built|finished)|under construction)\b/i;
const PERMIT = /\b(permitted|fully permitted|legal(ly)?( permitted)?|certificate of occupancy|C of O|city[- ]approved|finaled|signed off)\b/i;
const DETACHED = /\b(detached\W+(\S+\W+){0,2}(J?ADU|unit|guest|studio|cottage|casita|apartment|dwelling|structure)|back ?house|back tender|rear (house|unit|cottage)|separate (structure|residence|building)|two (separate )?(homes|houses|residences)|guest ?house|casita|standalone|stand-alone)\b/i;
const ATTACHED = /\b(attached|lower[- ]level|basement|upstairs|downstairs|below the main|above the garage|over the garage)\b/i;
const OWN_DOOR = /\b(own|separate|private) (entrance|entry|access)\b/i;
const KITCHEN = /\bkitchen(ette)?\b/i, BATH = /\b(bath(room)?s?|shower)\b/i;
const RENTED = /\b(income[- ]producing|currently (rented|leased|occupied)|tenant|airbnb|generat\w* \$|\$[\d,]{3,}\s*(\/|per |a )?\s*(mo|month|year|annual))/i;

function unitHits(sentence) {
  const hits = [];
  for (const [re, strong] of [[STRONG, true], [WEAK, false]]) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(sentence))) {
      const before = sentence.slice(Math.max(0, m.index - 90), m.index), after = sentence.slice(m.index + m[0].length, m.index + m[0].length + 25);
      hits.push({ strong, at: m.index, hypo: HYPO_BEFORE.test(before) || HYPO_AFTER.test(after) });
    }
  }
  return hits;
}

function aduVerdict(remarks) {
  const text = String(remarks || "");
  if (!text) return { ok: false, reason: "no description on the live page" };
  const sents = text.split(/(?<=[.!?])\s*(?=[A-Z])/);
  let potential = false, weak = false, bare = false;
  const found = [];
  for (let i = 0; i < sents.length; i++) {
    const s = sents[i], hits = unitHits(s);
    if (!hits.length) continue;
    const real = hits.filter((h) => !h.hypo);
    if (!real.length || UNBUILT.test(s)) { potential = true; continue; }
    // The next sentence counts only while it's still about the unit.
    const next = sents[i + 1] || "";
    const follows = unitHits(next).length || /^(It|Its|With|Inside|This (unit|space|ADU|cottage|studio|suite)|The (unit|ADU|space|suite|apartment|studio|cottage|casita|guest|back|rear|front|second|other|lower|upper))\b/.test(next);
    const ctx = s + " " + (follows ? next : "");
    // Features only count from the unit's own clause on — "renovated kitchen,
    // while a guest apartment…" is the MAIN house's kitchen (5140 Miriam).
    const first = Math.min(...real.map((h) => h.at));
    const lead = ctx.slice(Math.max(0, first - 60), first), cut = Math.max(lead.lastIndexOf(","), lead.lastIndexOf(";"));
    const unitCtx = (cut >= 0 ? lead.slice(cut + 1) : lead) + ctx.slice(first);
    const f = {
      strong: real.some((h) => h.strong), kitchen: KITCHEN.test(unitCtx), bath: BATH.test(unitCtx), rented: RENTED.test(unitCtx),
      permit: PERMIT.test(ctx), detached: DETACHED.test(ctx), attached: ATTACHED.test(ctx), door: OWN_DOOR.test(ctx), ctx: ctx.trim(),
    };
    if (!f.strong && !(f.kitchen || f.rented || f.detached)) { weak = true; continue; }   // a "guest suite" that's really a spare room
    f.duplex = /\bduplex\b|\blegal addresses\b|\btwo (separate |move-in[- ]ready )?units\b/i.test(ctx);
    f.twoHomes = /\btwo (separate )?(living areas|residences|homes|houses)\b/i.test(ctx);
    // "bonus ADU" with nothing said about it isn't evidence of a unit.
    if (!["kitchen", "bath", "door", "detached", "rented", "permit", "duplex", "twoHomes"].some((k) => f[k])) { bare = true; continue; }
    found.push(f);
  }
  if (!found.length) {
    if (bare) return { ok: false, reason: "names an ADU but describes nothing about it (no kitchen/bath/entrance/permit)" };
    if (weak) return { ok: false, reason: "a guest suite/flex room, not a unit (no kitchen, rent or separate structure)" };
    if (potential) return { ok: false, reason: "ADU is only potential/planned/unfinished" };
    return { ok: false, reason: "no ADU/second unit in description" };
  }
  const any = (k) => found.some((f) => f[k]);
  const detached = any("detached");
  const duplex = any("duplex");
  const sep = detached ? "Detached" : duplex ? "Duplex — second" : any("attached") ? (any("door") ? "Attached, own entrance" : "Attached") : any("door") ? "Own entrance" : "Detached/attached not stated";
  const facts = [any("permit") ? "permitted" : "permits not stated", any("kitchen") ? "kitchen" : null, any("bath") ? "bath" : null, any("rented") ? "rented now" : null].filter(Boolean);
  const score = (f) => ["kitchen", "bath", "detached", "door", "rented", "permit"].filter((k) => f[k]).length;
  // Quote the most specific sentence (most facts, then the shortest — headlines lose).
  const best = found.slice().sort((x, y) => score(y) - score(x) || x.ctx.length - y.ctx.length)[0].ctx;
  const evidence = best.length > 280 ? best.slice(0, 277) + "…" : best;
  return { ok: true, detached, tier: duplex && !detached ? `Duplex, 2nd unit (${facts.join(", ")})` : `${sep} ADU (${facts.join(", ")})`, evidence };
}

const GONE = /pending|contingent|under contract|contract signed|sold|closed|withdrawn|expired|cancel|off market|leased/i;

function houseWhy(c, d) {
  const bits = [`${c.beds ?? "?"}bd/${c.baths ?? "?"}ba`];
  if (c.sqft) bits.push(`${c.sqft.toLocaleString("en-US")} sqft`);
  let s = `${bits.join(", ")} in ${c.hood}, under the cap`;
  if (c.wasPrice && c.price < c.wasPrice) s = `PRICE CUT ${money(c.wasPrice)} → ${money(c.price)}. ` + s;
  const extra = [];
  if (d.yearBuilt) extra.push(`built ${d.yearBuilt}`);
  if (d.lotAcres) extra.push(`${d.lotAcres} ac lot`);
  if (extra.length) s += ` (${extra.join(", ")})`;
  s += c.mls ? `; MLS #${c.mls}.` : ".";
  const a = d.adu || aduVerdict(d.remarks);
  s += a.ok ? ` ${a.tier}: "${a.evidence}"` : " No separate ADU described.";
  const facts = pageFacts(d.fields);
  if (facts.length) s += ` 📋 ${facts.join(" · ")}.`;
  if (a.ok && /permits not stated/.test(a.tier)) s += " Confirm permits before offering.";
  return s;
}

// ── second live source: Compass (its search pages bot-block, but address
// lookup + listing pages still answer). Used when CB's page is >2 days old.
async function compassStatus(address, cityState) {
  try {
    const r = await fetch("https://www.compass.com/api/v3/omnisuggest/autocomplete", {
      method: "POST", headers: { "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify({ q: `${address}, ${cityState}`, infoFields: [2], listingTypes: [2] }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const key = (a) => String(a || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 2).join(" ");
    const item = (j.categories || []).flatMap((c) => c.items || []).find((it) => it.redirectUrl && key(it.text) === key(address));
    if (!item) return null;
    const html = await curl(`https://www.compass.com${item.redirectUrl}`);
    // The subject listing's own record carries its current price right after its status.
    const m = html.match(/"localizedStatus":"([^"]+)","price":\{"lastKnown":(\d+)/);
    return m ? { status: m[1], price: +m[2], url: `https://www.compass.com${item.redirectUrl}` } : null;
  } catch { return null; }
}

// ── talking to strawhutmedia.com ─────────────────────────────────────────
async function authHeader() {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL, tok = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (url && tok) {
    const r = await fetch(`${url}&audience=${encodeURIComponent(AUDIENCE)}`, { headers: { Authorization: `bearer ${tok}` } });
    if (!r.ok) throw new Error(`GitHub OIDC token request failed: HTTP ${r.status}`);
    return { Authorization: `Bearer ${(await r.json()).value}` };
  }
  if (process.env.SCOUT_TOKEN) return { "X-Newsletter-Token": process.env.SCOUT_TOKEN };
  throw new Error("no way to authenticate to the site (not in GitHub Actions and SCOUT_TOKEN unset)");
}
async function postAlert(endpoint, payload) {
  let last = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await fetch(`${SITE}${endpoint}`, {
        method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify(payload),
      });
      const body = await r.text();
      if (r.ok && /"ok"\s*:\s*true/.test(body)) return { ok: true };
      last = `HTTP ${r.status} ${body.slice(0, 200)}`;
    } catch (e) { last = e.message; }
    await new Promise((r) => setTimeout(r, 4000));
  }
  return { ok: false, error: last };
}

// ── HOUSE ────────────────────────────────────────────────────────────────
async function runHouse({ dry, today, state }) {
  const hd = require("./house-discover");
  const { candidates, stats } = await hd.discover();
  const broken = Object.entries(stats).filter(([, s]) => !s.scanned).map(([city]) => city);
  const verified = [], rejected = [], unreachable = [];
  await mapLimit(candidates, 6, async (c) => {
    const d = parseCbDetail(await curl(c.url));
    if (!d || !d.status) { unreachable.push(c); return; }                                  // retry tomorrow, not marked
    if (!/^active$/i.test(d.status)) { rejected.push({ ...c, reason: `status ${d.status}` }); return; }
    const age = daysSince(d.updated, today);
    if (!d.remarks) { unreachable.push(c); return; }                                     // description didn't load — retry tomorrow
    const adu = aduVerdict(d.remarks);                                                     // Ryan 10/12: separate ADU required
    if (!adu.ok) { rejected.push({ ...c, reason: `no separate ADU — ${adu.reason}` }); return; }
    let how = `Coldwell Banker live listing page: Status ${d.status}, Updated ${d.updated}`;
    if (age == null || age > FRESH_DAYS) {
      // CB page is stale (it can lag the MLS by days) → confirm on Compass today.
      const cp = await compassStatus(c.address, c.city === "Portland" ? "Portland, OR" : "Los Angeles, CA");
      // Stale + unconfirmable ≠ rejected: re-check tomorrow (marking it seen hid 3060 Silver Lake forever).
      if (!cp) { unreachable.push({ ...c, reason: `CB updated ${d.updated || "?"}; Compass lookup failed` }); return; }
      if (!/^active$/i.test(cp.status)) { rejected.push({ ...c, reason: `Compass live page says ${cp.status}` }); return; }
      how = `Compass live listing page: ${cp.status} at ${money(cp.price)} (CB page last updated ${d.updated})`;
      d.compassUrl = cp.url;
    }
    verified.push({ ...c, detail: { ...d, adu, how } });
  });

  // Board: add verified finds (a price cut on a board house updates it in place).
  const finds = readJson(FINDS, { finds: [], corrections: [] });
  finds.corrections = finds.corrections || [];
  let added = 0, cuts = 0;
  for (const v of verified) {
    const why = houseWhy(v, v.detail);
    const existing = finds.finds.find((f) => hd.addrKey(f.address) === hd.addrKey(v.address));
    const how = v.detail.how;
    if (existing) {
      if (v.price < (existing.price || Infinity)) cuts++;
      Object.assign(existing, { price: v.price, status: "Active", verified: today, verifiedHow: how, why });
      continue;
    }
    added++;
    finds.finds.push({
      id: `${slug(v.address)}-${v.city === "Portland" ? "pdx" : "la"}`,
      tag: v.city === "Portland" ? "🌲 Portland" : "🌴 Los Angeles",
      address: v.address, hood: v.city === "Portland" ? `${v.hood}, Portland OR` : `${v.hood}, Los Angeles`,
      price: v.price, beds: v.beds, baths: v.baths, sqft: v.sqft, status: "Active",
      verified: today, verifiedHow: how, dom: null, why,
      ask: "Pull permits for the ADU (LADBS / Portland Maps), confirm its sqft, kitchen, bath and separate entrance in person; check DOM and price history.",
      links: [{ label: "Coldwell Banker listing", url: v.url }, ...(v.detail.compassUrl ? [{ label: "Compass listing", url: v.detail.compassUrl }] : [])],
    });
  }
  // Board hygiene: a find whose live CB page now says pending/sold leaves the
  // board for the corrections log, same as the Routine did.
  const moved = [];
  const onCb = finds.finds.filter((f) => (f.links || []).some((l) => /coldwellbankerhomes\.com/.test(l.url)));
  await mapLimit(onCb, 6, async (f) => {
    const url = f.links.find((l) => /coldwellbankerhomes\.com/.test(l.url)).url;
    const d = parseCbDetail(await curl(url));
    if (d && d.status && GONE.test(d.status)) moved.push({ f, status: d.status });
  });
  for (const { f, status } of moved) {
    finds.finds = finds.finds.filter((x) => x !== f);
    finds.corrections.push({ date: today, text: `${f.address} (${f.hood}) is now ${status} per its live Coldwell Banker page — removed from the board.` });
  }
  if (!dry && (added || cuts || moved.length)) { finds.updatedAt = new Date().toISOString(); writeJson(FINDS, finds); }

  // Email Ryan.
  let emailed = false, emailError = null;
  if (verified.length) {
    const la = verified.filter((v) => v.city !== "Portland").length, pdx = verified.length - la;
    const cutsTxt = verified.filter((v) => v.wasPrice && v.price < v.wasPrice).map((v) => `${v.address} cut to ${money(v.price)}`);
    const intro = [cutsTxt.length ? `Price cut: ${cutsTxt.join("; ")}.` : null,
      `${verified.length} ${verified.length === 1 ? "house" : "houses"} with a separate ADU today (${la} Los Angeles, ${pdx} Portland) — each confirmed Active on its live listing page today.`,
      moved.length ? `${moved.length} board ${moved.length === 1 ? "house is" : "houses are"} now pending/sold and moved to corrections.` : null,
      `💰 Green box on each house: 20% down split 2/3 you + Maggie / 1/3 Steve; monthly is an estimate at ${RATE * 100}% 30-yr fixed + property tax + insurance (no closing costs, HOA or rent income).`,
    ].filter(Boolean).join(" ");
    const payload = { intro, houses: verified.map((v) => ({
      address: v.address, price: v.price, wasPrice: v.wasPrice && v.price < v.wasPrice ? v.wasPrice : null, beds: v.beds, baths: v.baths, sqft: v.sqft,
      city: v.city === "Portland" ? "Portland" : "Los Angeles", hood: v.hood, url: v.url, photo: v.photo || v.detail.photo,
      money: moneyFor(v.price, v.city), ...houseCard(v, v.detail),
    })) };
    if (dry) console.log("[dry-run] would email:", JSON.stringify(payload).slice(0, 2000));
    else { const r = await postAlert("/api/houses/alert", payload); emailed = r.ok; emailError = r.error || null; }
  }
  // A source that read nothing is broken, not "no matches" — say so once.
  let brokenSince = state.house?.brokenSince || null;
  if (broken.length && !brokenSince) {
    brokenSince = today;
    if (!dry) await postAlert("/api/houses/alert", { subject: `House scout: couldn't read listings for ${broken.join(" + ")} today`,
      body: `The daily house scout read 0 listings for ${broken.join(" and ")} from Coldwell Banker this morning, so "no new matches" would not be true. It will keep trying every day and stays quiet until this recovers. Run log: https://github.com/strawhutmedia/Houses/actions/workflows/scout-alerts.yml` });
  }
  if (!broken.length) brokenSince = null;

  // Remember every candidate it judged (emailed or rejected) so none repeats
  // unless its price drops. Verified ones only once the email went out.
  if (!dry) hd.markCandidates([...rejected, ...(emailed ? verified : [])]);
  return {
    lastRun: today, at: new Date().toISOString(), scanned: stats, candidates: candidates.length,
    verified: verified.map((v) => `${v.address} (${v.hood}) ${money(v.price)}`), emailed, emailError,
    rejected: rejected.slice(0, 40).map((r) => `${r.address}: ${r.reason}`), unreachable: unreachable.map((u) => u.address),
    boardAdded: added, boardPriceCuts: cuts, movedToCorrections: moved.map((m) => `${m.f.address}: ${m.status}`), brokenSince,
    ok: !emailError && !broken.length,
  };
}

// ── STUDIO ───────────────────────────────────────────────────────────────
const POST_GONE = /This posting has been deleted|This posting has expired|flagged for removal|posting has been removed|There is nothing here|page not found/i;
const FEATURES = [
  [/private (bath|restroom)|own (bath|restroom)|restroom inside/i, "private restroom"],
  [/parking/i, "parking mentioned"], [/high ceilings?|\b1[2-9]\s?(ft|')\s?ceilings?/i, "high ceilings"],
  [/sound ?proof|acoustic|recording|podcast|production/i, "pitched for production"], [/kitchenette|kitchen/i, "kitchenette"],
  [/roll-?up door|loading/i, "roll-up/loading door"], [/a\/c|\bac\b|air condition/i, "A/C"],
];
function studioWhy(title, body, sqft) {
  const f = FEATURES.filter(([re]) => re.test(body)).map(([, l]) => l);
  return `${sqft.toLocaleString("en-US")} sq ft private space — ${title.slice(0, 80)}${f.length ? `. Post mentions: ${f.join(", ")}` : ""}. Noise and parking unverified until a visit.`;
}

async function runStudio({ dry, today, state }) {
  const sa = require("./studio-alert");
  const { parseDetail } = require("./spaces");
  const sp = readJson(path.join(ROOT, "spaces.json"), { spaces: [] });
  const fetchedToday = sp.generatedAt && ptNow(new Date(sp.generatedAt)).day === today;
  const clBlocked = !fetchedToday || !(sp.sources && sp.sources.craigslistFetched > 0);
  const seen = readJson(path.join(ROOT, "studios-seen.json"), { ids: [] });
  const cands = sa.candidates(sp.spaces || [], seen.ids || []);
  const verified = [], rejected = [], unreachable = [];
  await mapLimit(cands, 6, async (c) => {
    const html = await curl(c.url);
    if (!html) { unreachable.push(c); return; }
    if (POST_GONE.test(html)) { rejected.push({ ...c, reason: "post removed/expired" }); return; }
    if (c.source !== "Craigslist") {
      // Broker page: it must still load and not say leased.
      if (/\bleased\b|no longer (available|advertised)/i.test(html)) { rejected.push({ ...c, reason: "broker page says leased" }); return; }
      if (!c.sqft || c.sqft < sa.MIN_SQFT) { rejected.push({ ...c, reason: "size not stated ≥800" }); return; }
      verified.push({ ...c, body: html.replace(/<[^>]+>/g, " ").slice(0, 20000) });
      return;
    }
    const d = parseDetail(html, c.title);
    if (d.rentPeriod === "daily" || d.rentPeriod === "weekly") { rejected.push({ ...c, reason: `${d.rentPeriod} rate` }); return; }
    if (d.cowork) { rejected.push({ ...c, reason: "coworking/shared" }); return; }
    const price = d.price || c.price;
    if (!price || price > sa.MAX_RENT) { rejected.push({ ...c, reason: `rent ${price ? money(price) : "not stated"}` }); return; }
    const sqft = d.sqft || c.sqft;
    if (!sqft || sqft < sa.MIN_SQFT) { rejected.push({ ...c, reason: sqft ? `${sqft} sq ft` : "size not stated" }); return; }
    const bodyM = html.match(/id="postingbody"[^>]*>([\s\S]*?)<\/section>/i);
    verified.push({ ...c, price, sqft, photo: d.photo || c.photo, body: bodyM ? bodyM[1].replace(/<[^>]+>/g, " ") : "" });
  });

  let emailed = false, emailError = null;
  if (verified.length) {
    const payload = {
      intro: `${verified.length} private studio ${verified.length === 1 ? "space" : "spaces"} matched today (800+ sq ft, ≤ $3,500/mo) — each post was open and live today.`,
      spaces: verified.map((v) => ({ address: v.title, price: v.price, sqft: v.sqft, hood: v.area, why: studioWhy(v.title, v.body, v.sqft), url: v.url, photo: v.photo })),
    };
    if (dry) console.log("[dry-run] would email:", JSON.stringify(payload).slice(0, 2000));
    else { const r = await postAlert("/api/studios/alert", payload); emailed = r.ok; emailError = r.error || null; }
  }
  let brokenSince = state.studio?.brokenSince || null;
  if (clBlocked && !brokenSince) {
    brokenSince = today;
    if (!dry) await postAlert("/api/studios/alert", { subject: "Studio scout: Craigslist didn't load today",
      body: "The daily studio scout could not read Craigslist this morning (it blocks some cloud servers), so only broker listings were checked. It will keep trying every day and stays quiet until this recovers. Run log: https://github.com/strawhutmedia/Houses/actions/workflows/scout-alerts.yml" });
  }
  if (!clBlocked) brokenSince = null;

  if (!dry) {
    const add = [...rejected, ...(emailed ? verified : [])].map((x) => x.id);
    seen.ids = [...new Set([...(seen.ids || []), ...add])];
    seen.updatedAt = new Date().toISOString();
    writeJson(path.join(ROOT, "studios-seen.json"), seen);
  }
  return {
    lastRun: today, at: new Date().toISOString(), spacesFile: sp.generatedAt || null, craigslistFetched: sp.sources?.craigslistFetched ?? null,
    candidates: cands.length, verified: verified.map((v) => `${v.title} (${v.area}) ${money(v.price)}`), emailed, emailError,
    rejected: rejected.slice(0, 40).map((r) => `${r.title}: ${r.reason}`), unreachable: unreachable.map((u) => u.title), brokenSince,
    ok: !emailError && !clBlocked,
  };
}

// ── entry ────────────────────────────────────────────────────────────────
async function main() {
  const [kind] = process.argv.slice(2);
  const dry = process.argv.includes("--dry-run"), force = process.argv.includes("--force");
  const { day: today, hour } = ptNow();
  const state = readJson(STATE, {});
  const due = (k) => force || (hour >= RUN_FROM_HOUR && state[k]?.lastRun !== today);
  if (kind === "gate") { console.log(`house=${due("house") ? 1 : 0}`); console.log(`studio=${due("studio") ? 1 : 0}`); return; }
  if (kind !== "house" && kind !== "studio") { console.error("usage: scout-alerts.js gate|house|studio [--dry-run] [--force]"); process.exit(2); }
  if (!due(kind)) { console.log(`${kind}: already ran today (${today}) or before ${RUN_FROM_HOUR} AM PT — nothing to do`); return; }
  const result = await (kind === "house" ? runHouse : runStudio)({ dry, today, state });
  console.log(JSON.stringify({ [kind]: result }, null, 2));
  if (!dry) { const s = readJson(STATE, {}); s[kind] = result; writeJson(STATE, s); }
  if (result.emailError) { console.error(`${kind}: EMAIL FAILED — ${result.emailError}`); process.exit(1); }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { parseCbDetail, aduVerdict, houseCard, pageFacts, compassStatus, daysSince, houseWhy, studioWhy, ptNow, GONE, POST_GONE };
