import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setup, CODE } from "./helpers.js";

const KEY = "gsk_" + "A1b2C3d4".repeat(6);

test("chiave Groq salvata sul server: vale su ogni dispositivo e non torna mai intera", async () => {
  const env = makeEnv(); await setup(env);
  assert.equal((await call(env, "/api/ia/chiave", { method: "POST", code: CODE, body: { chiave: "sbagliata 123" } })).status, 400);
  const r = (await call(env, "/api/ia/chiave", { method: "POST", code: CODE, body: { chiave: KEY, modello: "openai/gpt-oss-20b" } })).data;
  assert.deepEqual([r.sul_server, r.finale, r.modello], [true, KEY.slice(-4), "openai/gpt-oss-20b"]);
  // the key never leaves the server: not in the diagnostics, the export or the backup
  const diag = await call(env, "/api/diagnostica", { code: CODE });
  assert.equal(diag.data.ia.chiave_groq_sul_server, true);
  assert.ok(!JSON.stringify(diag.data).includes(KEY));
  assert.ok(!JSON.stringify((await call(env, "/api/export", { code: CODE })).data).includes(KEY));
  assert.equal((await call(env, "/api/ia/chiave", { code: "sbagliato-12345" })).status, 401);

  // a device without its own key (e.g. the PC) uses the server's key and model
  const seen = [];
  const f = mock.method(globalThis, "fetch", async (url, opt) => {
    seen.push({ auth: opt.headers.authorization, model: JSON.parse(opt.body).model });
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200, headers: { "content-type": "application/json" } });
  });
  try {
    const t = (await call(env, "/api/ai/test", { method: "POST", code: CODE })).data;
    assert.equal(t.provider, "groq");
    assert.deepEqual(seen[0], { auth: `Bearer ${KEY}`, model: "openai/gpt-oss-20b" });
  } finally { f.mock.restore(); }

  await call(env, "/api/ia/chiave", { method: "DELETE", code: CODE });
  assert.equal((await call(env, "/api/ia/chiave", { code: CODE })).data.sul_server, false);
});
