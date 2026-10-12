import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setup, CODE, nightToday } from "./helpers.js";

test("i testi del giorno si scrivono una volta sola: dopo il check-in e con la notte completa", async () => {
  let calls = 0;
  const env = makeEnv({ AI: { run: async () => { calls++; return { response: "ok" }; } } }); await setup(env);
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());
  await call(env, "/api/checkin", { method: "POST", code: CODE, body: { day: today, energia: 4 } });
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  if (hour < 10) {
    assert.equal((await call(env, "/api/coach/oggi", { method: "POST", code: CODE, body: {} })).data.notte_in_attesa, true);
    assert.equal((await call(env, "/api/allenamento/oggi", { method: "POST", code: CODE, body: {} })).data.notte_in_attesa, true);
    assert.equal(calls, 0, "niente IA finché la notte non è completa");
  }
  await nightToday(env);
  await call(env, "/api/coach/oggi", { method: "POST", code: CODE, body: {} });
  assert.equal(calls, 1);
  // more data of the night arriving later does not rewrite anything
  await call(env, "/api/ingest", { method: "POST", code: CODE, body: { hrv_valori: "64", hrv_date: `${today}T03:00:00+02:00` } });
  await call(env, "/api/coach/oggi", { method: "POST", code: CODE, body: {} });
  assert.equal(calls, 1, "scritto una volta sola");
});

test("senza check-in di oggi niente testi del coach né allenamento: nessuna chiamata all'IA", async () => {
  let calls = 0;
  const env = makeEnv({ AI: { run: async () => { calls++; return { response: "ok" }; } } }); await setup(env);
  assert.equal((await call(env, "/api/coach/oggi", { method: "POST", code: CODE, body: {} })).data.checkin_richiesto, true);
  assert.equal((await call(env, "/api/allenamento/oggi", { method: "POST", code: CODE, body: {} })).data.checkin_richiesto, true);
  assert.equal(calls, 0);
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());
  await call(env, "/api/checkin", { method: "POST", code: CODE, body: { day: today } }); // "oggi salto il check-in"
  await nightToday(env);
  const r = await call(env, "/api/coach/oggi", { method: "POST", code: CODE, body: {} });
  assert.equal(r.data.checkin_richiesto, undefined); assert.equal(calls, 1);
});
