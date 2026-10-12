// Kairo server — receives HealthSync data, stores it in D1, computes recovery & sleep,
// talks to the AI coach and serves the web app (static assets in /public).
import { computeDay, computeHistory, mergeStages } from "./metrics.js";
import { ensureSchema, SCHEMA_VERSION } from "./schema.js";
import { dailyAdvice, chat, testAI, groqModels, weeklyCoach, DEFAULT_GROQ_MODEL, FALLBACK_MODEL } from "./coach.js";
import { saveSets, strengthSummary, muscleFatigue } from "./strength.js";
import { weeklyReport } from "./report.js";
import { recommendWorkout, getSchede, saveSchede, lastSets, schedeFromText } from "./workout.js";
import { sha256, safeEqual, clientIp, lockedFor, recordFailure, clearFailures, pruneFailures, codeProblem } from "./security.js";
import { parsePayload, cleanCheckin, MAX_BODY_BYTES } from "./validate.js";
import { exportData, createBackup, listBackups, readBackup, restoreData } from "./backup.js";
import { getProfile, saveProfile, hrMax, profileText } from "./profile.js";
import { listMemory, addMemory, deleteMemory, memoryText } from "./memory.js";
import { injuryPlan, injuryText, savePain, clearPain, constraints, constraintList } from "./injury.js";

// What every coach prompt knows about the person: profile + remembered facts.
const coachProfile = async (db, profile) => {
  const p = profile || (await getProfile(db));
  return profileText(p) + (await injuryText(db, p)) + memoryText(await listMemory(db));
};
// Today's coach texts depend on the injury: drop them when it changes.
const dropTodayAdvice = (db, day) => db.prepare("DELETE FROM advice WHERE day IN (?, ?)").bind(day, "A:" + day).run();
import { recomputeTrimp, recomputeNightHr } from "./load.js";
import { getVapid, sendPush, validEndpoint } from "./push.js";

const VERSION = "1.10.2";

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
  if (!(await hasCheckin(env.DB, day))) return sendPush(env, { title: "Buongiorno", body: prof.infortunio?.attivo ? "Il recupero di stanotte è pronto: fai il check-in e segna il dolore per il piano di oggi." : "Il recupero di stanotte è pronto: fai il check-in di 10 secondi per vedere com'è andata e cosa fare oggi.", url: "/#/oggi" }, origin);
  if (prof.infortunio?.attivo) return sendPush(env, { title: "Modalità infortunio", body: "Segna quanto ti fa male oggi: il coach ti dice se riposare o quali esercizi fare.", url: "/#/oggi" }, origin);
  const label = d.recupero.score >= 67 ? "Recuperato" : d.recupero.score >= 34 ? "Recupero parziale" : "Recupero basso";
  const body = d.allarme ? `${d.allarme.titolo}: oggi vai leggero.` : d.carico?.consiglio ? `Oggi: ${d.carico.consiglio.titolo.toLowerCase()} — ${d.carico.consiglio.testo}.` : "Apri Kairo per il consiglio di oggi.";
  await sendPush(env, { title: `${label} · ${d.recupero.score}`, body, url: "/#/oggi" }, origin);
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
  await sendPush(env, { title: `A letto entro le ${st.a_letto}`, body: `Stanotte ti servono ${fmt(st.fabbisogno_min)} di sonno${st.per_carico_min || st.per_debito_min ? " (oggi un po' di più per recuperare)" : ""}.`, url: "/#/sonno" }, origin);
}

async function ingest(payload, env, origin) {
  const db = env.DB, rows = parsePayload(payload), stmts = [];
  // a measurement already stored (same instant) is skipped: no write is spent on data we already have
  for (const [m, ts, t, v] of rows.samples) stmts.push(db.prepare("INSERT INTO samples(metric,ts,t,value) VALUES(?,?,?,?) ON CONFLICT DO NOTHING").bind(m, ts, t, v));
  // daily and hourly totals arrive already summed by Health: keep the highest value seen (a day only grows)
  for (const [m, d, v] of rows.daily) stmts.push(db.prepare("INSERT INTO daily(metric,day,value) VALUES(?,?,?) ON CONFLICT(metric,day) DO UPDATE SET value=excluded.value WHERE excluded.value > daily.value").bind(m, d, v));
  for (const [m, h, v] of rows.hourly) stmts.push(db.prepare("INSERT INTO hourly(metric,hour,value) VALUES(?,?,?) ON CONFLICT(metric,hour) DO UPDATE SET value=excluded.value WHERE excluded.value > hourly.value").bind(m, h, v));
  for (const [s, e, st] of rows.sleep) stmts.push(db.prepare("INSERT OR IGNORE INTO sleep(start,end,stage) VALUES(?,?,?)").bind(s, e, st));
  // The Watch finishes processing the night a few minutes after waking up, so last night's data can
  // arrive in a later sync. Only data of the night just passed counts: the same window used for the recovery score,
  // from 30 minutes before falling asleep to waking up (the Watch also measures HRV during the day).
  const NIGHT = new Set(["hrv", "fcr", "resp", "spo2"]);
  const today = todayLocal((await getProfile(db)).tz);
  const yesterday = new Date(Date.parse(today + "T12:00:00Z") - 86400e3).toISOString().slice(0, 10);
  const res = [];
  for (let i = 0; i < stmts.length; i += 400) res.push(...(await db.batch(stmts.slice(i, i + 400))));
  const night = await db.prepare("SELECT min(start) s, max(end) e FROM sleep WHERE stage IN ('core','deep','rem','asleep') AND end > ? AND end <= ?").bind(`${yesterday}T18:00`, `${today}T14:00`).first();
  const from = night?.s ? Date.parse(night.s) - 30 * 60e3 : null, to = night?.e ? Date.parse(night.e) : null;
  // no sleep yet: fall back to 18:00 yesterday → 12:00 today
  const inNight = (ts) => (from != null ? Date.parse(ts) >= from && Date.parse(ts) <= to : String(ts).slice(0, 16) >= `${yesterday}T18:00` && String(ts).slice(0, 16) <= `${today}T12:00`);
  const sleepFrom = rows.samples.length + rows.daily.length + rows.hourly.length;
  let nightNew = 0;
  rows.samples.forEach((x, i) => { if (NIGHT.has(x[0]) && res[i]?.meta?.changes && inNight(x[1])) nightNew++; });
  rows.sleep.forEach((x, i) => { if (res[sleepFrom + i]?.meta?.changes && x[1].slice(0, 16) > `${yesterday}T18:00` && x[1].slice(0, 16) <= `${today}T14:00`) nightNew++; });
  // the night changed → today's coach texts were written on an incomplete night: write them again
  if (nightNew) await db.prepare("DELETE FROM advice WHERE day IN (?, ?)").bind(today, "A:" + today).run();
  // new heart-rate samples → recompute the training load of those days
  const fcDays = rows.samples.filter((r) => r[0] === "fc").map((r) => r[1].slice(0, 10));
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

async function diagnostics(env) {
  const db = env.DB;
  const r = await db.batch([
    db.prepare("SELECT (SELECT count(*) FROM samples) samples, (SELECT count(*) FROM daily) daily, (SELECT count(*) FROM hourly) hourly, (SELECT count(*) FROM sleep) sleep, (SELECT count(*) FROM checkin) checkin, (SELECT count(*) FROM imports) imports, (SELECT count(*) FROM advice) advice"),
    db.prepare("SELECT metric, count(*) n, min(ts) da, max(ts) a FROM samples GROUP BY metric ORDER BY metric"),
    db.prepare("SELECT metric, count(*) n, min(day) da, max(day) a FROM daily GROUP BY metric ORDER BY metric"),
    db.prepare("SELECT count(*) n, min(start) da, max(end) a FROM sleep"),
    db.prepare("SELECT received, modulo, esportato, righe, versione FROM imports ORDER BY id DESC LIMIT 12"),
    db.prepare("SELECT key, value FROM settings WHERE key LIKE 'ai_%' OR key IN ('schema_version','setup_at','last_backup','groq_model') OR (key = 'groq_key' AND value != '')"),
  ]);
  const settings = Object.fromEntries(r[5].results.map((x) => [x.key, x.key === "groq_key" ? "1" : x.value]));
  const day = new Date().toISOString().slice(0, 10);
  let dbSize = null;
  try { dbSize = (await db.prepare("SELECT 1").run()).meta?.size_after ?? null; } catch (_) {}
  return {
    server: { app: "kairo", versione: VERSION, schema: Number(settings.schema_version || SCHEMA_VERSION), ora_server: new Date().toISOString(), configurato_il: settings.setup_at || null },
    database: { righe: r[0].results[0], dimensione_byte: dbSize },
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
    await dropTodayAdvice(env.DB, todayLocal(tz));
    return json(saved);
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
    if (profile.infortunio?.attivo) {
      const day = todayLocal(tz);
      if (b.dolore != null) {
        const sp = await savePain(env.DB, day, b.dolore);
        if (sp.errore) return json(sp, 400);
        await env.DB.prepare("DELETE FROM advice WHERE day = ?").bind(day).run(); // the coach's message follows the pain
      }
      return json(await injuryPlan(env, req, { day, today: hist[hist.length - 1], profile, profileText: await coachProfile(env.DB, profile), force: !!b.forza }));
    }
    return json(await recommendWorkout(env, req, { hist, profile, profileText: await coachProfile(env.DB, profile), schede: await getSchede(env.DB),
      force: !!b.forza || !!b.altro, exclude: b.altro && ["palestra", "nuoto", "bici", "corsa"].includes(b.escludi) ? b.escludi : null }));
  }
  if (p === "/api/schede") {
    if (req.method === "PUT" || req.method === "POST") {
      const b = await readJson(req);
      const r = await saveSchede(env.DB, b?.schede);
      if (r.errore) return json(r, 400);
    }
    const schede = await getSchede(env.DB);
    return json({ schede, ultimo: await lastSets(env.DB, [...new Set(schede.flatMap((s) => s.esercizi.map((e) => e.nome)))]) });
  }
  if (p === "/api/schede/ia" && req.method === "POST") {
    const b = (await readJson(req)) || {};
    if (!String(b.testo || "").trim()) return json({ errore: "Descrivi i tuoi allenamenti" }, 400);
    return json(await schedeFromText(env, req, b.testo));
  }
  if (p === "/api/forza") {
    if (req.method === "POST") {
      const b = await readIngestBody(req);
      if (b.errore) return json({ errore: b.errore }, 400);
      return json({ ok: true, ...(await saveSets(env.DB, b.payload.serie)) });
    }
    return json({ ...(await strengthSummary(env.DB, todayLocal(tz))), muscoli: await muscleFatigue(env.DB) });
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
      await env.DB.prepare(`INSERT INTO checkin(day,energia,dolori,umore,attivita,rpe,durata_min,note,updated,sonno_min) VALUES(?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(day) DO UPDATE SET energia=excluded.energia, dolori=excluded.dolori, umore=excluded.umore, attivita=excluded.attivita,
        rpe=excluded.rpe, durata_min=excluded.durata_min, note=excluded.note, updated=excluded.updated, sonno_min=excluded.sonno_min`)
        .bind(day, c.energia ?? null, c.dolori ?? null, c.umore ?? null, c.attivita ?? null, c.rpe ?? null, c.durata_min ?? null, c.note ?? null, new Date().toISOString(), c.sonno_min ?? null).run();
      await env.DB.prepare("DELETE FROM advice WHERE day = ?").bind(day).run(); // advice must take the check-in into account
      return json({ ok: true });
    }
    return json(await env.DB.prepare("SELECT * FROM checkin WHERE day = ?").bind(validDay(url.searchParams.get("d")) || todayLocal(tz)).first());
  }
  if (p === "/api/coach/oggi" && req.method === "POST") {
    const b = (await readJson(req)) || {};
    // today's texts are written only after the morning check-in: one generation, with all the information
    if (!(await hasCheckin(env.DB, todayLocal(tz)))) return json({ checkin_richiesto: true });
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
  if (p === "/api/diagnostica") return json(await diagnostics(env));
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
    await env.DB.batch(["samples", "daily", "hourly", "sleep", "checkin", "imports", "advice", "memoria"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
    return json({ ok: true });
  }
  return json({ errore: "endpoint sconosciuto" }, 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204 });
    try {
      await ensureSchema(env.DB);
      return await api(req, env, url);
    } catch (e) {
      console.error(e);
      return json({ errore: "Errore interno del server. Riprova; se continua apri la Diagnostica." }, 500);
    }
  },
  // cron (wrangler.toml): weekly backup on Monday, bedtime reminder check every 30 minutes
  async scheduled(event, env, ctx) {
    await ensureSchema(env.DB);
    if (event.cron === "17 3 * * 1") ctx.waitUntil(createBackup(env, VERSION, "automatico settimanale").then((r) => r.errore && console.warn(r.errore)));
    else ctx.waitUntil(eveningPush(env, env.ORIGIN || "mailto:kairo@users.noreply.github.com").catch((e) => console.warn("push sera", e)));
  },
};
