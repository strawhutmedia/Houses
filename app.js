/* ============================================================
   EquityScout — app logic
   ============================================================ */
(function () {
  "use strict";

  var DATA = [];
  var DATA_IS_LIVE = false;
  var SAVED = loadSaved();          // { id: true }
  var NOTIFY = loadNotify();        // { id: true } -> alert when timer hits 0
  var TICKERS = [];                 // countdown DOM refs

  /* ---------------- derived-field helpers ---------------- */
  function hashStr(s) {
    var h = 0, i;
    s = String(s || "");
    for (i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
    return Math.abs(h);
  }
  var CONDITIONS = [
    { label: "Move-in Ready", damage: "Minimal", pct: 8, cls: "good" },
    { label: "Light Rehab", damage: "Cosmetic", pct: 28, cls: "ok" },
    { label: "Moderate Rehab", damage: "Moderate", pct: 52, cls: "warn" },
    { label: "Heavy Rehab", damage: "Significant", pct: 78, cls: "bad" },
  ];
  // US addresses put the ZIP last, but street numbers can also be 5 digits
  // (e.g. "12345 Sunset Blvd, Los Angeles, CA 90026"). Take the LAST 5-digit
  // group so we read the ZIP, not the house number.
  function zipOf(addr) { var all = String(addr || "").match(/\b\d{5}\b/g); return all && all.length ? all[all.length - 1] : ""; }

  function enrich(l) {
    var hasMV = l.marketValue != null && l.marketValue > 0;
    var equity = hasMV ? Math.max(0, l.marketValue - (l.price || 0)) : null;
    var pct = (equity != null) ? Math.round((equity / l.marketValue) * 100) : null;
    var grossYield = (l.rentEstimate && l.price)
      ? +(((l.rentEstimate * 12) / l.price) * 100).toFixed(1) : 0;
    var isSample = l.live === false;

    // "when it was put up" — real field if present, else derived for the demo set
    var posted = l.postedDate || (isSample && l.auctionDate
      ? shiftDays(l.auctionDate, -(10 + (hashStr(l.id) % 35))) : null);

    // condition / damage — real (vision-assessed) if present, else demo for samples
    var condition = l.condition || (isSample ? CONDITIONS[hashStr(l.id) % CONDITIONS.length] : null);
    var photoCount = (l.photoCount != null) ? l.photoCount : (isSample ? (hashStr(l.id + "p") % 7) + 2 : 0);

    var out = Object.assign({}, l, {
      equity: (l.equity !== undefined ? l.equity : equity),
      equityPct: (l.equityPct !== undefined ? l.equityPct : pct),
      grossYield: (l.grossYield !== undefined ? l.grossYield : grossYield),
      zip: zipOf(l.address),
      postedDate: posted,
      condition: condition,
      photoCount: photoCount,
      deadline: l.auctionDate ? l.auctionDate + "T18:00:00" : null,
    });
    return out;
  }
  function shiftDays(iso, days) {
    var d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  /* ---------------- data load ---------------- */
  function sampleRows() {
    return (window.LISTINGS || []).map(function (l) { return enrich(Object.assign({}, l, { live: false })); });
  }
  function loadData() {
    return fetch("listings.json", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && j.listings && j.listings.length) { DATA_IS_LIVE = true; return j.listings.map(enrich); }
        return sampleRows();
      })
      .catch(function () { return sampleRows(); });
  }

  /* ---------------- formatting ---------------- */
  var fmt = function (n) { return "$" + (n || 0).toLocaleString("en-US"); };
  var fmtK = function (n) {
    if (n >= 1000000) return "$" + (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1000) return "$" + Math.round(n / 1000) + "K";
    return "$" + n;
  };
  function fmtDate(s) { return new Date(s + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
  function esc(s) { return String(s).replace(/[<>&"]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]; }); }
  function streetOf(addr) { return String(addr || "").split(",")[0]; }

  /* ---------------- countdown ---------------- */
  function countdownText(deadlineISO) {
    if (!deadlineISO) return { txt: "TBD", urgent: false, ended: false };
    var ms = new Date(deadlineISO).getTime() - Date.now();
    if (ms <= 0) return { txt: "Auction ended", urgent: false, ended: true };
    var s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600),
      m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (d >= 1) return { txt: d + "d " + h + "h left", urgent: d < 2, ended: false };
    return { txt: h + "h " + pad(m) + "m " + pad(sec) + "s left", urgent: true, ended: false };
  }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  function startTicker() {
    if (startTicker._t) clearInterval(startTicker._t);
    startTicker._t = setInterval(function () {
      TICKERS.forEach(function (t) {
        var c = countdownText(t.deadline);
        if (t.el) { t.el.textContent = c.txt; t.el.className = "countdown" + (c.urgent ? " urgent" : "") + (c.ended ? " ended" : ""); }
        if (c.ended && !t.fired) {
          t.fired = true;
          if (NOTIFY[t.id]) fireNotification(t.id);
        }
      });
    }, 1000);
  }

  /* ---------------- saved / notify (localStorage) ---------------- */
  function loadSaved() { try { return JSON.parse(localStorage.getItem("es_saved") || "{}"); } catch (e) { return {}; } }
  function persistSaved() { try { localStorage.setItem("es_saved", JSON.stringify(SAVED)); } catch (e) {} }
  function loadNotify() { try { return JSON.parse(localStorage.getItem("es_notify") || "{}"); } catch (e) { return {}; } }
  function persistNotify() { try { localStorage.setItem("es_notify", JSON.stringify(NOTIFY)); } catch (e) {} }
  function savedCount() { return Object.keys(SAVED).filter(function (k) { return SAVED[k]; }).length; }

  function toggleSave(id) {
    SAVED[id] = !SAVED[id];
    if (!SAVED[id]) delete SAVED[id];
    persistSaved();
    updateSavedBadge();
    render();
  }
  function toggleNotify(id) {
    NOTIFY[id] = !NOTIFY[id];
    if (!NOTIFY[id]) { delete NOTIFY[id]; persistNotify(); render(); return; }
    persistNotify();
    if ("Notification" in window && Notification.permission !== "granted") {
      Notification.requestPermission();
    }
    render();
  }
  function fireNotification(id) {
    var d = DATA.find(function (x) { return x.id === id; });
    if (!d) return;
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("⏰ Auction ended: " + streetOf(d.address), {
        body: (d.city || "") + ", " + d.state + " · opened at " + (d.price != null ? fmt(d.price) : "see source"),
      });
    }
  }
  function updateSavedBadge() {
    var n = savedCount();
    var b = document.getElementById("saved-count");
    if (b) { b.textContent = n; b.style.display = n ? "" : "none"; }
  }

  /* ---------------- filter state ---------------- */
  // scope drives the big three-way switch: "focus" = LA + Portland metros,
  // "region" = all California + Oregon, "all" = every state. Defaults to the
  // two markets the buyer actually cares about.
  var state = {
    q: "", state: "ALL", source: "ALL", type: "ALL",
    maxPrice: 800000, minEquityPct: 0, sort: "ending", savedOnly: false, scope: "focus",
    view: "list",
  };

  // Which listings count as "Los Angeles + Portland". normalize.js tags these
  // metros for the right cities, so we just read d.metro.
  function inFocus(d) { return d.metro === "Los Angeles" || d.metro === "Portland"; }
  function inRegion(d) { return d.state === "CA" || d.state === "OR"; }

  function $(id) { return document.getElementById(id); }

  function build() {
    var sources = uniq(DATA.map(function (d) { return d.source; })).sort();
    fillSelect($("f-source"), sources, "All sources");

    $("f-q").addEventListener("input", function (e) { state.q = e.target.value.trim().toLowerCase(); render(); });
    $("f-source").addEventListener("change", function (e) { state.source = e.target.value; render(); });
    $("f-price").addEventListener("input", function (e) {
      state.maxPrice = +e.target.value; $("f-price-val").textContent = fmtK(state.maxPrice); render();
    });
    $("f-equity").addEventListener("input", function (e) {
      state.minEquityPct = +e.target.value; $("f-equity-val").textContent = state.minEquityPct + "%"; render();
    });
    $("f-sort").addEventListener("change", function (e) { state.sort = e.target.value; render(); });

    // List / Cards view toggle
    document.querySelectorAll("#view-wrap .view-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.view = btn.getAttribute("data-view");
        document.querySelectorAll("#view-wrap .view-btn").forEach(function (b) {
          b.classList.toggle("active", b.getAttribute("data-view") === state.view);
        });
        render();
      });
    });

    // Big three-way scope switch (LA+PDX / CA+OR / All USA)
    document.querySelectorAll("#scope-seg .scope-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { setScope(btn.getAttribute("data-scope")); });
    });
    updateScopeCounts();

    // State dropdown (populated from whatever states are in the live data).
    // Picking a specific state means "show me the whole country's states," so
    // widen the scope to All USA and let the dropdown do the narrowing.
    populateStates();
    $("f-state").addEventListener("change", function (e) {
      state.state = e.target.value;
      if (state.state !== "ALL") { state.scope = "all"; syncScope(); }
      syncMetroChips(); render();
    });
    populateMetroChips();
    document.querySelectorAll("[data-type]").forEach(function (c) {
      c.addEventListener("click", function () {
        document.querySelectorAll("[data-type]").forEach(function (x) { x.classList.remove("active"); });
        c.classList.add("active"); state.type = c.getAttribute("data-type"); render();
      });
    });
    $("f-reset").addEventListener("click", resetFilters);

    var savedTab = $("saved-tab");
    if (savedTab) savedTab.addEventListener("click", function (e) {
      e.preventDefault(); state.savedOnly = !state.savedOnly;
      savedTab.classList.toggle("active", state.savedOnly); render();
    });

    updateSavedBadge();
    renderHeroStats();
    render();
    startTicker();
  }

  function resetFilters() {
    state = { q: "", state: "ALL", source: "ALL", type: "ALL", maxPrice: 800000, minEquityPct: 0, sort: "ending", savedOnly: false, scope: "focus", view: state.view };
    $("f-q").value = ""; $("f-source").value = "ALL";
    $("f-price").value = 800000; $("f-price-val").textContent = fmtK(800000);
    $("f-equity").value = 0; $("f-equity-val").textContent = "0%";
    $("f-sort").value = "ending";
    var fs = $("f-state"); if (fs) fs.value = "ALL";
    syncScope(); syncMetroChips();
    var st = $("saved-tab"); if (st) st.classList.remove("active");
    document.querySelectorAll("[data-type]").forEach(function (x) {
      x.classList.toggle("active", x.getAttribute("data-type") === "ALL");
    });
    render();
  }

  // ZIP-aware search. A bare 5-digit query is treated as "near this ZIP":
  // exact ZIP first, then the same 3-digit ZIP region (roughly your metro area).
  var LAST_ZIP = null;      // the ZIP the user searched, if any
  var ZIP_EXACT = 0;        // how many exact-ZIP matches in the last apply()
  function zipMatch(d, zipQ) {
    var z = d.zip || zipOf(d.address);
    if (!z) return 0;
    if (z === zipQ) return 2;                     // exact ZIP
    if (z.slice(0, 3) === zipQ.slice(0, 3)) return 1; // same region (nearby)
    return 0;
  }

  function apply() {
    var zipQ = /^\d{5}$/.test(state.q) ? state.q : null;
    LAST_ZIP = zipQ; ZIP_EXACT = 0;
    var out = DATA.filter(function (d) {
      if (state.savedOnly && !SAVED[d.id]) return false;
      if (state.scope === "focus" && !inFocus(d)) return false;
      if (state.scope === "region" && !inRegion(d)) return false;
      if (state.state !== "ALL" && d.state !== state.state) return false;
      if (state.source !== "ALL" && d.source !== state.source) return false;
      if (state.type !== "ALL" && d.type !== state.type) return false;
      if (d.price != null && d.price > state.maxPrice) return false;
      if (state.minEquityPct && (d.equityPct == null || d.equityPct < state.minEquityPct)) return false;
      if (zipQ) {
        var m = zipMatch(d, zipQ);
        if (!m) return false;
        if (m === 2) ZIP_EXACT++;
      } else if (state.q) {
        var hay = (d.address + " " + d.city + " " + d.state + " " + d.zip + " " + d.metro + " " + d.source + " " + d.type).toLowerCase();
        if (hay.indexOf(state.q) === -1) return false;
      }
      return true;
    });
    return out.sort(function (a, b) {
      // When searching a ZIP, always float the nearest ones to the top.
      if (zipQ) {
        var za = +((a.zip || zipOf(a.address)) || 0), zb = +((b.zip || zipOf(b.address)) || 0);
        var da = Math.abs(za - +zipQ), db = Math.abs(zb - +zipQ);
        if (da !== db) return da - db;
      }
      var ap = a.price, bp = b.price, ae = a.equity, be = b.equity;
      switch (state.sort) {
        case "deal": {
          // Best deals: biggest built-in equity first; where equity is unknown
          // (most live rows), fall back to cheapest opening price.
          var ea = a.equityPct == null ? -1 : a.equityPct, eb = b.equityPct == null ? -1 : b.equityPct;
          if (eb !== ea) return eb - ea;
          return (ap == null ? Infinity : ap) - (bp == null ? Infinity : bp);
        }
        case "price-asc": return (ap == null ? Infinity : ap) - (bp == null ? Infinity : bp);
        case "price-desc": return (bp == null ? -Infinity : bp) - (ap == null ? -Infinity : ap);
        case "yield": return (b.grossYield || 0) - (a.grossYield || 0);
        case "ending": return (new Date(a.deadline || "2999-01-01")) - (new Date(b.deadline || "2999-01-01"));
        case "ending-late": return (new Date(b.deadline || "1970-01-01")) - (new Date(a.deadline || "1970-01-01"));
        case "city": {
          var ca = (a.city || "~") + a.state, cb = (b.city || "~") + b.state;
          if (ca !== cb) return ca.localeCompare(cb);
          return (new Date(a.deadline || "2999-01-01")) - (new Date(b.deadline || "2999-01-01"));
        }
        case "newest": return (new Date(b.postedDate || "1970-01-01")) - (new Date(a.postedDate || "1970-01-01"));
        default: return (be == null ? -1 : be) - (ae == null ? -1 : ae);
      }
    });
  }

  /* ---------------- artwork ---------------- */
  var PALETTES = {
    "Single Family": ["#1f6f54", "#123f30"], "Multi-Family": ["#3a4a63", "#1c2636"],
    "Townhouse": ["#5a4a2c", "#2c2415"], "Condo": ["#2c4a5a", "#152a33"],
    "Land": ["#4a5a2c", "#232c15"], "Commercial / Other": ["#4a3a5a", "#241533"],
  };
  function artFor(l) {
    var pal = PALETTES[l.type] || PALETTES["Single Family"];
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="320">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + pal[0] +
      '"/><stop offset="1" stop-color="' + pal[1] + '"/></linearGradient></defs>' +
      '<rect width="600" height="320" fill="url(#g)"/>' + housePath(l.type) +
      '<text x="24" y="298" fill="rgba(255,255,255,.55)" font-family="Arial" font-size="15" font-weight="700">' +
      esc((l.city || "") + (l.state ? ", " + l.state : "")) + "</text></svg>";
    return "url('data:image/svg+xml;utf8," + encodeURIComponent(svg) + "')";
  }
  function housePath(type) {
    if (type === "Land") return '<g fill="rgba(255,255,255,.16)"><path d="M0 250 Q150 210 300 240 T600 235 V320 H0 Z"/><rect x="470" y="150" width="8" height="80"/><path d="M474 150 l40 22 -40 12 z"/></g>';
    if (type === "Multi-Family") return '<g fill="rgba(255,255,255,.16)"><rect x="220" y="120" width="70" height="120"/><rect x="300" y="95" width="80" height="145"/><rect x="390" y="130" width="65" height="110"/></g>';
    return '<g fill="rgba(255,255,255,.16)"><path d="M300 105 L200 185 H240 V245 H360 V185 H400 Z"/><g fill="rgba(0,0,0,.2)"><rect x="285" y="200" width="30" height="45"/><rect x="255" y="195" width="22" height="22"/><rect x="323" y="195" width="22" height="22"/></g></g>';
  }

  /* ---------------- render ---------------- */
  function render() {
    var rows = apply();
    var host = $("cards");
    TICKERS = [];
    var note = DATA_IS_LIVE ? ' <span class="src-note live">● live data</span>' : ' <span class="src-note">● sample data</span>';
    var label = state.savedOnly ? "saved deal" : "deal";
    $("result-count").innerHTML = "<b>" + rows.length + "</b> " + label + (rows.length === 1 ? "" : "s") +
      (state.savedOnly ? "" : " match your filters") + note;

    if (!rows.length) {
      if (LAST_ZIP) {
        host.innerHTML = '<div class="empty"><strong>No government homes in or near ZIP ' + esc(LAST_ZIP) + ' right now.</strong>' +
          '<br>Cheap federal &amp; county homes are sparse — most ZIP codes have none on any given day, and they turn over every few hours. Try a wider area:' +
          '<div class="empty-actions">' +
            '<button class="btn btn-primary" data-clearq="1">Clear the ZIP &amp; show all homes</button>' +
            (state.scope !== "all" ? '<button class="btn btn-ghost" data-widen="all">Search all 50 states</button>' : '') +
          '</div></div>';
        wireWiden(host);
        var cq = host.querySelector("[data-clearq]");
        if (cq) cq.addEventListener("click", function () { state.q = ""; $("f-q").value = ""; render(); });
      } else if (state.savedOnly) {
        host.innerHTML = '<div class="empty"><strong>No saved deals yet.</strong><br>Tap the ♥ on any listing to save it here.</div>';
      } else if (state.scope === "focus") {
        host.innerHTML = '<div class="empty"><strong>No cheap government homes in the LA + Portland metros right now.</strong>' +
          '<br>Cheap federal/county homes in these two metros are scarce and come and go — new ones land every few hours. Widen the search:' +
          '<div class="empty-actions">' +
            '<button class="btn btn-primary" data-widen="region">See all California + Oregon</button>' +
            '<button class="btn btn-ghost" data-widen="all">See all 50 states</button>' +
          '</div></div>';
        wireWiden(host);
      } else {
        host.innerHTML = '<div class="empty"><strong>No deals match yet.</strong><br>Try widening your price range or clearing a filter.</div>';
      }
      return;
    }

    // ZIP search feedback: tell them plainly whether we found their exact ZIP
    // or broadened to the surrounding area.
    var thinNote = "";
    if (LAST_ZIP) {
      thinNote += ZIP_EXACT > 0
        ? '<div class="thin-note"><span><b>' + ZIP_EXACT + '</b> home' + (ZIP_EXACT === 1 ? "" : "s") +
          ' in ZIP <b>' + esc(LAST_ZIP) + '</b>, then the nearest around it.</span></div>'
        : '<div class="thin-note"><span>No homes in <b>' + esc(LAST_ZIP) + '</b> exactly — showing the <b>' +
          rows.length + '</b> nearest in the ' + esc(LAST_ZIP.slice(0, 3)) + 'xx area, closest first.</span></div>';
    }

    // Thin-inventory nudge: when the LA+Portland view has only a handful,
    // gently offer to widen without hiding the homes that ARE there.
    if (!LAST_ZIP && state.scope === "focus" && rows.length < 12) {
      thinNote = '<div class="thin-note"><span>Only <b>' + rows.length + '</b> cheap government home' + (rows.length === 1 ? "" : "s") +
        ' in the LA + Portland metros right now.</span>' +
        '<span class="thin-actions"><button class="btn btn-ghost btn-sm" data-widen="region">+ California &amp; Oregon</button>' +
        '<button class="btn btn-ghost btn-sm" data-widen="all">+ All 50 states</button></span></div>';
    }
    // Cap rendered rows for performance (esp. mobile); nationwide can be 900+.
    var CAP = state.view === "list" ? 200 : 90;
    var shown = rows.slice(0, CAP);
    var isList = state.view === "list";
    host.className = "cards " + (isList ? "list-view" : "cards-view");
    var moreNote = rows.length > CAP
      ? '<div class="empty" style="grid-column:1/-1;padding:24px;"><strong>Showing ' + CAP +
        ' of ' + rows.length + '.</strong><br>Pick a state, search a city or ZIP, or tighten the price to narrow it down.</div>'
      : "";
    var head = isList ? listHeadHTML() : "";
    var body = shown.map(isList ? listRowHTML : cardHTML).join("");
    host.innerHTML = thinNote + head + body + moreNote;
    rows = shown; // only wire the rows actually rendered
    wireWiden(host);

    // wire per-row controls + register tickers. The whole row/card is clickable
    // (simplest for a first-time user) — only the save heart swallows its click.
    host.querySelectorAll("[data-id]").forEach(function (el) {
      var id = el.getAttribute("data-id");
      el.addEventListener("click", function () { openModal(id); });
      var sv = el.querySelector("[data-save]"); if (sv) sv.addEventListener("click", function (e) { e.stopPropagation(); toggleSave(id); });
      var cd = el.querySelector(".countdown");
      var d = rows.find(function (r) { return r.id === id; });
      if (cd && d) { TICKERS.push({ id: id, deadline: d.deadline, el: cd, fired: false }); var c = countdownText(d.deadline); cd.textContent = c.txt; cd.className = "countdown" + (c.urgent ? " urgent" : "") + (c.ended ? " ended" : ""); }
    });
  }

  // Clean list row — the default view: closing time leads, then city, price,
  // the basics, and the source. Whole row opens the exact listing.
  function listHeadHTML() {
    return '<div class="lhead">' +
      '<span class="lh-close">Closes</span>' +
      '<span class="lh-loc">City</span>' +
      '<span class="lh-price">Opening price</span>' +
      '<span class="lh-meta">Home</span>' +
      '<span class="lh-src">Source</span>' +
      '<span class="lh-go"></span>' +
    '</div>';
  }
  function listRowHTML(d) {
    var loc = [d.city, d.state].filter(Boolean).join(", ") || "Location at source";
    var beds = d.type === "Land"
      ? (d.lotAcres ? d.lotAcres + " ac" : "Land")
      : (d.beds || d.baths)
        ? d.beds + "bd/" + d.baths + "ba" + (d.sqft ? " · " + d.sqft.toLocaleString() + "sf" : "")
        : "See source";
    var saved = !!SAVED[d.id];
    return '' +
      '<article class="lrow" data-id="' + esc(d.id) + '">' +
        '<span class="l-close"><span class="countdown">…</span>' +
          '<span class="l-date">' + (d.auctionDate ? fmtDate(d.auctionDate) : "date at source") + '</span></span>' +
        '<span class="l-loc"><b>' + esc(d.city || "—") + '</b><span class="l-st">' + esc(d.state || "") +
          (d.zip ? " " + esc(d.zip) : "") + '</span></span>' +
        '<span class="l-price">' + (d.price != null ? fmt(d.price) : "See source") + '</span>' +
        '<span class="l-meta">' + esc(d.type) + '<span class="l-bd">' + esc(beds) + '</span></span>' +
        '<span class="l-src">' + esc(d.source) + '</span>' +
        '<span class="l-go"><button class="save-btn' + (saved ? " on" : "") + '" data-save title="' +
          (saved ? "Saved" : "Save") + '">' + (saved ? "♥" : "♡") + '</button><span class="l-view">View →</span></span>' +
      '</article>';
  }

  function cardHTML(d) {
    var beds = d.type === "Land"
      ? (d.lotAcres ? d.lotAcres + " ac lot" : "Land parcel")
      : (d.beds || d.baths || d.sqft)
        ? d.beds + " bd · " + d.baths + " ba · " + (d.sqft ? d.sqft.toLocaleString() + " sqft" : "—")
        : "Details at source";
    var hasEq = d.equityPct != null;
    var loc = [d.city, d.state].filter(Boolean).join(", ") + (d.zip ? " " + d.zip : "");
    var saved = !!SAVED[d.id];
    var cond = d.condition;
    return '' +
      '<article class="card" data-id="' + esc(d.id) + '">' +
        '<div class="media" data-open style="background-image:' + artFor(d) + '">' +
          '<span class="badge src">' + esc(d.source) + '</span>' +
          (hasEq ? '<span class="badge equity">' + d.equityPct + '% equity</span>' : '') +
          '<button class="save-btn' + (saved ? " on" : "") + '" data-save title="' + (saved ? "Saved" : "Save") + '">' + (saved ? "♥" : "♡") + '</button>' +
        '</div>' +
        '<div class="body">' +
          '<div class="price-row">' +
            '<div class="price">' + (d.price != null ? fmt(d.price) : "See source") + '</div>' +
            '<div class="mv">Est. value<br><b>' + (d.marketValue != null ? fmt(d.marketValue) : "—") + '</b></div>' +
          '</div>' +
          '<div data-open>' +
            '<div class="addr">' + esc(streetOf(d.address) || d.source) + '</div>' +
            '<div class="loc">' + esc(loc || "Location at source") + (d.metro ? ' · ' + esc(d.metro) + ' metro' : '') + '</div>' +
          '</div>' +
          '<div class="meta" data-open>' +
            '<span>🏠 ' + esc(d.type) + '</span>' +
            '<span>📐 ' + esc(beds) + '</span>' +
          '</div>' +
          (cond ? '<div class="cond ' + cond.cls + '" data-open><span class="dot"></span>' + esc(cond.label) +
            ' <em>· ' + esc(cond.damage) + ' work</em><span class="phc">📷 ' + d.photoCount + '</span></div>'
            : '<div class="cond unassessed" data-open><span class="dot"></span>Condition not yet assessed</div>') +
          (hasEq ? '<div class="equity-bar" data-open><div class="track"><div class="fill" style="width:' + Math.min(100, d.equityPct) + '%"></div></div>' +
            '<div class="cap"><span>Built-in equity</span><b>' + fmt(d.equity) + '</b></div></div>' : '') +
          '<div class="dates" data-open>' +
            '<span class="posted">Listed ' + (d.postedDate ? fmtDate(d.postedDate) : "—") + '</span>' +
            '<span class="countdown">' + '…' + '</span>' +
          '</div>' +
        '</div>' +
      '</article>';
  }

  /* ---------------- modal ---------------- */
  function openModal(id) {
    var d = DATA.find(function (x) { return x.id === id; });
    if (!d) return;
    var m = $("modal");
    m.querySelector(".m-media").style.backgroundImage = artFor(d);
    m.querySelector("#m-title").textContent = streetOf(d.address) || d.source;
    m.querySelector("#m-sub").textContent =
      ([d.city, d.state, d.zip].filter(Boolean).join(" ")) + (d.metro ? " · " + d.metro + " metro" : "") || "Location at source";
    m.querySelector("#m-source").textContent = d.source;
    m.querySelector("#m-type").textContent = d.type +
      (d.year ? " · built " + d.year : "") +
      (d.type !== "Land" && (d.beds || d.baths || d.sqft) ? " · " + d.beds + " bd / " + d.baths + " ba / " + (d.sqft ? d.sqft.toLocaleString() + " sqft" : "—") : "");
    m.querySelector("#m-price").textContent = d.price != null ? fmt(d.price) : "See source";
    m.querySelector("#m-value").textContent = d.marketValue != null
      ? fmt(d.marketValue) + (d.valueBasis === "assessed" ? " (assessed est.)" : "") : "—";
    m.querySelector("#m-equity").textContent = d.equity != null ? fmt(d.equity) + " (" + d.equityPct + "%)" : "—";
    m.querySelector("#m-rent").textContent = d.rentEstimate ? fmt(d.rentEstimate) + "/mo" : "—";
    m.querySelector("#m-posted").textContent = d.postedDate
      ? new Date(d.postedDate + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "—";
    m.querySelector("#m-auction").textContent = d.auctionDate
      ? new Date(d.auctionDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" }) + " (closes 6pm)"
      : "TBD — see source";

    // condition block
    var cb = m.querySelector("#m-condition");
    if (d.condition) {
      cb.className = "m-cond " + d.condition.cls;
      cb.innerHTML = '<div class="m-cond-head"><span class="dot"></span><b>' + esc(d.condition.label) + '</b>' +
        '<span class="m-cond-pct">' + d.condition.damage + ' damage / rehab</span></div>' +
        '<div class="track"><div class="fill" style="width:' + d.condition.pct + '%"></div></div>' +
        '<p class="m-cond-note">Estimated from ' + d.photoCount + ' listing photo' + (d.photoCount === 1 ? "" : "s") +
        ' by AI vision analysis. Always verify condition in person before bidding.</p>';
    } else {
      cb.className = "m-cond unassessed";
      cb.innerHTML = '<div class="m-cond-head"><span class="dot"></span><b>Condition not yet assessed</b></div>' +
        '<p class="m-cond-note">No photos have been analyzed for this listing yet.</p>';
    }

    // save + notify controls
    var saveBtn = m.querySelector("#m-save");
    saveBtn.textContent = SAVED[id] ? "♥ Saved" : "♡ Save this deal";
    saveBtn.className = "btn " + (SAVED[id] ? "btn-primary" : "btn-ghost");
    saveBtn.onclick = function () { toggleSave(id); openModal(id); };
    var notifyBtn = m.querySelector("#m-notify");
    notifyBtn.textContent = NOTIFY[id] ? "🔔 Alert on" : "🔕 Alert me when it ends";
    notifyBtn.className = "btn " + (NOTIFY[id] ? "btn-primary" : "btn-ghost");
    notifyBtn.onclick = function () { toggleNotify(id); openModal(id); };

    var link = m.querySelector("#m-link");
    if (d.url) { link.href = d.url; link.style.display = ""; } else { link.style.display = "none"; }

    $("modal-back").classList.add("open");
    document.body.style.overflow = "hidden";
  }
  function closeModal() { $("modal-back").classList.remove("open"); document.body.style.overflow = ""; }

  /* ---------------- hero stats ---------------- */
  function renderHeroStats() {
    var withEq = DATA.filter(function (d) { return d.equity != null; });
    var withPrice = DATA.filter(function (d) { return d.price != null; });
    var totalEquity = withEq.reduce(function (s, d) { return s + d.equity; }, 0);
    var avgPct = withEq.length ? Math.round(withEq.reduce(function (s, d) { return s + d.equityPct; }, 0) / withEq.length) : 0;
    var cheapest = withPrice.length ? withPrice.reduce(function (m, d) { return Math.min(m, d.price); }, Infinity) : 0;
    $("stat-deals").textContent = DATA.length;
    $("stat-equity").textContent = totalEquity ? fmtK(totalEquity) : "—";
    $("stat-avg").textContent = avgPct ? avgPct + "%" : "—";
    $("stat-min").textContent = cheapest ? fmtK(cheapest) : "—";
  }

  /* ---------------- state / market filters ---------------- */
  var STATE_NAMES = {
    AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
    CT: "Connecticut", DE: "Delaware", DC: "Washington DC", FL: "Florida", GA: "Georgia", HI: "Hawaii",
    ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
    ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
    MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
    NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
    OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
    TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
    WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  };
  function stateCounts() {
    var c = {};
    DATA.forEach(function (d) { if (d.state) c[d.state] = (c[d.state] || 0) + 1; });
    return c;
  }
  function populateStates() {
    var c = stateCounts();
    var states = Object.keys(c).sort(function (a, b) {
      return (STATE_NAMES[a] || a).localeCompare(STATE_NAMES[b] || b);
    });
    var html = '<option value="ALL">All states (' + DATA.length + ')</option>';
    states.forEach(function (s) {
      html += '<option value="' + s + '">' + esc(STATE_NAMES[s] || s) + " (" + c[s] + ")</option>";
    });
    $("f-state").innerHTML = html;
  }
  /* ---------------- scope switch (LA+PDX / CA+OR / All USA) ---------------- */
  function scopeCounts() {
    var f = 0, r = 0;
    DATA.forEach(function (d) { if (inFocus(d)) f++; if (inRegion(d)) r++; });
    return { focus: f, region: r, all: DATA.length };
  }
  function updateScopeCounts() {
    var c = scopeCounts();
    var set = function (id, n) { var el = $(id); if (el) el.textContent = n + " home" + (n === 1 ? "" : "s"); };
    set("scope-c-focus", c.focus); set("scope-c-region", c.region); set("scope-c-all", c.all);
  }
  function setScope(sc) {
    state.scope = sc;
    // A scope pick is the primary, simple control — clear the fiddly filters so
    // the buyer always sees a full, un-narrowed view of the market they chose.
    state.state = "ALL"; var fs = $("f-state"); if (fs) fs.value = "ALL";
    state.savedOnly = false; var st = $("saved-tab"); if (st) st.classList.remove("active");
    syncScope(); syncMetroChips(); render();
  }
  function syncScope() {
    document.querySelectorAll("#scope-seg .scope-btn").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-scope") === state.scope);
    });
  }
  // "Widen the search" buttons in the empty / thin-inventory notices.
  function wireWiden(host) {
    host.querySelectorAll("[data-widen]").forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation(); setScope(b.getAttribute("data-widen"));
        var deals = document.getElementById("deals"); if (deals) deals.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  // Quick-market chips = the states with the most deals (handy shortcuts under
  // the "All USA" scope). Tapping one widens scope to All USA + filters to it.
  function populateMetroChips() {
    var c = stateCounts();
    var top = Object.keys(c).sort(function (a, b) { return c[b] - c[a]; }).slice(0, 6);
    var host = $("metro-chips");
    if (!host) return;
    host.innerHTML = top.map(function (s) {
      return '<span class="chip" data-qstate="' + s + '">' + esc(STATE_NAMES[s] || s) + "</span>";
    }).join("");
    host.querySelectorAll("[data-qstate]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        state.scope = "all"; state.state = chip.getAttribute("data-qstate");
        $("f-state").value = state.state; syncScope(); syncMetroChips(); render();
      });
    });
  }
  function syncMetroChips() {
    document.querySelectorAll("#metro-chips [data-qstate]").forEach(function (chip) {
      chip.classList.toggle("active", state.scope === "all" && chip.getAttribute("data-qstate") === state.state);
    });
  }

  /* ---------------- helpers ---------------- */
  function uniq(a) { return a.filter(function (v, i) { return a.indexOf(v) === i; }); }
  function fillSelect(sel, items, allLabel) {
    var html = '<option value="ALL">' + allLabel + "</option>";
    items.forEach(function (it) { html += '<option value="' + esc(it) + '">' + esc(it) + "</option>"; });
    sel.innerHTML = html;
  }

  /* ---------------- boot ---------------- */
  document.addEventListener("DOMContentLoaded", function () {
    loadData().then(function (rows) { DATA = rows; build(); });
    $("modal-close").addEventListener("click", closeModal);
    $("modal-back").addEventListener("click", function (e) { if (e.target === $("modal-back")) closeModal(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });

    var toggle = $("nav-toggle"), links = $("nav-links");
    if (toggle) toggle.addEventListener("click", function () { links.classList.toggle("open"); });
    links.querySelectorAll("a").forEach(function (a) { a.addEventListener("click", function () { links.classList.remove("open"); }); });
  });
})();
