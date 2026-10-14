"use strict";
const { sendJson, method } = require("../lib/http");
const { getSettings, effectiveModel, AVAILABLE_MODELS } = require("../lib/store");
module.exports = async (req, res) => {
  if (req.method !== "GET") return method(res, "GET");
  try {
    const cfg = await getSettings();
    const defProvider = cfg.provider === "groq" ? "groq" : "gemini";
    const defModel = effectiveModel(cfg);
    const models = AVAILABLE_MODELS.slice();
    if (!models.some(m => m.provider === defProvider && m.model === defModel))
      models.push({ provider: defProvider, model: defModel, label: "Default (admin)" });
    sendJson(res, 200, { announcement: cfg.announcement || "", model: defModel, provider: defProvider, models });
  } catch (e) { sendJson(res, 500, { error: e.message }); }
};
