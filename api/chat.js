"use strict";
/* POST /api/chat — validate token, stream the AI reply.
   Providers: Gemini (native SSE) and Groq (OpenAI-compatible SSE).
   Groq chunks are translated to Gemini-shaped SSE so the frontend's
   single parser works for both. maxDuration is raised in vercel.json
   so long replies are not cut. */
const { readJson, sendJson, method } = require("../lib/http");
const { getTokens, findValid, getSettings, rateOk, logUsage, saveTokens, estTokens, effectiveModel, AVAILABLE_MODELS } = require("../lib/store");

module.exports = async (req, res) => {
  if (req.method !== "POST") return method(res, "POST");
  let body;
  try { body = await readJson(req); }
  catch (e) { return sendJson(res, 400, { error: "Bad request." }); }

  try {
    // Fetch token list + settings in parallel: one round trip instead of two.
    const [tokens, cfg] = await Promise.all([getTokens(), getSettings()]);
    const tok = findValid(tokens, String((body && body.token) || "").trim());
    if (!tok) return sendJson(res, 403, { error: "Invalid or revoked token." });
    if (!(await rateOk(tok.id))) return sendJson(res, 429, { error: "Too many requests — slow down a little." });
    if (tok.maxMsg && tok.usedMsg >= tok.maxMsg)
      return sendJson(res, 403, { error: "This token has reached its message limit." });

    // Keep history small: oversized payloads slow down every request.
    const msgs = Array.isArray(body.messages) ? body.messages.slice(-24) : [];
    if (!msgs.length || !msgs.every(m => m && typeof m.text === "string"))
      return sendJson(res, 400, { error: "Bad messages." });

    let provider = cfg.provider === "groq" ? "groq" : "gemini";
    let model = effectiveModel(cfg);
    // The chatter may pick a model in the chat UI. Only an allowlisted
    // model (or the admin's own saved model) is accepted; anything else
    // falls back to the admin default.
    const wantP = String((body && body.provider) || "").toLowerCase();
    const wantM = String((body && body.model) || "").trim().slice(0, 120);
    if ((wantP === "gemini" || wantP === "groq") && wantM &&
        (AVAILABLE_MODELS.some(m => m.provider === wantP && m.model === wantM) ||
         (wantM === model && wantP === provider))) {
      provider = wantP;
      model = wantM;
    }
    const temp = Number(cfg.temp);
    const tempClamped = Number.isFinite(temp) ? Math.max(0, Math.min(2, temp)) : 1;
    const mt = Number(cfg.maxTokens);
    const maxOut = Number.isFinite(mt) && mt > 0 ? Math.max(1, Math.min(128000, Math.floor(mt))) : 2048;
    const system = (cfg.system && cfg.system.trim()) ? cfg.system.trim().slice(0, 8000) : "";

    let url, reqHeaders, reqBody;
    if (provider === "groq") {
      const GROQ_KEY = process.env.GROQ_API_KEY || "";
      if (!GROQ_KEY) return sendJson(res, 500, { error: "Server is not configured (missing Groq API key)." });
      url = "https://api.groq.com/openai/v1/chat/completions";
      reqHeaders = { "Content-Type": "application/json", "Authorization": "Bearer " + GROQ_KEY };
      reqBody = {
        model,
        messages: [
          ...(system ? [{ role: "system", content: system }] : []),
          ...msgs.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.text.slice(0, 12000) }))
        ],
        temperature: tempClamped,
        max_tokens: maxOut,
        stream: true
      };
    } else {
      const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
      if (!GEMINI_KEY) return sendJson(res, 500, { error: "Server is not configured (missing API key)." });
      url = "https://generativelanguage.googleapis.com/v1beta/models/"
        + encodeURIComponent(model)
        + ":streamGenerateContent?alt=sse&key=" + encodeURIComponent(GEMINI_KEY);
      reqHeaders = { "Content-Type": "application/json" };
      reqBody = {
        contents: msgs.map(m => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.text.slice(0, 12000) }]
        })),
        generationConfig: { temperature: tempClamped, maxOutputTokens: maxOut }
      };
      if (system) reqBody.systemInstruction = { parts: [{ text: system }] };
    }

    let gRes = null, attempt = 0;
    for (;;) {
      try {
        gRes = await fetch(url, {
          method: "POST",
          headers: reqHeaders,
          body: JSON.stringify(reqBody)
        });
      } catch (e) {
        return sendJson(res, 502, { error: "Could not reach the AI service. Try again." });
      }
      // 503 = temporary capacity crunch on Google's side: be patient, it
      // usually clears within seconds. 429 = rate limit: back off longer.
      // Honor Google's Retry-After header when present (capped at 10s).
      if ((gRes.status === 429 || gRes.status === 503) && attempt < 3) {
        attempt++;
        let wait = gRes.status === 503 ? 1200 * attempt : 2000 * attempt;
        try {
          const ra = Number(gRes.headers && gRes.headers.get && gRes.headers.get("Retry-After"));
          if (Number.isFinite(ra) && ra > 0) wait = Math.min(ra * 1000, 10000);
        } catch (e) {}
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      break;
    }
    if (!gRes.ok) {
      if (gRes.status === 503)
        return sendJson(res, 503, { error: "The AI is busy right now (high demand). Please wait a moment and try again." });
      let detail = "";
      try {
        const t = await gRes.text();
        const j = JSON.parse(t);
        if (j.error && j.error.message) detail = " — " + String(j.error.message).slice(0, 220);
      } catch (e) {}
      return sendJson(res, gRes.status === 429 ? 503 : 502,
        { error: "AI service error (" + gRes.status + ")." + detail });
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    let outText = "";
    const inText = msgs.map(m => m.text).join("\n");
    let reader;
    try { reader = gRes.body.getReader(); }
    catch (e) { try { res.end(); } catch (e2) {} return; }
    const dec = new TextDecoder();
    let buf = "", clientGone = false;
    req.on("close", () => { clientGone = true; try { reader.cancel(); } catch (e) {} });
    try {
      for (;;) {
        const r = await reader.read();
        if (r.done || clientGone) break;
        const chunk = dec.decode(r.value, { stream: true });
        buf += chunk;
        const lines = buf.split("\n"); buf = lines.pop();
        for (const ln of lines) {
          const t = ln.trim();
          if (!t.startsWith("data:")) continue;
          const p = t.slice(5).trim();
          if (!p || p === "[DONE]") continue;
          try {
            const j = JSON.parse(p);
            if (provider === "groq") {
              // OpenAI-format chunk -> Gemini-shaped chunk for the frontend.
              const ch0 = (j.choices && j.choices[0]) || {};
              const txt = (ch0.delta && ch0.delta.content) || (ch0.message && ch0.message.content) || "";
              if (txt) {
                outText += txt;
                res.write("data: " + JSON.stringify({ candidates: [{ content: { parts: [{ text: txt }] } }] }) + "\n\n");
              }
            } else {
              const parts = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
              if (parts) parts.forEach(x => { if (x.text) outText += x.text; });
              res.write(ln + "\n");
            }
          } catch (e) {}
        }
      }
    } catch (e) { /* stream interrupted */ }
    try { res.end(); } catch (e) {}

    if (!clientGone) {
      const inT = estTokens(inText), outT = estTokens(outText);
      tok.usedMsg = (tok.usedMsg || 0) + 1;
      tok.usedTok = (tok.usedTok || 0) + inT + outT;
      await Promise.all([
        saveTokens(tokens),
        logUsage({ t: Date.now(), tokenId: tok.id, model, inT, outT, ok: true })
      ]);
    }
  } catch (e) {
    try { sendJson(res, 500, { error: e.message || "Server error." }); }
    catch (e2) { try { res.end(); } catch (e3) {} }
  }
};
