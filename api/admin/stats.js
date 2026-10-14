"use strict";
const { sendJson, method } = require("../../lib/http");
const { requireAdmin } = require("../../lib/auth");
const { getTokens, getUsage, getSettings } = require("../../lib/store");

module.exports = async (req, res) => {
  if (req.method !== "GET") return method(res, "GET");
  if (!requireAdmin(req)) return sendJson(res, 401, { error: "unauthorized" });
  try {
    const [tokens, usage, cfg] = await Promise.all([getTokens(), getUsage(), getSettings()]);
    const day = Date.now() - 86400000;
    sendJson(res, 200, {
      tokens: tokens.length,
      activeTokens: tokens.filter(t => !t.revoked).length,
      totalMsg: tokens.reduce((a, t) => a + (t.usedMsg || 0), 0),
      totalTok: tokens.reduce((a, t) => a + (t.usedTok || 0), 0),
      last24h: usage.filter(u => u.t > day).length,
      model: cfg.model
    });
  } catch (e) { sendJson(res, 500, { error: e.message }); }
};
