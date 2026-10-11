// Kairo server — receives HealthSync data, stores it in D1, computes recovery & sleep,
// talks to the AI coach and serves the web app (static assets in /public).
import { computeDay, computeHistory } from "./metrics.js";
import { ensureSchema, SCHEMA_VERSION } from "./schema.js";
import { dailyAdvice, chat, testAI, groqModels, DEFAULT_GROQ_MODEL, FALLBACK_MODEL } from "./coach.js";

const VERSION = "1.3.0";
// Metrics that arrive already summed per day / per hour
const DAILY = new Set(["passi", "kcal_attive", "kcal_riposo", "dist_piedi", "piani", "dist_bici",
  "dist_nuoto", "bracciate", "kcal_cibo", "proteine", "carboidrati", "grassi", "acqua"]);
const HOURLY = new Set(["kcal_ora"]);

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization,content-type,x-groq-key,x-groq-model",
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
};
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS },
});

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const getSetting = async (db, key) => (await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first())?.value ?? null;
const setSetting = (db, key, value) => db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key, value).run();

// Sync link: a random token that only allows sending data (used by the HealthSync shortcut).
async function syncToken(db, rotate = false) {
  let t = rotate ? null : await getSetting(db, "sync_token");
  if (!t) {
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    t = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => abc[b % abc.length]).join("");
    await setSetting(db, "sync_token", t);
  }
  return t;
}

function bearer(req) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}
async function authorized(req, env) {
  const token = bearer(req);
  if (!token) return false;
  if (env.API_KEY && token === env.API_KEY) return true; // optional secret set with wrangler
  const hash = await getSetting(env.DB, "access_hash");
  return !!hash && (await sha256(token)) === hash;
}

// Sleep stage names arrive in the phone's language: map them to stable codes.
function stageCode(s) {
  const t = (s || "").toLowerCase().trim();
  if (t.includes("profond") || t.includes("deep") || t.includes("tief") || t.includes("profund")) return "deep";
  if (t.includes("rem")) return "rem";
  if (t.includes("principal") || t.includes("core") || t.includes("leggero") || t.includes("kern") || t.includes("básico")) return "core";
  if (t.includes("veglia") || t.includes("sveglio") || t.includes("awake") || t.includes("wach") || t.includes("despierto")) return "awake";
  if (t.includes("letto") || t.includes("bed") || t.includes("bett") || t.includes("cama")) return "inbed";
  return "asleep";
}

const split = (s) => (s ? String(s).split(";").map((x) => x.trim()).filter((x) => x !== "") : []);
const num = (s) => Number(String(s).replace(",", "."));

async function ingest(payload, env) {
  const stmts = [];
  const keys = new Set(Object.keys(payload).filter((k) => k.endsWith("_valori")).map((k) => k.slice(0, -7)));
  for (const key of keys) {
    const vals = split(payload[`${key}_valori`]);
    const dates = split(payload[`${key}_date`]);
    const ends = split(payload[`${key}_fine`]);
    const n = Math.min(vals.length, dates.length);
    for (let i = 0; i < n; i++) {
      const ts = dates[i];
      if (key === "sonno") {
        if (!ends[i]) continue;
        stmts.push(env.DB.prepare("INSERT INTO sleep(start,end,stage) VALUES(?,?,?) ON CONFLICT(start) DO UPDATE SET end=excluded.end, stage=excluded.stage")
          .bind(ts, ends[i], stageCode(vals[i])));
        continue;
      }
      const v = num(vals[i]);
      if (!Number.isFinite(v)) continue;
      if (DAILY.has(key)) {
        if (v === 0) continue; // Shortcuts fills days without data with 0
        stmts.push(env.DB.prepare("INSERT INTO daily(metric,day,value) VALUES(?,?,?) ON CONFLICT(metric,day) DO UPDATE SET value=max(value,excluded.value)")
          .bind(key, ts.slice(0, 10), v));
      } else if (HOURLY.has(key)) {
        stmts.push(env.DB.prepare("INSERT INTO hourly(metric,hour,value) VALUES(?,?,?) ON CONFLICT(metric,hour) DO UPDATE SET value=max(value,excluded.value)")
          .bind(key, ts.slice(0, 13), v));
      } else {
        stmts.push(env.DB.prepare("INSERT INTO samples(metric,ts,value) VALUES(?,?,?) ON CONFLICT(metric,ts) DO UPDATE SET value=excluded.value")
          .bind(key, ts, v));
      }
    }
  }
  for (let i = 0; i < stmts.length; i += 400) await env.DB.batch(stmts.slice(i, i + 400));
  await env.DB.prepare("INSERT INTO imports(received,modulo,esportato,righe,versione) VALUES(?,?,?,?,?)")
    .bind(new Date().toISOString(), payload.modulo || null, payload.esportato || null, stmts.length, payload.versione || null).run();
  return stmts.length;
}

const todayLocal = (tz) => new Intl.DateTimeFormat("sv-SE", { timeZone: tz || "Europe/Rome" }).format(new Date());

async function diagnostics(env) {
  const db = env.DB;
  const r = await db.batch([
    db.prepare("SELECT (SELECT count(*) FROM samples) samples, (SELECT count(*) FROM daily) daily, (SELECT count(*) FROM hourly) hourly, (SELECT count(*) FROM sleep) sleep, (SELECT count(*) FROM checkin) checkin, (SELECT count(*) FROM imports) imports, (SELECT count(*) FROM advice) advice"),
    db.prepare("SELECT metric, count(*) n, min(ts) da, max(ts) a FROM samples GROUP BY metric ORDER BY metric"),
    db.prepare("SELECT metric, count(*) n, min(day) da, max(day) a FROM daily GROUP BY metric ORDER BY metric"),
    db.prepare("SELECT count(*) n, min(start) da, max(end) a FROM sleep"),
    db.prepare("SELECT received, modulo, esportato, righe, versione FROM imports ORDER BY id DESC LIMIT 12"),
    db.prepare("SELECT key, value FROM settings WHERE key LIKE 'ai_%' OR key = 'schema_version' OR key = 'setup_at'"),
  ]);
  const settings = Object.fromEntries(r[5].results.map((x) => [x.key, x.value]));
  const day = new Date().toISOString().slice(0, 10);
  let dbSize = null;
  try { dbSize = (await db.prepare("SELECT 1").run()).meta?.size_after ?? null; } catch (_) {}
  return {
    server: { app: "kairo", versione: VERSION, schema: Number(settings.schema_version || SCHEMA_VERSION), ora_server: new Date().toISOString(), configurato_il: settings.setup_at || null },
    database: { righe: r[0].results[0], dimensione_byte: dbSize },
    metriche: r[1].results, giornaliere: r[2].results, sonno: r[3].results[0],
    importazioni: r[4].results,
    ia: {
      groq_quota: settings.ai_quota_groq ? JSON.parse(settings.ai_quota_groq) : null,
      chiamate_oggi_groq: Number(settings[`ai_calls_groq_${day}`] || 0),
      chiamate_oggi_riserva: Number(settings[`ai_calls_workers_ai_${day}`] || 0),
      riserva_disponibile: !!env.AI, modello_riserva: FALLBACK_MODEL, modello_predefinito: DEFAULT_GROQ_MODEL,
      chiave_groq_sul_server: !!env.GROQ_API_KEY,
    },
  };
}

async function api(req, env, url) {
  const p = url.pathname;
  const tz = req.headers.get("x-timezone") || "Europe/Rome";

  // Public endpoints
  if (p === "/api/info") {
    const hash = await getSetting(env.DB, "access_hash");
    return json({ app: "kairo", versione: VERSION, schema: SCHEMA_VERSION, setup_richiesto: !hash && !env.API_KEY });
  }
  if (p === "/api/setup" && req.method === "POST") {
    if ((await getSetting(env.DB, "access_hash")) || env.API_KEY) return json({ errore: "Server già configurato" }, 409);
    const { codice } = await req.json().catch(() => ({}));
    if (!codice || String(codice).length < 8) return json({ errore: "Il codice deve avere almeno 8 caratteri" }, 400);
    await setSetting(env.DB, "access_hash", await sha256(String(codice)));
    await setSetting(env.DB, "setup_at", new Date().toISOString());
    return json({ ok: true });
  }

  // Data sent by the HealthSync shortcut through the sync link (no access code needed)
  if (p.startsWith("/api/sync/")) {
    const tok = p.slice(10).replace(/\/+$/, "");
    const real = await getSetting(env.DB, "sync_token");
    if (!real || tok !== real) return json({ errore: "Link di collegamento non valido: copialo di nuovo dall'app Kairo (Impostazioni)." }, 401);
    if (req.method !== "POST") return json({ ok: true, app: "kairo", messaggio: "Link valido" });
    let payload;
    try { payload = JSON.parse(await req.text()); } catch { return json({ errore: "JSON non valido" }, 400); }
    return json({ ok: true, righe: await ingest(payload, env) });
  }

  if (!(await authorized(req, env))) return json({ errore: "Codice di accesso non valido" }, 401);

  if (p === "/api/collegamento") {
    const t = await syncToken(env.DB, req.method === "POST");
    return json({ link: `${url.origin}/api/sync/${t}` });
  }

  if (p === "/api/ingest" && req.method === "POST") {
    let payload;
    try { payload = JSON.parse(await req.text()); } catch { return json({ errore: "JSON non valido" }, 400); }
    return json({ ok: true, righe: await ingest(payload, env) });
  }
  if (p === "/api/day") return json(await computeDay(env.DB, url.searchParams.get("d") || todayLocal(tz)));
  if (p === "/api/history") {
    const days = Math.min(Math.max(Number(url.searchParams.get("days") || 30), 1), 400);
    return json(await computeHistory(env.DB, url.searchParams.get("fino") || todayLocal(tz), days));
  }
  if (p === "/api/sonno") {
    // stages of the night that ends on day `d` (from 18:00 of the previous day to 18:00 of `d`)
    const d = url.searchParams.get("d") || todayLocal(tz);
    const prev = new Date(Date.parse(d + "T12:00:00Z") - 86400e3).toISOString().slice(0, 10);
    const r = await env.DB.prepare("SELECT start, end, stage FROM sleep WHERE end > ? AND end <= ? ORDER BY start")
      .bind(prev + "T18:00", d + "T18:00").all();
    return json(r.results);
  }
  if (p === "/api/hrv-mensile") {
    const r = await env.DB.prepare("SELECT substr(ts,1,7) mese, avg(value) media, count(*) n FROM samples WHERE metric='hrv' GROUP BY mese ORDER BY mese DESC LIMIT 13").all();
    return json(r.results.reverse());
  }
  if (p === "/api/checkin") {
    if (req.method === "POST") {
      const c = await req.json().catch(() => ({}));
      const day = c.day || todayLocal(tz);
      await env.DB.prepare(`INSERT INTO checkin(day,energia,dolori,umore,attivita,rpe,durata_min,note,updated) VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(day) DO UPDATE SET energia=excluded.energia, dolori=excluded.dolori, umore=excluded.umore, attivita=excluded.attivita,
        rpe=excluded.rpe, durata_min=excluded.durata_min, note=excluded.note, updated=excluded.updated`)
        .bind(day, c.energia ?? null, c.dolori ?? null, c.umore ?? null, c.attivita ?? null, c.rpe ?? null, c.durata_min ?? null, c.note ?? null, new Date().toISOString()).run();
      await env.DB.prepare("DELETE FROM advice WHERE day = ?").bind(day).run(); // advice must take the check-in into account
      return json({ ok: true });
    }
    return json(await env.DB.prepare("SELECT * FROM checkin WHERE day = ?").bind(url.searchParams.get("d") || todayLocal(tz)).first());
  }
  if (p === "/api/coach/oggi" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    return json(await dailyAdvice(env, req, todayLocal(tz), !!b.forza, b.profilo || ""));
  }
  if (p === "/api/coach/chat" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    return json(await chat(env, req, todayLocal(tz), Array.isArray(b.messaggi) ? b.messaggi : [], b.profilo || ""));
  }
  if (p === "/api/ai/test" && req.method === "POST") return json(await testAI(env, req));
  if (p === "/api/ai/modelli") return json(await groqModels(req, env));
  if (p === "/api/diagnostica") return json(await diagnostics(env));
  if (p === "/api/codice" && req.method === "POST") {
    const { nuovo } = await req.json().catch(() => ({}));
    if (!nuovo || String(nuovo).length < 8) return json({ errore: "Il codice deve avere almeno 8 caratteri" }, 400);
    await setSetting(env.DB, "access_hash", await sha256(String(nuovo)));
    return json({ ok: true });
  }
  if (p === "/api/export") {
    const r = await env.DB.batch(["samples", "daily", "hourly", "sleep", "checkin", "imports"].map((t) => env.DB.prepare(`SELECT * FROM ${t}`)));
    return new Response(JSON.stringify({ app: "kairo", versione: VERSION, esportato: new Date().toISOString(),
      samples: r[0].results, daily: r[1].results, hourly: r[2].results, sleep: r[3].results, checkin: r[4].results, imports: r[5].results }), {
      headers: { "content-type": "application/json", "content-disposition": `attachment; filename="kairo-export-${todayLocal(tz)}.json"`, ...CORS } });
  }
  if (p === "/api/dati" && req.method === "DELETE") {
    const { conferma } = await req.json().catch(() => ({}));
    if (conferma !== "CANCELLA") return json({ errore: "Conferma mancante" }, 400);
    await env.DB.batch(["samples", "daily", "hourly", "sleep", "checkin", "imports", "advice"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
    return json({ ok: true });
  }
  return json({ errore: "endpoint sconosciuto" }, 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      await ensureSchema(env.DB);
      return await api(req, env, url);
    } catch (e) {
      return json({ errore: String((e && e.message) || e) }, 500);
    }
  },
};
