import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setup, CODE } from "./helpers.js";
import { extractTags, MAX_ITEMS } from "../src/memory.js";

// Fake Workers AI: answers with `reply`, records the prompts it received.
const fakeAI = (replies) => {
  const seen = [];
  return { seen, run: async (_m, { messages }) => { seen.push(messages); return { response: replies.shift() ?? "ok" }; } };
};

test("i tag di memoria vengono tolti dalla risposta", () => {
  const t = extractTags("Ottimo, in bocca al lupo!\n\n[[RICORDA: gara di nuoto 1500 m il 2026-11-15]]\n[[DIMENTICA: dolore spalla]]");
  assert.equal(t.testo, "Ottimo, in bocca al lupo!");
  assert.deepEqual(t.ricorda, ["gara di nuoto 1500 m il 2026-11-15"]);
  assert.deepEqual(t.dimentica, ["dolore spalla"]);
});

test("il coach ricorda tra una conversazione e l'altra e dimentica su richiesta", async () => {
  const AI = fakeAI([
    "Bene, ci lavoriamo. [[RICORDA: ha dolore alla spalla destra in panca piana]]",
    "Ok, lo tolgo. [[DIMENTICA: dolore spalla]]",
  ]);
  const env = makeEnv({ AI }); await setup(env);
  const r = await call(env, "/api/coach/chat", { method: "POST", code: CODE, body: { domanda: "Mi fa male la spalla in panca" } });
  assert.equal(r.data.testo, "Bene, ci lavoriamo.");
  assert.match(r.data.meta, /📌 Me lo segno: ha dolore alla spalla destra/);
  const mem = (await call(env, "/api/memoria", { code: CODE })).data.memoria;
  assert.equal(mem.length, 1); assert.equal(mem[0].fonte, "coach");
  // a new conversation (chat cleared) still knows it, and so does the morning advice
  await call(env, "/api/chat", { method: "DELETE", code: CODE });
  await call(env, "/api/coach/chat", { method: "POST", code: CODE, body: { domanda: "La spalla è guarita" } });
  assert.match(AI.seen[1][0].content, /COSA SAI DI LUI[\s\S]*spalla destra/);
  assert.equal((await call(env, "/api/memoria", { code: CODE })).data.memoria.length, 0);
  await call(env, "/api/coach/oggi", { method: "POST", code: CODE, body: {} });
  assert.doesNotMatch(AI.seen[2][0].content, /spalla/);
});

test("memoria dalle Impostazioni: aggiungi, niente doppioni, elimina, limite", async () => {
  const env = makeEnv(); await setup(env);
  const add = (testo) => call(env, "/api/memoria", { method: "POST", code: CODE, body: { testo } });
  await add("Gara di 10 km il 2026-11-15");
  await add("Gara di 10 km il 2026-11-15");
  assert.equal((await add("x")).data.errore, "Testo troppo corto");
  let mem = (await call(env, "/api/memoria", { code: CODE })).data.memoria;
  assert.equal(mem.length, 1); assert.equal(mem[0].fonte, "utente");
  for (let i = 0; i < MAX_ITEMS + 5; i++) await env.DB.prepare("INSERT INTO memoria(testo,fonte,creato) VALUES(?, 'coach', '2026-10-01')").bind("fatto " + i).run();
  await add("ultimo fatto");
  mem = (await call(env, "/api/memoria", { code: CODE })).data.memoria;
  assert.equal(mem.length, MAX_ITEMS);
  assert.ok(mem.some((m) => m.testo.startsWith("Gara")), "quelli scritti da te restano");
  await call(env, `/api/memoria?id=${mem[0].id}`, { method: "DELETE", code: CODE });
  assert.equal((await call(env, "/api/memoria", { code: CODE })).data.memoria.length, MAX_ITEMS - 1);
  assert.equal((await call(env, "/api/memoria", { code: "sbagliato-123" })).status, 401);
});

test("la memoria finisce nel backup e si ripristina", async () => {
  const env = makeEnv(); await setup(env);
  await call(env, "/api/memoria", { method: "POST", code: CODE, body: { testo: "Preferisce allenarsi la sera" } });
  const exp = (await call(env, "/api/export", { code: CODE })).data;
  assert.equal(exp.memoria.length, 1);
  await env.DB.prepare("DELETE FROM memoria").run();
  await call(env, "/api/ripristina", { method: "POST", code: CODE, body: exp });
  assert.equal((await call(env, "/api/memoria", { code: CODE })).data.memoria[0].testo, "Preferisce allenarsi la sera");
});
