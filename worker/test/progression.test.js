import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setup, CODE } from "./helpers.js";
import { proposeTop, proposeClassic, kgStep, backoffFromTop, learnFatigue } from "../src/progression.js";

const PANCA = { nome: "Panca piana", serie: 3, min: 5, max: 7, metodo: "top", backoff: 12, drop: true };
const last = (top, rpe, backs = [], storia = []) => ({ serie: [{ tipo: "top", kg: top[0], reps: top[1], rpe }, ...backs.map(([kg, reps]) => ({ tipo: "backoff", kg, reps, rpe: 8 }))], storia });

// rpe of the heavy set = 10 − reps in reserve
const rpe = (rir) => 10 - rir;

test("pesante: ripetizioni + riserva decidono la prossima, mai più di +2 incrementi", () => {
  assert.equal(proposeTop(PANCA, last([100, 7], rpe(1))).serie[0].kg, 102.5, "7 con 1 in riserva: +1 incremento");
  assert.equal(proposeTop(PANCA, last([100, 7], rpe(3))).serie[0].kg, 105, "7 con 3+ in riserva: +2");
  assert.equal(proposeTop(PANCA, last([100, 10], rpe(3))).serie[0].kg, 105, "molto oltre: comunque +2 al massimo");
  assert.equal(proposeTop(PANCA, last([100, 7], rpe(0))).serie[0].kg, 100, "7 senza riserva: resta");
  assert.equal(proposeTop(PANCA, last([100, 8], rpe(0))).serie[0].kg, 102.5, "8 senza riserva: +1");
  assert.equal(proposeTop(PANCA, last([100, 6], rpe(1))).serie[0].kg, 100, "dentro il range: stesso carico");
  assert.equal(proposeTop(PANCA, last([100, 6], rpe(3))).serie[0].kg, 102.5, "dentro il range ma con tanto margine: +1");
  assert.equal(proposeTop(PANCA, last([100, 4], rpe(1))).serie[0].kg, 97.5, "sotto il range: −1");
  assert.equal(proposeTop(PANCA, last([100, 3], rpe(0))).serie[0].kg, 95, "molto sotto e senza riserva: −2");
});

test("back-off dal massimale di oggi: giornata forte, normale, storta", () => {
  const ex = PANCA, f = 0.07, s = 2.5;
  assert.equal(backoffFromTop(100, 7, 3, ex, f, s), 97.5);
  assert.equal(backoffFromTop(100, 7, 1, ex, f, s), 92.5);
  assert.equal(backoffFromTop(100, 5, 0, ex, f, s), 85);
  const p = proposeTop(PANCA, last([100, 7], rpe(1), [[92.5, 8], [92.5, 8]]));
  assert.deepEqual(p.serie.map((x) => x.tipo), ["top", "backoff", "backoff", "dropset"]);
  assert.deepEqual([p.serie[1].min, p.serie[1].max], [7, 9]);
  assert.equal(p.bo_target, 8); assert.ok(p.fatica > 0.02 && p.fatica < 0.2);
  assert.equal(p.serie[3].kg, Math.max(2.5, Math.round(p.serie[1].kg * 0.75 / 2.5) * 2.5), "drop −25% dalla back-off");
  assert.match(proposeTop(PANCA, last([100, 7], rpe(1))).riscaldamento, /52,5 kg × 8 · 72,5 kg × 4 · 87,5 kg × 2/);
});

test("il calo dopo la pesante si impara dalle tue sedute", () => {
  // back-offs much weaker than predicted (12% instead of 7%) in 3 sessions → bigger fatigue, lighter back-offs
  const ses = (bk, br) => [{ tipo: "top", kg: 100, reps: 7, rpe: rpe(1) }, { tipo: "backoff", kg: bk, reps: br }, { tipo: "backoff", kg: bk, reps: br }];
  const weak = learnFatigue([ses(85, 8), ses(85, 8), ses(85, 8)]), strong = learnFatigue([ses(97.5, 8), ses(97.5, 8), ses(97.5, 8)]);
  assert.ok(weak.fatica > 0.09, `${weak.fatica}`); assert.ok(strong.fatica < 0.05, `${strong.fatica}`);
  assert.equal(learnFatigue([]).fatica, 0.07);
  // one odd session moves it only a little
  assert.ok(learnFatigue([ses(80, 8)]).fatica < 0.12);
});

test("stallo, scarico, prima volta e incrementi per tipo di esercizio", () => {
  const st = [{ kg: 100, reps_top: 6 }, { kg: 100, reps_top: 6 }, { kg: 100, reps_top: 6 }];
  assert.equal(proposeTop(PANCA, last([100, 6], rpe(1), [], st)).serie[0].kg, 90);
  const d = proposeTop(PANCA, last([100, 7], rpe(1), [[87.5, 8], [87.5, 8]]), { scarico: true });
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
    { start, exercise: "Panca piana", set_index: 0, set_type: "top", weight: 100, reps: 7, rpe: 7 },
    { start, exercise: "Panca piana", set_index: 1, set_type: "backoff", weight: 92.5, reps: 9, rpe: 8 },
    { start, exercise: "Panca piana", set_index: 2, set_type: "backoff", weight: 92.5, reps: 8, rpe: 8 },
    { start, exercise: "Panca piana", set_index: 3, set_type: "dropset", weight: 65, reps: 12, rpe: 8 }] } });
  const p = (await call(env, "/api/schede", { code: CODE })).data.proposte.a[0];
  assert.equal(p.serie[0].kg, 103.75, "7 con 3+ in riserva → dal massimale stimato, a passi da 1,25 kg (dischi più piccoli)");
  assert.match(p.consiglio, /Ultima pesante: 100 kg × 7 \(3\+ in riserva\)/);
  const ultimo = (await call(env, "/api/schede", { code: CODE })).data.ultimo["Panca piana"];
  assert.equal(ultimo.sessioni.length, 1); assert.equal(ultimo.sessioni[0].length, 4);
});

test("incremento minimo della palestra: pesi multipli dei dischi più piccoli, back-off sempre più leggera della pesante", () => {
  const alz = { nome: "Alzate laterali al cavo", serie: 2, min: 10, max: 12, metodo: "top" };
  const top = (kg, reps, rir) => ({ serie: [{ tipo: "top", kg, reps, rpe: 10 - rir }], storia: [] });
  assert.equal(kgStep(12, "Curl manubri", 1.25), 1.25, "1 kg non esiste: 1,25");
  assert.equal(kgStep(80, "Panca", 2), 2, "manubri da 2 in 2");
  const p = proposeTop(alz, top(5, 11, 2), { incremento: 1.25 });
  for (const x of p.serie) if (x.kg != null) assert.equal(x.kg % 1.25, 0, `${x.kg}`);
  assert.ok(p.serie[1].kg < p.serie[0].kg, "back-off più leggera");
  const t = proposeTop({ nome: "Triceps pushdown", serie: 2, min: 8, max: 10, metodo: "top", incremento: 2.5 }, top(20, 10, 1), { incremento: 1.25 });
  for (const x of t.serie) if (x.kg != null) assert.equal(x.kg % 2.5, 0, "l'incremento dell'esercizio vince su quello generale");
});

test("drop set anche con le serie uguali; il drop non sporca la progressione", async () => {
  const ex = { nome: "Croci ai cavi", serie: 3, min: 10, max: 12, drop: true };
  const p = proposeClassic(ex, { serie: [{ kg: 20, reps: 12 }, { kg: 20, reps: 12 }, { kg: 20, reps: 12 }, { kg: 15, reps: 15, tipo: "dropset" }], storia: [{ kg: 20, reps: 36, rpe: 8 }] }, { incremento: 1.25 });
  assert.deepEqual(p.serie.map((x) => x.tipo), ["normal", "normal", "normal", "dropset"]);
  assert.equal(p.serie[0].kg, 21.25, "range chiuso: si sale di un salto (1,25), il drop a 15 kg non conta");
  assert.equal(p.serie[3].kg, 16.25, "drop −25% dall'ultima serie");
  const env = makeEnv(); await setup(env);
  const r = await call(env, "/api/schede", { method: "PUT", code: CODE, body: { schede: [{ id: "a", nome: "A", esercizi: [ex] }] } });
  assert.equal(r.data.schede[0].esercizi[0].drop, true);
});

test("muscoli riconosciuti dal nome, modificabili e ripristinabili", async () => {
  const env = makeEnv(); await setup(env);
  const get = async (n) => (await call(env, `/api/muscoli?nomi=${encodeURIComponent(n)}`, { code: CODE })).data.muscoli[n];
  assert.equal((await get("Pectoral machine")).lista[0][0], "petto", "machine non è «chin» (trazioni)");
  assert.equal((await get("Alzate laterali al cavo")).lista.length, 1, "le alzate non usano i tricipiti");
  assert.deepEqual((await get("Esercizio strano")).lista, []);
  await call(env, "/api/muscoli", { method: "POST", code: CODE, body: { esercizio: "Esercizio strano", muscolo: "glutei" } });
  const m = await get("Esercizio strano");
  assert.equal(m.lista[0][0], "glutei"); assert.equal(m.scelto, "glutei");
  await call(env, "/api/muscoli", { method: "POST", code: CODE, body: { esercizio: "Esercizio strano", muscolo: "auto" } });
  assert.deepEqual((await get("Esercizio strano")).lista, []);
});
