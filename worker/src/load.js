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

// Training sessions from heart rate: blocks above 60% of max HR (pauses up to 5 minutes kept inside),
// at least 10 minutes long. Works for any sport, without the workout being started on the Watch.
export function detectSessions(samples, hrmax) {
  const out = [];
  let cur = null;
  for (const s of samples) {
    if (s.v < 0.6 * hrmax) continue;
    if (cur && s.t - cur.last <= MAX_GAP_MIN * 60) { cur.last = s.t; cur.vals.push(s); }
    else { if (cur) out.push(cur); cur = { first: s.t, last: s.t, vals: [s] }; }
  }
  if (cur) out.push(cur);
  return out.filter((b) => b.last - b.first >= 10 * 60).map((b) => ({
    start: b.first, end: b.last, minuti: Math.round((b.last - b.first) / 60),
    fc_media: Math.round(b.vals.reduce((a, x) => a + x.v, 0) / b.vals.length),
    trimp: edwardsTrimp(samples.filter((x) => x.t >= b.first && x.t <= b.last), hrmax).trimp,
  }));
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
    stmts.push(db.prepare("DELETE FROM sessioni WHERE day = ?").bind(day));
    for (const x of detectSessions(r.results, hrmax)) {
      const iso = (t) => new Date(t * 1000).toISOString().slice(0, 19) + "Z";
      stmts.push(db.prepare("INSERT OR REPLACE INTO sessioni(start,day,end,minuti,fc_media,trimp) VALUES(?,?,?,?,?,?)").bind(iso(x.start), day, iso(x.end), x.minuti, x.fc_media, x.trimp));
    }
  }
  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
  return stmts.length;
}

// ---------- resting heart rate during sleep (like Oura's "lowest heart rate") ----------
// Apple writes its resting heart rate later in the day; the heart rate while asleep is ready at wake-up.
// Value of a night = lowest 10-minute average of the heart-rate samples that fall inside the sleep stages.
const ASLEEP = new Set(["core", "deep", "rem", "asleep"]);
const WINDOW_S = 10 * 60;

export function lowestSleepingHr(samples, intervals) {
  // samples: [{ t: epoch s, v }] sorted; intervals: [[startS, endS]] of asleep stages
  const inSleep = samples.filter((s) => intervals.some(([a, b]) => s.t >= a && s.t <= b));
  if (inSleep.length < 6) return null; // too few measurements to be reliable
  let best = null;
  for (let i = 0, j = 0, sum = 0; i < inSleep.length; i++) {
    while (j < inSleep.length && inSleep[j].t - inSleep[i].t <= WINDOW_S) sum += inSleep[j++].v;
    const n = j - i;
    if (n >= 2) { const m = sum / n; if (best == null || m < best) best = m; }
    sum -= inSleep[i].v;
  }
  return best == null ? null : Math.round(best * 10) / 10;
}

// Recomputes the night value for the given wake-up days (local dates) and stores it as daily "fc_notte".
export async function recomputeNightHr(db, days) {
  const stmts = [];
  for (const day of [...new Set(days)].sort().slice(-90)) {
    // the night that ends on `day`: sleep stages ending between 18:00 of the day before and 14:00 of `day`
    const sl = await db.prepare("SELECT start, end, stage FROM sleep WHERE end > ? AND end <= ? ORDER BY start").bind(`${addDay(day, -1)}T18:00`, `${day}T14:00`).all();
    const iv = sl.results.filter((x) => ASLEEP.has(x.stage)).map((x) => [Date.parse(x.start) / 1000, Date.parse(x.end) / 1000]).filter(([a, b]) => b > a);
    if (!iv.length) continue;
    const from = Math.min(...iv.map((x) => x[0])), to = Math.max(...iv.map((x) => x[1]));
    const hr = await db.prepare("SELECT t, value v FROM samples WHERE metric = 'fc' AND t >= ? AND t <= ? ORDER BY t").bind(Math.floor(from), Math.ceil(to)).all();
    const v = lowestSleepingHr(hr.results, iv);
    if (v != null && v >= 25 && v <= 150) stmts.push(db.prepare("INSERT INTO daily(metric,day,value) VALUES('fc_notte',?,?) ON CONFLICT(metric,day) DO UPDATE SET value=excluded.value").bind(day, v));
  }
  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
  return stmts.length;
}
