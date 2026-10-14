"use strict";
/* Persistent storage on Vercel KV.
   Keys: sol:tokens (array), sol:settings (object), sol:usage (array, capped). */
const { getKv } = require("./kvclient");
const crypto = require("crypto");

const K_TOKENS = "sol:tokens";
const K_SETTINGS = "sol:settings";
const K_USAGE = "sol:usage";

const GEMINI_DEFAULT_MODEL = "gemini-3.5-flash";
const GROQ_DEFAULT_MODEL = "openai/gpt-oss-120b";
// Models the chatter may pick in the chat UI (the admin's saved model is
// always allowed too, even if it is not in this list).
const AVAILABLE_MODELS = [
  { provider: "gemini", model: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { provider: "groq", model: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
  { provider: "groq", model: "openai/gpt-oss-20b", label: "GPT-OSS 20B" },
  { provider: "groq", model: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B" }
];
const DEFAULT_SETTINGS = {
  provider: "gemini", model: GEMINI_DEFAULT_MODEL, system: "", temp: 1, maxTokens: 2048, announcement: ""
};
// The model that will actually be called: falls back to the provider's
// default when the saved model is empty or belongs to the other provider.
function effectiveModel(cfg) {
  const c = cfg || {};
  if (c.provider === "groq") {
    const m = String(c.model || "").trim();
    if (!m || m.startsWith("gemini-")) return GROQ_DEFAULT_MODEL;
    return m;
  }
  return String(c.model || "").trim() || GEMINI_DEFAULT_MODEL;
}
const newToken = () => "sx-" + crypto.randomBytes(18).toString("base64url");
const newId = () => Date.now().toString(36) + crypto.randomBytes(4).toString("hex");
const estTokens = s => Math.ceil(String(s || "").length / 4);

async function getTokens() {
  const t = await getKv().get(K_TOKENS);
  return Array.isArray(t) ? t : [];
}
async function saveTokens(t) { await getKv().set(K_TOKENS, t); }
function findValid(tokens, tok) {
  if (!tok) return null;
  const t = tokens.find(x => x.token === tok);
  return t && !t.revoked ? t : null;
}
async function getSettings() {
  const s = await getKv().get(K_SETTINGS);
  return Object.assign({}, DEFAULT_SETTINGS, s || {});
}
async function saveSettings(s) { await getKv().set(K_SETTINGS, s); }
async function logUsage(entry) {
  const kv = getKv();
  let u = await kv.get(K_USAGE);
  if (!Array.isArray(u)) u = [];
  u.push(entry);
  if (u.length > 2000) u = u.slice(-2000);
  await kv.set(K_USAGE, u);
}
async function getUsage() {
  const u = await getKv().get(K_USAGE);
  return Array.isArray(u) ? u : [];
}
// sliding-window rate limit: 30 req / 60s per token id
async function rateOk(tokenId) {
  const kv = getKv();
  const k = "sol:rl:" + tokenId;
  const n = await kv.incr(k);
  if (n === 1) await kv.expire(k, 60);
  return n <= 30;
}
module.exports = {
  getTokens, saveTokens, findValid, getSettings, saveSettings,
  logUsage, getUsage, rateOk, newToken, newId, estTokens,
  effectiveModel, GEMINI_DEFAULT_MODEL, GROQ_DEFAULT_MODEL, AVAILABLE_MODELS
};
