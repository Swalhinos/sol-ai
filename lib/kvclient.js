"use strict";
/* Resolves the KV client: real @vercel/kv in production, in-memory locally.
   Fails loudly on Vercel when KV env vars are missing (silent memory
   fallback there would lose all tokens). */
const { createMemKv } = require("./memkv");
let cached = null;
function getKv() {
  if (cached) return cached;
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    cached = require("@vercel/kv").kv;
    return cached;
  }
  if (process.env.VERCEL) {
    throw new Error("KV storage is not configured (missing KV_REST_API_URL / KV_REST_API_TOKEN). Create a KV database in the Vercel dashboard and link it to this project.");
  }
  cached = createMemKv();
  return cached;
}
module.exports = { getKv };
