"use strict";
/*
 * Shared live boards — synced favorites without accounts.
 * A board is one shared ♥ list behind a secret slug; the link is the
 * membership. Backed by the tiny sync server in /sync-server (Railway).
 */
window.ESBoards = (function () {
  var SYNC = "https://board-sync-production-4b60.up.railway.app";
  var KEY = "es_board";

  function idFromUrl() {
    var m = (location.search + " " + location.hash).match(/board=([a-z0-9][a-z0-9-]{5,49})/);
    return m ? m[1] : null;
  }
  function stored() { try { return localStorage.getItem(KEY) || null; } catch (e) { return null; } }
  function store(id) { try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch (e) {} }
  function newId() {
    var s = "b", c = "abcdefghjkmnpqrstuvwxyz23456789";
    for (var i = 0; i < 11; i++) s += c[Math.floor(Math.random() * c.length)];
    return s;
  }
  function get(id) { return fetch(SYNC + "/b/" + id, { cache: "no-store" }).then(function (r) { return r.json(); }); }
  function set(id, itemId, on) {
    return fetch(SYNC + "/b/" + id, { method: "POST", body: JSON.stringify({ op: "set", itemId: itemId, on: !!on }) })
      .then(function (r) { return r.json(); });
  }
  function seed(id, items) {
    return fetch(SYNC + "/b/" + id, { method: "POST", body: JSON.stringify({ op: "seed", items: items || {} }) })
      .then(function (r) { return r.json(); });
  }
  function link(page, id) { return location.origin + location.pathname.replace(/[^/]*$/, page) + "?board=" + id; }

  return { idFromUrl: idFromUrl, stored: stored, store: store, newId: newId, get: get, set: set, seed: seed, link: link };
})();
