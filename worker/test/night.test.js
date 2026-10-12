import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setup, CODE } from "./helpers.js";

test("notte completata dopo la sveglia: i testi del giorno si rifanno solo se arrivano dati nuovi", async () => {
  const env = makeEnv(); await setup(env);
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());
  const cache = () => env.DB.batch([today, "A:" + today].map((k) => env.DB.prepare("INSERT OR REPLACE INTO advice(day,text,created) VALUES(?,'vecchio',?)").bind(k, new Date().toISOString())));
  const count = async () => (await env.DB.prepare("SELECT count(*) n FROM advice WHERE day IN (?,?)").bind(today, "A:" + today).first()).n;
  const yesterday = new Date(Date.parse(today + "T12:00:00Z") - 86400e3).toISOString().slice(0, 10);
  const t = `${today}T03:00:00+02:00`, e = `${today}T04:00:00+02:00`;
  const night = { hrv_valori: "62", hrv_date: t, sonno_valori: "Profondo", sonno_date: t, sonno_fine: e };
  await cache();
  await call(env, "/api/ingest", { method: "POST", code: CODE, body: night });
  assert.equal(await count(), 0, "notte nuova: testi da rifare");
  await cache();
  await call(env, "/api/ingest", { method: "POST", code: CODE, body: night });
  assert.equal(await count(), 2, "stessi dati reinviati: niente da rifare");
  await call(env, "/api/ingest", { method: "POST", code: CODE, body: { passi_valori: "5000", passi_date: t } });
  assert.equal(await count(), 2, "i passi non toccano la notte");
  await call(env, "/api/ingest", { method: "POST", code: CODE, body: { hrv_valori: "70", hrv_date: `${yesterday}T15:00:00+02:00` } });
  assert.equal(await count(), 2, "l'HRV misurata di giorno non rifà i testi");
  // the night lasted 03:00-04:00: an HRV at 06:00 (after waking up) changes nothing, one at 03:30 does
  await call(env, "/api/ingest", { method: "POST", code: CODE, body: { hrv_valori: "66", hrv_date: `${today}T06:00:00+02:00` } });
  assert.equal(await count(), 2, "HRV dopo il risveglio: niente da rifare");
  await call(env, "/api/ingest", { method: "POST", code: CODE, body: { hrv_valori: "64", hrv_date: `${today}T03:30:00+02:00` } });
  assert.equal(await count(), 0, "HRV durante il sonno: testi da rifare");
});
