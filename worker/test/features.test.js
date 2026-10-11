import { test, mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { makeEnv, call, setup, CODE, count } from "./helpers.js";
import { edwardsTrimp } from "../src/load.js";
import { encryptPayload, vapidHeader, getVapid, b64u, unb64u } from "../src/push.js";
import { e1rm } from "../src/strength.js";

const day = (n) => new Date(Date.parse("2026-10-11T12:00:00Z") - n * 86400e3).toISOString().slice(0, 10);
const ts = (d, hh = "03:00") => `${d}T${hh}:00+02:00`;
const epoch = (s) => Math.floor(Date.parse(s) / 1000);

// 40 days of normal data: HRV 70, resting HR 50, 8 h of sleep, daily load `load(i)`
async function seed(env, { load = () => 100, hrv = () => 70, fcr = () => 50 } = {}) {
  const db = env.DB, st = [];
  for (let i = 0; i < 40; i++) {
    const d = day(i), prev = day(i + 1);
    st.push(db.prepare("INSERT INTO samples(metric,ts,t,value) VALUES('hrv',?,?,?)").bind(ts(d), epoch(ts(d)), hrv(i)));
    st.push(db.prepare("INSERT INTO samples(metric,ts,t,value) VALUES('fcr',?,?,?)").bind(ts(d, "08:00"), epoch(ts(d, "08:00")), fcr(i)));
    st.push(db.prepare("INSERT INTO sleep(start,end,stage) VALUES(?,?,'core')").bind(ts(prev, "23:00"), ts(d, "02:00")));
    st.push(db.prepare("INSERT INTO sleep(start,end,stage) VALUES(?,?,'deep')").bind(ts(d, "02:00"), ts(d, "03:30")));
    st.push(db.prepare("INSERT INTO sleep(start,end,stage) VALUES(?,?,'rem')").bind(ts(d, "03:30"), ts(d, "05:30")));
    st.push(db.prepare("INSERT INTO sleep(start,end,stage) VALUES(?,?,'core')").bind(ts(d, "05:30"), ts(d, "07:00")));
    if (load(i) != null) st.push(db.prepare("INSERT INTO daily(metric,day,value) VALUES('trimp',?,?)").bind(d, load(i)));
  }
  await db.batch(st);
}
const today = async (env, d = day(0)) => (await call(env, `/api/day?d=${d}`, { code: CODE })).data;

test("profilo sul server: valori validati e condivisi", async () => {
  const env = makeEnv(); await setup(env);
  assert.equal((await call(env, "/api/profilo", { method: "POST", code: CODE, body: { eta: 5 } })).status, 400);
  const saved = (await call(env, "/api/profilo", { method: "POST", code: CODE, body: { nome: "Lorenzo", eta: 21, sesso: "M", obiettivi: "12% di grasso", sveglia: "07:00", tz: "Europe/Rome", extra: "x" } })).data;
  assert.equal(saved.eta, 21); assert.equal(saved.extra, undefined);
  assert.equal((await call(env, "/api/profilo", { code: CODE })).data.obiettivi, "12% di grasso");
});

test("chat salvata sul server, uguale su ogni dispositivo", async () => {
  const env = makeEnv(); await setup(env);
  const r = await call(env, "/api/coach/chat", { method: "POST", code: CODE, body: { domanda: "Come sto?" } });
  assert.equal(r.status, 200);
  assert.equal((await call(env, "/api/chat", { code: CODE })).data.length, 2);
  await call(env, "/api/chat", { method: "DELETE", code: CODE });
  assert.equal((await call(env, "/api/chat", { code: CODE })).data.length, 0);
  assert.equal((await call(env, "/api/coach/chat", { method: "POST", code: CODE, body: { domanda: "" } })).status, 400);
});

test("TRIMP di Edwards: 30 minuti al 78% della FC max = 29 min × zona 3", () => {
  const s = Array.from({ length: 30 }, (_, i) => ({ t: i * 60, v: 150 }));
  assert.equal(edwardsTrimp(s, 193).trimp, 87);
  assert.equal(edwardsTrimp([{ t: 0, v: 60 }, { t: 600, v: 60 }], 193).trimp, 0, "a riposo non conta");
  assert.equal(edwardsTrimp([{ t: 0, v: 190 }, { t: 3600, v: 190 }], 193).trimp, 25, "pause oltre 5 minuti tagliate");
});

test("carico calcolato all'arrivo della FC, anche con invii ripetuti", async () => {
  const env = makeEnv(); await setup(env);
  await call(env, "/api/profilo", { method: "POST", code: CODE, body: { fc_max: 193 } });
  const times = Array.from({ length: 30 }, (_, i) => `2026-10-10T18:${String(i).padStart(2, "0")}:00+02:00`);
  const body = { fc_valori: times.map(() => "150").join(";"), fc_date: times.join(";") };
  await call(env, "/api/ingest", { method: "POST", code: CODE, body });
  await call(env, "/api/ingest", { method: "POST", code: CODE, body });
  assert.equal((await env.DB.prepare("SELECT value FROM daily WHERE metric='trimp' AND day='2026-10-10'").first()).value, 87);
  // età cambiata → zone ricalcolate
  await call(env, "/api/profilo", { method: "POST", code: CODE, body: { fc_max: 160 } });
  assert.notEqual((await env.DB.prepare("SELECT value FROM daily WHERE metric='trimp' AND day='2026-10-10'").first()).value, 87);
});

test("carico abituale: mantenimento e allenamento consigliato in base al recupero", async () => {
  const env = makeEnv(); await setup(env); await seed(env);
  const d = await today(env);
  assert.equal(d.carico.cronico, 100);
  assert.equal(d.carico.stato, "mantenimento");
  assert.ok(d.carico.consiglio, "consiglio presente");
  assert.ok(d.carico.consiglio.max >= d.carico.consiglio.min);
});

test("picco di carico: rapporto alto e consiglio di scaricare", async () => {
  const env = makeEnv(); await setup(env); await seed(env, { load: (i) => (i >= 1 && i <= 7 ? 260 : 100) });
  const d = await today(env);
  assert.ok(d.carico.rapporto > 1.5, `rapporto ${d.carico.rapporto}`);
  assert.equal(d.carico.stato, "eccesso");
  assert.ok(["leggera", "riposo"].includes(d.carico.consiglio.livello), d.carico.consiglio.livello);
});

test("recupero basso: riposo attivo", async () => {
  const env = makeEnv(); await setup(env); await seed(env, { hrv: (i) => (i === 0 ? 30 : 70 + (i % 3)), fcr: (i) => (i === 0 ? 60 : 50 + (i % 2)) });
  const d = await today(env);
  assert.ok(d.recupero.score < 34, `recupero ${d.recupero.score}`);
  assert.equal(d.carico.consiglio.livello, "riposo");
});

test("palestra: session-RPE dal check-in del giorno dopo", async () => {
  const env = makeEnv(); await setup(env); await seed(env, { load: (i) => (i === 1 ? null : 100) });
  await call(env, "/api/checkin", { method: "POST", code: CODE, body: { day: day(0), energia: 3, attivita: "palestra", rpe: 7, durata_min: 60 } });
  const h = (await call(env, `/api/history?days=2&fino=${day(0)}`, { code: CODE })).data;
  assert.equal(h[0].carico.oggi, 210, "7 × 60 / 2");
});

test("allarme: due giorni con HRV bassa e FC a riposo alta", async () => {
  const env = makeEnv(); await setup(env);
  await seed(env, { hrv: (i) => (i <= 1 ? 40 : 70 + (i % 3)), fcr: (i) => (i <= 1 ? 58 : 50 + (i % 2)) });
  const d = await today(env);
  assert.equal(d.allarme?.tipo, "malanno");
  const env2 = makeEnv(); await setup(env2); await seed(env2);
  assert.equal((await today(env2)).allarme, undefined, "nessun allarme con dati normali");
});

test("fabbisogno di sonno e orario per andare a letto", async () => {
  const env = makeEnv(); await setup(env); await seed(env);
  await call(env, "/api/profilo", { method: "POST", code: CODE, body: { sveglia: "07:00", sonno_min: 480 } });
  const d = await today(env);
  assert.equal(d.sonno_stanotte.fabbisogno_min, 480);
  assert.equal(d.sonno_stanotte.a_letto, "22:45");
});

test("notte senza Watch: ore dichiarate nel check-in", async () => {
  const env = makeEnv(); await setup(env);
  await call(env, "/api/checkin", { method: "POST", code: CODE, body: { day: day(0), energia: 3, sonno_min: 420 } });
  const d = await today(env);
  assert.equal(d.sonno.manuale, true);
  assert.equal(d.sonno.durata_min, 420);
  assert.equal(d.sonno.punteggio, 85);
  assert.equal((await call(env, "/api/checkin", { method: "POST", code: CODE, body: { sonno_min: 5 } })).status, 400);
});

test("report settimanale", async () => {
  const env = makeEnv(); await setup(env); await seed(env);
  const w = (await call(env, `/api/settimana?a=${day(1)}`, { code: CODE })).data;
  assert.equal(w.giorni.length, 7);
  assert.equal(w.settimana.carico, 700);
  assert.equal(w.settimana.notti, 7);
  assert.ok(w.settimana.recupero >= 50);
});

test("forza: import, niente doppioni, massimale stimato", async () => {
  const env = makeEnv(); await setup(env);
  const serie = [];
  for (let wk = 0; wk < 6; wk++) {
    const d = day(wk * 7 + 1);
    for (let i = 0; i < 3; i++) serie.push({ start: ts(d, "18:00"), end: ts(d, "19:00"), exercise: "Panca piana", set_index: i, set_type: "normal", weight: 80 + (5 - wk) * 2.5, reps: 8, rpe: 8 });
  }
  serie.push({ start: "non una data", exercise: "x", set_index: 0 }, { start: ts(day(1)), exercise: "Panca piana", set_index: 9, weight: 5000, reps: 1 });
  const r1 = (await call(env, "/api/forza", { method: "POST", code: CODE, body: { serie } })).data;
  assert.equal(r1.righe, 18); assert.equal(r1.scartate, 2);
  await call(env, "/api/forza", { method: "POST", code: CODE, body: { serie } });
  assert.equal(await count(env, "sets"), 18);
  const f = (await call(env, "/api/forza", { code: CODE })).data;
  assert.equal(f.esercizi[0].esercizio, "Panca piana");
  assert.equal(f.esercizi[0].record, Math.round(e1rm(92.5, 8) * 10) / 10);
  assert.ok(f.esercizi[0].max_4_settimane > f.esercizi[0].max_4_precedenti);
});

test("forza: la seduta in palestra entra nel carico (durata × RPE)", async () => {
  const env = makeEnv(); await setup(env); await seed(env, { load: (i) => (i === 1 ? null : 100) });
  await call(env, "/api/forza", { method: "POST", code: CODE, body: { serie: [{ start: ts(day(1), "18:00"), end: ts(day(1), "19:00"), exercise: "Squat", set_index: 0, weight: 100, reps: 5, rpe: 8 }] } });
  const h = (await call(env, `/api/history?days=2&fino=${day(0)}`, { code: CODE })).data;
  assert.equal(h[0].carico.oggi, 240, "60 min × RPE 8 / 2");
});

test("notifiche: cifratura RFC 8291 decifrabile dal telefono e firma VAPID valida", async () => {
  // "telefono": chiavi del browser
  const ua = crypto.createECDH("prime256v1"); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const body = await encryptPayload('{"title":"ciao"}', b64u(ua.getPublicKey()), b64u(auth));
  // decifratura lato telefono
  const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  const secret = ua.computeSecret(Buffer.from(asPub));
  const hk = (s, ikm, info, n) => Buffer.from(crypto.hkdfSync("sha256", ikm, s, info, n));
  const ikm = hk(auth, secret, Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), Buffer.from(asPub)]), 32);
  const cek = hk(Buffer.from(salt), ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hk(Buffer.from(salt), ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  const dec = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  dec.setAuthTag(Buffer.from(ct.slice(-16)));
  const plain = Buffer.concat([dec.update(Buffer.from(ct.slice(0, -16))), dec.final()]);
  assert.equal(plain.slice(0, -1).toString(), '{"title":"ciao"}');
  assert.equal(plain[plain.length - 1], 2);
  // VAPID
  const env = makeEnv(); await setup(env);
  const v = await getVapid(env.DB);
  const h = await vapidHeader("https://web.push.apple.com/abc", v, "mailto:x@y.z");
  const [, jwt, k] = h.match(/^vapid t=([^,]+), k=(.+)$/);
  const [hd, cl, sig] = jwt.split(".");
  const pub = await crypto.webcrypto.subtle.importKey("raw", unb64u(k), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert.ok(await crypto.webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, unb64u(sig), new TextEncoder().encode(`${hd}.${cl}`)));
  assert.equal(JSON.parse(Buffer.from(unb64u(cl)).toString()).aud, "https://web.push.apple.com");
});

test("notifiche: iscrizione validata, invio di prova, iscrizioni scadute rimosse", async () => {
  const env = makeEnv(); await setup(env);
  const ua = crypto.createECDH("prime256v1"); ua.generateKeys();
  const sub = { endpoint: "https://web.push.apple.com/QAbc", keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(crypto.randomBytes(16)) } };
  assert.equal((await call(env, "/api/push/iscrivi", { method: "POST", code: CODE, body: { ...sub, endpoint: "https://evil.example.com/x" } })).status, 400);
  assert.equal((await call(env, "/api/push/iscrivi", { method: "POST", code: CODE, body: sub })).status, 200);
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opt) => { calls.push({ url, opt }); return new Response(null, { status: calls.length === 1 ? 201 : 410 }); };
  try {
    assert.equal((await call(env, "/api/push/prova", { method: "POST", code: CODE })).data.inviate, 1);
    assert.equal(calls[0].opt.headers["content-encoding"], "aes128gcm");
    await call(env, "/api/push/prova", { method: "POST", code: CODE });
    assert.equal(await count(env, "push_subs"), 0, "rimossa dopo il 410");
  } finally { globalThis.fetch = orig; }
});
