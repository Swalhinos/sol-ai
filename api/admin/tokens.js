"use strict";
const { readJson, sendJson, method } = require("../../lib/http");
const { requireAdmin } = require("../../lib/auth");
const { getTokens, saveTokens, newToken, newId } = require("../../lib/store");

module.exports = async (req, res) => {
  if (!requireAdmin(req)) return sendJson(res, 401, { error: "unauthorized" });
  try {
    if (req.method === "GET") {
      const tokens = await getTokens();
      return sendJson(res, 200, tokens.map(t => ({
        id: t.id, name: t.name, token: t.token, created: t.created,
        revoked: !!t.revoked, maxMsg: t.maxMsg || 0, usedMsg: t.usedMsg || 0, usedTok: t.usedTok || 0
      })));
    }
    if (req.method === "POST") {
      const body = await readJson(req);
      const name = String((body && body.name) || "member").slice(0, 60) || "member";
      const maxMsg = Math.max(0, Math.floor(Number(body && body.maxMsg) || 0));
      const tokens = await getTokens();
      const t = { id: newId(), name, token: newToken(), created: Date.now(), revoked: false, maxMsg, usedMsg: 0, usedTok: 0 };
      tokens.unshift(t);
      await saveTokens(tokens);
      return sendJson(res, 200, { ok: true, token: t });
    }
    return method(res, "GET, POST");
  } catch (e) { sendJson(res, 500, { error: e.message }); }
};
