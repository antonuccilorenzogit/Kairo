import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setup, CODE } from "./helpers.js";
import { computeDay } from "../src/metrics.js";

const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());
const day = (n) => new Date(Date.parse(today + "T12:00:00Z") - n * 86400e3).toISOString().slice(0, 10);
const ts = (d, hh) => `${d}T${hh}:00+02:00`;
// 40 nights: HRV around 70 (3 readings per night), resting HR 50, 7.5 h of sleep with stages
async function seed(env, { hrv = () => 70 } = {}) {
  const st = [];
  const S = env.DB.prepare("INSERT OR IGNORE INTO samples(metric,ts,t,value) VALUES(?,?,?,?)"), L = env.DB.prepare("INSERT OR IGNORE INTO sleep(start,end,stage) VALUES(?,?,?)");
  for (let i = 0; i < 40; i++) {
    const d = day(i), p = day(i + 1);
    for (const [hh, k] of [["01:00", 0], ["03:00", 1], ["05:00", 2]]) st.push(S.bind("hrv", ts(d, hh), Math.floor(Date.parse(ts(d, hh)) / 1000), hrv(i) + (i % 3) - 1 + k));
    st.push(S.bind("fcr", ts(d, "09:00"), Math.floor(Date.parse(ts(d, "09:00")) / 1000), 50 + (i % 2)));
    st.push(L.bind(ts(p, "23:30"), ts(d, "02:00"), "core"), L.bind(ts(d, "02:00"), ts(d, "03:30"), "deep"), L.bind(ts(d, "03:30"), ts(d, "05:30"), "rem"), L.bind(ts(d, "05:30"), ts(d, "07:00"), "core"));
  }
  await env.DB.batch(st);
}

test("recupero: componenti nuove, check-in, incertezza, spiegazione", async () => {
  const env = makeEnv(); await setup(env); await seed(env);
  let d = await computeDay(env.DB, today);
  const r = d.recupero;
  assert.ok(r.score != null); assert.equal(r.affidabilita, "alta");
  assert.ok(r.componenti.stabilita_hrv.punteggio != null, "stabilità HRV calcolata");
  assert.ok(r.incertezza > 0); assert.ok(Array.isArray(r.spiegazione));
  assert.equal(r.componenti.soggettivo.punteggio, null);
  // check-in: feeling bad lowers the score
  await env.DB.prepare("INSERT INTO checkin(day, energia, dolori, umore) VALUES(?, 1, 5, 1)").bind(today).run();
  d = await computeDay(env.DB, today);
  assert.equal(d.recupero.componenti.soggettivo.punteggio, 0);
  assert.ok(d.recupero.score < r.score);
});

test("recupero: i giorni con alcol o malanno non entrano nelle medie", async () => {
  const env = makeEnv(); await setup(env);
  // HRV collapsed for 10 days in the past, tagged as illness
  await seed(env, { hrv: (i) => (i >= 5 && i < 15 ? 30 : 70) });
  const a = await computeDay(env.DB, today);
  const st = env.DB.prepare("INSERT INTO checkin(day, tag) VALUES(?, 'malanno')");
  await env.DB.batch(Array.from({ length: 10 }, (_, k) => st.bind(day(5 + k))));
  const b = await computeDay(env.DB, today);
  assert.ok(b.recupero.componenti.hrv.baseline > a.recupero.componenti.hrv.baseline, "media senza i giorni di malanno");
});

test("verifica personale: servono almeno 10 sedute", async () => {
  const env = makeEnv(); await setup(env);
  const v = (await call(env, "/api/recupero/verifica", { code: CODE })).data;
  assert.equal(v.pronto, false); assert.match(v.messaggio, /10 sedute/);
});

test("check-in con etichette valide", async () => {
  const env = makeEnv(); await setup(env);
  await call(env, "/api/checkin", { method: "POST", code: CODE, body: { day: today, energia: 3, tag: ["alcol", "pizza"] } });
  assert.equal((await env.DB.prepare("SELECT tag FROM checkin WHERE day = ?").bind(today).first()).tag, "alcol");
});

test("recupero: con una sola misura strana lo score non crolla (al massimo −15 da ieri)", async () => {
  const env = makeEnv(); await setup(env); await seed(env);
  const y = (await computeDay(env.DB, day(1))).recupero.score;
  await env.DB.prepare("DELETE FROM samples WHERE metric IN ('hrv','fcr') AND ts LIKE ?").bind(today + "%").run();
  await env.DB.prepare("INSERT INTO samples(metric,ts,t,value) VALUES('hrv',?,?,25)").bind(ts(today, "03:00"), Math.floor(Date.parse(ts(today, "03:00")) / 1000)).run();
  const d = (await computeDay(env.DB, today)).recupero;
  assert.equal(d.affidabilita, "bassa");
  assert.ok(d.score >= y - 15, `${d.score} vs ieri ${y}`);
});
