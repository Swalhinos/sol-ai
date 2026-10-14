"use strict";
const { readJson, sendJson, method } = require("../lib/http");
const { getTokens, findValid } = require("../lib/store");
module.exports = async (req, res) => {
  if (req.method !== "POST") return method(res, "POST");
  try {
    const body = await readJson(req);
    const t = findValid(await getTokens(), String((body && body.token) || "").trim());
    if (!t) return sendJson(res, 403, { ok: false, error: "Invalid or revoked token." });
    sendJson(res, 200, { ok: true, name: t.name || "member" });
  } catch (e) { sendJson(res, 500, { error: e.message }); }
};
