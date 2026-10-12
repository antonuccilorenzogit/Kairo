import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setup, CODE, checkinToday } from "./helpers.js";
import { allowedMode, injuryArea, constraints, violation, ruleBased, MODALITA } from "../src/injury.js";

const fakeAI = (replies) => {
  const seen = [];
  return { seen, run: async (_m, { messages }) => { seen.push(messages); return { response: replies.shift() ?? "ok" }; } };
};
const daysAgo = (n) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date(Date.now() - n * 86400e3));
const plan = (env, body = {}) => call(env, "/api/allenamento/oggi", { method: "POST", code: CODE, body });

test("regole di sicurezza: riposo nei primi giorni o con dolore forte", () => {
  assert.equal(allowedMode({ dolore: 8, giorni: 20 }).modalita, "riposo");
  assert.equal(allowedMode({ dolore: 1, giorni: 1 }).modalita, "riposo");
  assert.equal(allowedMode({ dolore: 5, giorni: 10 }).modalita, "resto del corpo");
  assert.equal(allowedMode({ dolore: null, giorni: 10 }).modalita, "resto del corpo");
  assert.equal(allowedMode({ dolore: 2, giorni: 10 }).modalita, "riabilitazione");
});

test("zona del corpo dalla descrizione", () => {
  assert.equal(injuryArea("distorsione caviglia destra"), "inferiore");
  assert.equal(injuryArea("dolore alla spalla in panca"), "superiore");
  assert.equal(injuryArea("mal di schiena lombare"), "schiena");
  assert.equal(injuryArea("mi sento stanca e ho preso una botta"), "non chiara");
});

test("modalità infortunio: niente sport, piano del giorno che segue il dolore", async () => {
  const env = makeEnv(); await setup(env); await checkinToday(env);
  await call(env, "/api/profilo", { method: "POST", code: CODE, body: { sport: ["palestra", "corsa"] } });
  // on: started today → rest
  const on = await call(env, "/api/infortunio", { method: "POST", code: CODE, body: { attivo: true, descrizione: "distorsione caviglia destra" } });
  assert.equal(on.data.infortunio.attivo, true); assert.equal(on.data.infortunio.dal, daysAgo(0));
  let r = (await plan(env)).data;
  assert.equal(r.infortunio, true); assert.equal(r.modalita, "riposo"); assert.equal(r.sport, undefined);
  assert.match(r.attenzione, /medico|fisioterapista/);
  // 10 days later, low pain → rehab; the rest-of-body part is for the upper body
  await call(env, "/api/infortunio", { method: "POST", code: CODE, body: { dal: daysAgo(10) } });
  r = (await plan(env, { dolore: 2 })).data;
  assert.equal(r.modalita, "riabilitazione"); assert.equal(r.dolore, 2); assert.equal(r.area, "inferiore");
  assert.match(r.struttura.map((x) => x.dettaglio).join(" "), /da seduto/);
  r = (await plan(env, { dolore: 8 })).data;
  assert.equal(r.modalita, "riposo");
  assert.equal((await plan(env, { dolore: 11 })).status, 400);
  // saving the profile from an older app (without the injury field) keeps it on
  await call(env, "/api/profilo", { method: "POST", code: CODE, body: { nome: "Lorenzo", sport: ["palestra"] } });
  assert.equal((await call(env, "/api/profilo", { code: CODE })).data.infortunio.attivo, true);
  // off → normal workout again
  await call(env, "/api/infortunio", { method: "POST", code: CODE, body: { attivo: false } });
  r = (await plan(env)).data;
  assert.equal(r.infortunio, undefined); assert.equal(r.sport, "palestra");
});

test("l'IA non può andare oltre il limite di sicurezza e il coach conosce l'infortunio", async () => {
  const tooMuch = JSON.stringify({ modalita: "riabilitazione", titolo: "Si spinge", durata_min: 40, struttura: [{ fase: "Corsa", dettaglio: "5 km" }], perche: "x", attenzione: "y" });
  const ok = JSON.stringify({ modalita: "riposo", titolo: "Riposo e mobilità", durata_min: 15, struttura: [{ fase: "Mobilità", dettaglio: "camminata 10'" }], perche: "Dolore alto", attenzione: "Se peggiora senti il medico" });
  const AI = fakeAI([tooMuch, ok, "Oggi riposa la spalla."]);
  const env = makeEnv({ AI }); await setup(env); await checkinToday(env);
  await call(env, "/api/infortunio", { method: "POST", code: CODE, body: { attivo: true, descrizione: "spalla destra dolorante", dal: daysAgo(7) } });
  let r = (await plan(env, { dolore: 8 })).data;
  assert.equal(r.fonte, "regole"); assert.equal(r.modalita, "riposo");
  r = (await plan(env, { forza: true })).data;
  assert.equal(r.fonte, "ia"); assert.equal(r.titolo, "Riposo e mobilità");
  // cached for the day while nothing changes
  assert.equal((await plan(env)).data.cache, true);
  await call(env, "/api/coach/chat", { method: "POST", code: CODE, body: { domanda: "Cosa faccio oggi?" } });
  const sys = AI.seen.at(-1)[0].content;
  assert.match(sys, /MODALITÀ INFORTUNIO/); assert.match(sys, /spalla destra dolorante/); assert.match(sys, /Dolore dichiarato[^\n]*8/);
});

const MENISCO = "Il 17 settembre 2026 artroscopia al ginocchio sinistro: sutura del menisco laterale. Prescrizioni: divieto di carico sull'arto operato per 30 giorni, con utilizzo delle stampelle. Flessione del ginocchio limitata a 90°, mobilizzazione consentita tra 0° e 90°.";

test("prescrizioni riconosciute dal testo e modificabili a mano", () => {
  const c = constraints({ descrizione: MENISCO, dal: "2026-09-17" });
  assert.deepEqual(c, { no_carico: true, fino: "2026-10-17", stampelle: true, gradi: 90, altre: "" });
  // what the person sets explicitly wins (e.g. the surgeon allowed weight bearing)
  const c2 = constraints({ descrizione: MENISCO, dal: "2026-09-17", prescrizioni: { no_carico: false, gradi: 120 } });
  assert.equal(c2.no_carico, false); assert.equal(c2.gradi, 120);
  assert.equal(constraints({ descrizione: "botta alla spalla" }).no_carico, false);
});

test("un piano che viola le prescrizioni viene riconosciuto", () => {
  const c = constraints({ descrizione: MENISCO, dal: "2026-09-17" });
  const plan = (dettaglio) => ({ titolo: "x", struttura: [{ fase: "x", dettaglio }] });
  assert.ok(violation(plan("Camminata leggera sul posto con stampelle per 3 minuti"), c, "inferiore"));
  assert.ok(violation(plan("Squat a corpo libero 3 x 10"), c, "inferiore"));
  assert.ok(violation(plan("Mobilità del ginocchio fino a 110°"), c, "inferiore"));
  assert.ok(violation(plan("Push-up al muro 3 x 12"), c, "inferiore"));
  assert.equal(violation(plan("Da sdraiato contrai il quadricipite 10 x 10\", senza appoggiare il piede. Non camminare. Flessione 0-90°."), c, "inferiore"), null);
});

test("le sedute di riserva rispettano sempre le prescrizioni", () => {
  const all = { no_carico: true, stampelle: true, gradi: 60, altre: "" };
  for (const area of ["inferiore", "superiore", "schiena", "più zone", "non chiara"])
    for (const mode of MODALITA) assert.equal(violation(ruleBased(mode, area, "", all), all, area), null, `${mode} / ${area}`);
});

test("l'IA che propone di camminare senza carico viene scartata", async () => {
  const bad = JSON.stringify({ modalita: "riabilitazione", titolo: "Esercizi dolci", durata_min: 25, struttura: [{ fase: "Riscaldamento", dettaglio: "Camminata leggera sul posto con stampelle per 3 minuti, braccia in movimento circolare" }], perche: "x", attenzione: "y" });
  const AI = fakeAI([bad]);
  const env = makeEnv({ AI }); await setup(env); await checkinToday(env);
  await call(env, "/api/infortunio", { method: "POST", code: CODE, body: { attivo: true, descrizione: MENISCO, dal: daysAgo(24) } });
  const r = (await plan(env, { dolore: 0 })).data;
  assert.equal(r.fonte, "regole"); assert.match(r.scartato, /carico/);
  assert.ok(r.vincoli.some((v) => /Movimento massimo 90°/.test(v)));
  assert.match(AI.seen[0][1].content, /VINCOLI ASSOLUTI/);
  const g = (await call(env, "/api/infortunio", { code: CODE })).data;
  assert.equal(g.vincoli.no_carico, true); assert.equal(g.vincoli.gradi, 90);
});
