// Training load from heart rate: Edwards' TRIMP (1993) = Σ minutes in zone × zone weight,
// zones as % of maximum heart rate: 50-60% → 1, 60-70% → 2, 70-80% → 3, 80-90% → 4, 90-100% → 5.
// Each heart-rate sample stands for the time until the next one (at most 5 minutes: the Watch samples
// every few seconds during workouts and every few minutes the rest of the day).

const MAX_GAP_MIN = 5;
const addDay = (d, n = 1) => new Date(Date.parse(d + "T12:00:00Z") + n * 86400e3).toISOString().slice(0, 10);

export function edwardsTrimp(samples, hrmax) {
  // samples: [{ t: epoch seconds, v: bpm }] sorted by time
  let trimp = 0;
  const zones = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < samples.length - 1; i++) {
    const dt = Math.min((samples[i + 1].t - samples[i].t) / 60, MAX_GAP_MIN);
    if (!(dt > 0)) continue;
    const pct = samples[i].v / hrmax;
    const zone = pct < 0.5 ? 0 : Math.min(5, Math.floor((pct - 0.5) * 10) + 1);
    zones[zone] += dt;
    trimp += zone * dt;
  }
  return { trimp: Math.round(trimp), minuti_zona: zones.map((m) => Math.round(m)) };
}

// Recomputes the daily TRIMP of the given (local) days from the stored heart-rate samples.
export async function recomputeTrimp(db, days, hrmax) {
  const stmts = [];
  for (const day of [...new Set(days)].sort().slice(-400)) {
    const r = await db.prepare("SELECT t, value v FROM samples WHERE metric = 'fc' AND ts >= ? AND ts < ? ORDER BY t").bind(day, addDay(day)).all();
    if (r.results.length < 2) continue;
    const { trimp } = edwardsTrimp(r.results, hrmax);
    // computed from the raw samples: this value is authoritative for the day
    stmts.push(db.prepare("INSERT INTO daily(metric,day,value) VALUES('trimp',?,?) ON CONFLICT(metric,day) DO UPDATE SET value=excluded.value").bind(day, trimp));
  }
  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
  return stmts.length;
}
