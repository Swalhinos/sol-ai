"use strict";
/* In-memory KV with the same interface as @vercel/kv.
   Used for local development and tests when KV env vars are absent. */
const clone = v => v === undefined ? v : JSON.parse(JSON.stringify(v));
function createMemKv() {
  const data = new Map();   // key -> {val, exp}
  const now = () => Date.now();
  function live(k) {
    const e = data.get(k);
    if (!e) return null;
    if (e.exp && e.exp <= now()) { data.delete(k); return null; }
    return e;
  }
  return {
    async get(k) { const e = live(k); return e ? clone(e.val) : null; },
    async set(k, v, opts) {
      const ex = opts && opts.ex ? Number(opts.ex) : 0;
      data.set(k, { val: clone(v), exp: ex > 0 ? now() + ex * 1000 : 0 });
      return "OK";
    },
    async del(k) { return data.delete(k) ? 1 : 0; },
    async incr(k) {
      const e = live(k);
      const n = (e ? Number(e.val) : 0) + 1;
      data.set(k, { val: n, exp: e ? e.exp : 0 });
      return n;
    },
    async expire(k, secs) {
      const e = live(k);
      if (!e) return 0;
      e.exp = now() + Number(secs) * 1000;
      return 1;
    }
  };
}
module.exports = { createMemKv };
