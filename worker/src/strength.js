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

// ---------- fatigue per muscle group ----------
// Exercise name → muscles worked (primary first). Italian and English names, the most common gym exercises.
// Each muscle has a weight: the main one counts 1, the helpers only a fraction of a set.
const MUSCLE_MAP = [
  // order matters: the first match wins (e.g. "leg curl" before "curl", "reverse fly" before "fly")
  [/stacc|deadlift|\brdl\b|good morning/i, [["femorali", 1], ["glutei", 0.5], ["lombari", 0.3]]],
  [/squat|pressa|leg press|affond|lunge|\bhack|bulgar|step.?up/i, [["quadricipiti", 1], ["glutei", 0.4]]],
  [/leg ext|estension.*gamb|quadricip/i, [["quadricipiti", 1]]],
  [/leg curl|curl.*gamb|femoral|nordic/i, [["femorali", 1]]],
  [/hip thrust|ponte|glute|abdu|\bkickback.*glut/i, [["glutei", 1]]],
  [/polpacc|calf|punte/i, [["polpacci", 1]]],
  [/reverse fly|rear delt|croci invers|posterior|face pull/i, [["spalle", 1], ["schiena", 0.3]]],
  [/\bdip/i, [["petto", 1], ["tricipiti", 0.5]]],
  [/croci|\bfly|pec ?deck|\bpec\b|pectoral machine|butterfly/i, [["petto", 1]]],
  [/panca|bench|chest|pector|pettoral|piegament|push.?up/i, [["petto", 1], ["tricipiti", 0.3], ["spalle", 0.2]]],
  [/lento|military|overhead|shoulder press|arnold|spinte?.*spall/i, [["spalle", 1], ["tricipiti", 0.3]]],
  [/alzat|lateral raise|laterali|front raise|frontal|deltoid|spall/i, [["spalle", 1]]],
  [/shrug|scrollat|trapez/i, [["trapezio", 1]]],
  [/trazion|pull.?up|\bchin|\blat\b|lat ?machine|pulldown|rematore|\brow|pulley|dorsal|schiena|t.?bar/i, [["schiena", 1], ["bicipiti", 0.3]]],
  [/hyperext|iperestens|lombar|back ext/i, [["lombari", 1]]],
  [/french|tricipit|tricep|push.?down|skull|kick.?back|estension.*tric|\bjm press/i, [["tricipiti", 1]]],
  [/curl|bicipit|bicep|hammer/i, [["bicipiti", 1], ["avambracci", 0.2]]],
  [/wrist|polso|avambracc|forearm/i, [["avambracci", 1]]],
  [/crunch|plank|addom|\babs?\b|core|russian|leg raise|ab wheel|sit.?up/i, [["addome", 1]]],
];
export const MUSCLES = ["petto", "schiena", "spalle", "bicipiti", "tricipiti", "quadricipiti", "femorali", "glutei", "polpacci", "addome", "trapezio", "lombari", "avambracci"];
// custom: { "nome esercizio in minuscolo": "muscolo" | "nessuno" } chosen by the person in Palestra
export function muscleWeights(name, custom = {}) {
  const c = custom[String(name).toLowerCase().trim()];
  if (c) return c === "nessuno" ? [] : [[c, 1]];
  for (const [re, m] of MUSCLE_MAP) if (re.test(name)) return m;
  return [];
}
export async function customMuscles(db) {
  const r = await db.prepare("SELECT value FROM settings WHERE key = 'muscoli_custom'").first();
  try { return r ? JSON.parse(r.value) : {}; } catch { return {}; }
}
export async function setCustomMuscle(db, esercizio, muscolo) {
  const name = String(esercizio || "").toLowerCase().trim().slice(0, 80);
  if (!name || !(MUSCLES.includes(muscolo) || muscolo === "nessuno" || muscolo === "auto")) return { errore: "Esercizio o muscolo non valido" };
  const c = await customMuscles(db);
  if (muscolo === "auto") delete c[name]; else c[name] = muscolo; // "auto": back to what Kairo recognises from the name
  await db.prepare("INSERT INTO settings(key,value) VALUES('muscoli_custom',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(c)).run();
  return { ok: true };
}
// exercises of your routines and of the last 60 days that Kairo cannot link to a muscle
export async function unknownExercises(db, schede = []) {
  const c = await customMuscles(db);
  const r = await db.prepare("SELECT DISTINCT exercise FROM sets WHERE start >= ?").bind(new Date(Date.now() - 60 * 86400e3).toISOString().slice(0, 10)).all();
  const names = [...new Set([...schede.flatMap((s) => s.esercizi.map((e) => e.nome)), ...r.results.map((x) => x.exercise)])];
  return names.filter((n) => !muscleWeights(n, c).length && c[n.toLowerCase().trim()] !== "nessuno").slice(0, 30);
}
export const musclesOf = (name, custom) => muscleWeights(name, custom).map(([m]) => m);

// For each muscle: recent fatigue (sets in the last 72 h, decaying: <24 h ×1, 24-48 h ×0.6, 48-72 h ×0.3; sets to failure
// ×1.3, decaying slower: ×1, ×0.8, ×0.5)
// and weekly volume (sets in 7 days, helper muscles count only their fraction) vs the 10-20 sets/week range (Schoenfeld 2017).
export async function muscleFatigue(db, nowMs = Date.now()) {
  const since = new Date(nowMs - 7 * 86400e3).toISOString().slice(0, 10);
  // sets to failure (back-offs, drops, a heavy set with no reps left) need more recovery: they count 1.3 and fade slower
  const r = await db.prepare("SELECT start, exercise, count(*) n, sum(CASE WHEN set_type IN ('backoff','dropset','failure') OR (set_type = 'top' AND rpe >= 9.5) THEN 1 ELSE 0 END) hard FROM sets WHERE start >= ? AND (set_type IS NULL OR set_type != 'warmup') GROUP BY start, exercise").bind(since).all();
  const out = {}, custom = await customMuscles(db);
  for (const x of r.results) {
    const ms = muscleWeights(x.exercise, custom); if (!ms.length) continue;
    const h = (nowMs - Date.parse(x.start)) / 36e5;
    const w = h < 24 ? 1 : h < 48 ? 0.6 : h < 72 ? 0.3 : 0;
    const wh = h < 24 ? 1 : h < 48 ? 0.8 : h < 72 ? 0.5 : 0;
    const hard = Math.min(x.hard || 0, x.n);
    ms.forEach(([m, k]) => {
      const o = (out[m] ||= { muscolo: m, fatica: 0, serie_7g: 0 });
      o.fatica += (x.n - hard) * k * w + hard * 1.3 * k * wh; o.serie_7g += x.n * k;
    });
  }
  const list = Object.values(out).map((o) => ({ ...o, fatica: Math.round(o.fatica * 10) / 10, serie_7g: Math.round(o.serie_7g),
    stato: o.fatica >= 6 ? "stanco" : o.fatica >= 2.5 ? "in recupero" : "fresco",
    volume: o.serie_7g < 10 ? "basso" : o.serie_7g > 20 ? "alto" : "giusto" })).sort((a, b) => b.fatica - a.fatica);
  Object.defineProperty(list, "custom", { value: custom }); // used by routineFatigue, not serialized
  return list;
}
// How tired a routine's muscles are (to pick the best routine for today).
export const routineFatigue = (scheda, fat) => {
  const by = Object.fromEntries(fat.map((f) => [f.muscolo, f.fatica]));
  const ms = [...new Set(scheda.esercizi.flatMap((e) => musclesOf(e.nome, fat.custom).slice(0, 1)))];
  return ms.length ? ms.reduce((a, m) => a + (by[m] || 0), 0) / ms.length : 0;
};

// ---------- does the recovery score work for you? ----------
// For each gym day: best estimated 1RM of each exercise / your best of the previous 8 weeks.
// Then compare the days with recovery 67+ with the others (and the correlation over all days).
export async function recoveryCheck(db, scoresByDay, energyByDay = {}) {
  const since = new Date(Date.now() - 150 * 86400e3).toISOString().slice(0, 10);
  const r = await db.prepare("SELECT substr(start,1,10) d, exercise, max(weight * (1 + reps / 30.0)) e FROM sets WHERE start >= ? AND weight > 0 AND reps BETWEEN 1 AND 12 AND (set_type IS NULL OR set_type != 'warmup') GROUP BY d, exercise ORDER BY d").bind(since).all();
  const hist = {}, perf = {};
  for (const x of r.results) {
    const prev = (hist[x.exercise] ||= []).filter((h) => (Date.parse(x.d) - Date.parse(h.d)) / 864e5 <= 56);
    const best = prev.length ? Math.max(...prev.map((h) => h.e)) : null;
    if (best) (perf[x.d] ||= []).push(x.e / best);
    hist[x.exercise] = [...prev, { d: x.d, e: x.e }];
  }
  const pts = Object.entries(perf).filter(([d]) => scoresByDay[d] != null).map(([d, v]) => ({ score: scoresByDay[d], perf: v.reduce((a, b) => a + b, 0) / v.length }));
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  if (pts.length < 10) {
    // no gym yet (or injured): check with how you feel in the check-in, which is not part of the score
    const en = Object.entries(energyByDay).filter(([d, e]) => e != null && scoresByDay[d] != null).map(([d, e]) => ({ score: scoresByDay[d], e }));
    const g = en.filter((x) => x.score >= 67), o = en.filter((x) => x.score < 67);
    if (en.length >= 14 && g.length >= 4 && o.length >= 4) {
      const eg = avg(g.map((x) => x.e)), eo = avg(o.map((x) => x.e));
      return { pronto: true, fonte: "energia", sedute: pts.length, giorni: en.length, giorni_verdi: g.length, altri_giorni: o.length,
        messaggio: eg - eo >= 0.3 ? `Nei giorni verdi ti senti più carico (energia ${eg.toFixed(1)}/5 contro ${eo.toFixed(1)}/5): lo score descrive bene come stai.`
          : eg - eo > -0.3 ? `Per ora l'energia che segni è simile nei giorni verdi e negli altri (${eg.toFixed(1)} contro ${eo.toFixed(1)}): servono più giorni per capire.`
          : `Nei giorni verdi segni meno energia (${eg.toFixed(1)} contro ${eo.toFixed(1)}): per te lo score per ora non coincide con le sensazioni.` };
    }
    return { sedute: pts.length, pronto: false, messaggio: `Servono 10 sedute di palestra oppure 14 check-in (con giorni verdi e non) per verificarlo: ne ho ${pts.length} e ${en.length}.` };
  }
  const green = pts.filter((p) => p.score >= 67), other = pts.filter((p) => p.score < 67);
  const mx = avg(pts.map((p) => p.score)), my = avg(pts.map((p) => p.perf));
  const cov = pts.reduce((a, p) => a + (p.score - mx) * (p.perf - my), 0);
  const sx = Math.sqrt(pts.reduce((a, p) => a + (p.score - mx) ** 2, 0)), sy = Math.sqrt(pts.reduce((a, p) => a + (p.perf - my) ** 2, 0));
  const corr = sx && sy ? cov / (sx * sy) : null;
  const diff = green.length >= 4 && other.length >= 4 ? (avg(green.map((p) => p.perf)) / avg(other.map((p) => p.perf)) - 1) * 100 : null;
  return {
    sedute: pts.length, pronto: true, correlazione: corr == null ? null : Math.round(corr * 100) / 100,
    differenza_pct: diff == null ? null : Math.round(diff * 10) / 10, giorni_verdi: green.length, altri_giorni: other.length,
    messaggio: diff == null ? "Servono almeno 4 sedute in giorni verdi e 4 negli altri per il confronto."
      : diff >= 1 ? `Nei giorni verdi in palestra rendi in media il ${Math.round(diff * 10) / 10}% in più: per te lo score funziona.`
      : diff > -1 ? "Per ora i giorni verdi e gli altri si somigliano in palestra: lo score conta di più per sonno e fatica che per la forza."
      : "Per ora nei giorni verdi non rendi di più: guarda le componenti, forse per te pesa altro (sonno, come ti senti).",
  };
}
