"use strict";
/*
 * Tiny HTTP helper built on the `curl` binary.
 * Why curl instead of Node's global fetch? curl transparently honors the
 * HTTPS_PROXY / CA-bundle environment that many hosting + CI environments
 * (including this one) require, with zero npm dependencies.
 */
const { execFile } = require("child_process");

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function curl(url, { ua = DEFAULT_UA, timeout = 30, headers = [] } = {}) {
  const args = ["-sSL", "-m", String(timeout), "-A", ua];
  for (const h of headers) args.push("-H", h);
  args.push(url);
  return new Promise((resolve, reject) => {
    execFile("curl", args, { maxBuffer: 1024 * 1024 * 20 }, (err, stdout, stderr) => {
      if (err) return reject(new Error("curl failed for " + url + ": " + (stderr || err.message)));
      resolve(stdout);
    });
  });
}

/** Fetch text with simple exponential-backoff retry. */
async function fetchText(url, opts = {}) {
  const tries = opts.retries || 3;
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await curl(url, opts);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 800 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

/** POST helper. Pass `form` (urlencoded string) or `json` (object). */
function curlPost(url, { ua = DEFAULT_UA, timeout = 45, headers = [], form, json } = {}) {
  const args = ["-sS", "-m", String(timeout), "-A", ua, "-X", "POST"];
  const hdrs = headers.slice();
  let data = "";
  if (json != null) { hdrs.push("Content-Type: application/json"); data = JSON.stringify(json); }
  else if (form != null) { hdrs.push("Content-Type: application/x-www-form-urlencoded"); data = form; }
  hdrs.push("X-Requested-With: XMLHttpRequest");
  for (const h of hdrs) args.push("-H", h);
  args.push("--data", data, url);
  return new Promise((resolve, reject) => {
    execFile("curl", args, { maxBuffer: 1024 * 1024 * 20 }, (err, stdout, stderr) => {
      if (err) return reject(new Error("curl POST failed for " + url + ": " + (stderr || err.message)));
      resolve(stdout);
    });
  });
}

async function fetchPost(url, opts = {}) {
  const tries = opts.retries || 2;
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await curlPost(url, opts); }
    catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 800 * Math.pow(2, i))); }
  }
  throw lastErr;
}

module.exports = { fetchText, fetchPost, DEFAULT_UA };
