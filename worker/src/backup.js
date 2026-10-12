// Backups: a full copy of the data, compressed, kept in Cloudflare KV (free plan).
// Created automatically every week (cron) and before destructive actions; restorable from the app.
import { METRICS, parseTs, stageCode } from "./validate.js";
import { saveSets, cleanSets } from "./strength.js";
import { cleanSchede } from "./workout.js";
import { cleanPlan, cleanTest } from "./plan.js";
import { cleanProfile } from "./profile.js";

export const KEEP_BACKUPS = 8;
const PREFIX = "backup/";
const TABLES = ["samples", "daily", "hourly", "sleep", "checkin", "imports", "memoria", "sets", "schede", "esiti_piano", "test_sport", "pisolini"];

export async function exportData(db, version) {
  const r = await db.batch([...TABLES.map((t) => db.prepare(`SELECT * FROM ${t}`)), db.prepare("SELECT key, value FROM settings WHERE key IN ('profilo','piano')")]);
  const out = { app: "kairo", formato: 3, versione: version, esportato: new Date().toISOString() };
  TABLES.forEach((t, i) => (out[t] = r[i].results));
  // profile and training plan settings (never the access code, keys or tokens)
  out.impostazioni = Object.fromEntries(r[TABLES.length].results.map((x) => { try { return [x.key, JSON.parse(x.value)]; } catch { return [x.key, null]; } }));
  return out;
}

const countRows = (d) => TABLES.reduce((a, t) => a + (Array.isArray(d[t]) ? d[t].length : 0), 0);

async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

export async function createBackup(env, version, motivo = "manuale") {
  if (!env.BACKUP) return { errore: "Backup automatici non attivi: manca lo spazio KV «BACKUP» (vedi docs/SETUP.md)." };
  const data = await exportData(env.DB, version);
  const bytes = await gzip(JSON.stringify(data));
  if (bytes.byteLength > 24 * 1024 * 1024) return { errore: "Backup troppo grande per lo spazio gratuito (oltre 24 MB)." };
  const created = new Date().toISOString();
  const key = PREFIX + created.replace(/[:.]/g, "-");
  const meta = { creato: created, righe: countRows(data), byte: bytes.byteLength, motivo, versione: version };
  await env.BACKUP.put(key, bytes, { metadata: meta });
  // keep only the most recent copies
  const list = await listBackups(env);
  for (const old of list.slice(KEEP_BACKUPS)) await env.BACKUP.delete(old.chiave);
  await env.DB.prepare("INSERT INTO settings(key,value) VALUES('last_backup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(JSON.stringify(meta)).run();
  return { ok: true, chiave: key, ...meta };
}

export async function listBackups(env) {
  if (!env.BACKUP) return [];
  const items = [];
  let cursor;
  do {
    const page = await env.BACKUP.list({ prefix: PREFIX, cursor });
    for (const k of page.keys) items.push({ chiave: k.name, ...(k.metadata || {}) });
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return items.sort((a, b) => (a.chiave < b.chiave ? 1 : -1));
}

export async function readBackup(env, key) {
  if (!env.BACKUP || typeof key !== "string" || !key.startsWith(PREFIX)) return null;
  const buf = await env.BACKUP.get(key, "arrayBuffer");
  return buf ? new Uint8Array(buf) : null;
}

// Restore: merges the rows into the database. Never overwrites newer data with older:
// samples are keyed by instant, daily/hourly keep the maximum, sleep and check-ins are only added.
export async function restoreData(db, data) {
  if (!data || typeof data !== "object") return { errore: "File non valido" };
  const stmts = [];
  let skipped = 0;
  for (const r of Array.isArray(data.samples) ? data.samples : []) {
    const spec = METRICS[r?.metric], ms = parseTs(r?.ts), v = Number(r?.value);
    if (!spec || !["sample", "pct"].includes(spec[0]) || ms == null || !Number.isFinite(v) || v < spec[1] || v > spec[2]) { skipped++; continue; }
    stmts.push(db.prepare("INSERT OR REPLACE INTO samples(metric,ts,t,value) VALUES(?,?,?,?)").bind(r.metric, r.ts, Math.floor(ms / 1000), v));
  }
  for (const [table, col, re] of [["daily", "day", /^\d{4}-\d{2}-\d{2}$/], ["hourly", "hour", /^\d{4}-\d{2}-\d{2}T\d{2}$/]]) {
    for (const r of Array.isArray(data[table]) ? data[table] : []) {
      const spec = METRICS[r?.metric], v = Number(r?.value);
      if (!spec || !re.test(String(r?.[col])) || !Number.isFinite(v) || v < spec[1] || v > spec[2]) { skipped++; continue; }
      stmts.push(db.prepare(`INSERT INTO ${table}(metric,${col},value) VALUES(?,?,?) ON CONFLICT(metric,${col}) DO UPDATE SET value=max(value,excluded.value)`).bind(r.metric, r[col], v));
    }
  }
  for (const r of Array.isArray(data.sleep) ? data.sleep : []) {
    const s = parseTs(r?.start), e = parseTs(r?.end);
    if (s == null || e == null || e <= s || e - s > 86400e3) { skipped++; continue; }
    stmts.push(db.prepare("INSERT OR IGNORE INTO sleep(start,end,stage) VALUES(?,?,?)").bind(r.start, r.end, stageCode(r.stage)));
  }
  for (const c of Array.isArray(data.checkin) ? data.checkin : []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(c?.day))) { skipped++; continue; }
    stmts.push(db.prepare("INSERT OR IGNORE INTO checkin(day,energia,dolori,umore,attivita,rpe,durata_min,note,updated) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(c.day, c.energia ?? null, c.dolori ?? null, c.umore ?? null, c.attivita ?? null, c.rpe ?? null, c.durata_min ?? null, c.note ?? null, c.updated ?? null));
  }
  for (const m of Array.isArray(data.memoria) ? data.memoria : []) {
    const t = String(m?.testo ?? "").replace(/[\u0000-\u001f\[\]]/g, " ").trim().slice(0, 240);
    if (t.length < 3) { skipped++; continue; }
    stmts.push(db.prepare("INSERT OR IGNORE INTO memoria(testo,fonte,creato) VALUES(?,?,?)")
      .bind(t, m.fonte === "utente" ? "utente" : "coach", /^\d{4}-\d{2}-\d{2}$/.test(String(m.creato)) ? m.creato : new Date().toISOString().slice(0, 10)));
  }
  // gym sets, routines (only if there are none yet), plan outcomes and tests, profile and plan (only if not set yet)
  const sets = Array.isArray(data.sets) ? data.sets : [];
  const cs = cleanSets(sets); skipped += cs.discarded;
  const exist = await db.prepare("SELECT count(*) n FROM schede").first();
  if (!exist.n && Array.isArray(data.schede) && data.schede.length) {
    const c = cleanSchede(data.schede.map((s) => { try { return { id: s.id, nome: s.nome, esercizi: JSON.parse(s.esercizi) }; } catch { return null; } }).filter(Boolean));
    if (!c.errore) c.schede.forEach((s, i) => stmts.push(db.prepare("INSERT OR IGNORE INTO schede(id,nome,ordine,esercizi,updated) VALUES(?,?,?,?,?)").bind(s.id, s.nome, i, JSON.stringify(s.esercizi), new Date().toISOString())));
  }
  for (const e of Array.isArray(data.esiti_piano) ? data.esiti_piano : []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e?.day)) || !e.seduta || !["fatto", "saltato"].includes(e.stato)) { skipped++; continue; }
    stmts.push(db.prepare("INSERT OR IGNORE INTO esiti_piano(day,seduta,sport,tipo,stato,sensazione,risultato,created) VALUES(?,?,?,?,?,?,?,?)")
      .bind(e.day, String(e.seduta).slice(0, 60), String(e.sport).slice(0, 20), String(e.tipo).slice(0, 20), e.stato, ["facile", "giusta", "dura"].includes(e.sensazione) ? e.sensazione : null, null, e.created || new Date().toISOString()));
  }
  for (const t of Array.isArray(data.test_sport) ? data.test_sport : []) {
    let v; try { v = cleanTest(t.sport, JSON.parse(t.dati)); } catch { v = { errore: 1 }; }
    if (v.errore || !/^\d{4}-\d{2}-\d{2}$/.test(String(t.day))) { skipped++; continue; }
    stmts.push(db.prepare("INSERT OR IGNORE INTO test_sport(day,sport,dati,created) VALUES(?,?,?,?)").bind(t.day, t.sport, JSON.stringify(v), t.created || new Date().toISOString()));
  }
  for (const n of Array.isArray(data.pisolini) ? data.pisolini : []) {
    const a = parseTs(n?.start), b = parseTs(n?.end);
    if (a == null || b == null || b - a < 5 * 60e3 || b - a > 240 * 60e3) { skipped++; continue; }
    stmts.push(db.prepare("INSERT OR IGNORE INTO pisolini(start,end,created) VALUES(?,?,?)").bind(n.start, n.end, n.created || new Date().toISOString()));
  }
  const imp = data.impostazioni || {};
  if (imp.profilo) { const pr = cleanProfile(imp.profilo); if (!pr.errore) stmts.push(db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('profilo',?)").bind(JSON.stringify(pr))); }
  if (imp.piano) stmts.push(db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('piano',?)").bind(JSON.stringify(cleanPlan(imp.piano))));
  for (let i = 0; i < stmts.length; i += 400) await db.batch(stmts.slice(i, i + 400));
  const sv = cs.rows.length ? await saveSets(db, sets) : { righe: 0 };
  return { ok: true, righe: stmts.length + sv.righe, scartate: skipped };
}
