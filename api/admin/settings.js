"use strict";
const { readJson, sendJson, method } = require("../../lib/http");
const { requireAdmin } = require("../../lib/auth");
const { getSettings, saveSettings } = require("../../lib/store");

module.exports = async (req, res) => {
  if (!requireAdmin(req)) return sendJson(res, 401, { error: "unauthorized" });
  try {
    if (req.method === "GET") return sendJson(res, 200, await getSettings());
    if (req.method === "POST") {
      const b = await readJson(req);
      const cfg = await getSettings();
      if (b.provider === "gemini" || b.provider === "groq") cfg.provider = b.provider;
      if (typeof b.model === "string" && b.model.trim()) cfg.model = b.model.trim().slice(0, 120);
      if (typeof b.system === "string") cfg.system = b.system.slice(0, 8000);
      if (b.temp !== undefined && b.temp !== "") cfg.temp = Math.max(0, Math.min(2, Number(b.temp) || 0));
      if (b.maxTokens !== undefined && b.maxTokens !== "")
        cfg.maxTokens = Math.max(1, Math.min(128000, Math.floor(Number(b.maxTokens) || 2048)));
      if (typeof b.announcement === "string") cfg.announcement = b.announcement.slice(0, 500);
      await saveSettings(cfg);
      return sendJson(res, 200, { ok: true, settings: cfg });
    }
    return method(res, "GET, POST");
  } catch (e) { sendJson(res, 500, { error: e.message }); }
};
