// Training sessions with sport, distance and pace.
// Sessions are detected from heart rate (≥ 10 min above 60% of max HR, see load.js). Their sport comes from the data
// recorded in the same hours: swimming or cycling distance, running distance at running speed, gym sets logged in Kairo.
// Distances arrive hour by hour (HealthSync), so the hours a session touches are summed: exact for swimming and cycling,
// slightly generous for running (a walk in the same hour is counted too), which is why paces are shown as "about".

const addDay = (d, n = 1) => new Date(Date.parse(d + "T12:00:00Z") + n * 86400e3).toISOString().slice(0, 10);

// "YYYY-MM-DDTHH" in the person's time zone (the format of the hourly table)
export function localHour(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}`;
}

const RUN_KMH = 6.5; // above this average speed on foot it is running, not walking

export function classify(sess, hours, gymStarts) {
  const s = Date.parse(sess.start), e = Date.parse(sess.end);
  // gym: a workout logged in Kairo that overlaps the session
  if (gymStarts.some(([a, b]) => a <= e + 15 * 60e3 && b >= s - 15 * 60e3)) return { sport: "palestra", fonte: "palestra" };
  const sum = (m) => hours.reduce((a, h) => a + (h[m] || 0), 0);
  const swim = sum("dist_nuoto_ora"), bike = sum("dist_bici_ora"), foot = sum("dist_piedi_ora");
  const min = Math.max(1, sess.minuti);
  if (swim >= 100) return { sport: "nuoto", fonte: "distanza", distanza_m: Math.round(swim), passo_s100: Math.round((min * 60) / (swim / 100)) };
  if (bike >= 1) return { sport: "bici", fonte: "distanza", distanza_m: Math.round(bike * 1000), velocita_kmh: Math.round((bike / (min / 60)) * 10) / 10 };
  if (foot >= 1 && foot / (min / 60) >= RUN_KMH) return { sport: "corsa", fonte: "distanza", distanza_m: Math.round(foot * 1000), passo_skm: Math.round((min * 60) / foot) };
  return { sport: null, fonte: null };
}

// Sessions between two local days (inclusive), each with its sport when it can be recognised.
export async function sessionsWithSport(db, from, to, tz = "Europe/Rome") {
  const [ses, hr, gym, es] = await db.batch([
    db.prepare("SELECT start, end, day, minuti, fc_media, trimp FROM sessioni WHERE day >= ? AND day <= ? ORDER BY start").bind(from, to),
    db.prepare("SELECT metric, hour, value FROM hourly WHERE metric IN ('dist_nuoto_ora','dist_bici_ora','dist_piedi_ora') AND hour >= ? AND hour < ?").bind(addDay(from, -1), addDay(to, 2)),
    db.prepare("SELECT start, max(end) end FROM sets WHERE start >= ? AND start < ? GROUP BY start").bind(addDay(from, -1), addDay(to, 2)),
    db.prepare("SELECT day, sport FROM esiti WHERE day >= ? AND day <= ? AND sport IS NOT NULL AND stato != 'saltato'").bind(from, to),
  ]);
  const byHour = {};
  for (const x of hr.results) (byHour[x.hour] ||= {})[x.metric] = x.value;
  const gymStarts = gym.results.map((x) => [Date.parse(x.start), Date.parse(x.end || x.start) || Date.parse(x.start) + 3600e3]);
  const declared = Object.fromEntries(es.results.map((x) => [x.day, x.sport]));
  const out = ses.results.map((x) => {
    const s = Date.parse(x.start), e = Date.parse(x.end), hours = [];
    for (let t = s - (s % 3600e3); t <= e; t += 3600e3) { const h = byHour[localHour(t, tz)]; if (h) hours.push(h); }
    const c = classify(x, hours, gymStarts);
    return { inizio: x.start, fine: x.end, giorno: x.day, minuti: x.minuti, fc_media: x.fc_media, carico: x.trimp, ...c };
  });
  // a single unrecognised session on a day with a declared sport (e.g. football): that sport
  for (const [day, sport] of Object.entries(declared)) {
    const unk = out.filter((x) => x.giorno === day && !x.sport);
    if (unk.length === 1 && !out.some((x) => x.giorno === day && x.sport === sport)) Object.assign(unk[0], { sport, fonte: "dichiarato" });
  }
  return out;
}
