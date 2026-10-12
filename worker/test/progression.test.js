import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setup, CODE } from "./helpers.js";
import { proposeTop, proposeClassic, kgStep } from "../src/progression.js";

const PANCA = { nome: "Panca piana", serie: 3, min: 5, max: 7, metodo: "top", backoff: 12, drop: true };
const last = (top, rpe, backs = [], storia = []) => ({ serie: [{ tipo: "top", kg: top[0], reps: top[1], rpe }, ...backs.map(([kg, reps]) => ({ tipo: "backoff", kg, reps, rpe: 8 }))], storia });

test("pesante: 7+ ripetizioni → si sale, di più se era facile, si aspetta se era al limite", () => {
  assert.equal(proposeTop(PANCA, last([100, 7], 8.5)).serie[0].kg, 102.5, "giusta: +1 incremento");
  assert.equal(proposeTop(PANCA, last([100, 7], 7)).serie[0].kg, 105, "facile: +2 incrementi");
  assert.equal(proposeTop(PANCA, last([100, 9], 8.5)).serie[0].kg, 105, "2 ripetizioni oltre il range: +2");
  assert.equal(proposeTop(PANCA, last([100, 7], 10)).serie[0].kg, 100, "al limite con 7: resta");
  assert.equal(proposeTop(PANCA, last([100, 8], 10)).serie[0].kg, 102.5, "al limite ma 8: +1");
  assert.equal(proposeTop(PANCA, last([100, 6], 8.5)).serie[0].kg, 100, "dentro il range: stesso carico");
  assert.equal(proposeTop(PANCA, last([100, 4], 8.5)).serie[0].kg, 97.5, "sotto il range: −1");
  assert.equal(proposeTop(PANCA, last([100, 3], 10)).serie[0].kg, 95, "molto sotto e al limite: −2");
});

test("back-off e drop seguono la pesante e si adattano alle ripetizioni fatte", () => {
  const p = proposeTop(PANCA, last([100, 7], 8.5, [[87.5, 8], [87.5, 8]]));
  assert.deepEqual(p.serie.map((x) => x.tipo), ["top", "backoff", "backoff", "dropset"]);
  assert.equal(p.serie[1].kg, 90, "stessa percentuale (−12,5%) sulla nuova pesante");
  assert.deepEqual([p.serie[1].min, p.serie[1].max], [7, 9]);
  assert.equal(p.serie[3].kg, 67.5, "drop −25% dalla back-off");
  const up = proposeTop(PANCA, last([100, 6], 8.5, [[87.5, 9], [87.5, 9]]));
  assert.ok(up.serie[1].kg > 87.5, "back-off tutte in cima → più pesanti");
  const down = proposeTop(PANCA, last([100, 6], 8.5, [[87.5, 5], [87.5, 6]]));
  assert.ok(down.serie[1].kg < 87.5, "back-off sotto il range → più leggere");
  assert.match(proposeTop(PANCA, last([100, 7], 8.5)).riscaldamento, /52,5 kg × 8 · 72,5 kg × 4 · 87,5 kg × 2/);
});

test("stallo, scarico, prima volta e incrementi per tipo di esercizio", () => {
  const st = [{ kg: 100, reps_top: 6 }, { kg: 100, reps_top: 6 }, { kg: 100, reps_top: 6 }];
  assert.equal(proposeTop(PANCA, last([100, 6], 8.5, [], st)).serie[0].kg, 90);
  const d = proposeTop(PANCA, last([100, 7], 8.5, [[87.5, 8], [87.5, 8]]), { scarico: true });
  assert.equal(d.serie[0].kg, 92.5); assert.equal(d.serie.filter((x) => x.tipo === "backoff").length, 1); assert.ok(!d.serie.some((x) => x.tipo === "dropset"));
  const first = proposeTop(PANCA, null);
  assert.equal(first.serie[0].kg, null); assert.match(first.consiglio, /Prima volta/);
  assert.equal(kgStep(140, "Squat"), 5); assert.equal(kgStep(12, "Curl manubri"), 1); assert.equal(kgStep(80, "Panca piana"), 2.5);
  // straight sets keep the double progression
  const c = proposeClassic({ nome: "Rematore", serie: 3, min: 8, max: 10 }, { serie: [{ kg: 60, reps: 10 }, { kg: 60, reps: 10 }, { kg: 60, reps: 10 }], storia: [{ kg: 60, reps: 30, rpe: 8 }] });
  assert.equal(c.serie[0].kg, 62.5); assert.equal(c.serie.length, 3);
});

test("dall'app: scheda con pesante + back-off, seduta salvata con i tipi di serie, proposta della volta dopo", async () => {
  const env = makeEnv(); await setup(env);
  const r = await call(env, "/api/schede", { method: "PUT", code: CODE, body: { schede: [{ id: "a", nome: "A", esercizi: [{ nome: "Panca piana", serie: 3, min: 5, max: 7, metodo: "top", backoff: 12, drop: true }, { nome: "Croci", serie: 3, min: 12, max: 15 }] }] } });
  assert.equal(r.data.schede[0].esercizi[0].metodo, "top"); assert.equal(r.data.schede[0].esercizi[1].metodo, undefined);
  const start = "2026-10-05T18:00:00+02:00";
  await call(env, "/api/forza", { method: "POST", code: CODE, body: { serie: [
    { start, exercise: "Panca piana", set_index: 0, set_type: "top", weight: 100, reps: 8, rpe: 7 },
    { start, exercise: "Panca piana", set_index: 1, set_type: "backoff", weight: 87.5, reps: 9, rpe: 8 },
    { start, exercise: "Panca piana", set_index: 2, set_type: "backoff", weight: 87.5, reps: 9, rpe: 8 },
    { start, exercise: "Panca piana", set_index: 3, set_type: "dropset", weight: 65, reps: 12, rpe: 8 }] } });
  const p = (await call(env, "/api/schede", { code: CODE })).data.proposte.a[0];
  assert.equal(p.serie[0].kg, 105, "8 ripetizioni facili → +5 kg");
  assert.ok(p.serie[1].kg > 90);
  assert.match(p.consiglio, /Ultima pesante: 100 kg × 8 \(facile\)/);
});
