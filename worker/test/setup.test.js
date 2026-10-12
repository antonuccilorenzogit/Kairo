import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setup, CODE, checkinToday } from "./helpers.js";

const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());
const day = (n) => new Date(Date.parse(today + "T12:00:00Z") - n * 86400e3).toISOString().slice(0, 10);
const ts = (d, hh) => `${d}T${hh}:00+02:00`;
const epoch = (s) => Math.floor(Date.parse(s) / 1000);
async function seed(env, nights) {
  const st = [], S = env.DB.prepare("INSERT OR IGNORE INTO samples(metric,ts,t,value) VALUES(?,?,?,?)"), L = env.DB.prepare("INSERT OR IGNORE INTO sleep(start,end,stage) VALUES(?,?,?)");
  for (let i = 0; i < nights; i++) {
    const d = day(i), p = day(i + 1);
    for (const hh of ["01:00", "03:00", "05:00"]) st.push(S.bind("hrv", ts(d, hh), epoch(ts(d, hh)), 70 + (i % 3)));
    st.push(S.bind("fcr", ts(d, "09:00"), epoch(ts(d, "09:00")), 50 + (i % 2)));
    st.push(L.bind(ts(p, "23:30"), ts(d, "02:00"), "core"), L.bind(ts(d, "02:00"), ts(d, "03:30"), "deep"), L.bind(ts(d, "03:30"), ts(d, "07:00"), "rem"));
  }
  await env.DB.batch(st);
}
const status = async (env) => (await call(env, "/api/settaggio", { code: CODE })).data;

test("settaggio: con poche notti non è pronto e dice quanto manca", async () => {
  const env = makeEnv(); await setup(env); await seed(env, 6);
  await call(env, "/api/profilo", { method: "POST", code: CODE, body: { eta: 21 } });
  const s = await status(env);
  assert.equal(s.pronto, false);
  assert.equal(s.notti_hrv, 6); assert.equal(s.mancano, 8);
  assert.equal(s.controlli.profilo, true); assert.equal(s.controlli.sync, false);
});

test("settaggio: pronto con 14 notti e l'età, e resta pronto", async () => {
  const env = makeEnv(); await setup(env); await seed(env, 20);
  assert.equal((await status(env)).pronto, false, "senza età le zone di FC sarebbero generiche");
  await call(env, "/api/profilo", { method: "POST", code: CODE, body: { eta: 21 } });
  assert.equal((await status(env)).pronto, true);
  // a few nights deleted later do not bring the set-up back
  await env.DB.prepare("DELETE FROM samples WHERE metric = 'hrv'").run();
  assert.equal((await status(env)).pronto, true);
});

test("settaggio ricominciato: si riparte da oggi, coach e allenamento non usano lo score", async () => {
  const seen = [];
  const env = makeEnv({ AI: { run: async (_m, { messages }) => { seen.push(messages); return { response: "ok" }; } } });
  await setup(env); await seed(env, 30); await checkinToday(env);
  await call(env, "/api/profilo", { method: "POST", code: CODE, body: { eta: 21, sport: ["nuoto", "bici"] } });
  assert.equal((await status(env)).pronto, true);
  const s = (await call(env, "/api/settaggio", { method: "POST", code: CODE, body: { ricomincia: true } })).data;
  assert.equal(s.pronto, false); assert.equal(s.dal, today); assert.equal(s.giorno, 1);
  await call(env, "/api/coach/oggi", { method: "POST", code: CODE, body: {} });
  const prompt = seen.at(-1)[1].content;
  assert.match(prompt, /KAIRO È IN SETTAGGIO/);
  assert.match(prompt, /recupero in settaggio/); assert.doesNotMatch(prompt, /Recupero medio/);
  const w = (await call(env, "/api/allenamento/oggi", { method: "POST", code: CODE, body: {} })).data;
  assert.equal(w.intensita === "intenso", false);
});

test("altri sport: salvati nel profilo, accettati nel check-in e nell'esito", async () => {
  const env = makeEnv(); await setup(env);
  const p = (await call(env, "/api/profilo", { method: "POST", code: CODE, body: { eta: 21, sport: ["palestra"], altri_sport: ["calcio", "padel", "golf"] } })).data;
  assert.deepEqual((p.profilo || p).altri_sport, ["calcio", "padel"]);
  await call(env, "/api/checkin", { method: "POST", code: CODE, body: { day: today, energia: 4, attivita: ["padel"], rpe: 7, durata_min: 90 } });
  assert.equal((await env.DB.prepare("SELECT attivita FROM checkin WHERE day = ?").bind(today).first()).attivita, "padel");
  const e = (await call(env, "/api/allenamento/esito", { method: "POST", code: CODE, body: { stato: "altro", sport: "calcio" } })).data;
  assert.equal(e.sport, "calcio");
});
