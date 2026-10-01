HOUSE ALERT — LA (NELA) + Portland. Daily MLS scout for Ryan. Repo: strawhutmedia/Houses (clone it if not already in the working directory; read CLAUDE.md first). The repo is PUBLIC — never commit the email token below.

CRITERIA
- LA: single-family house, 1.5+ baths, under $1.25M, in Highland Park (top pick), Atwater Village, Frogtown (Elysian Valley), Eagle Rock, Mt. Washington, Glassell Park, Silver Lake, Echo Park, Los Feliz.
- Portland: house, 1.5+ baths, under $1M, in West Hills/SW, Alberta, Mississippi, Overlook, Mt. Tabor, Hawthorne/Division, Sellwood, Irvington, Laurelhurst.
- ADU/guest unit is a strong plus, but treat any "guest apartment/ADU" claim as UNVERIFIED unless permits or sqft back it (5140 Miriam's "guest apartment" was a shed).

DISCOVERY (rebuilt 10/1 — Compass search pages now bot-block with an empty HTTP 202; do NOT use them)
1. Run: node scraper/house-discover.js > /tmp/cands.json
   It reads Coldwell Banker IDX search pages (full MLS inventory) for every ZIP covering the neighborhoods above, every page, and keeps only Single Family + Active + 1.5+ baths + under the cap + inside a neighborhood + not on the board (finds.json) + not already seen (houses-seen.json) unless the price dropped (wasPrice set). Its stderr line shows scanned/match counts — if "scanned" is 0 for a city, the source broke: say so in the final reply instead of claiming no matches.
2. Each candidate has url (CB detail page), photo, pid, mls.

IRON RULE: nothing is published or emailed unless confirmed ACTIVE on a live listing page TODAY. Open each candidate's CB detail page and read "Status:" and "Updated:". CB can lag the MLS by days (10/1: a house CB showed Active was Contract Signed on Compass). So: Active + Updated within the last 2 days = verified. Otherwise confirm on a second live page (Compass homedetails page found via web search site:compass.com, or the listing brokerage's page); if you can't confirm Active today, drop it. Drop anything pending/contingent/under contract/sold/lease/coming-soon.

OUTPUT
- Matches: add each to finds.json (address, price, beds/baths, sqft, neighborhood, live URL, verified date, 1-line why), commit, push to main (Pages auto-deploys). Move any existing find that is now pending/sold into the corrections log.
- Then EMAIL Ryan (arrives from houses@strawhutmedia.com via the site's AWS SES; the site renders it with photo thumbnails, grouped Los Angeles → Portland → neighborhood, cheapest first — do NOT sort or format it yourself). Use each candidate's "photo" field (CB 600px image); if missing, take og:image from its live page. Write /tmp/alert.json =
  {"intro":"<optional 1-3 lines: biggest news first, e.g. a price cut on a board house; if the git push above failed, end with: ⚠️ Board not updated today (push failed).>",
   "houses":[{"address":"4820 Buchanan St","price":1249000,"wasPrice":null,"beds":3,"baths":3,"sqft":1704,"city":"Los Angeles","hood":"Highland Park","why":"one line","url":"<live listing url>","photo":"<og:image url>"}]}
  city is exactly "Los Angeles" or "Portland"; hood is the plain neighborhood name (e.g. "Silver Lake", "West Hills"); wasPrice only for price cuts. Then run:
  curl -sS -X POST "https://www.strawhutmedia.com/api/houses/alert" -H "Content-Type: application/json" -H "X-Newsletter-Token: <TOKEN — NOT stored here (public repo); copy from the live Routine or the Calendar-prep Routine>" -d @/tmp/alert.json
  It must return {"ok":true}; if not, retry once, then say so in your final reply (the notification email is the fallback).
- Then remember every candidate (emailed or rejected) so it never repeats unless its price drops: node scraper/house-discover.js --mark /tmp/cands.json — commit houses-seen.json and push to main (do this on no-match days too).
- End your reply with a short plain summary.
- No matches: send NO email; reply exactly "No new matches today". No digest, no filler.
