HOUSE ALERT — LA (NELA) + Portland. Daily MLS scout for Ryan. Repo: strawhutmedia/Houses (clone it if not already in the working directory; read CLAUDE.md first).

CRITERIA
- LA: single-family house, 1.5+ baths, under $1.5M, in Highland Park (top pick), Atwater Village, Frogtown (Elysian Valley), Eagle Rock, Mt. Washington, Glassell Park, Silver Lake, Echo Park, Los Feliz.
- Portland: house, 1.5+ baths, under $1M, in West Hills/SW, Alberta, Mississippi, Overlook, Mt. Tabor, Hawthorne/Division, Sellwood, Irvington, Laurelhurst.
- ADU/guest unit is a strong plus, but treat any "guest apartment/ADU" claim as UNVERIFIED unless permits or sqft back it (5140 Miriam's "guest apartment" was a shed).

DISCOVERY
- Read LIVE brokerage inventory pages (Compass neighborhood pages fetch reliably; Zillow/Redfin block automation — don't rely on them). New listings, price drops, and back-on-market count.
- Skip anything already in finds.json (or its corrections log) unless its price dropped.

IRON RULE: nothing is published or emailed unless confirmed ACTIVE on a live listing or brokerage page TODAY. Search snippets are never enough. Drop anything pending/under contract/sold/lease.

OUTPUT
- Matches: add each to finds.json (address, price, beds/baths, sqft, neighborhood, live URL, verified date, 1-line why), commit, push to main (Pages auto-deploys). Move any existing find that is now pending/sold into the corrections log.
- Then EMAIL Ryan (arrives from houses@strawhutmedia.com via the site's AWS SES; the site renders it with photo thumbnails, grouped Los Angeles → Portland → neighborhood, cheapest first — do NOT sort or format it yourself). For each house, open its live listing page and take the photo URL from its <meta property="og:image" content="..."> tag. Write /tmp/alert.json =
  {"intro":"<optional 1-3 lines: biggest news first, e.g. a price cut on a board house; if the git push above failed, end with: ⚠️ Board not updated today (push failed).>",
   "houses":[{"address":"4820 Buchanan St","price":1249000,"wasPrice":null,"beds":3,"baths":3,"sqft":1704,"city":"Los Angeles","hood":"Highland Park","why":"one line","url":"<live listing url>","photo":"<og:image url>"}]}
  city is exactly "Los Angeles" or "Portland"; hood is the plain neighborhood name (e.g. "Silver Lake", "West Hills"); wasPrice only for price cuts. Then run:
  curl -sS -X POST "https://www.strawhutmedia.com/api/houses/alert" -H "Content-Type: application/json" -H "X-Newsletter-Token: <TOKEN — NOT stored here (public repo); copy from the live Routine or the Calendar-prep Routine>" -d @/tmp/alert.json
  It must return {"ok":true}; if not, retry once, then say so in your final reply (the notification email is the fallback).
- End your reply with a short plain summary.
- No matches: send NO email; reply exactly "No new matches today". No digest, no filler.
