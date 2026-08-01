/* ============================================================
   EquityScout — app logic
   ============================================================ */
(function () {
  "use strict";

  var DATA = [];
  var DATA_IS_LIVE = false;

  function enrich(l) {
    var hasMV = l.marketValue != null && l.marketValue > 0;
    var equity = hasMV ? Math.max(0, l.marketValue - (l.price || 0)) : null;
    var pct = (equity != null) ? Math.round((equity / l.marketValue) * 100) : null;
    var grossYield = (l.rentEstimate && l.price)
      ? +(((l.rentEstimate * 12) / l.price) * 100).toFixed(1)
      : 0;
    // keep precomputed values from the scraper if already present
    return Object.assign({ equity: equity, equityPct: pct, grossYield: grossYield }, l,
      (l.equity === undefined ? { equity: equity } : {}),
      (l.equityPct === undefined ? { equityPct: pct } : {}),
      (l.grossYield === undefined ? { grossYield: grossYield } : {}));
  }

  // Try the live scraper output first; fall back to the curated sample set.
  function loadData() {
    return fetch("listings.json", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && j.listings && j.listings.length) {
          DATA_IS_LIVE = true;
          return j.listings.map(enrich);
        }
        return (window.LISTINGS || []).map(enrich);
      })
      .catch(function () { return (window.LISTINGS || []).map(enrich); });
  }

  var fmt = function (n) {
    return "$" + (n || 0).toLocaleString("en-US");
  };
  var fmtK = function (n) {
    if (n >= 1000000) return "$" + (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1000) return "$" + Math.round(n / 1000) + "K";
    return "$" + n;
  };

  /* ---- placeholder house artwork (self-contained SVG data URI) ---- */
  var PALETTES = {
    "Single Family": ["#1f6f54", "#123f30"],
    "Multi-Family": ["#3a4a63", "#1c2636"],
    "Townhouse":   ["#5a4a2c", "#2c2415"],
    "Condo":       ["#2c4a5a", "#152a33"],
    "Land":        ["#4a5a2c", "#232c15"],
  };
  function artFor(l) {
    var pal = PALETTES[l.type] || PALETTES["Single Family"];
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="320">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + pal[0] + '"/>' +
      '<stop offset="1" stop-color="' + pal[1] + '"/></linearGradient></defs>' +
      '<rect width="600" height="320" fill="url(#g)"/>' +
      housePath(l.type) +
      '<text x="24" y="298" fill="rgba(255,255,255,.55)" font-family="Arial" font-size="15" font-weight="700">' +
      esc(l.city) + ", " + l.state + "</text>" +
      "</svg>";
    return "url('data:image/svg+xml;utf8," + encodeURIComponent(svg) + "')";
  }
  function housePath(type) {
    if (type === "Land") {
      return '<g fill="rgba(255,255,255,.16)"><path d="M0 250 Q150 210 300 240 T600 235 V320 H0 Z"/>' +
        '<rect x="470" y="150" width="8" height="80"/><path d="M474 150 l40 22 -40 12 z" fill="rgba(255,255,255,.22)"/></g>';
    }
    if (type === "Multi-Family") {
      return '<g fill="rgba(255,255,255,.16)"><rect x="220" y="120" width="70" height="120"/>' +
        '<rect x="300" y="95" width="80" height="145"/><rect x="390" y="130" width="65" height="110"/>' +
        '<g fill="rgba(0,0,0,.18)"><rect x="232" y="140" width="18" height="20"/><rect x="262" y="140" width="18" height="20"/>' +
        '<rect x="316" y="118" width="20" height="22"/><rect x="348" y="118" width="20" height="22"/>' +
        '<rect x="316" y="160" width="20" height="22"/><rect x="348" y="160" width="20" height="22"/></g></g>';
    }
    // generic single-family / townhouse / condo silhouette
    return '<g fill="rgba(255,255,255,.16)"><path d="M300 105 L200 185 H240 V245 H360 V185 H400 Z"/>' +
      '<g fill="rgba(0,0,0,.2)"><rect x="285" y="200" width="30" height="45"/>' +
      '<rect x="255" y="195" width="22" height="22"/><rect x="323" y="195" width="22" height="22"/></g></g>';
  }
  function esc(s) { return String(s).replace(/[<>&]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]; }); }

  /* ---------------- filter state ---------------- */
  var state = {
    q: "", state: "ALL", source: "ALL", type: "ALL",
    maxPrice: 250000, minEquityPct: 0, sort: "equity",
  };

  var els = {};
  function $(id) { return document.getElementById(id); }

  function build() {
    // populate dynamic selects
    var sources = uniq(DATA.map(function (d) { return d.source; })).sort();
    fillSelect($("f-source"), sources, "All sources");
    var types = uniq(DATA.map(function (d) { return d.type; })).sort();
    // type is chips, handled in markup

    // events
    $("f-q").addEventListener("input", function (e) { state.q = e.target.value.trim().toLowerCase(); render(); });
    $("f-source").addEventListener("change", function (e) { state.source = e.target.value; render(); });
    $("f-price").addEventListener("input", function (e) {
      state.maxPrice = +e.target.value; $("f-price-val").textContent = fmtK(state.maxPrice); render();
    });
    $("f-equity").addEventListener("input", function (e) {
      state.minEquityPct = +e.target.value; $("f-equity-val").textContent = state.minEquityPct + "%"; render();
    });
    $("f-sort").addEventListener("change", function (e) { state.sort = e.target.value; render(); });

    // state chips
    document.querySelectorAll("[data-state]").forEach(function (c) {
      c.addEventListener("click", function () {
        document.querySelectorAll("[data-state]").forEach(function (x) { x.classList.remove("active"); });
        c.classList.add("active"); state.state = c.getAttribute("data-state"); render();
      });
    });
    // type chips
    document.querySelectorAll("[data-type]").forEach(function (c) {
      c.addEventListener("click", function () {
        document.querySelectorAll("[data-type]").forEach(function (x) { x.classList.remove("active"); });
        c.classList.add("active"); state.type = c.getAttribute("data-type"); render();
      });
    });

    $("f-reset").addEventListener("click", resetFilters);

    // hero stats
    renderHeroStats();
    render();
  }

  function resetFilters() {
    state = { q: "", state: "ALL", source: "ALL", type: "ALL", maxPrice: 250000, minEquityPct: 0, sort: "equity" };
    $("f-q").value = "";
    $("f-source").value = "ALL";
    $("f-price").value = 250000; $("f-price-val").textContent = fmtK(250000);
    $("f-equity").value = 0; $("f-equity-val").textContent = "0%";
    $("f-sort").value = "equity";
    document.querySelectorAll("[data-state],[data-type]").forEach(function (x) {
      x.classList.toggle("active", x.getAttribute("data-state") === "ALL" || x.getAttribute("data-type") === "ALL");
    });
    render();
  }

  function apply() {
    return DATA.filter(function (d) {
      if (state.state !== "ALL" && d.state !== state.state) return false;
      if (state.source !== "ALL" && d.source !== state.source) return false;
      if (state.type !== "ALL" && d.type !== state.type) return false;
      if (d.price > state.maxPrice) return false;
      if (d.equityPct < state.minEquityPct) return false;
      if (state.q) {
        var hay = (d.address + " " + d.city + " " + d.state + " " + d.metro + " " + d.source + " " + d.type).toLowerCase();
        if (hay.indexOf(state.q) === -1) return false;
      }
      return true;
    }).sort(function (a, b) {
      var ap = a.price, bp = b.price, ae = a.equity, be = b.equity;
      switch (state.sort) {
        case "price-asc": return (ap == null ? Infinity : ap) - (bp == null ? Infinity : bp);
        case "price-desc": return (bp == null ? -Infinity : bp) - (ap == null ? -Infinity : ap);
        case "yield": return (b.grossYield || 0) - (a.grossYield || 0);
        case "auction":
          return (new Date(a.auctionDate || "2999-01-01")) - (new Date(b.auctionDate || "2999-01-01"));
        default: return (be == null ? -1 : be) - (ae == null ? -1 : ae); // equity
      }
    });
  }

  function render() {
    var rows = apply();
    var host = $("cards");
    var note = DATA_IS_LIVE
      ? ' <span class="src-note live">● live data</span>'
      : ' <span class="src-note">● sample data</span>';
    $("result-count").innerHTML = "<b>" + rows.length + "</b> deal" + (rows.length === 1 ? "" : "s") + " match your filters" + note;
    if (!rows.length) {
      host.innerHTML = '<div class="empty"><strong>No deals match yet.</strong><br>Try widening your price range or clearing a filter.</div>';
      return;
    }
    host.innerHTML = rows.map(cardHTML).join("");
    host.querySelectorAll("[data-open]").forEach(function (el) {
      el.addEventListener("click", function () { openModal(el.getAttribute("data-open")); });
    });
  }

  function cardHTML(d) {
    var beds = d.type === "Land"
      ? (d.lotAcres ? d.lotAcres + " ac lot" : "Land parcel")
      : (d.beds || d.baths || d.sqft)
        ? d.beds + " bd · " + d.baths + " ba · " + (d.sqft ? d.sqft.toLocaleString() + " sqft" : "—")
        : "Details at source";
    var hasEq = d.equityPct != null;
    var locBits = [d.city, d.state].filter(Boolean).join(", ") + (d.metro ? " · " + d.metro + " metro" : "");
    return '' +
      '<article class="card" data-open="' + d.id + '">' +
        '<div class="media" style="background-image:' + artFor(d) + '">' +
          '<span class="badge src">' + esc(d.source) + '</span>' +
          (hasEq ? '<span class="badge equity">' + d.equityPct + '% equity</span>' : '') +
        '</div>' +
        '<div class="body">' +
          '<div class="price-row">' +
            '<div class="price">' + (d.price != null ? fmt(d.price) : 'See source') + '</div>' +
            '<div class="mv">Est. value<br><b>' + (d.marketValue != null ? fmt(d.marketValue) : '—') + '</b></div>' +
          '</div>' +
          '<div>' +
            '<div class="addr">' + esc(streetOf(d.address) || d.source) + '</div>' +
            '<div class="loc">' + esc(locBits || "Location at source") + '</div>' +
          '</div>' +
          '<div class="meta">' +
            '<span>🏠 ' + esc(d.type) + '</span>' +
            '<span>📐 ' + esc(beds) + '</span>' +
            (d.rentEstimate ? '<span>💵 ' + fmt(d.rentEstimate) + '/mo rent</span>' : '') +
          '</div>' +
          (hasEq
            ? '<div class="equity-bar">' +
                '<div class="track"><div class="fill" style="width:' + Math.min(100, d.equityPct) + '%"></div></div>' +
                '<div class="cap"><span>Built-in equity</span><b>' + fmt(d.equity) + '</b></div>' +
              '</div>'
            : '') +
          '<div class="foot">' +
            '<span class="auc">Auction <b>' + (d.auctionDate ? fmtDate(d.auctionDate) : 'TBD') + '</b></span>' +
            '<span class="view">View deal →</span>' +
          '</div>' +
        '</div>' +
      '</article>';
  }

  function streetOf(addr) { return addr.split(",")[0]; }
  function fmtDate(s) {
    var d = new Date(s + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  /* ---------------- modal ---------------- */
  function openModal(id) {
    var d = DATA.find(function (x) { return x.id === id; });
    if (!d) return;
    var m = $("modal");
    m.querySelector(".m-media").style.backgroundImage = artFor(d);
    m.querySelector("#m-title").textContent = streetOf(d.address) || d.source;
    m.querySelector("#m-sub").textContent =
      ([d.city, d.state].filter(Boolean).join(", ") + (d.metro ? " · " + d.metro + " metro" : "")) || "Location at source";
    m.querySelector("#m-source").textContent = d.source;
    m.querySelector("#m-type").textContent = d.type + (d.year ? " · built " + d.year : "");
    m.querySelector("#m-price").textContent = d.price != null ? fmt(d.price) : "See source";
    m.querySelector("#m-value").textContent = d.marketValue != null ? fmt(d.marketValue) : "—";
    m.querySelector("#m-equity").textContent = d.equity != null ? fmt(d.equity) + " (" + d.equityPct + "%)" : "—";
    m.querySelector("#m-rent").textContent = d.rentEstimate ? fmt(d.rentEstimate) + "/mo" : "—";
    m.querySelector("#m-yield").textContent = d.grossYield ? d.grossYield + "% gross" : "—";
    m.querySelector("#m-auction").textContent = d.auctionDate
      ? new Date(d.auctionDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" })
      : "TBD — see source";
    var link = m.querySelector("#m-link");
    if (link) { if (d.url) { link.href = d.url; link.style.display = ""; } else { link.style.display = "none"; } }
    $("modal-back").classList.add("open");
    document.body.style.overflow = "hidden";
  }
  function closeModal() {
    $("modal-back").classList.remove("open");
    document.body.style.overflow = "";
  }

  /* ---------------- hero stats ---------------- */
  function renderHeroStats() {
    var withEq = DATA.filter(function (d) { return d.equity != null; });
    var withPrice = DATA.filter(function (d) { return d.price != null; });
    var totalEquity = withEq.reduce(function (s, d) { return s + d.equity; }, 0);
    var avgPct = withEq.length
      ? Math.round(withEq.reduce(function (s, d) { return s + d.equityPct; }, 0) / withEq.length) : 0;
    var cheapest = withPrice.length
      ? withPrice.reduce(function (m, d) { return Math.min(m, d.price); }, Infinity) : 0;
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

  /* ---------------- wire up ---------------- */
  document.addEventListener("DOMContentLoaded", function () {
    loadData().then(function (rows) {
      DATA = rows;
      build();
    });
    $("modal-close").addEventListener("click", closeModal);
    $("modal-back").addEventListener("click", function (e) { if (e.target === $("modal-back")) closeModal(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });

    // mobile nav
    var toggle = $("nav-toggle"), links = $("nav-links");
    if (toggle) toggle.addEventListener("click", function () { links.classList.toggle("open"); });
    links.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () { links.classList.remove("open"); });
    });
  });
})();
