import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setup, CODE, checkinToday } from "./helpers.js";
import { cleanPlan, scheduleWeek, levelOf, sessionDetail, blockOf, mondayOf, planToday } from "../src/plan.js";
import { classify, sessionsWithSport } from "../src/sessions.js";

const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());
const addDay = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 86400e3).toISOString().slice(0, 10);
const FULL = { attivo: true, sedute: { palestra: 3, nuoto: 2, corsa: 1, bici: 1 }, giorni: [0, 1, 2, 3, 4, 5, 6] };
const HARD = new Set(["soglia", "velocita", "test", "lungo"]);

test("settimana: un solo sport al giorno, lunghi nel weekend, sedute dure distanziate", () => {
  const plan = cleanPlan({ ...FULL, inizio: "2026-10-12", sedute: { palestra: 2, nuoto: 3, corsa: 2, bici: 0 } });
  const w = scheduleWeek(plan, "2026-10-19", { nuoto: { css: 100 }, corsa: { soglia_skm: 300 } });
  assert.equal(w.sedute.length, 7); assert.deepEqual(w.escluse, []);
  for (const g of new Set(w.sedute.map((s) => s.giorno))) assert.equal(w.sedute.filter((s) => s.giorno === g).length, 1);
  for (const s of w.sedute.filter((x) => x.tipo === "lungo")) assert.ok([0, 6].includes(new Date(s.giorno + "T12:00:00Z").getUTCDay()), s.giorno);
  // two endurance hard sessions of the same sport are never on consecutive days
  const hardDays = (sp) => w.sedute.filter((s) => s.sport === sp && HARD.has(s.tipo)).map((s) => Date.parse(s.giorno) / 864e5);
  for (const sp of ["nuoto", "corsa"]) { const d = hardDays(sp); for (let i = 1; i < d.length; i++) assert.ok(d[i] - d[i - 1] >= 2, sp); }
});

test("settimana: troppe sedute per i giorni disponibili → le più facili restano fuori e lo dice", () => {
  const plan = cleanPlan({ attivo: true, inizio: "2026-10-12", sedute: { palestra: 3, nuoto: 2 }, giorni: [1, 3, 5] });
  const w = scheduleWeek(plan, "2026-10-19", { nuoto: { css: 100 } });
  assert.equal(w.sedute.length, 3); assert.equal(w.escluse.length, 2);
});

test("blocchi di 4 settimane: la quarta è di scarico con i test; senza riferimento il primo test arriva subito", () => {
  const plan = cleanPlan({ ...FULL, inizio: "2026-10-12" });
  assert.deepEqual(blockOf(plan, "2026-11-02"), { blocco: 1, settimana: 4, scarico: true, indice: 3 });
  assert.equal(blockOf(plan, "2026-11-09").blocco, 2);
  const refs = { nuoto: { css: 100 }, corsa: { soglia_skm: 300 }, bici: { lthr: 160 } };
  const w4 = scheduleWeek(plan, "2026-11-02", refs);
  for (const sp of ["nuoto", "corsa", "bici"]) assert.ok(w4.sedute.some((s) => s.sport === sp && s.tipo === "test"), sp);
  const w2 = scheduleWeek(plan, "2026-10-19", { nuoto: { css: 100 } });
  assert.ok(!w2.sedute.some((s) => s.sport === "nuoto" && s.tipo === "test"));
  assert.ok(w2.sedute.some((s) => s.sport === "corsa" && s.tipo === "test"), "niente riferimento per la corsa → test");
});

test("progressione: sale con le sedute fatte, si ferma se è dura, scende dopo una pausa lunga", () => {
  const s = (giorno, sensazione = null, fatta = true) => ({ giorno, sport: "nuoto", tipo: "soglia", fatta, sensazione, scarico: false });
  assert.equal(levelOf([s("2026-10-01"), s("2026-10-08"), s("2026-10-15", "facile")], "nuoto", "soglia"), 4);
  assert.equal(levelOf([s("2026-10-01"), s("2026-10-08", "dura"), s("2026-10-15", "dura")], "nuoto", "soglia"), 0);
  assert.equal(levelOf([s("2026-10-01"), s("2026-10-08"), s("2026-10-15", null, false)], "nuoto", "soglia"), 2);
  assert.equal(levelOf([s("2026-09-01"), s("2026-09-08"), s("2026-09-15"), s("2026-10-20")], "nuoto", "soglia"), 1, "5 settimane di stop: si riparte quasi da zero");
  // the level makes the session longer
  const plan = cleanPlan({ ...FULL, inizio: "2026-10-12" });
  const ctx = (hist) => ({ plan, hist, refs: { nuoto: { css: 105 } }, hrmax: 190 });
  const a = sessionDetail({ id: "x", giorno: "2026-10-21", sport: "nuoto", tipo: "soglia" }, ctx([]));
  const b = sessionDetail({ id: "x", giorno: "2026-10-21", sport: "nuoto", tipo: "soglia" }, ctx([s("2026-10-07"), s("2026-10-14")]));
  assert.ok(b.volume > a.volume, `${b.volume} > ${a.volume}`);
  assert.match(a.struttura[1].dettaglio, /1'45"\/100 m/);
});

test("ritmi solo dai test: senza test la seduta è a sensazione e con le zone di battito", () => {
  const plan = cleanPlan({ ...FULL, inizio: "2026-10-12" });
  const d = sessionDetail({ id: "x", giorno: "2026-10-21", sport: "corsa", tipo: "soglia" }, { plan, hist: [], refs: {}, hrmax: 190 });
  assert.doesNotMatch(d.struttura.map((x) => x.dettaglio).join(" "), /\/km/);
  assert.match(d.struttura[1].dettaglio, /zona 4: \d+-\d+ bpm/);
  const n = sessionDetail({ id: "x", giorno: "2026-10-21", sport: "nuoto", tipo: "soglia" }, { plan, hist: [], refs: {}, hrmax: 190 });
  assert.doesNotMatch(n.struttura.map((x) => x.dettaglio).join(" "), /\/100 m/);
  // the time limit of the day is respected
  const short = cleanPlan({ ...FULL, inizio: "2026-10-12", minuti: { feriale: 30, weekend: 30 } });
  const c = sessionDetail({ id: "x", giorno: "2026-10-21", sport: "bici", tipo: "facile" }, { plan: short, hist: [], refs: {}, hrmax: 190 });
  assert.ok(c.durata_min <= 30);
});

test("sedute riconosciute: nuoto, bici e corsa dalle distanze delle stesse ore, palestra dalle serie", () => {
  const sess = { start: "2026-10-12T16:00:00Z", end: "2026-10-12T16:45:00Z", minuti: 45 };
  assert.deepEqual(classify(sess, [{ dist_nuoto_ora: 1800 }], []), { sport: "nuoto", fonte: "distanza", distanza_m: 1800, passo_s100: 150 });
  assert.equal(classify(sess, [{ dist_bici_ora: 18 }], []).sport, "bici");
  assert.equal(classify(sess, [{ dist_piedi_ora: 8 }], []).passo_skm, 338);
  assert.equal(classify(sess, [{ dist_piedi_ora: 3 }], []).sport, null, "4 km/h è una camminata");
  assert.equal(classify(sess, [], [[Date.parse("2026-10-12T15:55:00Z"), Date.parse("2026-10-12T17:00:00Z")]]).sport, "palestra");
});

test("piano dall'app: attivazione, seduta di oggi, test che fissa i ritmi, seduta saltata spostata", async () => {
  const env = makeEnv(); await setup(env); await checkinToday(env);
  await call(env, "/api/profilo", { method: "POST", code: CODE, body: { eta: 21 } });
  const o = (await call(env, "/api/piano", { method: "POST", code: CODE, body: FULL })).data;
  assert.equal(o.config.attivo, true); assert.equal(o.config.inizio, mondayOf(today));
  assert.equal(o.settimana.sedute.length, 7);
  const w = (await call(env, "/api/allenamento/oggi", { method: "POST", code: CODE, body: {} })).data;
  assert.equal(w.piano, true); assert.ok(w.sedute.length >= 1, "una seduta, o due se una dura dei giorni scorsi è stata spostata a oggi");
  assert.ok(w.sedute[0].struttura.length >= 1 || w.sedute[0].sport === "palestra");
  // a swim test done → CSS saved and used
  const week = mondayOf(today);
  const rows = (await env.DB.prepare("SELECT dati FROM piano_settimane WHERE settimana = ?").bind(week).first());
  const wk = JSON.parse(rows.dati);
  const swimTest = wk.sedute.find((s) => s.sport === "nuoto" && s.tipo === "test");
  assert.ok(swimTest, "primo test di nuoto in calendario");
  swimTest.giorno = today; await env.DB.prepare("UPDATE piano_settimane SET dati = ? WHERE settimana = ?").bind(JSON.stringify(wk), week).run();
  const bad = await call(env, "/api/piano/esito", { method: "POST", code: CODE, body: { seduta: swimTest.id, stato: "fatto", risultato: { t400: 100, t200: 50 } } });
  assert.equal(bad.status, 400);
  const ok = (await call(env, "/api/piano/esito", { method: "POST", code: CODE, body: { seduta: swimTest.id, stato: "fatto", sensazione: "giusta", risultato: { t400: 400, t200: 180 } } })).data;
  assert.equal(ok.test.css, 110);
  const o2 = (await call(env, "/api/piano", { code: CODE })).data;
  assert.equal(o2.riferimenti.nuoto.css, 110);
  assert.ok(o2.settimana.sedute.find((s) => s.id === swimTest.id).fatta);
});

test("seduta chiave non fatta ieri → spostata al primo giorno libero; recupero rosso → scambiata con una facile", async () => {
  const env = makeEnv(); await setup(env);
  await call(env, "/api/profilo", { method: "POST", code: CODE, body: { eta: 21 } });
  await call(env, "/api/piano", { method: "POST", code: CODE, body: { ...FULL, sedute: { nuoto: 3 }, giorni: [0, 1, 2, 3, 4, 5, 6] } });
  const week = mondayOf(today);
  const yest = addDay(today, -1) >= week ? addDay(today, -1) : null;
  const custom = { settimana: week, blocco: 1, n_settimana: 2, scarico: false, escluse: [], sedute: [
    ...(yest ? [{ id: `${week}-nuoto-a`, giorno: yest, sport: "nuoto", tipo: "soglia" }] : []),
    { id: `${week}-nuoto-b`, giorno: today, sport: "nuoto", tipo: "soglia" },
    ...(addDay(today, 2) <= addDay(week, 6) ? [{ id: `${week}-nuoto-c`, giorno: addDay(today, 2), sport: "nuoto", tipo: "facile" }] : []),
  ] };
  await env.DB.prepare("INSERT OR REPLACE INTO piano_settimane(settimana,dati,created) VALUES(?,?,?)").bind(week, JSON.stringify(custom), "x").run();
  const profile = { eta: 21, infortunio: {} };
  const red = { settaggio: { pronto: true }, recupero: { score: 20 } };
  const r = await planToday(env, { day: today, tz: "Europe/Rome", profile, today: red });
  const saved = JSON.parse((await env.DB.prepare("SELECT dati FROM piano_settimane WHERE settimana = ?").bind(week).first()).dati);
  if (yest) assert.ok(saved.sedute.find((s) => s.id === `${week}-nuoto-a`).spostata_da === yest || saved.sedute.find((s) => s.id === `${week}-nuoto-a`).persa);
  const b = saved.sedute.find((s) => s.id === `${week}-nuoto-b`);
  assert.ok(b.adattata, "la seduta dura di oggi è stata adattata");
  assert.ok(r.sedute.every((s) => s.tipo === "facile" || s.adattata));
});

test("in modalità infortunio il piano è in pausa", async () => {
  const env = makeEnv(); await setup(env); await checkinToday(env);
  await call(env, "/api/piano", { method: "POST", code: CODE, body: FULL });
  await call(env, "/api/infortunio", { method: "POST", code: CODE, body: { attivo: true, descrizione: "distorsione caviglia", dal: addDay(today, -10) } });
  const w = (await call(env, "/api/allenamento/oggi", { method: "POST", code: CODE, body: { dolore: 2 } })).data;
  assert.equal(w.infortunio, true); assert.equal(w.piano, undefined);
  assert.equal((await call(env, "/api/piano", { code: CODE })).data.pausa, true);
});

test("il backup contiene palestra, piano e test", async () => {
  const env = makeEnv(); await setup(env);
  await call(env, "/api/piano", { method: "POST", code: CODE, body: FULL });
  await call(env, "/api/forza", { method: "POST", code: CODE, body: { serie: [{ start: `${today}T18:00:00+02:00`, exercise: "Panca", set_index: 0, weight: 80, reps: 8 }] } });
  await env.DB.prepare("INSERT INTO test_sport(day,sport,dati,created) VALUES(?,?,?,?)").bind(today, "nuoto", JSON.stringify({ t400: 400, t200: 180, css: 110 }), "x").run();
  const exp = (await call(env, "/api/export", { code: CODE })).data;
  assert.equal(exp.sets.length, 1); assert.equal(exp.test_sport.length, 1); assert.equal(exp.impostazioni.piano.attivo, true);
  const env2 = makeEnv(); await setup(env2);
  await call(env2, "/api/ripristina", { method: "POST", code: CODE, body: exp });
  assert.equal((await env2.DB.prepare("SELECT count(*) n FROM sets").first()).n, 1);
  assert.equal((await call(env2, "/api/piano", { code: CODE })).data.riferimenti.nuoto.css, 110);
});

test("sedute riconosciute dal database con distanze orarie", async () => {
  const env = makeEnv(); await setup(env);
  await env.DB.prepare("INSERT INTO sessioni(start,day,end,minuti,fc_media,trimp) VALUES(?,?,?,?,?,?)").bind(`${today}T16:00:00Z`, today, `${today}T16:50:00Z`, 50, 140, 80).run();
  await call(env, "/api/ingest", { method: "POST", code: CODE, body: { dist_nuoto_ora_valori: "2000;0", dist_nuoto_ora_date: `${today}T18:00:00+02:00;${today}T19:00:00+02:00` } });
  const s = await sessionsWithSport(env.DB, today, today, "Europe/Rome");
  assert.equal(s[0].sport, "nuoto"); assert.equal(s[0].distanza_m, 2000); assert.equal(s[0].passo_s100, 150);
});

test("il coach conosce il piano e non propone altro; guarito → il piano riparte dal blocco 1", async () => {
  const seen = [];
  const env = makeEnv({ AI: { run: async (_m, { messages }) => { seen.push(messages); return { response: "ok" }; } } });
  await setup(env); await checkinToday(env);
  await call(env, "/api/profilo", { method: "POST", code: CODE, body: { eta: 21 } });
  await call(env, "/api/piano", { method: "POST", code: CODE, body: FULL });
  await call(env, "/api/coach/chat", { method: "POST", code: CODE, body: { domanda: "Cosa faccio questa settimana?" } });
  const sys = seen.at(-1)[0].content;
  assert.match(sys, /PIANO DI ALLENAMENTO \(deciso da Kairo/); assert.match(sys, /blocco 1, settimana 1 di 4/);
  assert.doesNotMatch(sys, /ALLENAMENTO CONSIGLIATO OGGI/);
  // injury, then healed: the plan restarts from this week
  await env.DB.prepare("UPDATE settings SET value = json_set(value, '$.inizio', ?) WHERE key = 'piano'").bind(addDay(mondayOf(today), -21)).run();
  await call(env, "/api/infortunio", { method: "POST", code: CODE, body: { attivo: true, descrizione: "caviglia" } });
  await call(env, "/api/infortunio", { method: "POST", code: CODE, body: { attivo: false } });
  const o = (await call(env, "/api/piano", { code: CODE })).data;
  assert.equal(o.config.inizio, mondayOf(today)); assert.equal(o.settimana.blocco, 1); assert.equal(o.settimana.n_settimana, 1);
});

test("durante il settaggio senza piano niente allenamento consigliato (e niente IA); con il piano sì", async () => {
  let calls = 0;
  const env = makeEnv({ AI: { run: async () => { calls++; return { response: "ok" }; } } }); await setup(env); await checkinToday(env);
  const w = (await call(env, "/api/allenamento/oggi", { method: "POST", code: CODE, body: {} })).data;
  assert.equal(w.settaggio, true); assert.equal(calls, 0);
  await call(env, "/api/piano", { method: "POST", code: CODE, body: FULL });
  const p = (await call(env, "/api/allenamento/oggi", { method: "POST", code: CODE, body: {} })).data;
  assert.equal(p.piano, true); assert.equal(calls, 0, "il piano è fatto di regole");
});

test("la seduta di oggi mostra cosa ha registrato il Watch", async () => {
  const env = makeEnv(); await setup(env); await checkinToday(env);
  await call(env, "/api/piano", { method: "POST", code: CODE, body: { ...FULL, sedute: { nuoto: 1 }, giorni: [0, 1, 2, 3, 4, 5, 6] } });
  const week = mondayOf(today);
  const wk = { settimana: week, blocco: 1, n_settimana: 2, scarico: false, escluse: [], sedute: [{ id: `${week}-nuoto-x`, giorno: today, sport: "nuoto", tipo: "facile" }] };
  await env.DB.prepare("INSERT OR REPLACE INTO piano_settimane(settimana,dati,created) VALUES(?,?,?)").bind(week, JSON.stringify(wk), "x").run();
  await env.DB.prepare("INSERT INTO sessioni(start,day,end,minuti,fc_media,trimp) VALUES(?,?,?,?,?,?)").bind(`${today}T05:00:00Z`, today, `${today}T05:40:00Z`, 40, 135, 60).run();
  await call(env, "/api/ingest", { method: "POST", code: CODE, body: { dist_nuoto_ora_valori: "1600", dist_nuoto_ora_date: `${today}T07:00:00+02:00` } });
  const r = await planToday(env, { day: today, tz: "Europe/Rome", profile: { eta: 21 }, today: {} });
  assert.equal(r.sedute[0].registrato.distanza_m, 1600); assert.equal(r.sedute[0].registrato.passo_s100, 150);
});
