/* ============================================================
   EquityScout — Studio / commercial spaces (LA lease feed)
   ============================================================ */
(function () {
  "use strict";

  var DATA = [];
  var YOUR_RENT = 3400;                 // what the user pays now, for savings math
  // Reference point: the user's current studio — 7201 Melrose Ave (Melrose & Formosa).
  var STUDIO = { lat: 34.0838, lng: 118.3455 };
  // Neighborhoods the user actually wants to be in — one-tap area filters.
  var TARGETS = {
    "Burbank": [34.1808, 118.3090],
    "Los Feliz": [34.1063, 118.2854],
    "Silver Lake": [34.0869, 118.2702],
    "East Hollywood": [34.0900, 118.2951],
  };
  var AREA_RADIUS = 3.0;   // miles — "in this area"
  var REF_NAME = "your studio";

  // A few LA neighborhoods to label listings by nearest.
  var HOODS = [
    ["West Hollywood",34.090,118.361],["Hollywood",34.098,118.329],["Los Feliz",34.106,118.286],
    ["Silver Lake",34.087,118.270],["Echo Park",34.078,118.260],["Downtown LA",34.045,118.251],
    ["Koreatown",34.058,118.300],["Mid-Wilshire",34.062,118.339],["Beverly Hills",34.073,118.400],
    ["Century City",34.058,118.417],["Culver City",34.021,118.397],["Santa Monica",34.019,118.491],
    ["Venice",33.990,118.463],["Marina del Rey",33.980,118.451],["Westwood",34.063,118.447],
    ["Brentwood",34.052,118.474],["West LA",34.039,118.429],["Mar Vista",34.000,118.430],
    ["Sherman Oaks",34.151,118.449],["Studio City",34.139,118.386],["North Hollywood",34.172,118.378],
    ["Burbank",34.181,118.309],["Glendale",34.142,118.255],["Pasadena",34.147,118.144],
    ["Highland Park",34.116,118.192],["Eagle Rock",34.139,118.211],["Atwater Village",34.117,118.262],
    ["Boyle Heights",34.033,118.210],["Inglewood",33.961,118.353],["El Segundo",33.919,118.416],
    ["Long Beach",33.770,118.189],["Pasadena",34.147,118.144]
  ];

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[<>&"]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]; }); }
  var fmt = function (n) { return "$" + (n || 0).toLocaleString("en-US"); };
  function miBetween(la1, lo1, la2, lo2) {
    var R = 3958.8, rad = Math.PI / 180, dLa = (la2 - la1) * rad, dLo = (lo2 - lo1) * rad;
    var a = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  function nearestHood(lat, lng) {
    var best = null;
    for (var i = 0; i < HOODS.length; i++) {
      var mi = miBetween(lat, Math.abs(lng), HOODS[i][1], HOODS[i][2]);
      if (!best || mi < best.mi) best = { name: HOODS[i][0], mi: mi };
    }
    return best;
  }
  function fmtDate(s) { try { return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" }); } catch (e) { return ""; } }

  function enrich(s) {
    if (s.lat != null && s.lng != null) {
      s._mi = miBetween(STUDIO.lat, STUDIO.lng, s.lat, Math.abs(s.lng));
      var h = nearestHood(s.lat, s.lng); s._hood = h ? h.name : "";
    } else { s._mi = Infinity; s._hood = ""; }
    s._save = (s.price != null && s.price < YOUR_RENT) ? YOUR_RENT - s.price : 0;
    return s;
  }

  function loadData() {
    return fetch("spaces.json", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return (j && j.spaces) ? j.spaces.map(enrich) : []; })
      .catch(function () { return []; });
  }

  var state = { q: "", maxPrice: YOUR_RENT, sort: "price", area: "" };

  function apply() {
    var t = state.area && TARGETS[state.area];
    var ref = t ? { lat: t[0], lng: t[1] } : STUDIO;
    REF_NAME = state.area || "your studio";
    var capped = state.maxPrice < 100000000;
    var out = DATA.filter(function (s) {
      // With a price cap on, only show spaces whose real price we know and verify.
      if (capped) { if (s.price == null || s.price > state.maxPrice) return false; }
      s._mi = (s.lat != null) ? miBetween(ref.lat, ref.lng, s.lat, Math.abs(s.lng)) : Infinity;
      if (t && s._mi > AREA_RADIUS) return false;   // keep it to the chosen neighborhood
      if (state.q) {
        var hay = (s.title + " " + (s._hood || "")).toLowerCase();
        if (hay.indexOf(state.q) === -1) return false;
      }
      return true;
    });
    out.sort(function (a, b) {
      if (state.sort === "near") { if (a._mi !== b._mi) return a._mi - b._mi; }
      if (state.sort === "newest") return (new Date(b.postedDate || 0)) - (new Date(a.postedDate || 0));
      var pa = a.price == null ? Infinity : a.price, pb = b.price == null ? Infinity : b.price;
      if (pa !== pb) return pa - pb;
      return a._mi - b._mi;
    });
    return out;
  }

  function render() {
    var rows = apply(), host = $("list");
    $("result-count").innerHTML = "<b>" + rows.length + "</b> space" + (rows.length === 1 ? "" : "s") +
      (state.area ? " in " + esc(state.area) : "") +
      (state.maxPrice < 100000000 ? " under " + fmt(state.maxPrice) + "/mo" : "") +
      ' <span class="src-note live">● live · Craigslist LA</span>';
    if (!rows.length) {
      host.innerHTML = '<div class="empty"><strong>No spaces match.</strong><br>Raise the price cap or clear the search.</div>';
      return;
    }
    host.innerHTML = rows.slice(0, 200).map(rowHTML).join("");
    host.querySelectorAll("[data-url]").forEach(function (el) {
      el.addEventListener("click", function () { window.open(el.getAttribute("data-url"), "_blank", "noopener"); });
    });
  }

  function rowHTML(s) {
    var sqft = s.sqft ? '<span class="sqft-chip">' + s.sqft.toLocaleString() + ' sqft</span> ' : "";
    var loc = sqft + (s._hood ? esc(s._hood) : "LA") + (isFinite(s._mi) ? ' <span class="l-mi">~' + Math.round(s._mi) + ' mi from ' + esc(REF_NAME) + '</span>' : "");
    var save = s._save > 0 ? '<span class="save-badge">saves ~' + fmt(Math.round(s._save)) + '/mo</span>' : "";
    return '' +
      '<article class="home" data-url="' + esc(s.url) + '">' +
        '<div class="home-main">' +
          '<div class="home-price">' + (s.price != null ? fmt(s.price) + '<span class="mo">/mo</span>' : '<span class="mo-unk">Price in listing</span>') + ' ' + save + '</div>' +
          '<div class="home-loc"><b>' + esc(s.title || "Commercial space") + '</b></div>' +
          '<div class="home-meta">' + loc + '</div>' +
          '<div class="home-sub">Craigslist' + (s.postedDate ? ' · posted ' + fmtDate(s.postedDate) : '') + '</div>' +
        '</div>' +
        '<div class="home-side"><span class="home-view">View →</span></div>' +
      '</article>';
  }

  function setPrice(max) {
    state.maxPrice = max;
    document.querySelectorAll("#price-chips .chip2").forEach(function (b) { b.classList.toggle("active", +b.getAttribute("data-max") === max); });
    render();
  }

  document.addEventListener("DOMContentLoaded", function () {
    loadData().then(function (rows) {
      DATA = rows;
      $("f-q").addEventListener("input", function (e) { state.q = e.target.value.trim().toLowerCase(); $("f-clear").hidden = !state.q; render(); });
      $("f-clear").addEventListener("click", function () { $("f-q").value = ""; state.q = ""; $("f-clear").hidden = true; render(); });
      document.querySelectorAll("#price-chips .chip2").forEach(function (b) { b.addEventListener("click", function () { setPrice(+b.getAttribute("data-max")); }); });
      document.querySelectorAll("#area-chips .chip2").forEach(function (b) {
        b.addEventListener("click", function () {
          state.area = b.getAttribute("data-area");
          document.querySelectorAll("#area-chips .chip2").forEach(function (x) { x.classList.toggle("active", x === b); });
          render();
        });
      });
      $("f-sort").addEventListener("change", function (e) { state.sort = e.target.value; render(); });
      render();
    });
  });
})();
