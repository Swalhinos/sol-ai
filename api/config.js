"use strict";
const { sendJson, method } = require("../lib/http");
const { getSettings } = require("../lib/store");
module.exports = async (req, res) => {
  if (req.method !== "GET") return method(res, "GET");
  try {
    const cfg = await getSettings();
    sendJson(res, 200, { announcement: cfg.announcement || "", model: cfg.model || "" });
  } catch (e) { sendJson(res, 500, { error: e.message }); }
};
