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

module.exports = { fetchText, DEFAULT_UA };
