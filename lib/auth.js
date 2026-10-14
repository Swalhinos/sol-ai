"use strict";
/* Stateless admin sessions: HMAC-signed tokens, no storage needed.
   sid = base64url(payload) + "." + base64url(HMAC_SHA256(ADMIN_PASSWORD, payload)) */
const crypto = require("crypto");
function secret() { return process.env.ADMIN_PASSWORD || ""; }
function createSession() {
  const payload = Buffer.from(JSON.stringify({ e: Date.now() + 12 * 3600 * 1000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  return payload + "." + sig;
}
function verifySession(sid) {
  try {
    const parts = String(sid || "").split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1] || !secret()) return false;
    const [p, s] = parts;
    const exp = crypto.createHmac("sha256", secret()).update(p).digest("base64url");
    const a = Buffer.from(s), b = Buffer.from(exp);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    return JSON.parse(Buffer.from(p, "base64url").toString()).e > Date.now();
  } catch (e) { return false; }
}
function requireAdmin(req) {
  return verifySession(req.headers["x-admin-session"]);
}
module.exports = { createSession, verifySession, requireAdmin };
