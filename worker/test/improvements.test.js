import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setup, CODE, checkinToday, setupDone } from "./helpers.js";
import { detectSessions } from "../src/load.js";
import { muscleFatigue } from "../src/strength.js";
import { hrZones } from "../src/workout.js";

test("allenamenti rilevati dal battito: almeno 10 minuti sopra il 60% della FC max", () => {
  const s = [];
  for (let m = 0; m < 30; m++) s.push({ t: m * 60, v: 70 });            // at rest
  for (let m = 30; m < 75; m++) s.push({ t: m * 60, v: 145 });          // 45 min of training
  for (let m = 75; m < 80; m++) s.push({ t: m * 60, v: 70 });
  for (let m = 80; m < 86; m++) s.push({ t: m * 60, v: 150 });          // 6 min: too short
  const x = detectSessions(s, 193);
  assert.equal(x.length, 1); assert.equal(x[0].minuti, 44); assert.equal(x[0].fc_media, 145); assert.ok(x[0].trimp > 0);
});

test("zone di frequenza cardiaca dalla FC massima", () => {
  assert.deepEqual(hrZones(200)[1], { z: 2, min: 120, max: 140 });
});

test("esito dell'allenamento salvato e restituito con la proposta", async () => {
  const env = makeEnv(); await setup(env); await checkinToday(env); await setupDone(env);
  assert.equal((await call(env, "/api/allenamento/esito", { method: "POST", code: CODE, body: { stato: "boh" } })).status, 400);
  await call(env, "/api/allenamento/esito", { method: "POST", code: CODE, body: { stato: "altro", sport: "nuoto" } });
  const w = (await call(env, "/api/allenamento/oggi", { method: "POST", code: CODE, body: {} })).data;
  assert.deepEqual(w.esito, { stato: "altro", sport: "nuoto" });
});

test("esercizio non riconosciuto collegato a mano a un muscolo", async () => {
  const env = makeEnv(); await setup(env);
  await env.DB.prepare("INSERT INTO sets(start,exercise,set_index,weight,reps) VALUES(?,?,0,30,10)").bind(new Date(Date.now() - 36e5).toISOString().slice(0, 19), "Macchina strana").run();
  let f = (await call(env, "/api/forza", { code: CODE })).data;
  assert.ok(f.non_riconosciuti.includes("Macchina strana"));
  assert.equal((await call(env, "/api/muscoli", { method: "POST", code: CODE, body: { esercizio: "Macchina strana", muscolo: "naso" } })).status, 400);
  await call(env, "/api/muscoli", { method: "POST", code: CODE, body: { esercizio: "Macchina strana", muscolo: "petto" } });
  f = (await call(env, "/api/forza", { code: CODE })).data;
  assert.ok(!f.non_riconosciuti.includes("Macchina strana"));
  assert.ok((await muscleFatigue(env.DB)).some((m) => m.muscolo === "petto"));
});
