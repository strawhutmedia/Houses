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
- Matches: add each to finds.json (address, price, beds/baths, sqft, neighborhood, live URL, verified date, 1-line why), commit, push to main (Pages auto-deploys). Move any existing find that is now pending/sold into the corrections log. Then end your reply with a short plain summary per house (address, price, bd/ba, why, link) — that reply is Ryan's email.
- No matches: reply exactly "No new matches today". No digest, no filler.
