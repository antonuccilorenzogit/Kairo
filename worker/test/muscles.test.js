import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setup, CODE } from "./helpers.js";
import { muscleFatigue, routineFatigue } from "../src/strength.js";

test("fatica per muscolo: serie recenti, volume settimanale e scheda più fresca", async () => {
  const env = makeEnv(); await setup(env);
  const ago = (h) => new Date(Date.now() - h * 36e5).toISOString().slice(0, 19);
  const sets = (start, exercise, n) => Array.from({ length: n }, (_, i) => ({ start, exercise, set_index: i, weight: 60, reps: 8 }));
  const st = env.DB.prepare("INSERT INTO sets(start,exercise,set_index,weight,reps) VALUES(?,?,?,?,?)");
  await env.DB.batch([...sets(ago(10), "Squat", 5), ...sets(ago(10), "Leg curl", 3), ...sets(ago(80), "Panca piana", 4)].map((x) => st.bind(x.start, x.exercise, x.set_index, x.weight, x.reps)));
  const f = Object.fromEntries((await muscleFatigue(env.DB)).map((x) => [x.muscolo, x]));
  assert.equal(f.quadricipiti.stato, "in recupero"); assert.equal(f.quadricipiti.serie_7g, 5);
  assert.equal(f.petto.stato, "fresco", "dopo 72 ore il petto è recuperato");
  assert.equal(f.petto.volume, "basso");
  const gambe = { esercizi: [{ nome: "Squat" }, { nome: "Leg curl" }] }, petto = { esercizi: [{ nome: "Panca piana" }] };
  assert.ok(routineFatigue(gambe, Object.values(f)) > routineFatigue(petto, Object.values(f)));
  const api = (await call(env, "/api/forza", { code: CODE })).data;
  assert.ok(api.muscoli.some((m) => m.muscolo === "quadricipiti"));
});
