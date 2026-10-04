# EquityScout — project handoff & state

Read this first. It is the source of truth for where the project stands and how
Ryan (the owner) works. Last full update: **2026-10-03**.

## What this is

Two things live in this repo, both deployed to GitHub Pages at
**https://strawhutmedia.github.io/Houses/**:

1. **EquityScout** — a scraper + site that aggregates cheap **government**
   housing (auctions, foreclosures, land banks) into one filterable feed
   (`index.html`).
2. **Scout Finds** (`finds.html` + `finds.json`) — a hand-verified board of
   regular **MLS** houses matching Ryan's personal house hunt, fed by a daily
   Routine (see below).

Plus `spaces.html` — a separate studio-space hunt for Straw Hut Media (Ryan's
podcast company).

## Deploy conventions (Ryan has approved this flow)

- Develop on branch `claude/equity-scout-x14039`, commit there, then
  **fast-forward merge to `main` and push** — pushing main auto-deploys Pages
  via `.github/workflows/refresh.yml` (which also re-runs the scraper every
  3 h). Ryan explicitly approved deploying to main; don't re-ask each time.
- `listings.json` is generated (git-ignored). `finds.json` IS committed.
- Verify before pushing: `node --check` on JS; for UI changes use Playwright
  (`NODE_PATH=/opt/node22/lib/node_modules`, chromium preinstalled).

## The site, feature by feature

- **Deal feed** (`index.html` + `app.js`): government listings from
  `listings.json` (fallback `data.js`). The "⭐ LA + Portland" focus filter is
  GEOGRAPHIC — `inFocusMetro()` in app.js keeps homes within 75 mi of downtown
  LA or 40 mi of Portland (coords → ZIP via zipgeo.js → curated city list,
  city list wins outright). "All USA" shows everything.
- **Scraper** (`scraper/`): 13 adapters, see `scraper/README.md` for the
  status table. Live & meaningful: HUD (~950), VRM VA REO (~1,180),
  St. Louis Land Bank (~1,000), **Michigan tax-sale.info (~320, has REAL
  equity: SEV × 2 = assessed market value)**, Detroit Land Bank (25),
  Genesee/Flint, Bid4Assets, IRS, GSA. AI enrichment (value/condition/vibes)
  runs only when `ANTHROPIC_API_KEY` is set.
- **Scout Finds** (`finds.html`/`finds.json`): verified MLS finds with a
  public **corrections log**. Iron rule, learned the hard way (we once emailed
  Ryan a house that had sold 6 months prior from a stale search snippet):
  **nothing is published or emailed unless confirmed on a live listing or
  brokerage page the same day.** Search snippets are never sufficient.
- **Favorites**: ♥ hearts on both pages (localStorage). Two sharing modes:
  legacy snapshot links (`#share=id1,id2`) and **live boards** — `boards.js`
  + `sync-server/` (zero-dep Node) deployed on **Ryan's Railway**: project
  `equityscout-sync`, service `board-sync`, volume at `/data`, URL
  `https://board-sync-production-4b60.up.railway.app`. A board is one shared
  synced list behind a secret `?board=<slug>` link; the link is the
  membership; 8 s poll + refresh on tab focus. No accounts, deliberately.

## ⚠️ Daily scouts now run as GitHub Actions — NOT Claude Routines (2026-10-03)

Owner rule: nothing recurring lives in a Claude session. **`.github/workflows/scout-alerts.yml`**
runs both scouts daily ~7:40 AM PT (three UTC cron slots; `scraper/scout-alerts.js gate`
runs each once per Pacific day, never before 7 AM). `scraper/scout-alerts.js` does what the
Routines did by judgment, as code: discovery (`house-discover.js` / `spaces.js` +
`studio-alert.js`), the IRON RULE (house = live CB page says Status Active AND Updated ≤2
days; studio = post still up, monthly, ≤$3,500, stated ≥800 sq ft, not coworking; broker
page not "leased"), board add + pending/sold → corrections, email via strawhutmedia.com,
mark seen, commit, then re-run the Pages deploy. **No secret:** the site accepts a GitHub
OIDC token minted for this workflow on main (site `src/githubOidc.js`). A source that reads
0 (CB city / Craigslist blocked) emails Ryan ONCE until it recovers. Every run's verdict
(scanned, verified, each reject + reason, email ok) is committed to **`scout-state.json`**
— read that first. Manual: Actions → "Daily scouts" → Run workflow (dry_run defaults ON).
Self-test: `node --test test/scout.test.js` (runs in the workflow first).
Found 10/3: the studio Routine had been failing since 9/30 (email blocked by a classifier,
push refused) — Ryan got no studio alerts. Also fixed then: Craigslist writes size as
`1000ft<sup>2</sup>`, which the parser missed (posts read "size unknown").
Routines trig_01DSFmTc3Mw891sxqUgTcL27 (house) + trig_01WJR3NFNxeGT4GWifSQK1s7 (studio):
DISABLED once the workflow's first real run was verified. The history below is kept for
the rules it records; `routines/*.md` are superseded.

## (Superseded 10-03) The daily house-alert Routine

Trigger `trig_01DSFmTc3Mw891sxqUgTcL27` ("House alert — LA (NELA) + Portland"),
cron `CRON_TZ=America/Los_Angeles 52 7 * * *` (7:52 AM PT), fresh session per run, **email-only notification**
(push off — Ryan's phone doesn't receive Claude pushes). Manage with
`list_triggers` / `update_trigger` (claude-code-remote MCP).

**History:** the original trigger (`trig_01YSm8iX…`) was found DELETED on 9/26 —
no alerts had run since ~9/17. Recreated 9/26 from the rules below. The canonical
prompt is now versioned at `routines/house-alert.md`; if the trigger vanishes
again, recreate it from that file. Periodically confirm it still exists
(`list_triggers recurring=true`).

Its rules (full prompt in `routines/house-alert.md`):
- **LA**: house, 1.5+ baths, **under $1.25M** (lowered from $1.5M 9/27 — Ryan: "can't afford 1.5"), in Highland Park (top pick),
  Atwater Village, Frogtown, Eagle Rock, Mt. Washington, Glassell Park,
  Silver Lake, Echo Park, Los Feliz.
- **Portland**: house, 1.5+ baths, **under $1M**, West Hills/SW + Alberta,
  Mississippi, Overlook, Mt. Tabor, Hawthorne/Division, Sellwood, Irvington,
  Laurelhurst. (Added 9/9 after a West Hills find exposed the gap.)
- Discovery (rebuilt **10/1** after Compass search pages started bot-blocking
  with empty HTTP 202): `node scraper/house-discover.js` reads **Coldwell
  Banker IDX** ZIP pages (`/ca/90042/`, `/or/97212/`, `p_N/` paging; full MLS
  inventory; Zillow/Redfin/Realtor/Homes/Trulia all block), filters type/
  status/baths/cap/neighborhood (geo circles), skips board + `houses-seen.json`
  (pid→price). **RULE: never pre-seed houses-seen.json** — the 10/1 seed hid
  189 un-emailed matches (incl. 3060 Silver Lake Blvd, Ryan caught it); un-seeded
  + catch-up run fired 10/3. Only the Routine marks pids, after it emails/rejects. CB status can lag MLS by days → Routine verifies Active
  with Updated ≤2 days, else a second live page. Compass *detail* pages still
  fetch fine. Then publishes to `finds.json` (push to main) and emails Ryan.
  No matches → exactly "No new matches today" → no email. Never a digest.
- ADU/guest unit is Ryan's favorite feature — but see "shed" lesson below.

## Ryan's house hunt — human context that matters

- Buying with wife **Maggie** and best friend **Steve**; they can pool
  **~$180K** down "no problem"; split **50/50** (Tillotsons | Steve).
- Settled plan after much debate: **buy together, everyone qualifying on the
  loan, joint pre-approval with a mortgage broker** (next real-world step —
  bring 2 yrs tax returns for Ryan, W-2s for Maggie/Steve). Ryan repeatedly
  wanted "one name on deed + secret side contract" to preserve first-time
  buyer status; the line held every time: **disclosed** equity-share/TIC = fine,
  concealed = mortgage fraud (false gift letters). Don't relitigate; if it
  returns, the legal shapes are: joint TIC, or one genuine owner-occupant +
  disclosed recorded loans from the others, or LLC **only** for pure rentals
  (they also floated renting everything out — DSCR loans fit that).
- Ryan is self-employed (Straw Hut Media LLC): ~$435K YTD revenue, ~$160K/yr
  net pace, $104K credit cards (pay down the $90K Amex before applying),
  $151K AR to collect. Solo he's a ~$650–750K buyer; jointly fine.
- **5140 Miriam St** (the Instagram house, $899K HLP): went UNDER CONTRACT
  ~9/9. Ryan visited: the "guest apartment" was **a shed** — the listing
  oversold it (that's why it sat 63 days; seller's 2023 basis $865K meant no
  price cuts). Backup offer idea dropped. Lesson now baked into practice:
  "guest apartment/ADU" claims are unverified until permits/sqft back them.
- Still live on the board: 117 N Dillon ($1.499M, Ryan's own street, 115+ DOM,
  negotiable), 4 Frogtown houses, 3210 SW Malcolm Ct Portland ($649K, 4/3,
  0.71 ac — verify still active before citing).
- Reality check that keeps recurring: Instagram house reels are stale,
  out-of-area, leases, or pre-market teases. The scout sees MLS truth.

## Adjacent systems (touched from this project's sessions)

- **Resend is DELETED** (Ryan deleted the account 9/9). Podbooster verified
  safe — it runs on **AWS SES** (its repo's own tests confirm no send path
  gated on Resend; repo `strawhutmedia/Podbooster`, deployed on a GoDaddy
  VPS). **OPEN QUESTION: first100.baby's email** — it had a fresh Resend key
  when the account died; its repo was never located. If email breaks there,
  that's why.
- No working AWS credentials exist in this session environment (env vars are
  sandbox placeholders). SES work needs real keys from Ryan.
- **House-alert emails (9/27):** the Routine emails Ryan real inbox mail from
  **houses@strawhutmedia.com** via `POST https://www.strawhutmedia.com/api/houses/alert`
  (strawhutmedia-site PR #122; SES, strawhutmedia.com domain identity verified;
  replies go to Ryan). Auth = the site's `X-Newsletter-Token` (same one the
  Calendar-prep Routine uses; Ryan explicitly approved reuse). **The token lives
  ONLY in the Routine prompt — never commit it; this repo is PUBLIC.** Claude's
  notification email stays on as fallback.
  Format (9/27, site PR #131, `src/houseAlert.js`): Routine posts
  `{intro, houses:[{address,price,wasPrice,beds,baths,sqft,city,hood,why,url,photo}]}`;
  the site renders photo thumbnails (listing og:image), grouped LA → Portland →
  neighborhood (Silver Lake, Highland Park first), cheapest first. Ryan asked for this.
- Board push: 9/27 run could not push; **9/28 run pushed finds.json fine**
  (commit c1e7598, 12 matches). Gap resolved.
- EquityScout emails Ryan manually via **his Gmail** (branded dark HTML,
  EquityScout style — see sent examples in his inbox); the Routine's
  automatic emails use the notification channel (plain).
- Ryan's other Routines (CRM sweep, calendar preps, Straw Hut site pass) are
  unrelated — don't touch.

## Studio-space side quest (open)

**Daily Studio alert Routine (9/30):** `trig_01WJR3NFNxeGT4GWifSQK1s7`, 7:38 AM PT,
fresh session, email-only. Criteria (Ryan): Silver Lake, Atwater Village,
Frogtown, Burbank, Toluca Lake; **800+ sq ft, ≤ $3,500/mo**; private move-in
space (no coworking/hourly/auto/salon). Prompt versioned at
`routines/studio-alert.md` (token placeholder; real token only in the trigger).
Pipeline: `node scraper/spaces.js` → `node scraper/studio-alert.js` (geo-filter
+ dedupe vs `studios-seen.json`) → live-verify each post → `POST /api/studios/alert`
(site PR #139; sends as Studio Scout <studios@strawhutmedia.com>, same renderer
as houses, rent "/mo") → `--mark` ids → push. 9/30 fix: Craigslist retired
`/jsonsearch` (returns HTML) and search now redirects, so spaces.js silently got
0 posts since ~Aug; added `-L` + static-results fallback + area-targeted
searches + "SF" sqft parsing.

Ryan photographed an Atwater office building ("…l Building", Weber
Management, offices from $599/mo utilities included, call April
818-577-9088). No online footprint; assessed as good cheap edit-suite,
bad recording room (wall ACs, 2-hr street parking, thin walls). Next step is
his: call April / get the cross street so we can pull assessor data.
- 9/28: **1728 & 1730 Silver Lake Blvd** (Figure 8 Realty; Nick Fichera
  630-460-0820, Cael Kirkland 323-842-2536). Broker page: 1958 split-level,
  ~1,800 sf total, 4 offices w/ separate entrances + baths, kitchen, parking;
  page says "Leased" but sign still up (Ryan: listed a long time). No asking
  rent published; estimate ~$1.3–1.8K/mo per office, ~$5–7K whole (unverified
  market guess). Busy street = recording noise risk. Next: Ryan calls Cael.
- 9/30: **Melrose × Heliotrope corner (Melrose Hill / East Hollywood 90029)** —
  700–712 N Heliotrope / 4323 Melrose, 1920s brick retail. Per LoopNet/Showcase
  (search snippets, not verified live): 1,435 sf corner $2.95/sf/mo NNN ≈ $4,233
  + NNN; 1,815 sf $3.00/sf MG ≈ $5,445; 712 N Heliotrope ~800 sf listed LEASED
  (Figure 8). All over the $3.5K cap; storefront glass + Melrose traffic = noise.
  Not in studio-alert areas (Ryan could add East Hollywood/Melrose Hill).
  9/30 later: Ryan WANTS the 1,435 sf corner (former tattoo shop, 4323 Melrose).
  Its LoopNet listing (31511159) now says "no longer advertised" → may be leased;
  the 1,815 sf listing (37461082) status unknown (sites 403). Building (7,469 sf,
  1923, APN 5538-023-002) SOLD 6/26/2025 for $3.05M — new owner. No interior
  photos online (Compass photos are nearby homes). Negotiation view: $3,500 all-in
  ≈ 30% under ask+NNN — unlikely; $3,500 base + NNN (~17% off) plausible with
  3–5 yr term. Next: Ryan calls broker (name unknown; LoopNet page lists it).

- 10/2: **Seeley Building, 1800 S Brand Blvd (Atwater/Glendale 5-points), Figure 8 /
  Cael Kirkland.** Ryan TOURING **Mon 11am**. Cael's asks (MG): 113 (1st fl, 945 sf)
  $2,500; 118 (1st, 940 sf) $2,500; 121 (1st, 1,400 sf) $3,000; 205 (2nd, 1,300 sf)
  $4,000. Each unit: private restroom + kitchenette, valet parking, brick/beams/
  polished concrete. Leverage: a Craigslist post (9/30 studio scrape) advertised a
  1,400 sf Seeley unit at **$2,495** — likely 121. Unit positions unknown (parcel map
  ≠ floor plan); ask which face the courtyard vs Brand/San Fernando traffic.

- **Current studio (for comparison):** 7201 Melrose Ave #203A+B (landlord Harry,
  Macculloch Partners, 310-680-9797). Combined A+B + 1 parking = **$3,400/mo from
  6/1/2026** (Harry's 4/17 email). Square footage NOT in Gmail/Drive (searched 10/4:
  lease emails, 2023 "Straw Hut Studio Hunt" sheet row is blank; Ryan's power
  sketch not found — likely a photo on his phone).
  10/4 Ryan sent the sketch (inches): 203A ≈ 303" long (152+151), widths read as
  ~101" / 130" / 170" → **≈ 275 sq ft**. 203B same length, narrower (width TBD) →
  A+B est. **~450–550 sq ft** ≈ $6–7.50/sf vs Seeley 121 1,400 sf @ $3,000 ($2.14/sf).

## Backlog (in rough priority)

1. Watch the Routine's output quality — discovery was rebuilt 9/9 to read
   live brokerage pages after 3 silent days; if it's still too quiet or too
   noisy, tune the prompt via `update_trigger`.
2. Scraper sources: Ohio sheriff sales (RealAuction — appraised values =
   real equity), Albany County + Lucas County (Toledo) land banks,
   Bid4Assets parcel-detail enrichment, AVM/rent enrichment.
3. Scout Finds: "names on hearts" (who saved what, no accounts — one-time
   name prompt) was offered and liked; build when group hunt gets real.
4. Weekly "sitting inventory" sweep (long-DOM deals resurface) was removed
   when the Routine was rebuilt email-only; re-add if Ryan misses it.
5. finds.json hygiene: Miriam St should be moved to corrections (under
   contract) — CHECK whether a Routine run already did this; if not, do it.

## Working with Ryan

Direct, sometimes heated, always fair when shown evidence. Wants short
answers first, detail on request ("you're saying so much" = simplify).
Expects things to actually ship — a plan is not a deliverable. When he's
wrong on facts (mortgage law, stale listings), state it plainly with
evidence once, hold the line, and give him the legal/working version of what
he's trying to do. Verify EVERYTHING before sending him listings — being
burned by unverified data is this project's founding trauma.
