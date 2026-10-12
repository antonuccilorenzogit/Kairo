import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setup, CODE, checkinToday, setupDone } from "./helpers.js";
import { parseSchedeText } from "../src/workout.js";

const day = (n) => new Date(Date.now() - n * 86400e3).toISOString().slice(0, 10);
const ts = (d, hh = "03:00") => `${d}T${hh}:00+02:00`;
const epoch = (s) => Math.floor(Date.parse(s) / 1000);
async function seed(env, { hrv = () => 70, fcr = () => 50 } = {}) {
  const db = env.DB, st = [];
  for (let i = 0; i < 40; i++) {
    const d = day(i), prev = day(i + 1);
    st.push(db.prepare("INSERT INTO samples(metric,ts,t,value) VALUES('hrv',?,?,?)").bind(ts(d), epoch(ts(d)), hrv(i)));
    st.push(db.prepare("INSERT INTO samples(metric,ts,t,value) VALUES('fcr',?,?,?)").bind(ts(d, "08:00"), epoch(ts(d, "08:00")), fcr(i)));
    st.push(db.prepare("INSERT INTO sleep(start,end,stage) VALUES(?,?,'core')").bind(ts(prev, "23:00"), ts(d, "07:00")));
    st.push(db.prepare("INSERT INTO daily(metric,day,value) VALUES('trimp',?,100)").bind(d));
  }
  await db.batch(st);
}
const ai = (obj) => ({ run: async () => ({ response: typeof obj === "string" ? obj : JSON.stringify(obj) }) });
const rec = (env, body = {}) => call(env, "/api/allenamento/oggi", { method: "POST", code: CODE, body }).then((r) => r.data);

test("allenamento del giorno: solo tra gli sport scelti, con seduta completa (regole senza IA)", async () => {
  const env = makeEnv(); await setup(env); await checkinToday(env); await setupDone(env); await seed(env);
  await call(env, "/api/profilo", { method: "POST", code: CODE, body: { sport: ["nuoto", "bici"] } });
  const r = await rec(env);
  assert.ok(["nuoto", "bici"].includes(r.sport), r.sport);
  assert.equal(r.fonte, "regole");
  assert.ok(r.struttura.length >= 3);
  const again = await rec(env);
  assert.equal(again.cache, true, "stessa proposta per tutto il giorno");
  const other = await rec(env, { altro: true, escludi: r.sport });
  assert.notEqual(other.sport, r.sport, "altra proposta = altro sport");
});

test("allenamento del giorno: con un allarme solo intensità leggera e niente pesi", async () => {
  const env = makeEnv(); await setup(env); await checkinToday(env); await setupDone(env); await seed(env, { hrv: (i) => (i <= 1 ? 40 : 70 + (i % 3)), fcr: (i) => (i <= 1 ? 58 : 50 + (i % 2)) });
  await call(env, "/api/profilo", { method: "POST", code: CODE, body: { eta: 30, sport: ["palestra", "nuoto"] } });
  const r = await rec(env);
  assert.equal(r.intensita, "leggero");
  assert.equal(r.sport, "nuoto");
});

test("allenamento del giorno dall'IA: l'intensità non può superare il limite, sport non scelti rifiutati", async () => {
  const env = makeEnv({ AI: ai({ sport: "bici", intensita: "intenso", titolo: "Ripetute", durata_min: 60, struttura: [{ fase: "Riscaldamento", dettaglio: "15'" }, { fase: "Parte centrale", dettaglio: "5x4'" }], scheda: null, perche: "test" }) });
  await setup(env); await checkinToday(env); await setupDone(env); await seed(env, { hrv: (i) => (i <= 1 ? 40 : 70 + (i % 3)), fcr: (i) => (i <= 1 ? 58 : 50 + (i % 2)) });
  await call(env, "/api/profilo", { method: "POST", code: CODE, body: { eta: 30, sport: ["bici", "nuoto"] } });
  const r = await rec(env);
  assert.equal(r.fonte, "ia"); assert.equal(r.sport, "bici"); assert.equal(r.intensita, "leggero", "tagliata dal limite");
  const env2 = makeEnv({ AI: ai({ sport: "corsa", intensita: "medio", titolo: "x", durata_min: 30, struttura: [{ fase: "a", dettaglio: "b" }] }) });
  await setup(env2); await checkinToday(env2); await setupDone(env2); await seed(env2);
  await call(env2, "/api/profilo", { method: "POST", code: CODE, body: { sport: ["nuoto"] } });
  const r2 = await rec(env2);
  assert.equal(r2.sport, "nuoto"); assert.equal(r2.fonte, "regole");
});

test("palestra: proposta la prossima scheda in rotazione", async () => {
  const env = makeEnv(); await setup(env); await checkinToday(env); await setupDone(env); await seed(env);
  await call(env, "/api/profilo", { method: "POST", code: CODE, body: { sport: ["palestra"] } });
  await call(env, "/api/schede", { method: "PUT", code: CODE, body: { schede: [{ nome: "A", esercizi: [{ nome: "Panca", serie: 3, min: 8, max: 10 }] }, { nome: "B", esercizi: [{ nome: "Squat", serie: 3, min: 5, max: 5 }] }] } });
  await call(env, "/api/forza", { method: "POST", code: CODE, body: { serie: [{ start: ts(day(2), "18:00"), end: ts(day(2), "19:00"), workout: "A", exercise: "Panca", set_index: 0, weight: 80, reps: 10, rpe: 7 }] } });
  const r = await rec(env);
  assert.equal(r.sport, "palestra"); assert.equal(r.scheda, "B");
});

test("schede: validazione, salvataggio e ultima seduta per precompilare", async () => {
  const env = makeEnv(); await setup(env); await checkinToday(env); await setupDone(env);
  const r = await call(env, "/api/schede", { method: "PUT", code: CODE, body: { schede: [{ nome: "Push", esercizi: [{ nome: "Panca piana", serie: 4, min: 8, max: 10 }, { nome: "", serie: 3, min: 8, max: 10 }, { nome: "Dip", serie: 99, min: 8, max: 10 }, { nome: "Croci", serie: 3, min: 12, max: 8 }] }] } });
  assert.equal(r.data.schede.length, 1);
  assert.deepEqual(r.data.schede[0].esercizi.map((e) => e.nome), ["Panca piana"]);
  await call(env, "/api/forza", { method: "POST", code: CODE, body: { serie: [0, 1].map((i) => ({ start: ts(day(1), "18:00"), exercise: "Panca piana", set_index: i, weight: 80, reps: 10 - i })) } });
  const g = (await call(env, "/api/schede", { code: CODE })).data;
  assert.deepEqual(g.ultimo["Panca piana"].serie, [{ kg: 80, reps: 10 }, { kg: 80, reps: 9 }]);
  assert.equal((await call(env, "/api/schede", { method: "PUT", code: CODE, body: { schede: "x" } })).status, 400);
});

test("schede dal testo: con l'IA e, se non c'è, con le regole", async () => {
  const text = "Scheda A petto\npanca piana 4x8-10\ncroci ai cavi 3x12\n\nScheda B gambe\n- squat 5x5\n- leg press 3 x 10-12";
  const rules = parseSchedeText(text);
  assert.equal(rules.schede.length, 2);
  assert.deepEqual(rules.schede[1].esercizi.map((e) => [e.nome, e.serie, e.min, e.max]), [["squat", 5, 5, 5], ["leg press", 3, 10, 12]]);
  const env = makeEnv(); await setup(env); await checkinToday(env); await setupDone(env);
  const r = (await call(env, "/api/schede/ia", { method: "POST", code: CODE, body: { testo: text } })).data;
  assert.equal(r.fonte, "regole"); assert.equal(r.schede.length, 2);
  const env2 = makeEnv({ AI: ai('Ecco: {"schede":[{"nome":"Scheda A – Petto","esercizi":[{"nome":"Panca piana con bilanciere","serie":4,"min":8,"max":10,"note":""}]}]}') });
  await setup(env2);
  const r2 = (await call(env2, "/api/schede/ia", { method: "POST", code: CODE, body: { testo: text } })).data;
  assert.equal(r2.fonte, "ia"); assert.equal(r2.schede[0].esercizi[0].nome, "Panca piana con bilanciere");
  assert.equal((await call(env2, "/api/schede", { code: CODE })).data.schede.length, 0, "non salva finché non confermi");
});
