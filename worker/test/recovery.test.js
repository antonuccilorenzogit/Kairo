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

test("recupero: 5 ingredienti, segnali a parte, come ti senti fuori dallo score", async () => {
  const env = makeEnv(); await setup(env); await seed(env);
  let d = await computeDay(env.DB, today);
  const r = d.recupero;
  assert.ok(r.score != null); assert.equal(r.affidabilita, "alta");
  assert.deepEqual(Object.keys(r.componenti).sort(), ["carico", "fc_riposo", "hrv", "respirazione", "sonno"]);
  const pesi = Object.values(r.componenti).reduce((a, c) => a + c.peso, 0);
  assert.ok(Math.abs(pesi - 1) < 0.15, `pesi ${pesi}`);
  assert.ok(r.segnali.stabilita_hrv.punteggio != null, "stabilità HRV calcolata come segnale");
  assert.ok("ossigeno" in r.segnali && "bilancio_sonno" in r.segnali);
  assert.equal(r.componenti.sonno.bilancio_min, r.segnali.bilancio_sonno.valore);
  assert.ok(Array.isArray(r.spiegazione));
  assert.equal(r.segnali.soggettivo.punteggio, null);
  // check-in: how you feel is shown next to the score, it does not change it
  await env.DB.prepare("INSERT INTO checkin(day, energia, dolori, umore) VALUES(?, 1, 5, 1)").bind(today).run();
  d = await computeDay(env.DB, today);
  assert.equal(d.recupero.segnali.soggettivo.punteggio, 0);
  assert.equal(d.recupero.score, r.score);
});

test("infortunio: le medie ripartono dai giorni dopo l'infortunio", async () => {
  const env = makeEnv(); await setup(env);
  // HRV 70 before the injury (20 days ago), 50 after it
  await seed(env, { hrv: (i) => (i < 20 ? 50 : 70) });
  const a = (await computeDay(env.DB, today)).recupero;
  assert.ok(!a.nuova_base);
  await call(env, "/api/infortunio", { method: "POST", code: CODE, body: { attivo: true, descrizione: "menisco", dal: day(20) } });
  const b = (await computeDay(env.DB, today)).recupero;
  assert.equal(b.nuova_base, true);
  assert.ok(b.componenti.hrv.baseline < a.componenti.hrv.baseline, `${b.componenti.hrv.baseline} < ${a.componenti.hrv.baseline}`);
  assert.ok(b.score > a.score, "rispetto alla nuova fase l'HRV di oggi è normale");
});

test("un giorno bloccato con la formula vecchia viene ricalcolato", async () => {
  const env = makeEnv(); await setup(env); await seed(env);
  await env.DB.prepare("INSERT INTO recupero_giorno(day,dati,created) VALUES(?,?,?)").bind(today, JSON.stringify({ score: 3, calcolo: 1, componenti: {} }), new Date().toISOString()).run();
  const r = (await computeDay(env.DB, today)).recupero;
  assert.notEqual(r.score, 3);
  assert.ok(r.componenti.hrv);
});

test("verifica senza palestra: usa l'energia del check-in, che non entra nello score", async () => {
  const env = makeEnv(); await setup(env);
  // alternating good and bad nights; energy follows them
  await seed(env, { hrv: (i) => (i % 2 ? 40 : 95) });
  const st = env.DB.prepare("INSERT INTO checkin(day, energia) VALUES(?, ?)");
  await env.DB.batch(Array.from({ length: 30 }, (_, i) => st.bind(day(i + 1), i % 2 ? 4 : 2)));
  const v = (await call(env, "/api/recupero/verifica", { code: CODE })).data;
  assert.equal(v.pronto, true, v.messaggio); assert.equal(v.fonte, "energia");
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

test("HRV: 1 misura a notte è normale per chi ne fa sempre 1; il Respira del mattino ha la sua media", async () => {
  const env = makeEnv(); await setup(env); await seed(env);
  // keep only the 03:00 reading every night → this person usually has 1 reading
  await env.DB.prepare("DELETE FROM samples WHERE metric = 'hrv' AND ts NOT LIKE '%T03:00%'").run();
  let r = (await computeDay(env.DB, today)).recupero;
  assert.equal(r.componenti.hrv.misure_tipiche, 1);
  assert.notEqual(r.affidabilita, "bassa", "1 misura è il tuo solito");
  // a Breathe session after waking up (07:15) with a much higher HRV: not used until 5 mornings
  const S = env.DB.prepare("INSERT INTO samples(metric,ts,t,value) VALUES('hrv',?,?,?)");
  await S.bind(ts(today, "07:15"), Math.floor(Date.parse(ts(today, "07:15")) / 1000), 110).run();
  const before = r.score;
  r = (await computeDay(env.DB, today)).recupero;
  assert.equal(r.componenti.hrv.fonte, "notte"); assert.equal(r.score, before, "il Respira non gonfia il punteggio");
  await env.DB.batch([1, 2, 3, 4, 5, 6].map((i) => S.bind(ts(day(i), "07:15"), Math.floor(Date.parse(ts(day(i), "07:15")) / 1000), 105 + i)));
  r = (await computeDay(env.DB, today)).recupero;
  assert.equal(r.componenti.hrv.fonte, "mattino");
  assert.equal(r.affidabilita, "alta");
});

test("stima di domani: personale dopo 8 notti piene, generica prima", async () => {
  const env = makeEnv(); await setup(env); await seed(env);
  await call(env, "/api/profilo", { method: "POST", code: CODE, body: { sonno_min: 420 } }); // 7 h: the seeded nights are full
  const r = (await computeDay(env.DB, today)).recupero;
  assert.equal(r.domani_se_dormi.personale, true);
  assert.ok(r.domani_se_dormi.notti >= 8);
  assert.ok(r.domani_se_dormi.margine >= 4 && r.domani_se_dormi.margine <= 15);
  const env2 = makeEnv(); await setup(env2); await seed(env2);
  await call(env2, "/api/profilo", { method: "POST", code: CODE, body: { sonno_min: 540 } }); // 9 h: no full night
  const g = (await computeDay(env2.DB, today)).recupero.domani_se_dormi;
  assert.equal(g.personale, false); assert.equal(g.mancano, 8); assert.equal(g.margine, 12);
});

test("il recupero di oggi si blocca con check-in e notte completa: i dati arrivati dopo non lo cambiano", async () => {
  const env = makeEnv(); await setup(env); await seed(env);
  await env.DB.prepare("DELETE FROM samples WHERE metric = 'fcr' AND ts LIKE ?").bind(today + "%").run();
  await call(env, "/api/checkin", { method: "POST", code: CODE, body: { day: today, energia: 4, dolori: 2, umore: 4 } });
  const a = (await computeDay(env.DB, today)).recupero;
  assert.ok(a.bloccato, "bloccato");
  // Apple's resting HR arrives at 10:00, much higher than usual: today's score does not move
  await env.DB.prepare("INSERT INTO samples(metric,ts,t,value) VALUES('fcr',?,?,70)").bind(ts(today, "10:00"), Math.floor(Date.parse(ts(today, "10:00")) / 1000)).run();
  assert.equal((await computeDay(env.DB, today)).recupero.score, a.score);
  // editing the check-in unfreezes it: recomputed with everything
  await call(env, "/api/checkin", { method: "POST", code: CODE, body: { day: today, energia: 4, dolori: 2, umore: 4 } });
  assert.ok((await computeDay(env.DB, today)).recupero.score < a.score);
});

test("senza le fasi del sonno la sveglia del profilo segna il mattino: il Respira non finisce tra le misure della notte", async () => {
  const env = makeEnv(); await setup(env);
  await call(env, "/api/profilo", { method: "POST", code: CODE, body: { sveglia: "07:00" } });
  const S = env.DB.prepare("INSERT INTO samples(metric,ts,t,value) VALUES('hrv',?,?,?)");
  await env.DB.batch([[ts(today, "03:00"), 50], [ts(today, "07:10"), 95]].map(([x, v]) => S.bind(x, Math.floor(Date.parse(x) / 1000), v)));
  const d = await computeDay(env.DB, today);
  assert.equal(d.notte.hrv_mattino, 95);
  assert.equal(d.notte.hrv_ms, 50, "la notte resta senza il Respira");
});
