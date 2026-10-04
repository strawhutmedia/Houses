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
  const remarks = ((html.match(/<div[^>]*class="[^"]*(?:remarks|description)[^"]*"[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || "").replace(/<[^>]+>/g, " ");
  return {
    status: (field("Status") || "").trim() || null,
    updated: (field("Updated") || "").trim() || null,
    yearBuilt: +ld("Year Built") || null,
    lotAcres: +ld("Lot Size \\(Acres\\)") || null,
    photo: (html.match(/property="og:image" content="([^"]+)"/) || html.match(/og:image" content="([^"]+)"/) || [])[1] || null,
    aduMention: /\b(ADU|accessory dwelling|guest (house|unit|apartment|suite)|in-?law|granny flat|casita)\b/i.test(remarks),
  };
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
  s += d.aduMention ? " Listing mentions an ADU/guest unit — UNVERIFIED until permits or sqft back it." : " Any ADU/guest-unit claim unverified.";
  return s;
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
    if (age == null || age > FRESH_DAYS) { rejected.push({ ...c, reason: `CB updated ${d.updated || "?"} — can't confirm Active today` }); return; }
    verified.push({ ...c, detail: d });
  });

  // Board: add verified finds (a price cut on a board house updates it in place).
  const finds = readJson(FINDS, { finds: [], corrections: [] });
  finds.corrections = finds.corrections || [];
  let added = 0, cuts = 0;
  for (const v of verified) {
    const why = houseWhy(v, v.detail);
    const existing = finds.finds.find((f) => hd.addrKey(f.address) === hd.addrKey(v.address));
    const how = `Coldwell Banker live listing page: Status ${v.detail.status}, Updated ${v.detail.updated}`;
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
      ask: "Verify permits and any ADU/guest-unit claims; check DOM and price history.",
      links: [{ label: "Coldwell Banker listing", url: v.url }],
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
      `${verified.length} verified ${verified.length === 1 ? "match" : "matches"} today (${la} Los Angeles, ${pdx} Portland) — each confirmed Active on its live listing page this morning.`,
      moved.length ? `${moved.length} board ${moved.length === 1 ? "house is" : "houses are"} now pending/sold and moved to corrections.` : null,
    ].filter(Boolean).join(" ");
    const payload = { intro, houses: verified.map((v) => ({
      address: v.address, price: v.price, wasPrice: v.wasPrice && v.price < v.wasPrice ? v.wasPrice : null, beds: v.beds, baths: v.baths, sqft: v.sqft,
      city: v.city === "Portland" ? "Portland" : "Los Angeles", hood: v.hood, why: houseWhy(v, v.detail), url: v.url, photo: v.photo || v.detail.photo,
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
      intro: `${verified.length} private studio ${verified.length === 1 ? "space" : "spaces"} matched today (800+ sq ft, ≤ $3,500/mo) — each post was open and live this morning.`,
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
module.exports = { parseCbDetail, daysSince, houseWhy, studioWhy, ptNow, GONE, POST_GONE };
