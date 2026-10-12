import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setup, CODE } from "./helpers.js";
import { lowestSleepingHr } from "../src/load.js";

test("FC nel sonno: media più bassa di 10 minuti, solo mentre dormi", () => {
  const s = (min, v) => ({ t: min * 60, v });
  const hr = [s(0, 60), s(5, 58), s(10, 57), s(60, 50), s(64, 49), s(68, 51), s(120, 55), s(200, 40)];
  assert.equal(lowestSleepingHr(hr, [[0, 150 * 60]]), 50, "il 40 è fuori dal sonno, conta 49-51");
  assert.equal(lowestSleepingHr(hr.slice(0, 4), [[0, 150 * 60]]), null, "troppo poche misure");
});

test("FC nel sonno calcolata all'arrivo dei dati e pronta alla sveglia", async () => {
  const env = makeEnv(); await setup(env);
  const day = new Date(Date.now() - 86400e3).toISOString().slice(0, 10), next = new Date().toISOString().slice(0, 10);
  // night 23:00 → 06:30 (UTC), one heart-rate sample every 4 minutes, lowest stretch around 03:00
  const times = [], vals = [];
  for (let m = 0; m < 450; m += 4) {
    const ts = new Date(Date.parse(`${day}T23:00:00Z`) + m * 60e3).toISOString().slice(0, 19) + "Z";
    times.push(ts); vals.push(m > 230 && m < 250 ? 46 : 55);
  }
  // awake in the evening, lower value that must be ignored
  times.push(`${day}T20:00:00Z`); vals.push(42);
  const body = { fc_valori: vals.join(";"), fc_date: times.join(";"), sonno_valori: "Principale", sonno_date: `${day}T23:00:00Z`, sonno_fine: `${next}T06:30:00Z` };
  await call(env, "/api/ingest", { method: "POST", code: CODE, body });
  const r = await env.DB.prepare("SELECT day, value FROM daily WHERE metric = 'fc_notte'").all();
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].day, next);
  assert.ok(r.results[0].value >= 46 && r.results[0].value < 50, `valore ${r.results[0].value}`);
});
