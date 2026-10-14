"use strict";
const { readJson, sendJson, method } = require("../../lib/http");
const { createSession } = require("../../lib/auth");
module.exports = async (req, res) => {
  if (req.method !== "POST") return method(res, "POST");
  const ADMIN_PASS = process.env.ADMIN_PASSWORD || "";
  if (!ADMIN_PASS) return sendJson(res, 500, { error: "Admin password not configured on server." });
  try {
    const body = await readJson(req);
    if (body && body.password === ADMIN_PASS)
      return sendJson(res, 200, { ok: true, sid: createSession() });
    sendJson(res, 401, { error: "Wrong password." });
  } catch (e) { sendJson(res, 500, { error: e.message }); }
};
