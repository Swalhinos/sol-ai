"use strict";
/* POST /api/admin/tokens-action {id, op:"revoke"|"delete"} */
const { readJson, sendJson, method } = require("../../lib/http");
const { requireAdmin } = require("../../lib/auth");
const { getTokens, saveTokens } = require("../../lib/store");

module.exports = async (req, res) => {
  if (req.method !== "POST") return method(res, "POST");
  if (!requireAdmin(req)) return sendJson(res, 401, { error: "unauthorized" });
  try {
    const body = await readJson(req);
    const id = String((body && body.id) || "");
    const op = String((body && body.op) || "");
    let tokens = await getTokens();
    if (op === "revoke") {
      const t = tokens.find(x => x.id === id);
      if (!t) return sendJson(res, 404, { error: "not found" });
      t.revoked = !t.revoked;
      await saveTokens(tokens);
      return sendJson(res, 200, { ok: true, revoked: t.revoked });
    }
    if (op === "delete") {
      tokens = tokens.filter(x => x.id !== id);
      await saveTokens(tokens);
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 400, { error: "bad op" });
  } catch (e) { sendJson(res, 500, { error: e.message }); }
};
