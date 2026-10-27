// Kairo server — receives HealthSync data, stores it in D1, computes recovery & sleep,
// talks to the AI coach and serves the web app (static assets in /public).
import { computeDay, computeHistory, mergeStages } from "./metrics.js";
import { ensureSchema, SCHEMA_VERSION } from "./schema.js";
import { dailyAdvice, chat, testAI, groqModels, weeklyCoach, DEFAULT_GROQ_MODEL, FALLBACK_MODEL } from "./coach.js";
import { saveSets, strengthSummary, muscleFatigue, unknownExercises, setCustomMuscle, MUSCLES, recoveryCheck, customMuscles, muscleWeights } from "./strength.js";
import { weeklyReport } from "./report.js";
import { recommendWorkout, getSchede, saveSchede, lastSets, schedeFromText, gymHistory, nextScheda } from "./workout.js";
import { sha256, safeEqual, clientIp, lockedFor, recordFailure, clearFailures, pruneFailures, codeProblem } from "./security.js";
import { parsePayload, cleanCheckin, cleanNap, MAX_BODY_BYTES } from "./validate.js";
import { exportData, createBackup, listBackups, readBackup, restoreData } from "./backup.js";
import { getProfile, saveProfile, hrMax, profileText, SPORTS, ALTRI_SPORT } from "./profile.js";
import { listMemory, addMemory, deleteMemory, memoryText } from "./memory.js";
import { injuryPlan, injuryText, savePain, clearPain, saveDone, constraints, constraintList } from "./injury.js";

// What every coach prompt knows about the person: profile + remembered facts.
const coachProfile = async (db, profile) => {
  const p = profile || (await getProfile(db));
  return profileText(p) + (await injuryText(db, p)) + memoryText(await listMemory(db));
};
// Today's coach texts depend on the injury: drop them when it changes.
const dropTodayAdvice = (db, day) => db.prepare("DELETE FROM advice WHERE day IN (?, ?)").bind(day, "A:" + day).run();
import { recomputeTrimp, recomputeNightHr } from "./load.js";
import { metered, saveTally } from "./meter.js";
import { getPlan, savePlan, restartPlan, planToday, planOverview, saveOutcome, blockOf, mondayOf } from "./plan.js";
import { propose } from "./progression.js";
import { getVapid, sendPush, validEndpoint } from "./push.js";

const VERSION = "1.25.3";

// No CORS headers: only the Kairo app (same origin) and the Shortcuts app (not a browser) talk to the API.
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra },
});
const getSetting = async (db, key) => (await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first())?.value ?? null;
const setSetting = (db, key, value) => db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key, value).run();

// Reads a JSON body with a size limit; returns undefined when it is missing or invalid.
async function readJson(req, limit = 256 * 1024) {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > limit) return { __troppo: true };
  const text = await req.text().catch(() => "");
  if (text.length > limit) return { __troppo: true };
  try { return JSON.parse(text); } catch { return undefined; }
}

// Sync link: a random token that only allows sending data (used by the HealthSync shortcut).
async function syncToken(db, rotate = false) {
  let t = rotate ? null : await getSetting(db, "sync_token");
  if (!t) {
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    // rejection sampling: every character equally likely
    const out = [];
    while (out.length < 32) for (const b of crypto.getRandomValues(new Uint8Array(48))) if (b < 228 && out.length < 32) out.push(abc[b % 57]);
    t = out.join("");
    await setSetting(db, "sync_token", t);
  }
  return t;
}

function bearer(req) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}
// "ok" | "missing" | "wrong"
async function checkCode(req, env) {
  const token = bearer(req);
  if (!token) return "missing";
  if (env.API_KEY && safeEqual(token, env.API_KEY)) return "ok"; // optional secret set with wrangler
  const hash = await getSetting(env.DB, "access_hash");
  return hash && safeEqual(await sha256(token), hash) ? "ok" : "wrong";
}
const locked = (sec) => json({ errore: `Troppi tentativi sbagliati: riprova tra ${Math.ceil(sec / 60)} minuti.`, bloccato_per_s: sec }, 429, { "retry-after": String(sec) });

// Writes validated rows. Every table has a natural key, so sending the same data again
// (or overlapping periods) never creates duplicates.
// Morning notification: the first time today's recovery is available (after the wake-up sync).
async function morningPush(env, origin) {
  const subs = await env.DB.prepare("SELECT count(*) n FROM push_subs").first();
  if (!subs.n) return;
  const prof = await getProfile(env.DB);
  const day = todayLocal(prof.tz), hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: prof.tz, hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  if (hour < 4 || hour > 13) return;
  const d = await computeDay(env.DB, day);
  if (d.recupero.score == null) return;
  // wait for the complete night: right after the alarm the Watch has not processed the sleep stages yet
  // (no night at all, or no deep/REM minutes). After 10:00 send anyway (some people have no stages).
  if (hour < 10 && !nightComplete(d)) return;
  // claim today's slot atomically, so two syncs at the same time do not send two notifications
  const r = await env.DB.prepare("INSERT INTO settings(key,value) VALUES('push_mattina',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE settings.value != excluded.value").bind(day).run();
  if (!r.meta?.changes) return;
  if (!(await hasCheckin(env.DB, day))) return sendPush(env, { title: "Buongiorno", body: d.settaggio && !d.settaggio.pronto ? "Fai il check-in di 10 secondi: Kairo sta completando il settaggio." : prof.infortunio?.attivo ? "Il recupero di stanotte è pronto: fai il check-in e segna il dolore per il piano di oggi." : "Il recupero di stanotte è pronto: fai il check-in di 10 secondi per vedere com'è andata e cosa fare oggi.", url: "/#/oggi" }, origin);
  if (d.settaggio && !d.settaggio.pronto) return; // no score to announce during the set-up period
  if (prof.infortunio?.attivo) return sendPush(env, { title: "Modalità infortunio", body: "Segna quanto ti fa male oggi: il coach ti dice se riposare o quali esercizi fare.", url: "/#/oggi" }, origin);
  const label = d.recupero.score >= 67 ? "Recuperato" : d.recupero.score >= 34 ? "Recupero parziale" : "Recupero basso";
  const body = d.allarme ? `${d.allarme.titolo}: oggi vai leggero.` : d.carico?.consiglio ? `Oggi: ${d.carico.consiglio.titolo.toLowerCase()} — ${d.carico.consiglio.testo}.` : "Apri Kairo per il consiglio di oggi.";
  await sendPush(env, { title: `${label} · ${d.recupero.score}`, body, url: "/#/oggi" }, origin);
}

// Today's texts wait for the complete night (the Watch processes it a few minutes after waking up);
// from 10:00 they are written anyway, for nights without the Watch's sleep stages.
function localHour(tz) { return Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date())); }
function nightReady(db, day, tz, d) {
  if (localHour(tz) >= 10) return d ? true : Promise.resolve(true);
  if (d) return nightComplete(d);
  return computeDay(db, day).then(nightComplete);
}
const hasCheckin = async (db, day) => !!(await db.prepare("SELECT 1 FROM checkin WHERE day = ?").bind(day).first());

// The night is complete when it has the Watch's sleep stages (or was declared by hand in the check-in).
const nightComplete = (d) => !!d.sonno && (d.sonno.manuale || (d.sonno.fasi_min && (d.sonno.fasi_min.profondo || 0) + (d.sonno.fasi_min.rem || 0) > 0));

// Evening notification: about 30 minutes before the suggested bedtime.
async function eveningPush(env, origin) {
  const subs = await env.DB.prepare("SELECT count(*) n FROM push_subs").first();
  if (!subs.n) return;
  const prof = await getProfile(env.DB);
  // the bedtime is between 19:00 and 02:00: outside that window there is nothing to compute
  const hourNow = Number(new Intl.DateTimeFormat("en-GB", { timeZone: prof.tz, hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  if (hourNow >= 2 && hourNow < 19) return;
  const day = todayLocal(prof.tz);
  // already sent tonight: nothing to compute (the evening slot is the day the evening started)
  const sent = await env.DB.prepare("SELECT value FROM settings WHERE key = 'push_sera'").first();
  if (sent?.value === day || (hourNow < 2 && sent?.value === new Date(Date.parse(day + "T12:00:00Z") - 864e5).toISOString().slice(0, 10))) return;
  const d = await computeDay(env.DB, day);
  const st = d.sonno_stanotte;
  if (!st || !st.a_letto) return;
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: prof.tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()).split(":").map(Number);
  const now = h * 60 + m, bed = Number(st.a_letto.slice(0, 2)) * 60 + Number(st.a_letto.slice(3));
  let diff = bed - now; if (diff < -720) diff += 1440; if (diff > 720) diff -= 1440;
  if (diff < 10 || diff > 45) return;
  const r = await env.DB.prepare("INSERT INTO settings(key,value) VALUES('push_sera',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE settings.value != excluded.value").bind(day).run();
  if (!r.meta?.changes) return;
  const fmt = (min) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
  await sendPush(env, { title: `A letto entro le ${st.a_letto}`, body: `Stanotte ti servono ${fmt(st.fabbisogno_min)} di sonno${st.pisolino_min ? ` (${st.pisolino_min} min in meno grazie al pisolino)` : st.per_carico_min || st.per_debito_min ? " (oggi un po' di più per recuperare)" : ""}.`, url: "/#/sonno" }, origin);
}

async function ingest(payload, env, origin) {
  const db = env.DB, rows = parsePayload(payload), stmts = [];
  // a measurement already stored (same instant) is skipped: no write is spent on data we already have
  for (const [m, ts, t, v] of rows.samples) stmts.push(db.prepare("INSERT INTO samples(metric,ts,t,value) VALUES(?,?,?,?) ON CONFLICT DO NOTHING").bind(m, ts, t, v));
  // daily and hourly totals arrive already summed by Health: keep the highest value seen (a day only grows)
  for (const [m, d, v] of rows.daily) stmts.push(db.prepare("INSERT INTO daily(metric,day,value) VALUES(?,?,?) ON CONFLICT(metric,day) DO UPDATE SET value=excluded.value WHERE excluded.value > daily.value").bind(m, d, v));
  for (const [m, h, v] of rows.hourly) stmts.push(db.prepare("INSERT INTO hourly(metric,hour,value) VALUES(?,?,?) ON CONFLICT(metric,hour) DO UPDATE SET value=excluded.value WHERE excluded.value > hourly.value").bind(m, h, v));
  for (const [s, e, st] of rows.sleep) stmts.push(db.prepare("INSERT OR IGNORE INTO sleep(start,end,stage) VALUES(?,?,?)").bind(s, e, st));
  for (let i = 0; i < stmts.length; i += 400) await db.batch(stmts.slice(i, i + 400));
  // new heart-rate samples → recompute the training load of those days
  const fcDays = rows.samples.filter((r) => r[0] === "fc").map((r) => r[1].slice(0, 10));
  // the first time also the last 30 days, to find the training sessions already in the heart-rate data
  const sessDone = await db.prepare("SELECT value FROM settings WHERE key = 'sessioni_storico'").first();
  if (!sessDone) {
    const r = await db.prepare("SELECT DISTINCT substr(ts,1,10) d FROM samples WHERE metric = 'fc' AND ts >= ?").bind(new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10)).all();
    fcDays.push(...r.results.map((x) => x.d));
    await db.prepare("INSERT INTO settings(key,value) VALUES('sessioni_storico','1') ON CONFLICT(key) DO NOTHING").run();
  }
  if (fcDays.length) await recomputeTrimp(db, fcDays, hrMax(await getProfile(db)));
  // resting heart rate while asleep: for the nights touched by new heart-rate or sleep data
  // (the first time also for the last 60 nights already stored)
  const wakeDays = rows.sleep.map((x) => x[1].slice(0, 10));
  const nightDays = [...fcDays, ...fcDays.map((d) => new Date(Date.parse(d + "T12:00:00Z") + 86400e3).toISOString().slice(0, 10)), ...wakeDays];
  const done = await db.prepare("SELECT value FROM settings WHERE key = 'fc_notte_storico'").first();
  if (!done) {
    const r = await db.prepare("SELECT DISTINCT substr(end,1,10) d FROM sleep WHERE end >= ?").bind(new Date(Date.now() - 60 * 86400e3).toISOString().slice(0, 10)).all();
    nightDays.push(...r.results.map((x) => x.d));
    await db.prepare("INSERT INTO settings(key,value) VALUES('fc_notte_storico','1') ON CONFLICT(key) DO NOTHING").run();
  }
  if (nightDays.length) await recomputeNightHr(db, nightDays);
  const clip = (x, n) => (x == null ? null : String(x).slice(0, n));
  await db.prepare("INSERT INTO imports(received,modulo,esportato,righe,versione) VALUES(?,?,?,?,?)")
    .bind(new Date().toISOString(), clip(payload?.modulo, 60), clip(payload?.esportato, 40), stmts.length, clip(payload?.versione, 20)).run();
  // keep the import log short
  await db.prepare("DELETE FROM imports WHERE id <= (SELECT max(id) - 500 FROM imports)").run();
  try { await morningPush(env, origin); } catch (e) { console.warn("push mattina", e); }
  return { righe: stmts.length, scartati: rows.discarded, sconosciuti: rows.unknown };
}

async function readIngestBody(req) {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_BODY_BYTES) return { errore: "Invio troppo grande: dividi i dati in più parti." };
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return { errore: "Invio troppo grande: dividi i dati in più parti." };
  try { const p = JSON.parse(text); return p && typeof p === "object" && !Array.isArray(p) ? { payload: p } : { errore: "JSON non valido" }; }
  catch { return { errore: "JSON non valido" }; }
}

const todayLocal = (tz) => {
  try { return new Intl.DateTimeFormat("sv-SE", { timeZone: tz || "Europe/Rome" }).format(new Date()); }
  catch { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date()); }
};
const validDay = (d) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) ? d : null);

async function diagnostics(env, refresh = false) {
  const db = env.DB;
  // counting every row of every table reads the whole database (D1 bills rows read, 5 million a day on the free
  // plan): the counts are kept for 24 hours; what must be fresh (last data received) uses the indexes, a few rows.
  const today = new Date().toISOString().slice(0, 10);
  const r = await db.batch([
    db.prepare("SELECT value FROM settings WHERE key = 'diag_cache'"),
    db.prepare("SELECT (SELECT max(ts) FROM samples WHERE metric='hrv') hrv, (SELECT max(ts) FROM samples WHERE metric='fcr') fcr, (SELECT max(ts) FROM samples WHERE metric='fc') fc, (SELECT max(ts) FROM samples WHERE metric='resp') resp, (SELECT max(ts) FROM samples WHERE metric='spo2') spo2, (SELECT max(end) FROM sleep) sonno"),
    db.prepare("SELECT key, value FROM settings WHERE key IN (?, ?)").bind("letture_" + today, "letture_" + new Date(Date.now() - 864e5).toISOString().slice(0, 10)),
    db.prepare("SELECT received, modulo, esportato, righe, versione FROM imports ORDER BY id DESC LIMIT 12"),
    db.prepare("SELECT key, value FROM settings WHERE key LIKE 'ai_%' OR key IN ('schema_version','setup_at','last_backup','groq_model') OR (key = 'groq_key' AND value != '')"),
  ]);
  let heavy = null;
  try { heavy = JSON.parse(r[0].results[0]?.value || "null"); } catch (_) {}
  if (refresh || !heavy || Date.now() - Date.parse(heavy.t) > 24 * 3600e3) {
    const h = await db.batch([
      db.prepare("SELECT (SELECT count(*) FROM samples) samples, (SELECT count(*) FROM daily) daily, (SELECT count(*) FROM hourly) hourly, (SELECT count(*) FROM sleep) sleep, (SELECT count(*) FROM checkin) checkin, (SELECT count(*) FROM imports) imports, (SELECT count(*) FROM advice) advice"),
      db.prepare("SELECT metric, count(*) n, min(ts) da, max(ts) a FROM samples GROUP BY metric ORDER BY metric"),
      db.prepare("SELECT metric, count(*) n, min(day) da, max(day) a FROM daily GROUP BY metric ORDER BY metric"),
      db.prepare("SELECT count(*) n, min(start) da, max(end) a FROM sleep"),
    ]);
    heavy = { t: new Date().toISOString(), righe: h[0].results[0], metriche: h[1].results, giornaliere: h[2].results, sonno: h[3].results[0] };
    await db.prepare("INSERT INTO settings(key,value) VALUES('diag_cache',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(heavy)).run();
  }
  const fresh = r[1].results[0] || {};
  const metriche = heavy.metriche.map((m) => (fresh[m.metric] ? { ...m, a: fresh[m.metric] } : m));
  for (const k of ["hrv", "fcr", "fc", "resp", "spo2"]) if (fresh[k] && !metriche.some((m) => m.metric === k)) metriche.push({ metric: k, n: null, da: null, a: fresh[k] });
  const sonno = { ...heavy.sonno, a: fresh.sonno || heavy.sonno?.a, n: heavy.sonno?.n || (fresh.sonno ? 1 : 0) };
  const lett = Object.fromEntries(r[2].results.map((x) => { try { return [x.key.slice(8), JSON.parse(x.value)]; } catch { return [x.key.slice(8), {}]; } }));
  const tot = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
  const letture = { oggi: tot(lett[today]), ieri: tot(lett[new Date(Date.now() - 864e5).toISOString().slice(0, 10)]), limite: 5000000,
    per_funzione: Object.entries(lett[today] || {}).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => ({ funzione: k, righe: v })) };
  r.splice(0, 3, { results: [heavy.righe] }, { results: metriche }, { results: heavy.giornaliere }, { results: [sonno] });
  // r: [righe, metriche, giornaliere, sonno, importazioni, settings] as before
  const settings = Object.fromEntries(r[5].results.map((x) => [x.key, x.key === "groq_key" ? "1" : x.value]));
  const day = new Date().toISOString().slice(0, 10);
  let dbSize = null;
  try { dbSize = (await db.prepare("SELECT 1").run()).meta?.size_after ?? null; } catch (_) {}
  return {
    server: { app: "kairo", versione: VERSION, schema: Number(settings.schema_version || SCHEMA_VERSION), ora_server: new Date().toISOString(), configurato_il: settings.setup_at || null },
    database: { righe: r[0].results[0], dimensione_byte: dbSize, conteggi_del: heavy.t }, letture,
    metriche: r[1].results, giornaliere: r[2].results, sonno: r[3].results[0],
    importazioni: r[4].results,
    backup: { attivo: !!env.BACKUP, ultimo: settings.last_backup ? JSON.parse(settings.last_backup) : null },
    ia: {
      groq_quota: settings.ai_quota_groq ? JSON.parse(settings.ai_quota_groq) : null,
      chiamate_oggi_groq: Number(settings[`ai_calls_groq_${day}`] || 0),
      chiamate_oggi_riserva: Number(settings[`ai_calls_workers_ai_${day}`] || 0),
      riserva_disponibile: !!env.AI, modello_riserva: FALLBACK_MODEL, modello_predefinito: DEFAULT_GROQ_MODEL,
      chiave_groq_sul_server: !!env.GROQ_API_KEY || !!settings.groq_key,
      modello_sul_server: settings.groq_model || null,
    },
  };
}

async function api(req, env, url) {
  const p = url.pathname;
  const tz = String(req.headers.get("x-timezone") || "Europe/Rome").slice(0, 60);
  const ip = clientIp(req);

  // ---- public ----
  if (p === "/api/info") {
    const hash = await getSetting(env.DB, "access_hash");
    return json({ app: "kairo", versione: VERSION, schema: SCHEMA_VERSION, setup_richiesto: !hash && !env.API_KEY });
  }
  if (p === "/api/setup" && req.method === "POST") {
    const wait = await lockedFor(env.DB, ip); if (wait) return locked(wait);
    if ((await getSetting(env.DB, "access_hash")) || env.API_KEY) { await recordFailure(env.DB, ip); return json({ errore: "Server già configurato" }, 409); }
    const b = await readJson(req);
    const problem = codeProblem(b?.codice);
    if (problem) return json({ errore: problem }, 400);
    // first come, first served: the insert only succeeds if nobody configured the server in the meantime
    const r = await env.DB.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('access_hash',?)").bind(await sha256(String(b.codice))).run();
    if (!r.meta?.changes) return json({ errore: "Server già configurato" }, 409);
    await setSetting(env.DB, "setup_at", new Date().toISOString());
    return json({ ok: true });
  }

  // ---- HealthSync shortcut: sync link (can only send data) ----
  if (p.startsWith("/api/sync/")) {
    // separate counter: an old link in a forgotten shortcut must not lock you out of the app
    const sip = "sync:" + ip;
    const wait = await lockedFor(env.DB, sip); if (wait) return locked(wait);
    const tok = p.slice(10).replace(/\/+$/, "");
    const real = await getSetting(env.DB, "sync_token");
    if (!real || !safeEqual(tok, real)) {
      const lock = await recordFailure(env.DB, sip);
      return lock ? locked(lock) : json({ errore: "Link di collegamento non valido: copialo di nuovo dall'app Kairo (Impostazioni)." }, 401);
    }
    if (req.method !== "POST") return json({ ok: true, app: "kairo", messaggio: "Link valido" });
    const b = await readIngestBody(req);
    if (b.errore) return json({ errore: b.errore }, 400);
    return json({ ok: true, ...(await ingest(b.payload, env, url.origin)) });
  }

  // ---- everything else needs the access code ----
  const wait = await lockedFor(env.DB, ip);
  if (wait) return locked(wait);
  const auth = await checkCode(req, env);
  if (auth !== "ok") {
    if (auth === "wrong") { const lock = await recordFailure(env.DB, ip); if (lock) return locked(lock); }
    return json({ errore: "Codice di accesso non valido" }, 401);
  }
  await clearFailures(env.DB, ip);
  if (Math.random() < 0.02) await pruneFailures(env.DB);

  if (p === "/api/profilo") {
    if (req.method === "GET") return json(await getProfile(env.DB));
    const before = await getProfile(env.DB);
    const body = (await readJson(req)) || {};
    if (body.infortunio === undefined) body.infortunio = before.infortunio; // older apps don't send it
    const saved = await saveProfile(env.DB, body);
    if (saved.errore) return json(saved, 400);
    // age or max heart rate changed → the heart-rate zones change: recompute the training load
    if (hrMax(before) !== hrMax(saved)) {
      const since = new Date(Date.now() - 120 * 86400e3).toISOString().slice(0, 10);
      const r = await env.DB.prepare("SELECT DISTINCT substr(ts,1,10) d FROM samples WHERE metric='fc' AND ts >= ?").bind(since).all();
      await recomputeTrimp(env.DB, r.results.map((x) => x.d), hrMax(saved));
    }
    if (JSON.stringify(before.infortunio) !== JSON.stringify(saved.infortunio)) {
      if (saved.infortunio.attivo && !before.infortunio?.attivo) await clearPain(env.DB);
      await dropTodayAdvice(env.DB, todayLocal(tz));
    }
    return json(saved);
  }
  // Injury mode on/off without touching the rest of the profile
  if (p === "/api/infortunio" && req.method === "GET") {
    const inj = (await getProfile(env.DB)).infortunio;
    return json({ infortunio: inj, vincoli: constraints(inj), elenco: constraintList(constraints(inj), todayLocal(tz)) });
  }
  if (p === "/api/infortunio" && req.method === "POST") {
    const b = (await readJson(req)) || {};
    const before = await getProfile(env.DB);
    const inj = { ...before.infortunio, ...b };
    if (b.attivo === true && !before.infortunio?.attivo && !b.dal) inj.dal = todayLocal(tz);
    const saved = await saveProfile(env.DB, { ...before, infortunio: inj });
    if (saved.errore) return json(saved, 400);
    if (saved.infortunio.attivo && !before.infortunio?.attivo) await clearPain(env.DB);
    // healed: the training plan starts again from block 1 (levels already drop by themselves after the long break)
    if (!saved.infortunio.attivo && before.infortunio?.attivo && (await getPlan(env.DB)).attivo) await restartPlan(env.DB, todayLocal(tz));
    await dropTodayAdvice(env.DB, todayLocal(tz));
    return json(saved);
  }
  // injury mode: were today's exercises done? ("fatto", "parte", "saltato")
  if (p === "/api/infortunio/esito" && req.method === "POST") {
    const b = (await readJson(req)) || {};
    if (!(await getProfile(env.DB)).infortunio?.attivo) return json({ errore: "La modalità infortunio non è attiva" }, 400);
    const r = await saveDone(env.DB, todayLocal(tz), b.stato);
    return json(r, r.errore ? 400 : 200);
  }
  if (p === "/api/chat") {
    if (req.method === "DELETE") { await env.DB.prepare("DELETE FROM chat").run(); return json({ ok: true }); }
    const r = await env.DB.prepare("SELECT role, content, meta, created FROM (SELECT * FROM chat ORDER BY id DESC LIMIT 40) ORDER BY id").all();
    return json(r.results);
  }
  if (p === "/api/push/chiave") return json({ chiave: (await getVapid(env.DB)).publicKey });
  if (p === "/api/push/iscrivi" && req.method === "POST") {
    const b = await readJson(req);
    const endpoint = b?.endpoint, key = b?.keys?.p256dh, auth = b?.keys?.auth;
    if (!validEndpoint(endpoint) || !/^[A-Za-z0-9_-]{80,100}$/.test(key || "") || !/^[A-Za-z0-9_-]{16,32}$/.test(auth || "")) return json({ errore: "Iscrizione non valida" }, 400);
    await env.DB.prepare("INSERT OR REPLACE INTO push_subs(endpoint,p256dh,auth,created) VALUES(?,?,?,?)").bind(endpoint, key, auth, new Date().toISOString()).run();
    return json({ ok: true });
  }
  if (p === "/api/push/iscrivi" && req.method === "DELETE") {
    const b = await readJson(req);
    await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(String(b?.endpoint || "")).run();
    return json({ ok: true });
  }
  if (p === "/api/push/prova" && req.method === "POST") {
    return json(await sendPush(env, { title: "Kairo", body: "Le notifiche funzionano. Ti scriverò la mattina e prima di dormire.", url: "/#/oggi" }, url.origin));
  }
  if (p === "/api/collegamento") {
    const t = await syncToken(env.DB, req.method === "POST");
    return json({ link: `${url.origin}/api/sync/${t}` });
  }
  if (p === "/api/ingest" && req.method === "POST") {
    const b = await readIngestBody(req);
    if (b.errore) return json({ errore: b.errore }, 400);
    return json({ ok: true, ...(await ingest(b.payload, env, url.origin)) });
  }
  // set-up period: progress, what is still to set, restart (new Watch, big change)
  if (p === "/api/settaggio") {
    const day = todayLocal(tz);
    if (req.method === "POST") {
      const b = (await readJson(req)) || {};
      if (!b.ricomincia) return json({ errore: "Richiesta non valida" }, 400);
      await env.DB.batch([
        env.DB.prepare("INSERT INTO settings(key,value) VALUES('settaggio_dal',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(day),
        env.DB.prepare("DELETE FROM settings WHERE key = 'settaggio_finito'"),
        env.DB.prepare("DELETE FROM recupero_giorno WHERE day = ?").bind(day),
        env.DB.prepare("DELETE FROM advice WHERE day IN (?, ?, ?)").bind(day, "A:" + day, "CTX:" + day),
      ]);
    }
    const [d, profile, schede, last] = await Promise.all([computeDay(env.DB, day), getProfile(env.DB), getSchede(env.DB),
      env.DB.prepare("SELECT max(received) r FROM imports").first()]);
    const sync = last?.r ? (Date.now() - Date.parse(last.r)) / 36e5 < 36 : false;
    return json({ ...d.settaggio, controlli: {
      profilo: !!(profile.eta || profile.fc_max), sport: (profile.sport || []).length > 0,
      schede: !(profile.sport || []).includes("palestra") || schede.length > 0, sveglia: !!profile.sveglia, sync, ultimo_invio: last?.r || null, piano: (await getPlan(env.DB)).attivo } });
  }
  if (p === "/api/day") return json(await computeDay(env.DB, validDay(url.searchParams.get("d")) || todayLocal(tz)));
  if (p === "/api/history") {
    const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 30, 1), 400);
    return json(await computeHistory(env.DB, validDay(url.searchParams.get("fino")) || todayLocal(tz), days));
  }
  if (p === "/api/sonno") {
    // stages of the night that ends on day `d` (from 18:00 of the previous day to 18:00 of `d`), sources merged
    const d = validDay(url.searchParams.get("d")) || todayLocal(tz);
    const prev = new Date(Date.parse(d + "T12:00:00Z") - 86400e3).toISOString().slice(0, 10);
    const r = await env.DB.prepare("SELECT start, end, stage FROM sleep WHERE end > ? AND start < ? ORDER BY start")
      .bind(prev + "T18:00", d + "T18:00").all();
    return json(mergeStages(r.results).filter((x) => x.end > prev + "T18:00" && x.end <= d + "T18:00"));
  }
  if (p === "/api/settimana" || p === "/api/settimana/coach") {
    const yesterday = new Date(Date.parse(todayLocal(tz) + "T12:00:00Z") - 86400e3).toISOString().slice(0, 10);
    const rep = await weeklyReport(env.DB, validDay(url.searchParams.get("a")) || yesterday);
    if (p === "/api/settimana") return json(rep);
    return json(await weeklyCoach(env, req, rep, await coachProfile(env.DB)));
  }
  if (p === "/api/allenamento/oggi" && req.method === "POST") {
    const b = (await readJson(req)) || {};
    if (!(await hasCheckin(env.DB, todayLocal(tz)))) return json({ checkin_richiesto: true });
    const profile = await getProfile(env.DB);
    const hist = await computeHistory(env.DB, todayLocal(tz), 8);
    const cachedW = await env.DB.prepare("SELECT 1 FROM advice WHERE day = ?").bind("A:" + todayLocal(tz)).first();
    const waitNight = () => !cachedW && !nightReady(null, null, tz, hist[hist.length - 1]);
    if (profile.infortunio?.attivo) {
      const day = todayLocal(tz);
      if (b.dolore != null) {
        const sp = await savePain(env.DB, day, b.dolore);
        if (sp.errore) return json(sp, 400);
        await env.DB.prepare("DELETE FROM advice WHERE day = ?").bind(day).run(); // the coach's message follows the pain
      }
      if (waitNight()) return json({ notte_in_attesa: true, infortunio: true });
      return json(await injuryPlan(env, req, { day, today: hist[hist.length - 1], profile, profileText: await coachProfile(env.DB, profile), force: !!b.forza }));
    }
    if (waitNight()) return json({ notte_in_attesa: true });
    // with an active plan, today's sessions come from the plan (rules, no AI)
    const pt = await planToday(env, { day: todayLocal(tz), tz, profile, today: hist[hist.length - 1] });
    if (pt) return json(pt);
    // set-up period without a plan: no daily recommendation (it would rest on a score that is not reliable yet)
    const su = hist[hist.length - 1].settaggio;
    if (su && !su.pronto) return json({ settaggio: true });
    const esito = await env.DB.prepare("SELECT stato, sport FROM esiti WHERE day = ?").bind(todayLocal(tz)).first();
    return json({ ...(await recommendWorkout(env, req, { hist, profile, profileText: await coachProfile(env.DB, profile), schede: await getSchede(env.DB),
      force: !!b.forza || !!b.altro, exclude: b.altro && ["palestra", "nuoto", "bici", "corsa"].includes(b.escludi) ? b.escludi : null })), esito: esito || null });
  }
  // training plan: settings, overview of the week, outcome of a planned session (with test results)
  if (p === "/api/piano") {
    if (req.method === "POST") {
      const r = await savePlan(env.DB, (await readJson(req)) || {}, todayLocal(tz));
      if (r.errore) return json(r, 400);
      await env.DB.prepare("DELETE FROM advice WHERE day IN (?, ?)").bind("A:" + todayLocal(tz), "CTX:" + todayLocal(tz)).run();
    }
    return json(await planOverview(env, { day: todayLocal(tz), tz, profile: await getProfile(env.DB) }));
  }
  if (p === "/api/piano/ricomincia" && req.method === "POST") {
    await restartPlan(env.DB, todayLocal(tz));
    return json(await planOverview(env, { day: todayLocal(tz), tz, profile: await getProfile(env.DB) }));
  }
  if (p === "/api/piano/esito" && req.method === "POST") {
    const r = await saveOutcome(env.DB, todayLocal(tz), (await readJson(req)) || {});
    return json(r, r.errore ? 400 : 200);
  }
  // the person links an exercise Kairo does not know to a muscle
  // which muscles Kairo thinks an exercise works (to show it in the routine editor)
  if (p === "/api/muscoli" && req.method === "GET") {
    const custom = await customMuscles(env.DB);
    const nomi = String(url.searchParams.get("nomi") || "").split("|").map((x) => x.trim()).filter(Boolean).slice(0, 40);
    return json({ muscoli: Object.fromEntries(nomi.map((n) => [n, { lista: muscleWeights(n, custom), scelto: custom[n.toLowerCase()] || null }])), elenco: MUSCLES });
  }
  if (p === "/api/muscoli" && req.method === "POST") {
    const b = (await readJson(req)) || {};
    const r = await setCustomMuscle(env.DB, b.esercizio, b.muscolo);
    return json(r, r.errore ? 400 : 200);
  }
  // outcome of the day's workout: "fatto", "altro" (with the sport) or "saltato"
  if (p === "/api/allenamento/esito" && req.method === "POST") {
    const b = (await readJson(req)) || {};
    const stato = ["fatto", "altro", "saltato"].includes(b.stato) ? b.stato : null;
    const sport = [...SPORTS, ...ALTRI_SPORT, "camminata"].includes(b.sport) ? b.sport : null;
    if (!stato) return json({ errore: "Esito non valido" }, 400);
    await env.DB.prepare("INSERT INTO esiti(day,stato,sport,created) VALUES(?,?,?,?) ON CONFLICT(day) DO UPDATE SET stato=excluded.stato, sport=excluded.sport, created=excluded.created")
      .bind(todayLocal(tz), stato, stato === "saltato" ? null : sport, new Date().toISOString()).run();
    return json({ ok: true, stato, sport });
  }
  if (p === "/api/schede") {
    if (req.method === "PUT" || req.method === "POST") {
      const b = await readJson(req);
      const r = await saveSchede(env.DB, b?.schede);
      if (r.errore) return json(r, 400);
    }
    const schede = await getSchede(env.DB);
    const ultimo = await lastSets(env.DB, [...new Set(schede.flatMap((s) => s.esercizi.map((e) => e.nome)))]);
    // next session of each routine: weights, reps and set types decided from what you did last time
    const plan = await getPlan(env.DB);
    const scarico = plan.attivo && plan.inizio ? blockOf(plan, mondayOf(todayLocal(tz))).scarico : false;
    const { incremento } = await getProfile(env.DB);
    const proposte = Object.fromEntries(schede.map((s) => [s.id, s.esercizi.map((e) => propose(e, ultimo[e.nome], { scarico, incremento }))]));
    // today's routine: next in rotation, or the one with the freshest muscles
    const oggi = schede.length ? (await nextScheda(env.DB, schede)).prossimaScheda?.id ?? null : null;
    return json({ schede, ultimo, proposte, scarico, oggi });
  }
  if (p === "/api/schede/ia" && req.method === "POST") {
    const b = (await readJson(req)) || {};
    if (!String(b.testo || "").trim()) return json({ errore: "Descrivi i tuoi allenamenti" }, 400);
    return json(await schedeFromText(env, req, b.testo));
  }
  if (p === "/api/forza/storico") {
    const q = url.searchParams;
    return json(await gymHistory(env.DB, { start: q.get("start"), esercizio: q.get("esercizio") }));
  }
  if (p === "/api/forza") {
    if (req.method === "POST") {
      const b = await readIngestBody(req);
      if (b.errore) return json({ errore: b.errore }, 400);
      return json({ ok: true, ...(await saveSets(env.DB, b.payload.serie)) });
    }
    return json({ ...(await strengthSummary(env.DB, todayLocal(tz))), muscoli: await muscleFatigue(env.DB),
      non_riconosciuti: await unknownExercises(env.DB, await getSchede(env.DB)), elenco_muscoli: MUSCLES });
  }
  // does the recovery score predict your gym performance? (last 150 days)
  if (p === "/api/recupero/verifica") {
    const hist = await computeHistory(env.DB, todayLocal(tz), 150);
    return json(await recoveryCheck(env.DB, Object.fromEntries(hist.map((d) => [d.giorno, d.recupero.score])), Object.fromEntries(hist.map((d) => [d.giorno, d.checkin?.energia ?? null]))));
  }
  if (p === "/api/corpo") {
    // Body page: measurements grouped per day, VO2max history, resting and walking heart rate per day
    const since = new Date(Date.now() - 400 * 86400e3).toISOString().slice(0, 10);
    const [body, vo2, fc] = await env.DB.batch([
      env.DB.prepare("SELECT metric, ts, value FROM samples WHERE metric IN ('peso','grasso_pct','massa_magra','bmi') ORDER BY ts"),
      env.DB.prepare("SELECT substr(ts,1,10) d, avg(value) v FROM samples WHERE metric='vo2max' GROUP BY d ORDER BY d"),
      env.DB.prepare("SELECT metric, substr(ts,1,10) d, avg(value) v FROM samples WHERE metric IN ('fcr','fc_camminata') AND ts >= ? GROUP BY metric, d ORDER BY d").bind(since),
    ]);
    const byDay = new Map();
    for (const r of body.results) {
      const d = r.ts.slice(0, 10);
      if (!byDay.has(d)) byDay.set(d, { giorno: d });
      byDay.get(d)[r.metric] = Math.round(r.value * 100) / 100; // last value of the day wins
    }
    const misure = [...byDay.values()].filter((m) => m.peso != null || m.grasso_pct != null);
    const serie = (m) => fc.results.filter((r) => r.metric === m).map((r) => [r.d, Math.round(r.v * 10) / 10]);
    return json({ misure, vo2max: vo2.results.map((r) => [r.d, Math.round(r.v * 10) / 10]), fcr: serie("fcr"), fc_camminata: serie("fc_camminata") });
  }
  if (p === "/api/hrv-mensile") {
    const r = await env.DB.prepare("SELECT substr(ts,1,7) mese, avg(value) media, count(*) n FROM samples WHERE metric='hrv' GROUP BY mese ORDER BY mese DESC LIMIT 13").all();
    return json(r.results.reverse());
  }
  if (p === "/api/checkin") {
    if (req.method === "POST") {
      const c = cleanCheckin(await readJson(req), todayLocal(tz));
      if (c.errore) return json({ errore: c.errore }, 400);
      const day = c.day;
      await env.DB.prepare(`INSERT INTO checkin(day,energia,dolori,umore,attivita,rpe,durata_min,note,updated,sonno_min,tag) VALUES(?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(day) DO UPDATE SET energia=excluded.energia, dolori=excluded.dolori, umore=excluded.umore, attivita=excluded.attivita,
        rpe=excluded.rpe, durata_min=excluded.durata_min, note=excluded.note, updated=excluded.updated, sonno_min=excluded.sonno_min, tag=excluded.tag`)
        .bind(day, c.energia ?? null, c.dolori ?? null, c.umore ?? null, c.attivita ?? null, c.rpe ?? null, c.durata_min ?? null, c.note ?? null, new Date().toISOString(), c.sonno_min ?? null, c.tag ?? null).run();
      // a changed check-in changes the recovery: unfreeze it and write the coach's texts again, together
      await env.DB.batch([env.DB.prepare("DELETE FROM advice WHERE day IN (?, ?)").bind(day, "CTX:" + day), env.DB.prepare("DELETE FROM recupero_giorno WHERE day = ?").bind(day)]);
      return json({ ok: true });
    }
    return json(await env.DB.prepare("SELECT * FROM checkin WHERE day = ?").bind(validDay(url.searchParams.get("d")) || todayLocal(tz)).first());
  }
  // a nap entered by hand (when the Watch did not record it): it lowers tonight's sleep need.
  // It does not touch today's recovery, which is the picture of the morning.
  if (p === "/api/pisolino") {
    if (req.method === "POST") {
      const n = cleanNap(await readJson(req));
      if (n.errore) return json(n, 400);
      // compared as instants (the offsets may differ, e.g. across a change to daylight saving time)
      const s0 = Date.parse(n.inizio), e0 = Date.parse(n.fine);
      const near = (await env.DB.prepare("SELECT start, end FROM pisolini WHERE end >= ?").bind(new Date(s0 - 2 * 86400e3).toISOString().slice(0, 10)).all()).results;
      if (near.some((x) => Date.parse(x.start) < e0 && Date.parse(x.end) > s0)) return json({ errore: "Hai già segnato un pisolino in questo orario" }, 400);
      await env.DB.prepare("INSERT INTO pisolini(start,end,created) VALUES(?,?,?)").bind(n.inizio, n.fine, new Date().toISOString()).run();
      return json({ ok: true, ...n });
    }
    if (req.method === "DELETE") {
      const r = await env.DB.prepare("DELETE FROM pisolini WHERE start = ?").bind(String(url.searchParams.get("inizio") || "")).run();
      return json({ ok: true, eliminati: r.meta?.changes || 0 });
    }
  }
  if (p === "/api/coach/oggi" && req.method === "POST") {
    const b = (await readJson(req)) || {};
    // today's texts are written only after the morning check-in: one generation, with all the information
    if (!(await hasCheckin(env.DB, todayLocal(tz)))) return json({ checkin_richiesto: true });
    // and only once the night is complete, so they are written once with all the data
    const cached = await env.DB.prepare("SELECT 1 FROM advice WHERE day = ?").bind(todayLocal(tz)).first();
    if (!cached && !b.forza && !(await nightReady(env.DB, todayLocal(tz), tz))) return json({ notte_in_attesa: true });
    return json(await dailyAdvice(env, req, todayLocal(tz), !!b.forza, await coachProfile(env.DB)));
  }
  if (p === "/api/coach/chat" && req.method === "POST") {
    const b = (await readJson(req, 512 * 1024)) || {};
    const q = String(b.domanda || "").trim().slice(0, 2000);
    if (!q) return json({ errore: "Domanda vuota" }, 400);
    const now = () => new Date().toISOString();
    await env.DB.prepare("INSERT INTO chat(role,content,created) VALUES('user',?,?)").bind(q, now()).run();
    const hist = (await env.DB.prepare("SELECT role, content FROM (SELECT * FROM chat ORDER BY id DESC LIMIT 10) ORDER BY id").all()).results;
    const r = await chat(env, req, todayLocal(tz), hist, await coachProfile(env.DB));
    const mem = [...(r.ricordati || []).map((t) => `📌 Me lo segno: ${t}`), ...(r.dimenticati || []).map((t) => `🗑 Dimenticato: ${t}`)];
    const meta = r.errore ? "errore" : [...mem, `${r.provider === "groq" ? "Groq" : "Modello di riserva"} · ${r.model}${r.avviso ? " · " + r.avviso : ""}`].join("\n");
    await env.DB.prepare("INSERT INTO chat(role,content,meta,created) VALUES('assistant',?,?,?)").bind(r.errore || r.testo, meta, now()).run();
    await env.DB.prepare("DELETE FROM chat WHERE id <= (SELECT max(id) - 200 FROM chat)").run();
    return json({ ...r, meta });
  }
  if (p === "/api/memoria") {
    if (req.method === "POST") { const b = (await readJson(req)) || {}; return json(await addMemory(env.DB, b.testo, "utente")); }
    if (req.method === "DELETE") return json(await deleteMemory(env.DB, url.searchParams.get("id")));
    return json({ memoria: await listMemory(env.DB) });
  }
  if (p === "/api/ai/test" && req.method === "POST") return json(await testAI(env, req));
  if (p === "/api/ai/modelli") return json(await groqModels(req, env));
  // Groq key saved on the server, so every device (iPhone, PC) uses it. It is never sent back in full.
  if (p === "/api/ia/chiave") {
    const set = (k, v) => env.DB.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(k, v).run();
    if (req.method === "POST") {
      const b = (await readJson(req)) || {};
      const key = String(b.chiave || "").trim(), model = String(b.modello || "").trim();
      if (key && !/^gsk_[A-Za-z0-9]{20,200}$/.test(key)) return json({ errore: "La chiave Groq inizia con gsk_ e non ha spazi: ricopiala da console.groq.com." }, 400);
      if (model && !/^[\w./:-]{1,100}$/.test(model)) return json({ errore: "Modello non valido" }, 400);
      if (key) await set("groq_key", key);
      if (b.modello !== undefined) await set("groq_model", model);
    } else if (req.method === "DELETE") {
      await env.DB.prepare("DELETE FROM settings WHERE key IN ('groq_key','groq_model')").run();
    }
    const k = (await env.DB.prepare("SELECT value FROM settings WHERE key = 'groq_key'").first())?.value || "";
    const m = (await env.DB.prepare("SELECT value FROM settings WHERE key = 'groq_model'").first())?.value || "";
    return json({ sul_server: !!k, finale: k ? k.slice(-4) : null, modello: m || null, segreto_cloudflare: !!env.GROQ_API_KEY });
  }
  if (p === "/api/diagnostica") return json(await diagnostics(env, url.searchParams.get("aggiorna") === "1"));
  if (p === "/api/codice" && req.method === "POST") {
    const b = (await readJson(req)) || {};
    const problem = codeProblem(b.nuovo);
    if (problem) return json({ errore: problem }, 400);
    await setSetting(env.DB, "access_hash", await sha256(String(b.nuovo)));
    return json({ ok: true });
  }
  if (p === "/api/export") {
    return new Response(JSON.stringify(await exportData(env.DB, VERSION)), {
      headers: { "content-type": "application/json", "cache-control": "no-store", "content-disposition": `attachment; filename="kairo-export-${todayLocal(tz)}.json"` } });
  }
  if (p === "/api/backup" && req.method === "GET") {
    return json({ attivo: !!env.BACKUP, backup: await listBackups(env), ultimo: JSON.parse((await getSetting(env.DB, "last_backup")) || "null") });
  }
  if (p === "/api/backup" && req.method === "POST") return json(await createBackup(env, VERSION, "manuale"));
  if (p === "/api/backup/file") {
    const key = url.searchParams.get("chiave");
    const bytes = await readBackup(env, key);
    if (!bytes) return json({ errore: "Backup non trovato" }, 404);
    const name = key.slice(7, 17);
    return new Response(bytes, { headers: { "content-type": "application/gzip", "cache-control": "no-store", "content-disposition": `attachment; filename="kairo-backup-${name}.json.gz"` } });
  }
  if (p === "/api/ripristina" && req.method === "POST") {
    const b = await readIngestBody(req);
    if (b.errore) return json({ errore: b.errore }, 400);
    return json(await restoreData(env.DB, b.payload));
  }
  if (p === "/api/dati" && req.method === "DELETE") {
    const { conferma } = (await readJson(req)) || {};
    if (conferma !== "CANCELLA") return json({ errore: "Conferma mancante" }, 400);
    // safety net: an automatic backup right before deleting everything
    if (env.BACKUP) { const bk = await createBackup(env, VERSION, "prima della cancellazione"); if (bk.errore) return json({ errore: `Backup di sicurezza non riuscito, cancellazione annullata: ${bk.errore}` }, 500); }
    await env.DB.batch(["samples", "daily", "hourly", "sleep", "checkin", "imports", "advice", "memoria", "pisolini"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
    return json({ ok: true });
  }
  return json({ errore: "endpoint sconosciuto" }, 404);
}

export default {
  async fetch(req, env0, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env0.ASSETS.fetch(req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204 });
    const raw = env0.DB, db = metered(raw, { cache: !env0.KAIRO_NO_CACHE });
    const env = { ...env0, DB: db };
    const route = url.pathname.startsWith("/api/sync/") ? "/api/sync" : url.pathname.slice(0, 60);
    // a request that may write bumps the data version before and after: cached histories are never stale
    const writes = req.method !== "GET" && req.method !== "HEAD";
    const bump = () => raw.prepare("INSERT INTO settings(key,value) VALUES('versione_dati','1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1").run();
    try {
      await ensureSchema(raw);
      if (writes) await bump();
      return await api(req, env, url);
    } catch (e) {
      console.error(e);
      return json({ errore: "Errore interno del server. Riprova; se continua apri la Diagnostica." }, 500);
    } finally {
      const done = (writes ? bump() : Promise.resolve()).then(() => saveTally(raw, route, db.tally.rows)).catch((e) => console.warn("letture", e));
      if (ctx?.waitUntil) ctx.waitUntil(done); else await done;
    }
  },
  // cron (wrangler.toml): weekly backup on Monday, bedtime reminder check every 30 minutes
  async scheduled(event, env0, ctx) {
    await ensureSchema(env0.DB);
    const db = metered(env0.DB), env = { ...env0, DB: db };
    const job = event.cron === "17 3 * * 1" ? createBackup(env, VERSION, "automatico settimanale").then((r) => r.errore && console.warn(r.errore))
      : eveningPush(env, env.ORIGIN || "mailto:kairo@users.noreply.github.com").catch((e) => console.warn("push sera", e));
    ctx.waitUntil(job.then(() => saveTally(env0.DB, event.cron === "17 3 * * 1" ? "cron backup" : "cron sera", db.tally.rows)).catch(() => {}));
  },
};
