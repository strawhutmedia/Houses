# EquityScout — project handoff & state

Read this first. It is the source of truth for where the project stands and how
Ryan (the owner) works. Last full update: **2026-09-17**.

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

## The daily house-alert Routine (CRITICAL — this is live automation)

Trigger `trig_01YSm8iXCHGyntzjiZSQFbwP` ("House alert — LA (NELA) + Portland"),
cron `0 15 * * *` (8 AM PT), fresh session per run, **email-only notification**
(push off — Ryan's phone doesn't receive Claude pushes). Manage with
`list_triggers` / `update_trigger` (claude-code-remote MCP).

Its rules (full prompt lives in the trigger itself):
- **LA**: house, 1.5+ baths, **under $1.5M**, in Highland Park (top pick),
  Atwater Village, Frogtown, Eagle Rock, Mt. Washington, Glassell Park,
  Silver Lake, Echo Park, Los Feliz.
- **Portland**: house, 1.5+ baths, **under $1M**, West Hills/SW + Alberta,
  Mississippi, Overlook, Mt. Tabor, Hawthorne/Division, Sellwood, Irvington,
  Laurelhurst. (Added 9/9 after a West Hills find exposed the gap.)
- Discovery reads **live brokerage inventory pages** (Compass neighborhood
  pages fetch reliably; Zillow/Redfin block automation), verifies same-day,
  publishes matches to `finds.json` (push to main), then emails Ryan.
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
- EquityScout emails Ryan manually via **his Gmail** (branded dark HTML,
  EquityScout style — see sent examples in his inbox); the Routine's
  automatic emails use the notification channel (plain).
- Ryan's other Routines (CRM sweep, calendar preps, Straw Hut site pass) are
  unrelated — don't touch.

## Studio-space side quest (open)

Ryan photographed an Atwater office building ("…l Building", Weber
Management, offices from $599/mo utilities included, call April
818-577-9088). No online footprint; assessed as good cheap edit-suite,
bad recording room (wall ACs, 2-hr street parking, thin walls). Next step is
his: call April / get the cross street so we can pull assessor data.

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
