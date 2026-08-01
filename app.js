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
  function zipOf(addr) { var m = String(addr || "").match(/\b(\d{5})(?:-\d{4})?\b/); return m ? m[1] : ""; }

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
  var state = {
    q: "", state: "ALL", source: "ALL", type: "ALL",
    maxPrice: 250000, minEquityPct: 0, sort: "equity", savedOnly: false,
  };

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

    document.querySelectorAll("[data-state]").forEach(function (c) {
      c.addEventListener("click", function () {
        document.querySelectorAll("[data-state]").forEach(function (x) { x.classList.remove("active"); });
        c.classList.add("active"); state.state = c.getAttribute("data-state"); render();
      });
    });
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
    state = { q: "", state: "ALL", source: "ALL", type: "ALL", maxPrice: 250000, minEquityPct: 0, sort: "equity", savedOnly: false };
    $("f-q").value = ""; $("f-source").value = "ALL";
    $("f-price").value = 250000; $("f-price-val").textContent = fmtK(250000);
    $("f-equity").value = 0; $("f-equity-val").textContent = "0%";
    $("f-sort").value = "equity";
    var st = $("saved-tab"); if (st) st.classList.remove("active");
    document.querySelectorAll("[data-state],[data-type]").forEach(function (x) {
      x.classList.toggle("active", x.getAttribute("data-state") === "ALL" || x.getAttribute("data-type") === "ALL");
    });
    render();
  }

  function apply() {
    return DATA.filter(function (d) {
      if (state.savedOnly && !SAVED[d.id]) return false;
      if (state.state !== "ALL" && d.state !== state.state) return false;
      if (state.source !== "ALL" && d.source !== state.source) return false;
      if (state.type !== "ALL" && d.type !== state.type) return false;
      if (d.price != null && d.price > state.maxPrice) return false;
      if (state.minEquityPct && (d.equityPct == null || d.equityPct < state.minEquityPct)) return false;
      if (state.q) {
        var hay = (d.address + " " + d.city + " " + d.state + " " + d.zip + " " + d.metro + " " + d.source + " " + d.type).toLowerCase();
        if (hay.indexOf(state.q) === -1) return false;
      }
      return true;
    }).sort(function (a, b) {
      var ap = a.price, bp = b.price, ae = a.equity, be = b.equity;
      switch (state.sort) {
        case "price-asc": return (ap == null ? Infinity : ap) - (bp == null ? Infinity : bp);
        case "price-desc": return (bp == null ? -Infinity : bp) - (ap == null ? -Infinity : ap);
        case "yield": return (b.grossYield || 0) - (a.grossYield || 0);
        case "ending": return (new Date(a.deadline || "2999-01-01")) - (new Date(b.deadline || "2999-01-01"));
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
      host.innerHTML = state.savedOnly
        ? '<div class="empty"><strong>No saved deals yet.</strong><br>Tap the ♥ on any listing to save it here.</div>'
        : '<div class="empty"><strong>No deals match yet.</strong><br>Try widening your price range or clearing a filter.</div>';
      return;
    }
    host.innerHTML = rows.map(cardHTML).join("");

    // wire per-card controls + register tickers
    host.querySelectorAll(".card").forEach(function (el) {
      var id = el.getAttribute("data-id");
      el.querySelector("[data-open]").addEventListener("click", function () { openModal(id); });
      var sv = el.querySelector("[data-save]"); if (sv) sv.addEventListener("click", function (e) { e.stopPropagation(); toggleSave(id); });
      var cd = el.querySelector(".countdown");
      var d = rows.find(function (r) { return r.id === id; });
      if (cd && d) { TICKERS.push({ id: id, deadline: d.deadline, el: cd, fired: false }); var c = countdownText(d.deadline); cd.textContent = c.txt; cd.className = "countdown" + (c.urgent ? " urgent" : "") + (c.ended ? " ended" : ""); }
    });
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
    m.querySelector("#m-value").textContent = d.marketValue != null ? fmt(d.marketValue) : "—";
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
