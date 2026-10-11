// Backups: a full copy of the data, compressed, kept in Cloudflare KV (free plan).
// Created automatically every week (cron) and before destructive actions; restorable from the app.
import { METRICS, parseTs, stageCode } from "./validate.js";

export const KEEP_BACKUPS = 8;
const PREFIX = "backup/";
const TABLES = ["samples", "daily", "hourly", "sleep", "checkin", "imports", "memoria"];

export async function exportData(db, version) {
  const r = await db.batch(TABLES.map((t) => db.prepare(`SELECT * FROM ${t}`)));
  const out = { app: "kairo", formato: 2, versione: version, esportato: new Date().toISOString() };
  TABLES.forEach((t, i) => (out[t] = r[i].results));
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
  for (let i = 0; i < stmts.length; i += 400) await db.batch(stmts.slice(i, i + 400));
  return { ok: true, righe: stmts.length, scartate: skipped };
}
