import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setup, CODE, checkinToday, setupDone, count } from "./helpers.js";

const day = (n) => new Date(Date.parse("2026-10-11T12:00:00Z") - n * 86400e3).toISOString().slice(0, 10);
const ts = (d, hh = "03:00") => `${d}T${hh}:00+02:00`;
const epoch = (s) => Math.floor(Date.parse(s) / 1000);

// 40 nights of 8 h (23:00 → 07:00), HRV 70, resting HR 50, steady load
async function seed(env) {
  const db = env.DB, st = [];
  for (let i = 0; i < 40; i++) {
    const d = day(i), prev = day(i + 1);
    st.push(db.prepare("INSERT INTO samples(metric,ts,t,value) VALUES('hrv',?,?,70)").bind(ts(d), epoch(ts(d))));
    st.push(db.prepare("INSERT INTO samples(metric,ts,t,value) VALUES('fcr',?,?,50)").bind(ts(d, "08:00"), epoch(ts(d, "08:00"))));
    st.push(db.prepare("INSERT INTO sleep(start,end,stage) VALUES(?,?,'core')").bind(ts(prev, "23:00"), ts(d, "02:00")));
    st.push(db.prepare("INSERT INTO sleep(start,end,stage) VALUES(?,?,'deep')").bind(ts(d, "02:00"), ts(d, "03:30")));
    st.push(db.prepare("INSERT INTO sleep(start,end,stage) VALUES(?,?,'rem')").bind(ts(d, "03:30"), ts(d, "05:30")));
    st.push(db.prepare("INSERT INTO sleep(start,end,stage) VALUES(?,?,'core')").bind(ts(d, "05:30"), ts(d, "07:00")));
    st.push(db.prepare("INSERT INTO daily(metric,day,value) VALUES('trimp',?,100)").bind(d));
  }
  await db.batch(st);
  await call(env, "/api/profilo", { method: "POST", code: CODE, body: { sveglia: "07:00", sonno_min: 480 } });
}
const dayData = async (env, d = day(0)) => (await call(env, `/api/day?d=${d}`, { code: CODE })).data;
const watchNap = (env, d, from, to, stage = "core") =>
  env.DB.prepare("INSERT INTO sleep(start,end,stage) VALUES(?,?,?)").bind(ts(d, from), ts(d, to), stage).run();

test("pisolino dal Watch: meno sonno stanotte, a letto più tardi", async () => {
  const env = makeEnv(); await setup(env); await seed(env);
  let d = await dayData(env);
  assert.equal(d.sonno_stanotte.fabbisogno_min, 480); assert.equal(d.sonno_stanotte.a_letto, "22:45");
  assert.equal(d.pisolini, null);
  await watchNap(env, day(0), "14:00", "14:45");
  d = await dayData(env);
  assert.equal(d.pisolini.totale_min, 45);
  assert.equal(d.pisolini.sessioni[0].manuale, null);
  assert.equal(d.sonno.durata_min, 480, "la notte resta la notte");
  assert.equal(d.sonno_stanotte.pisolino_min, 45);
  assert.equal(d.sonno_stanotte.fabbisogno_min, 435);
  assert.equal(d.sonno_stanotte.a_letto, "23:30");
});

test("un pisolino lungo non porta il fabbisogno della notte sotto le 6 ore", async () => {
  const env = makeEnv(); await setup(env); await seed(env);
  await watchNap(env, day(0), "13:00", "15:30"); // 2 h 30 → sarebbe 5 h 30
  const d = await dayData(env);
  assert.equal(d.sonno_stanotte.fabbisogno_min, 360);
  assert.equal(d.sonno_stanotte.pisolino_min, 120);
});

test("i pisolini sotto i 10 minuti non contano", async () => {
  const env = makeEnv(); await setup(env); await seed(env);
  await watchNap(env, day(0), "14:00", "14:08");
  const d = await dayData(env);
  assert.equal(d.pisolini, null); assert.equal(d.sonno_stanotte.fabbisogno_min, 480);
});

test("il pisolino di ieri riduce il debito e conta nel bilancio di oggi; quello di oggi no", async () => {
  const env = makeEnv(); await setup(env); await seed(env);
  // three short nights (6 h: 01:00 → 07:00) → a debt
  for (const i of [0, 1, 2]) await env.DB.prepare("DELETE FROM sleep WHERE start = ?").bind(ts(day(i + 1), "23:00")).run();
  for (const i of [0, 1, 2]) await env.DB.prepare("INSERT INTO sleep(start,end,stage) VALUES(?,?,'core')").bind(ts(day(i), "01:00"), ts(day(i), "02:00")).run();
  const before = await dayData(env);
  assert.equal(before.sonno_stanotte.debito_7g_min, 360);
  const balanceBefore = before.recupero.componenti.sonno.bilancio_min;
  await watchNap(env, day(1), "14:00", "15:00");
  const after = await dayData(env);
  assert.equal(after.sonno_stanotte.debito_7g_min, 300, "il pisolino di ieri ha ridotto il debito");
  assert.ok(after.recupero.componenti.sonno.bilancio_min > balanceBefore, "e conta nel bilancio di 14 notti");
  // today's nap: off tonight's need, not in today's balance (the recovery is the morning's picture)
  await watchNap(env, day(0), "14:00", "14:30");
  const today = await dayData(env);
  assert.equal(today.recupero.componenti.sonno.bilancio_min, after.recupero.componenti.sonno.bilancio_min);
  assert.equal(today.sonno_stanotte.fabbisogno_min, after.sonno_stanotte.fabbisogno_min - 30);
  // ...and it pays back the week's debt minute for minute
  assert.equal(today.sonno_stanotte.debito_7g_min, 270);
  assert.equal(today.sonno_stanotte.debito_pagato_min, 30);
});

test("senza debito il pisolino non crea un credito, ma abbassa comunque il fabbisogno", async () => {
  const env = makeEnv(); await setup(env); await seed(env);
  await watchNap(env, day(0), "14:00", "15:00");
  const d = await dayData(env);
  assert.equal(d.sonno_stanotte.debito_7g_min, 0); assert.equal(d.sonno_stanotte.debito_pagato_min, 0);
  assert.equal(d.sonno_stanotte.fabbisogno_min, 420);
});

test("in settaggio il pisolino cambia già fabbisogno e ora di andare a letto", async () => {
  const env = makeEnv(); await setup(env);
  await call(env, "/api/profilo", { method: "POST", code: CODE, body: { sveglia: "07:00", sonno_min: 480 } });
  // 3 nights only: Kairo is still in its set-up period
  const st = [];
  for (const i of [0, 1, 2]) st.push(env.DB.prepare("INSERT INTO sleep(start,end,stage) VALUES(?,?,'core')").bind(ts(day(i + 1), "23:00"), ts(day(i), "07:00")));
  await env.DB.batch(st);
  await watchNap(env, day(0), "15:00", "15:45");
  const d = await dayData(env);
  assert.equal(d.settaggio.pronto, false);
  assert.equal(d.sonno_stanotte.fabbisogno_min, 435);
  assert.equal(d.sonno_stanotte.a_letto, "23:30");
});

// local ISO time in Europe/Rome, n minutes ago
const localIso = (minAgo) => {
  const dt = new Date(Date.now() - minAgo * 60e3);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(dt).map((x) => [x.type, x.value]));
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  const off = Math.round((local - Math.floor(dt.getTime() / 60e3) * 60e3) / 60e3);
  const sign = off >= 0 ? "+" : "-", a = Math.abs(off);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
};

test("pisolino segnato a mano: si salva, non si sovrappone, si elimina", async () => {
  const env = makeEnv(); await setup(env);
  await call(env, "/api/profilo", { method: "POST", code: CODE, body: { sveglia: "07:00", sonno_min: 480 } });
  const inizio = localIso(50), fine = localIso(10), d = fine.slice(0, 10);
  const r = await call(env, "/api/pisolino", { method: "POST", code: CODE, body: { inizio, fine } });
  assert.equal(r.status, 200); assert.equal(r.data.min, 40);
  if (inizio.slice(0, 10) === d) { // not across midnight
    const x = await dayData(env, d);
    assert.equal(x.pisolini.totale_min, 40);
    assert.equal(x.pisolini.sessioni[0].manuale, inizio);
    assert.equal(x.sonno_stanotte.pisolino_min, 40);
  }
  // the same time twice is refused (never counted twice)
  assert.equal((await call(env, "/api/pisolino", { method: "POST", code: CODE, body: { inizio: localIso(30), fine: localIso(5) } })).status, 400);
  // limits
  assert.equal((await call(env, "/api/pisolino", { method: "POST", code: CODE, body: { inizio: localIso(400), fine: localIso(60) } })).status, 400, "oltre 4 ore");
  assert.equal((await call(env, "/api/pisolino", { method: "POST", code: CODE, body: { inizio: localIso(-10), fine: localIso(-60) } })).status, 400, "nel futuro");
  assert.equal((await call(env, "/api/pisolino", { method: "POST", code: CODE, body: { inizio: "ieri", fine: localIso(5) } })).status, 400);
  // delete
  await call(env, `/api/pisolino?inizio=${encodeURIComponent(inizio)}`, { method: "DELETE", code: CODE });
  assert.equal(await count(env, "pisolini"), 0);
});

test("pisolino registrato dal Watch e anche a mano: conta una volta sola", async () => {
  const env = makeEnv(); await setup(env); await seed(env);
  await watchNap(env, day(0), "14:00", "14:40");
  await env.DB.prepare("INSERT INTO pisolini(start,end,created) VALUES(?,?,?)").bind(ts(day(0), "14:10"), ts(day(0), "14:50"), "x").run();
  const d = await dayData(env);
  assert.equal(d.pisolini.totale_min, 50, "14:00 → 14:50, i minuti in comune contano una volta");
  assert.equal(d.pisolini.sessioni[0].manuale, ts(day(0), "14:10"));
});

test("pisolini nel backup e ripristino", async () => {
  const env = makeEnv(); await setup(env);
  await env.DB.prepare("INSERT INTO pisolini(start,end,created) VALUES(?,?,?)").bind(ts(day(0), "14:00"), ts(day(0), "14:30"), "x").run();
  const exp = (await call(env, "/api/export", { code: CODE })).data;
  assert.equal(exp.pisolini.length, 1);
  const env2 = makeEnv(); await setup(env2);
  await call(env2, "/api/ripristina", { method: "POST", code: CODE, body: exp });
  assert.equal(await count(env2, "pisolini"), 1);
});

test("infortunio: segno se ho fatto gli esercizi, il coach lo sa", async () => {
  const seen = [];
  const env = makeEnv({ AI: { run: async (_m, { messages }) => { seen.push(messages); return { response: "ok" }; } } });
  await setup(env); await checkinToday(env); await setupDone(env);
  const plan = (body = {}) => call(env, "/api/allenamento/oggi", { method: "POST", code: CODE, body });
  assert.equal((await call(env, "/api/infortunio/esito", { method: "POST", code: CODE, body: { stato: "fatto" } })).status, 400, "senza infortunio");
  await call(env, "/api/infortunio", { method: "POST", code: CODE, body: { attivo: true, descrizione: "distorsione caviglia destra" } });
  assert.equal((await plan()).data.esito, null);
  assert.equal((await call(env, "/api/infortunio/esito", { method: "POST", code: CODE, body: { stato: "boh" } })).status, 400);
  const r = await call(env, "/api/infortunio/esito", { method: "POST", code: CODE, body: { stato: "parte" } });
  assert.equal(r.data.stato, "parte");
  const p = (await plan()).data;
  assert.equal(p.esito, "parte"); assert.equal(p.cache, true, "segnarlo non rigenera il piano");
  // the coach's chat sees it
  await call(env, "/api/coach/chat", { method: "POST", code: CODE, body: { domanda: "come va?" } });
  assert.match(JSON.stringify(seen[seen.length - 1]), /fatti in parte/);
  // a new injury starts with an empty log
  await call(env, "/api/infortunio", { method: "POST", code: CODE, body: { attivo: false } });
  await call(env, "/api/infortunio", { method: "POST", code: CODE, body: { attivo: true, descrizione: "spalla" } });
  assert.equal((await plan()).data.esito, null);
});
