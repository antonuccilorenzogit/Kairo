import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setup, CODE } from "./helpers.js";

const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());

test("storico in cache: una lettura sola finché nessuno scrive, poi i dati nuovi si vedono subito", async () => {
  const env = makeEnv({ KAIRO_NO_CACHE: false }); await setup(env);
  let selects = 0;
  const prep = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => { if (/FROM samples WHERE metric IN \('hrv'/.test(sql)) selects++; return prep(sql); };
  await call(env, "/api/history?days=14", { code: CODE });
  await call(env, "/api/history?days=2", { code: CODE });
  await call(env, "/api/day", { code: CODE });
  assert.equal(selects, 1, "tre richieste, un solo calcolo");
  await call(env, "/api/checkin", { method: "POST", code: CODE, body: { day: today, energia: 5 } });
  const h = (await call(env, "/api/history?days=2", { code: CODE })).data;
  assert.equal(h[1].checkin.energia, 5, "dopo una scrittura il calcolo si rifà");
  assert.equal(selects, 2);
});

test("la FC grezza non viene letta per il recupero; letture contate per funzione; diagnostica leggera", async () => {
  const env = makeEnv(); await setup(env);
  const st = env.DB.prepare("INSERT INTO samples(metric,ts,t,value) VALUES('fc',?,?,70)");
  await env.DB.batch(Array.from({ length: 500 }, (_, i) => { const ts = new Date(Date.now() - i * 60e3).toISOString(); return st.bind(ts, Math.floor(Date.parse(ts) / 1000)); }));
  await call(env, "/api/history?days=14", { code: CODE });
  const d1 = (await call(env, "/api/diagnostica", { code: CODE })).data;
  assert.ok(d1.letture.oggi > 0);
  const hist = d1.letture.per_funzione.find((x) => x.funzione === "/api/history");
  assert.ok(hist && hist.righe < 500, `storico: ${hist?.righe} righe lette`);
  assert.ok(d1.metriche.some((m) => m.metric === "fc" && m.n === 500));
  // the counts are cached: a second diagnostics reads only a few rows
  const before = (await call(env, "/api/diagnostica", { code: CODE })).data.letture.per_funzione.find((x) => x.funzione === "/api/diagnostica").righe;
  const after = (await call(env, "/api/diagnostica", { code: CODE })).data.letture.per_funzione.find((x) => x.funzione === "/api/diagnostica").righe;
  assert.ok(after - before < 100, `diagnostica in cache: ${after - before} righe`);
});
