import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setup, CODE } from "./helpers.js";

test("notte completata dopo la sveglia: i testi del giorno si rifanno solo se arrivano dati nuovi", async () => {
  const env = makeEnv(); await setup(env);
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());
  const cache = () => env.DB.batch([today, "A:" + today].map((k) => env.DB.prepare("INSERT OR REPLACE INTO advice(day,text,created) VALUES(?,'vecchio',?)").bind(k, new Date().toISOString())));
  const count = async () => (await env.DB.prepare("SELECT count(*) n FROM advice WHERE day IN (?,?)").bind(today, "A:" + today).first()).n;
  const t = new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 19) + "Z", e = new Date(Date.now() - 2 * 36e5).toISOString().slice(0, 19) + "Z";
  const night = { hrv_valori: "62", hrv_date: t, sonno_valori: "Profondo", sonno_date: t, sonno_fine: e };
  await cache();
  await call(env, "/api/ingest", { method: "POST", code: CODE, body: night });
  assert.equal(await count(), 0, "notte nuova: testi da rifare");
  await cache();
  await call(env, "/api/ingest", { method: "POST", code: CODE, body: night });
  assert.equal(await count(), 2, "stessi dati reinviati: niente da rifare");
  await call(env, "/api/ingest", { method: "POST", code: CODE, body: { passi_valori: "5000", passi_date: t } });
  assert.equal(await count(), 2, "i passi non toccano la notte");
});
