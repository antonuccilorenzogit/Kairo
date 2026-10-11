import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setup, CODE, count } from "./helpers.js";

test("setup: codice troppo corto o banale rifiutato, poi una volta sola", async () => {
  const env = makeEnv();
  assert.equal((await call(env, "/api/setup", { method: "POST", body: { codice: "corto" } })).status, 400);
  assert.equal((await call(env, "/api/setup", { method: "POST", body: { codice: "aaaaaaaaaaaa" } })).status, 400);
  await setup(env);
  assert.equal((await call(env, "/api/setup", { method: "POST", body: { codice: "un-altro-codice-99" } })).status, 409);
  assert.equal((await call(env, "/api/info")).data.setup_richiesto, false);
});

test("accesso: senza codice 401, codice giusto 200", async () => {
  const env = makeEnv(); await setup(env);
  assert.equal((await call(env, "/api/diagnostica")).status, 401);
  assert.equal((await call(env, "/api/diagnostica", { code: CODE })).status, 200);
});

test("blocco dopo 5 tentativi sbagliati, solo per quell'IP, anche con il codice giusto", async () => {
  const env = makeEnv(); await setup(env);
  for (let i = 0; i < 4; i++) assert.equal((await call(env, "/api/diagnostica", { code: "sbagliato-" + i, ip: "6.6.6.6" })).status, 401);
  const fifth = await call(env, "/api/diagnostica", { code: "sbagliato-5", ip: "6.6.6.6" });
  assert.equal(fifth.status, 429);
  assert.ok(Number(fifth.headers.get("retry-after")) >= 15 * 60 - 1);
  assert.equal((await call(env, "/api/diagnostica", { code: CODE, ip: "6.6.6.6" })).status, 429, "bloccato anche con il codice giusto");
  assert.equal((await call(env, "/api/diagnostica", { code: CODE, ip: "2.2.2.2" })).status, 200, "altri IP non bloccati");
});

test("il secondo blocco dura il doppio", async () => {
  const env = makeEnv(); await setup(env);
  for (let i = 0; i < 5; i++) await call(env, "/api/diagnostica", { code: "x" + i, ip: "7.7.7.7" });
  await env.DB.prepare("UPDATE auth_fail SET locked_until = 0").run(); // simula la fine del primo blocco
  let last;
  for (let i = 0; i < 5; i++) last = await call(env, "/api/diagnostica", { code: "y" + i, ip: "7.7.7.7" });
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get("retry-after")) >= 30 * 60 - 1);
});

test("link di collegamento: valido invia dati, sbagliato non blocca l'app", async () => {
  const env = makeEnv(); await setup(env);
  const link = (await call(env, "/api/collegamento", { code: CODE })).data.link;
  const path = new URL(link).pathname;
  const ok = await call(env, path, { method: "POST", body: { hrv_valori: "70", hrv_date: "2026-10-10T03:00:00+02:00" } });
  assert.equal(ok.status, 200); assert.equal(ok.data.righe, 1);
  for (let i = 0; i < 6; i++) await call(env, "/api/sync/sbagliato" + i, { method: "POST", body: {}, ip: "9.9.9.9" });
  assert.equal((await call(env, "/api/sync/sbagliato", { method: "POST", body: {}, ip: "9.9.9.9" })).status, 429);
  assert.equal((await call(env, "/api/diagnostica", { code: CODE, ip: "9.9.9.9" })).status, 200, "l'app resta accessibile");
  // rigenerato: il vecchio link smette di funzionare
  await call(env, "/api/collegamento", { method: "POST", code: CODE });
  assert.equal((await call(env, path, { method: "POST", body: {} })).status, 401);
});

test("niente doppioni: lo stesso invio due volte", async () => {
  const env = makeEnv(); await setup(env);
  const payload = {
    hrv_valori: "70;80", hrv_date: "2026-10-10T03:00:00+02:00;2026-10-11T03:00:00+02:00",
    passi_valori: "8000", passi_date: "2026-10-10T00:00:00+02:00",
    sonno_valori: "Principale;Profondo", sonno_date: "2026-10-10T01:00:00+02:00;2026-10-10T02:00:00+02:00", sonno_fine: "2026-10-10T02:00:00+02:00;2026-10-10T03:00:00+02:00",
  };
  await call(env, "/api/ingest", { method: "POST", body: payload, code: CODE });
  await call(env, "/api/ingest", { method: "POST", body: payload, code: CODE });
  assert.equal(await count(env, "samples"), 2);
  assert.equal(await count(env, "daily"), 1);
  assert.equal(await count(env, "sleep"), 2);
});

test("niente doppioni: stessa misura con fuso orario diverso", async () => {
  const env = makeEnv(); await setup(env);
  await call(env, "/api/ingest", { method: "POST", code: CODE, body: { fcr_valori: "50", fcr_date: "2026-10-10T08:00:00+02:00" } });
  await call(env, "/api/ingest", { method: "POST", code: CODE, body: { fcr_valori: "50", fcr_date: "2026-10-10T06:00:00Z" } });
  assert.equal(await count(env, "samples"), 1);
});

test("totali giornalieri: più invii nello stesso giorno non si sommano", async () => {
  const env = makeEnv(); await setup(env);
  for (const v of [3000, 9000, 7000]) await call(env, "/api/ingest", { method: "POST", code: CODE, body: { passi_valori: String(v), passi_date: "2026-10-10T00:00:00+02:00" } });
  const r = await env.DB.prepare("SELECT value FROM daily WHERE metric='passi'").first();
  assert.equal(r.value, 9000);
});

test("sonno da più fonti sovrapposte: ogni minuto contato una volta", async () => {
  const env = makeEnv(); await setup(env);
  // Watch: 23:00-07:00 a fasi; iPhone: "a letto" 22:50-07:10 e "sonno" generico 23:00-07:00 (doppione)
  const W = (h) => `2026-10-${h < 12 ? "11" : "10"}T${String(h % 24).padStart(2, "0")}:00:00+02:00`;
  const body = {
    sonno_valori: "Principale;Profondo;REM;Principale;A letto;Sonno",
    sonno_date: [W(23), W(1), W(3), W(5), "2026-10-10T22:50:00+02:00", W(23)].join(";"),
    sonno_fine: [W(1), W(3), W(5), W(7), "2026-10-11T07:10:00+02:00", W(7)].join(";"),
  };
  await call(env, "/api/ingest", { method: "POST", code: CODE, body });
  const day = (await call(env, "/api/day?d=2026-10-11", { code: CODE })).data;
  assert.equal(day.sonno.durata_min, 480, "8 ore, non 16");
  assert.equal(day.sonno.fasi_min.profondo, 120);
  const stages = (await call(env, "/api/sonno?d=2026-10-11", { code: CODE })).data;
  for (let i = 1; i < stages.length; i++) assert.ok(stages[i].start >= stages[i - 1].end, "fasi senza sovrapposizioni");
});

test("dati non validi scartati senza rompere niente", async () => {
  const env = makeEnv(); await setup(env);
  const r = await call(env, "/api/ingest", { method: "POST", code: CODE, body: {
    hrv_valori: "70;abc;9999;-5", hrv_date: "2026-10-10T03:00:00+02:00;2026-10-10T04:00:00+02:00;2026-10-10T05:00:00+02:00;2026-10-10T06:00:00+02:00",
    fcr_valori: "50", fcr_date: "non-una-data",
    sonno_valori: "Profondo", sonno_date: "2026-10-10T03:00:00+02:00", sonno_fine: "2026-10-10T01:00:00+02:00",
    "<script>_valori": "1", "<script>_date": "2026-10-10T03:00:00+02:00",
    spo2_valori: "0.97", spo2_date: "2026-10-10T03:00:00+02:00",
  } });
  assert.equal(r.status, 200);
  assert.equal(r.data.righe, 2); // hrv 70 + spo2 97
  assert.ok(r.data.scartati >= 6);
  assert.equal((await env.DB.prepare("SELECT value FROM samples WHERE metric='spo2'").first()).value, 97);
  for (const bad of ["{", "[]", "null", '"testo"']) assert.equal((await call(env, "/api/ingest", { method: "POST", code: CODE, body: bad })).status, 400);
});

test("check-in: valori fuori scala rifiutati", async () => {
  const env = makeEnv(); await setup(env);
  assert.equal((await call(env, "/api/checkin", { method: "POST", code: CODE, body: { energia: 9 } })).status, 400);
  assert.equal((await call(env, "/api/checkin", { method: "POST", code: CODE, body: { energia: 4, attivita: "palestra,hack" } })).status, 200);
  const c = (await call(env, "/api/checkin", { code: CODE })).data;
  assert.equal(c.attivita, "palestra");
});

test("parametri strani nelle richieste non rompono il server", async () => {
  const env = makeEnv(); await setup(env);
  for (const q of ["/api/day?d=abc", "/api/history?days=-5", "/api/history?days=abc", "/api/sonno?d=2026-13-45", "/api/history?fino=xyz"])
    assert.equal((await call(env, q, { code: CODE })).status, 200, q);
  assert.equal((await call(env, "/api/non-esiste", { code: CODE })).status, 404);
});

test("backup: creato, elencato, scaricabile, ripristino senza doppioni", async () => {
  const env = makeEnv(); await setup(env);
  await call(env, "/api/ingest", { method: "POST", code: CODE, body: { hrv_valori: "70;80", hrv_date: "2026-10-10T03:00:00+02:00;2026-10-11T03:00:00+02:00", passi_valori: "5000", passi_date: "2026-10-10T00:00:00+02:00" } });
  const b = await call(env, "/api/backup", { method: "POST", code: CODE });
  assert.equal(b.data.ok, true); assert.equal(b.data.righe, 3 + 1 /* import log */);
  const list = (await call(env, "/api/backup", { code: CODE })).data;
  assert.equal(list.backup.length, 1);
  const file = await call(env, `/api/backup/file?chiave=${encodeURIComponent(list.backup[0].chiave)}`, { code: CODE, raw: true });
  const text = await new Response(file.body.pipeThrough(new DecompressionStream("gzip"))).text();
  const data = JSON.parse(text);
  // cancello tutto (crea un backup di sicurezza) e ripristino due volte
  assert.equal((await call(env, "/api/dati", { method: "DELETE", code: CODE, body: { conferma: "CANCELLA" } })).status, 200);
  assert.equal(await count(env, "samples"), 0);
  assert.equal((await call(env, "/api/backup", { code: CODE })).data.backup.length, 2, "backup di sicurezza prima della cancellazione");
  await call(env, "/api/ripristina", { method: "POST", code: CODE, body: data });
  await call(env, "/api/ripristina", { method: "POST", code: CODE, body: data });
  assert.equal(await count(env, "samples"), 2);
  assert.equal(await count(env, "daily"), 1);
});

test("backup: ne tiene al massimo 8", async () => {
  const env = makeEnv(); await setup(env);
  for (let i = 0; i < 11; i++) { await call(env, "/api/backup", { method: "POST", code: CODE }); await new Promise((r) => setTimeout(r, 2)); }
  assert.equal((await call(env, "/api/backup", { code: CODE })).data.backup.length, 8);
});

test("backup senza spazio KV: messaggio chiaro, nessun errore", async () => {
  const env = makeEnv({ BACKUP: undefined }); await setup(env);
  const r = await call(env, "/api/backup", { method: "POST", code: CODE });
  assert.equal(r.status, 200); assert.ok(r.data.errore);
  assert.equal((await call(env, "/api/dati", { method: "DELETE", code: CODE, body: { conferma: "CANCELLA" } })).status, 200);
});

test("backup automatico dal cron settimanale", async () => {
  const env = makeEnv(); await setup(env);
  const { default: worker } = await import("../src/index.js");
  const waits = [];
  await worker.scheduled({}, env, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  assert.equal((await call(env, "/api/backup", { code: CODE })).data.backup[0].motivo, "automatico settimanale");
});

test("migrazione da un database della versione 1 senza perdere dati", async () => {
  const env = makeEnv();
  const db = env.DB;
  await db.exec(`CREATE TABLE samples (metric TEXT NOT NULL, ts TEXT NOT NULL, value REAL NOT NULL, PRIMARY KEY (metric, ts));
    CREATE TABLE sleep (start TEXT PRIMARY KEY, end TEXT NOT NULL, stage TEXT NOT NULL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO settings VALUES('schema_version','1');
    INSERT INTO samples VALUES('hrv','2026-10-10T03:00:00+02:00',70),('hrv','2026-10-10T01:00:00Z',71),('fcr','2026-10-10T08:00:00+02:00',50);
    INSERT INTO sleep VALUES('2026-10-10T01:00:00+02:00','2026-10-10T02:00:00+02:00','core');`);
  await setup(env);
  assert.equal(await count(env, "samples"), 2, "il doppione con fuso diverso viene unito");
  assert.equal(await count(env, "sleep"), 1);
  assert.equal((await db.prepare("SELECT value FROM settings WHERE key='schema_version'").first()).value, "2");
});

test("richieste OPTIONS e pagine dell'app", async () => {
  const env = makeEnv();
  assert.equal((await call(env, "/api/info", { method: "OPTIONS", raw: true })).status, 204);
  assert.equal(await (await call(env, "/", { raw: true })).text(), "asset");
});
