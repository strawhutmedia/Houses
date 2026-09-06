"use strict";
/*
 * EquityScout board sync — the tiniest possible shared-favorites backend.
 *
 * A "board" is one shared ♥ list identified by a secret slug; anyone with the
 * link reads and writes it (the slug IS the membership — no accounts).
 *
 *   GET  /b/<id>                 -> { items: {itemId: 1, ...}, updatedAt }
 *   POST /b/<id>  {op:"set",  itemId, on}      toggle one heart
 *   POST /b/<id>  {op:"seed", items:{...}}     merge a whole local list in
 *   GET  /health                 -> ok
 *
 * Storage: one JSON file on a Railway volume (DATA_DIR). No dependencies.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || "/data";
const FILE = path.join(DATA_DIR, "boards.json");
const ID_RE = /^[a-z0-9][a-z0-9-]{5,49}$/;
const MAX_ITEMS = 500;          // per board
const MAX_BOARDS = 5000;

let boards = {};
try { boards = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { boards = {}; }
let dirty = false;
setInterval(function () {
  if (!dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE + ".tmp", JSON.stringify(boards));
    fs.renameSync(FILE + ".tmp", FILE);
  } catch (e) { console.error("persist failed:", e.message); }
}, 1500).unref();

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
function send(res, code, obj) {
  cors(res);
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}
function cleanItems(items) {
  const out = {};
  if (items && typeof items === "object") {
    for (const k of Object.keys(items).slice(0, MAX_ITEMS)) {
      if (typeof k === "string" && k.length <= 120 && items[k]) out[k] = 1;
    }
  }
  return out;
}

http.createServer(function (req, res) {
  if (req.method === "OPTIONS") { cors(res); res.writeHead(204); return res.end(); }
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/health") return send(res, 200, { ok: true, boards: Object.keys(boards).length });

  const m = url.pathname.match(/^\/b\/([^/]+)$/);
  if (!m) return send(res, 404, { error: "not found" });
  const id = m[1];
  if (!ID_RE.test(id)) return send(res, 400, { error: "bad board id" });

  if (req.method === "GET") {
    const b = boards[id] || { items: {}, updatedAt: null };
    return send(res, 200, { items: b.items || {}, updatedAt: b.updatedAt });
  }

  if (req.method === "POST") {
    let body = "";
    req.on("data", function (c) { body += c; if (body.length > 64 * 1024) req.destroy(); });
    req.on("end", function () {
      let msg;
      try { msg = JSON.parse(body || "{}"); } catch (e) { return send(res, 400, { error: "bad json" }); }
      if (!boards[id] && Object.keys(boards).length >= MAX_BOARDS) return send(res, 507, { error: "board limit" });
      const b = boards[id] || (boards[id] = { items: {}, updatedAt: null });
      if (msg.op === "set" && typeof msg.itemId === "string" && msg.itemId.length <= 120) {
        if (msg.on) { if (Object.keys(b.items).length < MAX_ITEMS) b.items[msg.itemId] = 1; }
        else delete b.items[msg.itemId];
      } else if (msg.op === "seed") {
        Object.assign(b.items, cleanItems(msg.items));
      } else {
        return send(res, 400, { error: "bad op" });
      }
      b.updatedAt = new Date().toISOString();
      dirty = true;
      return send(res, 200, { items: b.items, updatedAt: b.updatedAt });
    });
    return;
  }
  send(res, 405, { error: "method not allowed" });
}).listen(PORT, function () { console.log("EquityScout board sync on :" + PORT + " (data: " + FILE + ")"); });
