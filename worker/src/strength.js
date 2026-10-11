// Strength training: sets imported from Hevy (CSV) or logged in Kairo.
// Estimated one-rep max with the Epley formula (1985): weight × (1 + reps / 30), on sets of 1-12 reps.

export const e1rm = (w, reps) => (w > 0 && reps >= 1 && reps <= 12 ? w * (1 + reps / 30) : null);

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)?$/;

export function cleanSets(rows) {
  const out = [];
  let discarded = 0;
  for (const r of Array.isArray(rows) ? rows.slice(0, 20000) : []) {
    const start = String(r?.start || ""), end = r?.end ? String(r.end) : null;
    const ex = String(r?.exercise || "").trim().slice(0, 80);
    const idx = Number(r?.set_index), w = r?.weight == null || r.weight === "" ? null : Number(r.weight), reps = r?.reps == null || r.reps === "" ? null : Number(r.reps);
    const rpe = r?.rpe == null || r.rpe === "" ? null : Number(r.rpe);
    if (!ISO.test(start) || (end && !ISO.test(end)) || !ex || !Number.isInteger(idx) || idx < 0 || idx > 100 ||
      (w != null && !(w >= 0 && w <= 1000)) || (reps != null && !(Number.isInteger(reps) && reps >= 0 && reps <= 1000)) || (rpe != null && !(rpe >= 1 && rpe <= 10))) { discarded++; continue; }
    out.push([start, ex, idx, String(r?.set_type || "normal").slice(0, 20), w, reps, rpe, String(r?.workout || "").slice(0, 80), end, String(r?.fonte || "hevy").slice(0, 20)]);
  }
  return { rows: out, discarded };
}

export async function saveSets(db, rows) {
  const { rows: clean, discarded } = cleanSets(rows);
  const stmts = clean.map((r) => db.prepare("INSERT OR REPLACE INTO sets(start,exercise,set_index,set_type,weight,reps,rpe,workout,end,fonte) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(...r));
  for (let i = 0; i < stmts.length; i += 400) await db.batch(stmts.slice(i, i + 400));
  return { righe: stmts.length, scartate: discarded };
}

// Progress of the main lifts: the exercises done most often in the last 8 weeks.
export async function strengthSummary(db, today) {
  const since = new Date(Date.parse(today + "T12:00:00Z") - 365 * 86400e3).toISOString().slice(0, 10);
  const r = await db.prepare("SELECT start, exercise, weight, reps FROM sets WHERE start >= ? AND (set_type IS NULL OR set_type NOT IN ('warmup')) AND weight > 0 AND reps > 0 ORDER BY start").bind(since).all();
  const by = {};
  for (const s of r.results) {
    const v = e1rm(s.weight, s.reps);
    if (!v) continue;
    const day = s.start.slice(0, 10);
    const ex = (by[s.exercise] ||= {});
    ex[day] = Math.max(ex[day] || 0, v);
  }
  const daysAgo = (d) => (Date.parse(today + "T12:00:00Z") - Date.parse(d + "T12:00:00Z")) / 86400e3;
  const list = Object.entries(by).map(([name, perDay]) => {
    const hist = Object.entries(perDay).sort(([a], [b]) => (a < b ? -1 : 1)).map(([d, v]) => [d, Math.round(v * 10) / 10]);
    const recent = hist.filter(([d]) => daysAgo(d) <= 28), prev = hist.filter(([d]) => daysAgo(d) > 28 && daysAgo(d) <= 56);
    const best = (a) => (a.length ? Math.max(...a.map((x) => x[1])) : null);
    let pr = null, prDay = null;
    for (const [d, v] of hist) if (pr == null || v > pr + 0.01) { pr = v; prDay = d; }
    return { esercizio: name, sedute_8_settimane: hist.filter(([d]) => daysAgo(d) <= 56).length, max_4_settimane: best(recent), max_4_precedenti: best(prev),
      record: pr, record_il: prDay, settimane_dal_record: prDay ? Math.floor(daysAgo(prDay) / 7) : null, storico: hist.slice(-40) };
  }).filter((x) => x.sedute_8_settimane > 0).sort((a, b) => b.sedute_8_settimane - a.sedute_8_settimane);
  // weekly volume (sets of 1+ reps, warm-ups excluded) for the last 8 weeks
  const vol = await db.prepare("SELECT substr(start,1,10) d, count(*) n FROM sets WHERE start >= ? AND (set_type IS NULL OR set_type != 'warmup') AND reps > 0 GROUP BY d").bind(new Date(Date.parse(today + "T12:00:00Z") - 56 * 86400e3).toISOString().slice(0, 10)).all();
  const weeks = Array.from({ length: 8 }, () => 0);
  for (const v of vol.results) { const w = Math.floor(daysAgo(v.d) / 7); if (w >= 0 && w < 8) weeks[7 - w] += v.n; }
  return { esercizi: list.slice(0, 6), serie_per_settimana: weeks, ultima_seduta: r.results.length ? r.results[r.results.length - 1].start : null };
}
