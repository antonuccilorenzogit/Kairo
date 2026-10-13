// Database reads meter. Cloudflare D1 (free plan) allows 5 million rows read per day and bills every row a query
// scans, not only the rows it returns. Every request goes through this wrapper: it adds up the rows read
// (from the result metadata) and keeps a daily total per route, shown in "Stato di Kairo".
// It also marks the database as cacheable (see computeHistory in metrics.js).

export function metered(db, { cache = true } = {}) {
  const tally = { rows: 0 };
  const real = new WeakMap(); // wrapper → real statement (batch() needs the real ones)
  const count = (r) => { for (const x of Array.isArray(r) ? r : [r]) tally.rows += Number(x?.meta?.rows_read) || 0; return r; };
  const wrap = (st) => {
    const w = {
      bind: (...a) => wrap(st.bind(...a)),
      // first() through all(): D1 returns the read count only in all()/run(), and reads the same rows either way
      first: (col) => st.all().then(count).then((r) => { const row = r.results?.[0] ?? null; return col ? (row ? row[col] ?? null : null) : row; }),
      all: (...a) => st.all(...a).then(count),
      run: (...a) => st.run(...a).then(count),
      raw: (...a) => st.raw(...a),
    };
    real.set(w, st);
    return w;
  };
  const out = {
    prepare: (sql) => wrap(db.prepare(sql)),
    batch: (list) => db.batch(list.map((x) => real.get(x) || x)).then(count),
    exec: (sql) => db.exec(sql),
    dump: (...a) => db.dump?.(...a),
    kairoCache: cache,
    tally,
  };
  return out;
}

// Daily total per route: settings key "letture_YYYY-MM-DD" → {"/api/history": 12345, …}. Old days are removed.
export async function saveTally(db, route, rows) {
  if (!rows) return;
  const day = new Date().toISOString().slice(0, 10); // D1 resets the limit at 00:00 UTC
  const key = "letture_" + day, path = `$."${route.replace(/"/g, "")}"`;
  await db.batch([
    db.prepare("INSERT INTO settings(key,value) VALUES(?, '{}') ON CONFLICT(key) DO NOTHING").bind(key),
    db.prepare("UPDATE settings SET value = json_set(value, ?, coalesce(json_extract(value, ?), 0) + ?) WHERE key = ?").bind(path, path, rows, key),
    db.prepare("DELETE FROM settings WHERE key LIKE 'letture_%' AND key < ?").bind("letture_" + new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)),
  ]);
}
