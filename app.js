/* ============================================================
   EquityScout — simple app logic
   One search box, a couple of chips, one clean list.
   ============================================================ */
(function () {
  "use strict";

  var DATA = [], DATA_IS_LIVE = false;
  var SAVED = loadSaved(), NOTIFY = loadNotify(), TICKERS = [];

  function $(id) { return document.getElementById(id); }

  /* ---------------- helpers ---------------- */
  function hashStr(s) { var h = 0, i; s = String(s || ""); for (i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; } return Math.abs(h); }
  var CONDITIONS = [
    { label: "Move-in Ready", damage: "Minimal", pct: 8, cls: "good" },
    { label: "Light Rehab", damage: "Cosmetic", pct: 28, cls: "ok" },
    { label: "Moderate Rehab", damage: "Moderate", pct: 52, cls: "warn" },
    { label: "Heavy Rehab", damage: "Significant", pct: 78, cls: "bad" },
  ];
  function zipOf(a) { var all = String(a || "").match(/\b\d{5}\b/g); return all && all.length ? all[all.length - 1] : ""; }
  // HUD encodes baths as "full.half" (e.g. 1.1 = 1 full + 1 half = 1.5 baths,
  // 3.2 = 3 full + 2 half = 4). Convert that shorthand to a real bath count;
  // leave true decimals (1.5, 2.5) alone.
  function normBaths(b) {
    if (b == null) return 0;
    b = +b; if (!isFinite(b)) return 0;
    var full = Math.floor(b), frac = +(b - full).toFixed(2);
    if (frac >= 0.1 && frac <= 0.45 && Math.round(frac * 10) === frac * 10) return full + Math.round(frac * 10) * 0.5;
    return b;
  }
  function shiftDays(iso, days) { var d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }

  function enrich(l) {
    var hasMV = l.marketValue != null && l.marketValue > 0;
    var equity = hasMV ? Math.max(0, l.marketValue - (l.price || 0)) : null;
    var pct = (equity != null) ? Math.round((equity / l.marketValue) * 100) : null;
    var isSample = l.live === false;
    var posted = l.postedDate || (isSample && l.auctionDate ? shiftDays(l.auctionDate, -(10 + (hashStr(l.id) % 35))) : null);
    var condition = l.condition || (isSample ? CONDITIONS[hashStr(l.id) % CONDITIONS.length] : null);
    var photoCount = (l.photoCount != null) ? l.photoCount : (isSample ? (hashStr(l.id + "p") % 7) + 2 : 0);
    return Object.assign({}, l, {
      equity: (l.equity !== undefined ? l.equity : equity),
      equityPct: (l.equityPct !== undefined ? l.equityPct : pct),
      baths: normBaths(l.baths),
      zip: l.zip || zipOf(l.address),
      postedDate: posted, condition: condition, photoCount: photoCount,
      deadline: l.auctionDate ? l.auctionDate + "T18:00:00" : null,
    });
  }
  function sampleRows() { return (window.LISTINGS || []).map(function (l) { return enrich(Object.assign({}, l, { live: false })); }); }
  function loadData() {
    return fetch("listings.json", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.listings && j.listings.length) { DATA_IS_LIVE = true; return j.listings.map(enrich); } return sampleRows(); })
      .catch(function () { return sampleRows(); });
  }

  var fmt = function (n) { return "$" + (n || 0).toLocaleString("en-US"); };
  function fmtDate(s) { return new Date(s + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
  function esc(s) { return String(s).replace(/[<>&"]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]; }); }
  function streetOf(a) { return String(a || "").split(",")[0]; }

  /* ---------------- countdown ---------------- */
  function countdownText(iso) {
    if (!iso) return { txt: "Date at source", urgent: false, ended: false };
    var ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return { txt: "Auction ended", urgent: false, ended: true };
    var s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d >= 1) return { txt: d + "d " + h + "h left", urgent: d < 2, ended: false };
    return { txt: h + "h " + pad(m) + "m left", urgent: true, ended: false };
  }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function startTicker() {
    if (startTicker._t) clearInterval(startTicker._t);
    startTicker._t = setInterval(function () {
      TICKERS.forEach(function (t) {
        var c = countdownText(t.deadline);
        if (t.el) { t.el.textContent = c.txt; t.el.className = "countdown" + (c.urgent ? " urgent" : "") + (c.ended ? " ended" : ""); }
        if (c.ended && !t.fired) { t.fired = true; if (NOTIFY[t.id]) fireNotification(t.id); }
      });
    }, 1000);
  }

  /* ---------------- saved / notify ---------------- */
  function loadSaved() { try { return JSON.parse(localStorage.getItem("es_saved") || "{}"); } catch (e) { return {}; } }
  function persistSaved() { try { localStorage.setItem("es_saved", JSON.stringify(SAVED)); } catch (e) {} }
  function loadNotify() { try { return JSON.parse(localStorage.getItem("es_notify") || "{}"); } catch (e) { return {}; } }
  function persistNotify() { try { localStorage.setItem("es_notify", JSON.stringify(NOTIFY)); } catch (e) {} }
  function savedCount() { return Object.keys(SAVED).filter(function (k) { return SAVED[k]; }).length; }
  function toggleSave(id) { SAVED[id] = !SAVED[id]; if (!SAVED[id]) delete SAVED[id]; persistSaved(); updateSavedBadge(); render(); }
  function toggleNotify(id) {
    NOTIFY[id] = !NOTIFY[id];
    if (!NOTIFY[id]) { delete NOTIFY[id]; persistNotify(); render(); return; }
    persistNotify();
    if ("Notification" in window && Notification.permission !== "granted") Notification.requestPermission();
    render();
  }
  function fireNotification(id) {
    var d = DATA.find(function (x) { return x.id === id; }); if (!d) return;
    if ("Notification" in window && Notification.permission === "granted")
      new Notification("⏰ Auction ended: " + streetOf(d.address), { body: (d.city || "") + ", " + d.state });
  }
  function updateSavedBadge() {
    var n = savedCount(); var b = $("saved-toggle");
    if (b) b.innerHTML = "♥ Saved" + (n ? " (" + n + ")" : "");
  }

  /* ---------------- ZIP -> location (loaded on demand) ---------------- */
  var ZIP_GEO = null, ZIP_GEO_LOADING = null;
  function loadZipGeo() {
    if (window.ZIPGEO) { ZIP_GEO = window.ZIPGEO; return Promise.resolve(ZIP_GEO); }
    if (ZIP_GEO_LOADING) return ZIP_GEO_LOADING;
    ZIP_GEO_LOADING = new Promise(function (res) {
      var s = document.createElement("script"); s.src = "zipgeo.js"; s.async = true;
      s.onload = function () { ZIP_GEO = window.ZIPGEO || {}; res(ZIP_GEO); };
      s.onerror = function () { ZIP_GEO = {}; res(ZIP_GEO); };
      document.head.appendChild(s);
    });
    return ZIP_GEO_LOADING;
  }
  function zipLatLng(z) { var g = ZIP_GEO && ZIP_GEO[z]; return g ? { lat: g[0] / 100, lng: Math.abs(g[1] / 100) } : null; }
  function milesBetween(la1, lo1, la2, lo2) {
    var R = 3958.8, rad = Math.PI / 180, dLa = (la2 - la1) * rad, dLo = (lo2 - lo1) * rad;
    var a = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  function homeMiles(d, o) { if (!o || d.lat == null || d.lng == null) return Infinity; return milesBetween(o.lat, o.lng, d.lat, Math.abs(d.lng)); }

  /* ---------------- hotspots (near coast / lake / downtown / mtns / park) ---------------- */
  var HOT_META = {
    ocean:    { icon: "🌊", label: "Near the coast", rad: 16 },
    lake:     { icon: "🏞️", label: "Near a lake", rad: 12 },
    downtown: { icon: "🏙️", label: "Fun downtown", rad: 16 },
    mtn:      { icon: "🏔️", label: "Mountains", rad: 25 },
    park:     { icon: "🌲", label: "National park", rad: 30 },
  };
  function hotspotOf(d) {
    if (d._hot !== undefined) return d._hot;
    var reasons = [], HS = window.HOTSPOTS || [];
    if (d.lat != null && d.lng != null && HS.length) {
      var hlat = d.lat, hlng = Math.abs(d.lng), best = null;
      for (var i = 0; i < HS.length; i++) {
        var p = HS[i], meta = HOT_META[p.k]; if (!meta) continue;
        var mi = milesBetween(hlat, hlng, p.lat, Math.abs(p.lng));
        if (mi <= meta.rad && (!best || mi < best.mi)) best = { p: p, mi: mi, meta: meta };
      }
      if (best) reasons.push({ icon: best.meta.icon, text: best.meta.label + " — " + best.p.n + " (~" + Math.round(best.mi) + " mi)" });
    }
    if (d.price != null && d.sqft && d.sqft >= 1500 && d.price / d.sqft < 55)
      reasons.push({ icon: "🏡", text: "Big house for the money — " + d.sqft.toLocaleString() + " sqft" });
    d._hot = reasons;
    return reasons;
  }

  /* ---------------- state ---------------- */
  var FOCUS_STATES = { CA: 1, OR: 1 };
  var state = { q: "", area: "focus", maxPrice: 100000000, sort: "price", savedOnly: false, hotspots: false, minBeds: 0, minBaths: 0 };
  var LAST_ZIP = null, ZIP_ORIGIN = null;

  /* ---------------- filter + sort ---------------- */
  function apply() {
    // Pull a ZIP out of whatever they typed — a bare ZIP, or a pasted address
    // like "3742 Sunburst Ave, Signal Hill, CA 90755" → measure from that ZIP.
    var zipQ = (state.q.match(/\b\d{5}\b/) || [])[0] || null;
    ZIP_ORIGIN = zipQ ? zipLatLng(zipQ) : null;
    LAST_ZIP = zipQ;
    var q = state.q;

    var out = DATA.filter(function (d) {
      if (state.savedOnly) return !!SAVED[d.id]; // saved view ignores other filters
      if (d.price != null && d.price > state.maxPrice) return false;
      if (state.minBeds && (d.beds || 0) < state.minBeds) return false;
      if (state.minBaths && (d.baths || 0) < state.minBaths) return false;
      if (state.hotspots && !hotspotOf(d).length) return false;
      if (zipQ) {
        // "near a ZIP" — keep everything, rank by distance below. Never blank.
        if (ZIP_ORIGIN) d._mi = homeMiles(d, ZIP_ORIGIN);
        else { var z = +((d.zip || zipOf(d.address)) || 0); d._mi = z ? Math.abs(z - +zipQ) : Infinity; }
        return true;
      }
      if (q) {
        var hay = (d.address + " " + d.city + " " + d.state + " " + d.zip + " " + d.source + " " + d.type).toLowerCase();
        return hay.indexOf(q) !== -1;
      }
      if (state.hotspots) return true; // hotspots = discover nationwide
      if (state.area === "focus" && !FOCUS_STATES[d.state]) return false;
      return true;
    });

    var mode = zipQ ? "near" : state.sort;
    out.sort(function (a, b) {
      if (mode === "near") { var da = a._mi == null ? Infinity : a._mi, db = b._mi == null ? Infinity : b._mi; if (da !== db) return da - db; }
      if (mode === "ending") return (new Date(a.deadline || "2999-01-01")) - (new Date(b.deadline || "2999-01-01"));
      var pa = a.price == null ? Infinity : a.price, pb = b.price == null ? Infinity : b.price;
      if (pa !== pb) return pa - pb;
      return (new Date(a.deadline || "2999-01-01")) - (new Date(b.deadline || "2999-01-01"));
    });
    return out;
  }

  /* ---------------- render ---------------- */
  function render() {
    var rows = apply();
    var host = $("list");
    TICKERS = [];
    var note = DATA_IS_LIVE ? ' <span class="src-note live">● live</span>' : ' <span class="src-note">● sample</span>';

    var head;
    if (LAST_ZIP) {
      var near = rows[0], mi = (near && near._mi != null && isFinite(near._mi)) ? Math.round(near._mi) : null;
      head = (ZIP_ORIGIN && mi != null)
        ? "closest to your place — nearest first"
        : "finding homes near your place…";
    } else if (state.savedOnly) head = "your saved homes";
    else if (state.hotspots) head = "in hotspot locations 🌊🏞️🏙️ (coast, lakes, fun downtowns…)";
    else if (state.q) head = "matching “" + esc(state.q) + "”";
    else head = state.area === "focus" ? "in California & Oregon" : "across all 50 states";

    $("result-count").innerHTML = "<b>" + rows.length + "</b> home" + (rows.length === 1 ? "" : "s") + " " + head + note;

    if (!rows.length) {
      host.innerHTML = '<div class="empty"><strong>No homes to show here.</strong><br>' +
        (state.maxPrice < 100000000 ? 'Tap <b>Any price</b>, or ' : '') +
        (state.area === "focus" && !state.q ? 'tap <b>All USA</b>, ' : '') +
        'or clear the search box.</div>';
      return;
    }

    var CAP = 200, shown = rows.slice(0, CAP);
    var more = rows.length > CAP
      ? '<div class="empty" style="padding:20px;"><b>Showing the first ' + CAP + ' of ' + rows.length + '.</b><br>Type a ZIP or city, or pick a price to narrow it down.</div>'
      : "";
    host.innerHTML = shown.map(rowHTML).join("") + more;
    rows = shown;

    host.querySelectorAll("[data-id]").forEach(function (el) {
      var id = el.getAttribute("data-id");
      el.addEventListener("click", function () { openModal(id); });
      var sv = el.querySelector("[data-save]"); if (sv) sv.addEventListener("click", function (e) { e.stopPropagation(); toggleSave(id); });
      var cd = el.querySelector(".countdown"); var d = rows.find(function (r) { return r.id === id; });
      if (cd && d) { TICKERS.push({ id: id, deadline: d.deadline, el: cd, fired: false }); var c = countdownText(d.deadline); cd.textContent = c.txt; cd.className = "countdown" + (c.urgent ? " urgent" : "") + (c.ended ? " ended" : ""); }
    });
  }

  function rowHTML(d) {
    var beds = (d.beds || d.baths)
      ? d.beds + " bd · " + d.baths + " ba" + (d.sqft ? " · " + d.sqft.toLocaleString() + " sqft" : "")
      : "Details at source";
    var saved = !!SAVED[d.id];
    var miChip = LAST_ZIP && d._mi != null && isFinite(d._mi) ? '<span class="l-mi">~' + Math.round(d._mi) + ' mi away</span>' : '';
    var hs = hotspotOf(d);
    var hsBadge = hs.length ? '<div class="hot-badge">' + hs[0].icon + ' ' + esc(hs[0].text) + '</div>' : '';
    return '' +
      '<article class="home" data-id="' + esc(d.id) + '">' +
        '<div class="home-main">' +
          '<div class="home-price">' + (d.price != null ? fmt(d.price) : "See source") + '</div>' +
          '<div class="home-loc"><b>' + esc(d.city || streetOf(d.address) || "Home") + '</b>, ' + esc(d.state || "") + (d.zip ? " " + esc(d.zip) : "") + ' ' + miChip + '</div>' +
          '<div class="home-meta">' + esc(beds) + '</div>' +
          hsBadge +
          '<div class="home-sub">' + esc(d.source) + ' &middot; <span class="countdown">…</span></div>' +
        '</div>' +
        '<div class="home-side">' +
          '<button class="save-btn' + (saved ? " on" : "") + '" data-save title="Save">' + (saved ? "♥" : "♡") + '</button>' +
          '<span class="home-view">View →</span>' +
        '</div>' +
      '</article>';
  }

  /* ---------------- modal ---------------- */
  function openModal(id) {
    var d = DATA.find(function (x) { return x.id === id; }); if (!d) return;
    var m = $("modal");
    m.querySelector(".m-media").style.backgroundImage = artFor(d);
    m.querySelector("#m-title").textContent = streetOf(d.address) || d.city || d.source;
    m.querySelector("#m-sub").textContent = [d.city, d.state, d.zip].filter(Boolean).join(" ") || "Location at source";
    m.querySelector("#m-source").textContent = d.source;
    m.querySelector("#m-type").textContent = d.type + (d.year ? " · built " + d.year : "") +
      ((d.beds || d.baths || d.sqft) ? " · " + d.beds + " bd / " + d.baths + " ba / " + (d.sqft ? d.sqft.toLocaleString() + " sqft" : "—") : "");
    var mhot = m.querySelector("#m-hot");
    if (mhot) {
      var hs = hotspotOf(d);
      mhot.innerHTML = hs.map(function (r) { return '<span class="hot-badge">' + r.icon + ' ' + esc(r.text) + '</span>'; }).join("");
      mhot.style.display = hs.length ? "" : "none";
    }
    // Only show a field if we actually have it — no more rows of blank "—".
    function cell(id, val) {
      var el = m.querySelector(id); el.textContent = val == null ? "" : val;
      var c = el.closest(".cell"); if (c) c.style.display = (val == null) ? "none" : "";
    }
    cell("#m-price", d.price != null ? fmt(d.price) : "See source");
    cell("#m-value", d.marketValue != null ? fmt(d.marketValue) : null);
    cell("#m-equity", d.equity != null ? fmt(d.equity) + " (" + d.equityPct + "%)" : null);
    cell("#m-rent", d.rentEstimate ? fmt(d.rentEstimate) + "/mo" : null);
    cell("#m-posted", d.postedDate
      ? new Date(d.postedDate + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : null);
    cell("#m-auction", d.auctionDate
      ? new Date(d.auctionDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" }) + " (closes 6pm)"
      : null);

    var cb = m.querySelector("#m-condition");
    if (d.condition) {
      cb.className = "m-cond " + d.condition.cls;
      cb.innerHTML = '<div class="m-cond-head"><span class="dot"></span><b>' + esc(d.condition.label) + '</b>' +
        '<span class="m-cond-pct">' + d.condition.damage + ' damage / rehab</span></div>' +
        '<div class="track"><div class="fill" style="width:' + d.condition.pct + '%"></div></div>' +
        '<p class="m-cond-note">Estimated from ' + d.photoCount + ' listing photo' + (d.photoCount === 1 ? "" : "s") +
        ' by AI. Always verify in person before bidding.</p>';
    } else {
      cb.className = "m-cond unassessed";
      cb.innerHTML = '<div class="m-cond-head"><span class="dot"></span><b>Condition not yet assessed</b></div>' +
        '<p class="m-cond-note">Check the listing photos on the source page.</p>';
    }

    var saveBtn = m.querySelector("#m-save");
    saveBtn.textContent = SAVED[id] ? "♥ Saved" : "♡ Save this home";
    saveBtn.className = "btn " + (SAVED[id] ? "btn-primary" : "btn-ghost");
    saveBtn.onclick = function () { toggleSave(id); openModal(id); };
    var notifyBtn = m.querySelector("#m-notify");
    notifyBtn.textContent = NOTIFY[id] ? "🔔 Alert on" : "🔕 Alert me when it ends";
    notifyBtn.className = "btn " + (NOTIFY[id] ? "btn-primary" : "btn-ghost");
    notifyBtn.onclick = function () { toggleNotify(id); openModal(id); };

    // "Before you bid" — lookup links tailored to this property's city/state.
    fillDueDiligence(d);

    var link = m.querySelector("#m-link");
    if (d.url) { link.href = d.url; link.style.display = ""; } else { link.style.display = "none"; }

    $("modal-back").classList.add("open");
    document.body.style.overflow = "hidden";
  }
  function closeModal() { $("modal-back").classList.remove("open"); document.body.style.overflow = ""; }

  /* ---------------- "before you bid" lookup links ---------------- */
  function fillDueDiligence(d) {
    var place = [d.city, d.state].filter(Boolean).join(", ");
    var pn = $("dd-place"); if (pn) pn.textContent = place || "this property";
    var g = function (q) { return "https://www.google.com/search?q=" + encodeURIComponent(q); };
    var addr = streetOf(d.address) + " " + place;
    var links = [
      { t: "🏛️ County property tax & liens", q: (d.city || "") + " " + (d.state || "") + " county treasurer property tax lookup" },
      { t: "🚧 City code violations", q: (d.city || "") + " " + (d.state || "") + " code enforcement violations lookup" },
      { t: "📜 Deed & title history", q: (d.city || "") + " " + (d.state || "") + " county recorder deed search " + (d.zip || "") },
      { t: "🏠 What it's worth (comps)", q: addr + " home value zillow" },
    ];
    var host = $("m-dd-links"); if (!host) return;
    host.innerHTML = links.map(function (l) {
      return '<a class="dd-link" href="' + g(l.q) + '" target="_blank" rel="noopener">' + l.t + '<span class="a">↗</span></a>';
    }).join("");
    var dd = $("m-dd"); if (dd) dd.open = false; // collapsed by default each open
  }

  /* ---------------- tile artwork (modal header) ---------------- */
  var PALETTES = { "Single Family": ["#1f6f54", "#123f30"], "Multi-Family": ["#3a4a63", "#1c2636"], "Townhouse": ["#5a4a2c", "#2c2415"], "Condo": ["#2c4a5a", "#152a33"], "Land": ["#4a5a2c", "#232c15"] };
  function artFor(l) {
    var pal = PALETTES[l.type] || PALETTES["Single Family"];
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + pal[0] + '"/><stop offset="1" stop-color="' + pal[1] + '"/></linearGradient></defs>' +
      '<rect width="600" height="240" fill="url(#g)"/>' +
      '<g fill="rgba(255,255,255,.16)"><path d="M300 70 L200 150 H240 V210 H360 V150 H400 Z"/></g>' +
      '<text x="24" y="220" fill="rgba(255,255,255,.6)" font-family="Arial" font-size="15" font-weight="700">' + esc((l.city || "") + (l.state ? ", " + l.state : "")) + '</text></svg>';
    return "url('data:image/svg+xml;utf8," + encodeURIComponent(svg) + "')";
  }

  /* ---------------- wiring ---------------- */
  function setArea(a) {
    state.area = a; state.savedOnly = false;
    document.querySelectorAll("#area-chips .chip2").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-area") === a); });
    $("saved-toggle").classList.remove("active");
    render();
  }
  function setPrice(max) {
    state.maxPrice = max;
    document.querySelectorAll("#price-chips .chip2").forEach(function (b) { b.classList.toggle("active", +b.getAttribute("data-max") === max); });
    render();
  }
  function setHotspots(on) {
    state.hotspots = on;
    var b = $("hot-btn"); if (b) b.classList.toggle("active", on);
    if (on) { state.savedOnly = false; $("saved-toggle").classList.remove("active"); }
    render();
  }

  function build() {
    var q = $("f-q");
    q.addEventListener("input", function (e) {
      state.q = e.target.value.trim().toLowerCase();
      $("f-clear").hidden = !state.q;
      // Any ZIP in the box (a bare ZIP or a full pasted address) = "measure from here".
      if (/\b\d{5}\b/.test(state.q)) { $("f-sort").value = "near"; state.sort = "near"; if (!ZIP_GEO) { loadZipGeo().then(render); } }
      render();
    });
    $("f-clear").addEventListener("click", function () { q.value = ""; state.q = ""; $("f-clear").hidden = true; render(); q.focus(); });

    document.querySelectorAll("#area-chips .chip2").forEach(function (b) { b.addEventListener("click", function () { setArea(b.getAttribute("data-area")); }); });
    document.querySelectorAll("#price-chips .chip2").forEach(function (b) { b.addEventListener("click", function () { setPrice(+b.getAttribute("data-max")); }); });
    var hb = $("hot-btn"); if (hb) hb.addEventListener("click", function () { setHotspots(!state.hotspots); });
    $("f-beds").addEventListener("change", function (e) { state.minBeds = +e.target.value; render(); });
    $("f-baths").addEventListener("change", function (e) { state.minBaths = +e.target.value; render(); });
    $("f-sort").addEventListener("change", function (e) { state.sort = e.target.value; render(); });

    var st = $("saved-toggle");
    st.addEventListener("click", function () { state.savedOnly = !state.savedOnly; st.classList.toggle("active", state.savedOnly); render(); });

    updateSavedBadge();
    render();
    startTicker();
  }

  /* ---------------- boot ---------------- */
  document.addEventListener("DOMContentLoaded", function () {
    loadData().then(function (rows) { DATA = rows; build(); });
    $("modal-close").addEventListener("click", closeModal);
    $("modal-back").addEventListener("click", function (e) { if (e.target === $("modal-back")) closeModal(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });
  });
})();
