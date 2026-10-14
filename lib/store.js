"use strict";
/* Persistent storage on Vercel KV.
   Keys: sol:tokens (array), sol:settings (object), sol:usage (array, capped). */
const { getKv } = require("./kvclient");
const crypto = require("crypto");

const K_TOKENS = "sol:tokens";
const K_SETTINGS = "sol:settings";
const K_USAGE = "sol:usage";

const DEFAULT_SETTINGS = {
  model: "gemini-3.5-flash", system: "", temp: 1, maxTokens: 2048, announcement: ""
};
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
  logUsage, getUsage, rateOk, newToken, newId, estTokens
};
