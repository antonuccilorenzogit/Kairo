import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeStages, computeHistory } from "../src/metrics.js";
import { parsePayload } from "../src/validate.js";
import { makeEnv } from "./helpers.js";
import { ensureSchema } from "../src/schema.js";

test("mergeStages: la fase più informativa vince sulle sovrapposizioni", () => {
  const out = mergeStages([
    { start: "2026-10-10T23:00:00+02:00", end: "2026-10-11T07:00:00+02:00", stage: "asleep" },
    { start: "2026-10-11T01:00:00+02:00", end: "2026-10-11T02:00:00+02:00", stage: "deep" },
    { start: "2026-10-10T22:30:00+02:00", end: "2026-10-11T07:30:00+02:00", stage: "inbed" },
  ]);
  const min = (st) => out.filter((x) => x.stage === st).reduce((a, x) => a + (Date.parse(x.end) - Date.parse(x.start)) / 60e3, 0);
  assert.equal(min("deep"), 60);
  assert.equal(min("asleep"), 420);
  assert.equal(min("inbed"), 60);
  for (let i = 1; i < out.length; i++) assert.ok(Date.parse(out[i].start) >= Date.parse(out[i - 1].end));
});

test("parsePayload: percentuali in frazione convertite", () => {
  const r = parsePayload({ grasso_pct_valori: "0.154", grasso_pct_date: "2026-06-07T17:33:42+02:00" });
  assert.equal(r.samples[0][3], 15.4);
});

async function seed(db, nights, { hrv = 70, fcr = 50 } = {}) {
  const stmts = [];
  for (let i = 0; i < nights; i++) {
    const d = new Date(Date.parse("2026-10-11T12:00:00Z") - i * 86400e3).toISOString().slice(0, 10);
    const prev = new Date(Date.parse(d + "T12:00:00Z") - 86400e3).toISOString().slice(0, 10);
    const h = typeof hrv === "function" ? hrv(i) : hrv;
    stmts.push(db.prepare("INSERT INTO samples(metric,ts,t,value) VALUES('hrv',?,?,?)").bind(`${d}T03:00:00+02:00`, Math.floor(Date.parse(`${d}T03:00:00+02:00`) / 1000), h));
    stmts.push(db.prepare("INSERT INTO samples(metric,ts,t,value) VALUES('fcr',?,?,?)").bind(`${d}T08:00:00+02:00`, Math.floor(Date.parse(`${d}T08:00:00+02:00`) / 1000), fcr));
    stmts.push(db.prepare("INSERT INTO sleep(start,end,stage) VALUES(?,?,'core')").bind(`${prev}T23:00:00+02:00`, `${d}T02:00:00+02:00`));
    stmts.push(db.prepare("INSERT INTO sleep(start,end,stage) VALUES(?,?,'deep')").bind(`${d}T02:00:00+02:00`, `${d}T03:30:00+02:00`));
    stmts.push(db.prepare("INSERT INTO sleep(start,end,stage) VALUES(?,?,'rem')").bind(`${d}T03:30:00+02:00`, `${d}T05:30:00+02:00`));
    stmts.push(db.prepare("INSERT INTO sleep(start,end,stage) VALUES(?,?,'core')").bind(`${d}T05:30:00+02:00`, `${d}T07:00:00+02:00`));
  }
  await db.batch(stmts);
}

test("orari identici ogni notte: regolarità (SRI) 100 e sonno pieno", async () => {
  const env = makeEnv(); await ensureSchema(env.DB); await seed(env.DB, 30);
  const h = await computeHistory(env.DB, "2026-10-11", 1);
  assert.equal(h[0].sonno.sri, 100);
  assert.equal(h[0].sonno.durata_min, 480);
  assert.equal(h[0].sonno.contributi.durata, 100);
});

test("recupero: valori uguali alla media → giallo/verde attorno a 60+, HRV crollata → più basso", async () => {
  const env = makeEnv(); await ensureSchema(env.DB); await seed(env.DB, 40, { hrv: (i) => (i === 0 ? 35 : 70 + (i % 3)) });
  const [today] = await computeHistory(env.DB, "2026-10-11", 1);
  const [yesterday] = await computeHistory(env.DB, "2026-10-10", 1);
  assert.ok(yesterday.recupero.score >= 60, `ieri ${yesterday.recupero.score}`);
  assert.ok(today.recupero.score < yesterday.recupero.score - 10, `oggi ${today.recupero.score}`);
  assert.ok(today.recupero.componenti.hrv.punteggio < 40);
});

test("recupero: senza dati nessun punteggio, nessun errore", async () => {
  const env = makeEnv(); await ensureSchema(env.DB);
  const [d] = await computeHistory(env.DB, "2026-10-11", 1);
  assert.equal(d.recupero.score, null);
  assert.equal(d.recupero.stato, "calibrazione");
});
