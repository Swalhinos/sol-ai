"use strict";
/* Shared HTTP helpers for the serverless functions. */
function readJson(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", c => { buf += c; if (buf.length > 2 * 1024 * 1024) req.destroy(); });
    req.on("end", () => {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error("bad json")); }
    });
    req.on("error", reject);
  });
}
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    // API responses must never be cached: the model list and settings
    // must always be fresh, never a stale cached copy.
    "Cache-Control": "no-store"
  });
  res.end(body);
}
function method(res, allow) {
  res.writeHead(405, { "Content-Type": "application/json", Allow: allow });
  res.end(JSON.stringify({ error: "method not allowed" }));
}
module.exports = { readJson, sendJson, method };
