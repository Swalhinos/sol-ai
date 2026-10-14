/* =====================================================================
   SOL.ai Web — private AI chat site
   - Serves the chat UI + admin dashboard
   - Token-gated access (admin creates tokens, users enter them once)
   - Proxies chat to Google Gemini with the server-side API key
     (the key NEVER reaches the browser)
   - Usage tracking + announcements, all in ./data/*.json (no DB needed)
   Env vars (set on the host, never in code):
     GEMINI_API_KEY   — your Google AI Studio key
     ADMIN_PASSWORD   — password for /admin
     PORT             — default 3000
   ===================================================================== */
"use strict";
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "1mb" }));
// small safety headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

/* ---------------- storage ---------------- */
const DATA = path.join(__dirname, "data");
fs.mkdirSync(DATA, { recursive: true });
function readJSON(f, dflt) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8")); }
  catch (e) { return dflt; }
}
function writeJSON(f, val) {
  const tmp = path.join(DATA, f + ".tmp");
  fs.writeFileSync(tmp, JSON.stringify(val, null, 2));
  fs.renameSync(tmp, path.join(DATA, f));
}
// tokens: [{id,name,token,created,revoked,maxMsg,usedMsg,usedTok}]
let tokens = readJSON("tokens.json", []);
// usage: [{t,tokenId,model,inT,outT,ok}]  (capped)
let usage = readJSON("usage.json", []);
// settings: {model,system,temp,maxTokens,announcement}
let cfg = Object.assign(
  { model: "gemini-3.5-flash", system: "", temp: 1, maxTokens: 2048, announcement: "" },
  readJSON("settings.json", {})
);
function saveTokens() { writeJSON("tokens.json", tokens); }
function saveUsage() {
  if (usage.length > 2000) usage = usage.slice(-2000);
  writeJSON("usage.json", usage);
}
function saveCfg() { writeJSON("settings.json", cfg); }

const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const ADMIN_PASS = process.env.ADMIN_PASSWORD || "";
if (!GEMINI_KEY) console.warn("[warn] GEMINI_API_KEY is not set — /api/chat will fail until it is.");
if (!ADMIN_PASS) console.warn("[warn] ADMIN_PASSWORD is not set — /admin login will fail until it is.");

/* ---------------- helpers ---------------- */
const newToken = () => "sx-" + crypto.randomBytes(18).toString("base64url");
const newId = () => Date.now().toString(36) + crypto.randomBytes(4).toString("hex");
const estTokens = s => Math.ceil(String(s || "").length / 4);
function findToken(tok) {
  if (!tok) return null;
  const t = tokens.find(x => x.token === tok);
  return t && !t.revoked ? t : null;
}
// per-token rate limit: 30 req / 60s sliding window (in-memory)
const hits = new Map();
function rateOk(tokenId) {
  const now = Date.now(), arr = (hits.get(tokenId) || []).filter(t => now - t < 60000);
  arr.push(now); hits.set(tokenId, arr);
  return arr.length <= 30;
}
// admin sessions: Map<sid, expires>
const sessions = new Map();
function adminAuth(req, res, next) {
  const sid = req.headers["x-admin-session"];
  const exp = sid && sessions.get(sid);
  if (exp && exp > Date.now()) return next();
  if (sid) sessions.delete(sid);
  res.status(401).json({ error: "unauthorized" });
}

/* ---------------- public API ---------------- */
// what the chat UI needs (no secrets)
app.get("/api/config", (req, res) => {
  res.json({ announcement: cfg.announcement || "", model: cfg.model || "" });
});
// validate an access token (used by the gate screen)
app.post("/api/verify", (req, res) => {
  const t = findToken((req.body && req.body.token || "").trim());
  if (!t) return res.status(403).json({ ok: false, error: "Invalid or revoked token." });
  res.json({ ok: true, name: t.name || "member" });
});
// chat: validate token -> stream Gemini SSE straight through
app.post("/api/chat", async (req, res) => {
  const tok = findToken((req.body && req.body.token || "").trim());
  if (!tok) return res.status(403).json({ error: "Invalid or revoked token." });
  if (!rateOk(tok.id)) return res.status(429).json({ error: "Too many requests — slow down a little." });
  if (tok.maxMsg && tok.usedMsg >= tok.maxMsg)
    return res.status(403).json({ error: "This token has reached its message limit." });
  if (!GEMINI_KEY) return res.status(500).json({ error: "Server is not configured (missing API key)." });

  const msgs = Array.isArray(req.body.messages) ? req.body.messages.slice(-40) : [];
  if (!msgs.length || !msgs.every(m => m && typeof m.text === "string"))
    return res.status(400).json({ error: "Bad messages." });

  const body = {
    contents: msgs.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.text.slice(0, 30000) }]
    })),
    generationConfig: {}
  };
  if (cfg.system && cfg.system.trim())
    body.systemInstruction = { parts: [{ text: cfg.system.trim().slice(0, 8000) }] };
  const temp = Number(cfg.temp);
  if (Number.isFinite(temp)) body.generationConfig.temperature = Math.max(0, Math.min(2, temp));
  const mt = Number(cfg.maxTokens);
  if (Number.isFinite(mt) && mt > 0) body.generationConfig.maxOutputTokens = Math.max(1, Math.min(128000, Math.floor(mt)));

  const url = "https://generativelanguage.googleapis.com/v1beta/models/"
    + encodeURIComponent(cfg.model || "gemini-3.5-flash")
    + ":streamGenerateContent?alt=sse&key=" + encodeURIComponent(GEMINI_KEY);

  let gRes = null, attempt = 0;
  for (;;) {
    try {
      gRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
    } catch (e) {
      return res.status(502).json({ error: "Could not reach the AI service. Try again." });
    }
    if ((gRes.status === 429 || gRes.status === 503) && attempt < 2) {
      attempt++;
      await new Promise(r => setTimeout(r, 2000 * attempt));
      continue;
    }
    break;
  }
  if (!gRes.ok) {
    let detail = "";
    try {
      const t = await gRes.text();
      const j = JSON.parse(t);
      if (j.error && j.error.message) detail = " — " + String(j.error.message).slice(0, 220);
    } catch (e) {}
    return res.status(gRes.status === 429 || gRes.status === 503 ? 503 : 502)
      .json({ error: "AI service error (" + gRes.status + ")." + detail });
  }

  // stream through, while estimating usage
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  let outText = "";
  const inText = msgs.map(m => m.text).join("\n");
  let reader;
  try { reader = gRes.body.getReader(); }
  catch (e) { try { res.end(); } catch (e2) {} return; }
  const dec = new TextDecoder();
  let buf = "", clientGone = false;
  req.on("close", () => { clientGone = true; try { reader.cancel(); } catch (e) {} });
  try {
    for (;;) {
      const r = await reader.read();
      if (r.done || clientGone) break;
      const chunk = dec.decode(r.value, { stream: true });
      buf += chunk;
      res.write(chunk);
      // accumulate text for usage estimate (best-effort parse)
      const lines = buf.split("\n"); buf = lines.pop();
      for (const ln of lines) {
        const t = ln.trim();
        if (!t.startsWith("data:")) continue;
        const p = t.slice(5).trim();
        if (!p || p === "[DONE]") continue;
        try {
          const j = JSON.parse(p);
          const parts = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
          if (parts) parts.forEach(x => { if (x.text) outText += x.text; });
        } catch (e) {}
      }
    }
  } catch (e) { /* stream interrupted */ }
  try { res.end(); } catch (e) {}

  if (!clientGone) {
    const inT = estTokens(inText), outT = estTokens(outText);
    tok.usedMsg = (tok.usedMsg || 0) + 1;
    tok.usedTok = (tok.usedTok || 0) + inT + outT;
    saveTokens();
    usage.push({ t: Date.now(), tokenId: tok.id, model: cfg.model, inT, outT, ok: true });
    saveUsage();
  }
});

/* ---------------- admin API ---------------- */
app.post("/api/admin/login", (req, res) => {
  if (!ADMIN_PASS) return res.status(500).json({ error: "Admin password not configured on server." });
  if ((req.body && req.body.password) === ADMIN_PASS) {
    const sid = crypto.randomBytes(24).toString("hex");
    sessions.set(sid, Date.now() + 12 * 3600 * 1000);
    // opportunistic cleanup
    for (const [k, exp] of sessions) if (exp < Date.now()) sessions.delete(k);
    return res.json({ ok: true, sid });
  }
  res.status(401).json({ error: "Wrong password." });
});
app.get("/api/admin/tokens", adminAuth, (req, res) => {
  res.json(tokens.map(t => ({
    id: t.id, name: t.name, token: t.token, created: t.created,
    revoked: !!t.revoked, maxMsg: t.maxMsg || 0, usedMsg: t.usedMsg || 0, usedTok: t.usedTok || 0
  })));
});
app.post("/api/admin/tokens", adminAuth, (req, res) => {
  const name = String((req.body && req.body.name) || "member").slice(0, 60) || "member";
  const maxMsg = Math.max(0, Math.floor(Number(req.body && req.body.maxMsg) || 0));
  const t = { id: newId(), name, token: newToken(), created: Date.now(), revoked: false, maxMsg, usedMsg: 0, usedTok: 0 };
  tokens.unshift(t); saveTokens();
  res.json({ ok: true, token: t });
});
app.post("/api/admin/tokens/:id/revoke", adminAuth, (req, res) => {
  const t = tokens.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: "not found" });
  t.revoked = !t.revoked; saveTokens();
  res.json({ ok: true, revoked: t.revoked });
});
app.delete("/api/admin/tokens/:id", adminAuth, (req, res) => {
  tokens = tokens.filter(x => x.id !== req.params.id);
  saveTokens(); res.json({ ok: true });
});
app.get("/api/admin/stats", adminAuth, (req, res) => {
  const day = Date.now() - 86400000;
  res.json({
    tokens: tokens.length,
    activeTokens: tokens.filter(t => !t.revoked).length,
    totalMsg: tokens.reduce((a, t) => a + (t.usedMsg || 0), 0),
    totalTok: tokens.reduce((a, t) => a + (t.usedTok || 0), 0),
    last24h: usage.filter(u => u.t > day).length,
    model: cfg.model
  });
});
app.get("/api/admin/settings", adminAuth, (req, res) => { res.json(cfg); });
app.post("/api/admin/settings", adminAuth, (req, res) => {
  const b = req.body || {};
  if (typeof b.model === "string" && b.model.trim()) cfg.model = b.model.trim().slice(0, 120);
  if (typeof b.system === "string") cfg.system = b.system.slice(0, 8000);
  if (b.temp !== undefined && b.temp !== "") cfg.temp = Math.max(0, Math.min(2, Number(b.temp) || 0));
  if (b.maxTokens !== undefined && b.maxTokens !== "") cfg.maxTokens = Math.max(1, Math.min(128000, Math.floor(Number(b.maxTokens) || 2048)));
  if (typeof b.announcement === "string") cfg.announcement = b.announcement.slice(0, 500);
  saveCfg();
  res.json({ ok: true, settings: cfg });
});

/* ---------------- static ---------------- */
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("SOL.ai web running on port " + PORT));
