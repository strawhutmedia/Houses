STUDIO ALERT — Straw Hut Media studio space. Daily scout for Ryan. Repo: strawhutmedia/Houses (clone it if not already in the working directory; read CLAUDE.md "Studio-space side quest" first). The repo is PUBLIC — never commit the email token below.

CRITERIA
- Areas: Silver Lake, Atwater Village, Frogtown (Elysian Valley), Burbank, Toluca Lake.
- Private, move-in space for a podcast/video studio: office, creative office, studio, flex/light-industrial. NOT coworking/shared desks, virtual offices, hourly/daily rentals, salons, auto shops, retail-only storefronts, storage.
- 800+ sq ft and $3,500/mo or less (monthly rent; add NNN/CAM if the post states it and say so).

DISCOVERY
1. Run: node scraper/spaces.js   (Craigslist + broker listings → spaces.json)
2. Run: node scraper/studio-alert.js   → JSON candidates in the areas above, not yet alerted (studios-seen.json). sizeUnknown:true means the post didn't state size.
3. Also check brokers directly (WebFetch): figure8re.com listings, and any lead listed in CLAUDE.md's studio section (e.g. 1728-1730 Silver Lake Blvd). LoopNet/Crexi block automation — don't rely on them.

IRON RULE: open every candidate's live post/listing TODAY and confirm it is still up, monthly, in-area, and actually 800+ sq ft (read the body; drop sizeUnknown ones whose body gives no size ≥800, or clearly a single small room). Search/feed data alone is never enough.

OUTPUT
- Matches: email Ryan (arrives from studios@strawhutmedia.com via the site's AWS SES; the site renders photo thumbnails, grouped by neighborhood, cheapest first — do NOT sort/format yourself). Write /tmp/studio.json =
  {"intro":"<optional 1-2 lines, biggest news first>",
   "spaces":[{"address":"<post title or street address>","price":2495,"sqft":1400,"hood":"Atwater Village","why":"one line: what it is + studio fit (noise, parking, ceilings, private bath)","url":"<live post url>","photo":"<600x450 photo url from the post>"}]}
  hood is exactly one of: Silver Lake, Atwater Village, Frogtown, Burbank, Toluca Lake. Then run:
  curl -sS -X POST "https://www.strawhutmedia.com/api/studios/alert" -H "Content-Type: application/json" -H "X-Newsletter-Token: <TOKEN — NOT stored here (public repo); copy from the live Routine or the Calendar-prep Routine>" -d @/tmp/studio.json
  It must return {"ok":true}; if not, retry once, then say so in your final reply.
- Then record every emailed AND every rejected candidate so it never repeats: node scraper/studio-alert.js --mark id1,id2,...  then commit studios-seen.json + spaces.json and push to main.
- No matches: send NO email; still --mark the rejects and push; reply exactly "No new studio matches today".
