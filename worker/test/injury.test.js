import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setup, CODE } from "./helpers.js";
import { allowedMode, injuryArea } from "../src/injury.js";

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
  const env = makeEnv(); await setup(env);
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
  assert.match(r.struttura.map((x) => x.dettaglio).join(" "), /piegamenti/);
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
  const env = makeEnv({ AI }); await setup(env);
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
