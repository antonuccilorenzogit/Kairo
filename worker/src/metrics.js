// Calcolo delle metriche: sonno, valori notturni, baseline personali, Score di Recupero,
// carico di allenamento, allenamento consigliato, allarmi e fabbisogno di sonno.
import { getProfile, hrMax, DEFAULT_SLEEP_NEED } from "./profile.js";
//
// Metodi e fonti (nessuna app pubblica la formula esatta dei suoi punteggi: qui si usano i metodi
// pubblicati e validati che quelle app dichiarano di usare, con soglie tratte dalla letteratura):
// - HRV: logaritmo naturale (Plews et al. 2012-2013), media mobile 7 giorni confrontata con la
//   "normal range" a 60 giorni ± 0,5 DS = smallest worthwhile change (Plews; HRV4Training usa 60 giorni).
// - Struttura del Recupero come la Readiness di Oura: contributi 0-100 per HRV (oggi e bilancio),
//   FC a riposo rispetto alla media a lungo termine, sonno della notte, bilancio di sonno a 14 giorni,
//   più la frequenza respiratoria notturna (usata da Whoop). Fasce finali come Whoop: 67+ verde, 34-66 giallo.
// - Punteggio del sonno con i contributi di Oura (durata, efficienza, profondo, REM, regolarità, orario)
//   e le soglie di AASM/NSF: 7-9 h (Watson 2015), efficienza >= 85% (Ohayon 2017), profondo ~15-20%
//   e REM ~20-25% (Oura; Ohayon 2004), punto medio del sonno tra 00:00 e 03:00 (Oura).
// - Carico: TRIMP di Edwards (1993) dalla frequenza cardiaca, minuti × zona (50-60% FCmax = 1 … 90-100% = 5),
//   FCmax misurata o stimata con Tanaka et al. (2001): 208 − 0,7 × età. Per la palestra, dove la FC sottostima
//   la fatica, session-RPE di Foster (2001): RPE × minuti, riportato alla scala TRIMP con un fattore personale.
//   Rapporto acuto:cronico (media 7 giorni / media 28 giorni, Gabbett 2016): zona ottimale 0,8-1,3.
// - Regolarità: Sleep Regularity Index (Phillips et al. 2017) su 7 giorni; riferimento UK Biobank
//   (Windred 2024): mediana 81, intervallo interquartile 73,8-86,3.

const BASELINE_DAYS = 60;   // finestra della media personale
const MIN_BASELINE = 5;     // notti minime per considerare affidabile una baseline
const GAP_MS = 2 * 3600e3;  // pausa oltre la quale due blocchi di sonno sono sessioni diverse

const DAY_MS = 86400e3;
const SLEEP_NEED_MIN = 480;  // fabbisogno di riferimento: 8 h (centro dell'intervallo AASM 7-9 h)
// interpolazione lineare a tratti: points = [[x, y], ...] ordinati per x
const pw = (x, points) => {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i], [x0, y0] = points[i - 1];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return points[points.length - 1][1];
};
const addDays = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);
const t = (iso) => Date.parse(iso);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const std = (a) => {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
const median = (a) => { const v = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!v.length) return null; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const r1 = (x, d = 1) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

async function load(db, from, to) {
  const r = await db.batch([
    // la FC grezza (migliaia di valori al giorno) non serve qui: il carico arriva già calcolato in daily.trimp
    db.prepare("SELECT metric, ts, value FROM samples WHERE ts >= ? AND ts < ? AND metric != 'fc' ORDER BY ts").bind(from, addDays(to, 1)),
    db.prepare("SELECT start, end, stage FROM sleep WHERE end >= ? AND start < ? ORDER BY start").bind(from, addDays(to, 1)),
    db.prepare("SELECT metric, day, value FROM daily WHERE day >= ? AND day <= ?").bind(from, to),
    db.prepare("SELECT * FROM checkin WHERE day >= ? AND day <= ?").bind(from, addDays(to, 1)),
    // sedute di forza: durata e RPE medio per il session-RPE
    db.prepare("SELECT start, max(end) end, avg(rpe) rpe, count(*) n FROM sets WHERE start >= ? AND start < ? GROUP BY start").bind(from, addDays(to, 1)),
    db.prepare("SELECT day, start, end, minuti, fc_media, trimp FROM sessioni WHERE day >= ? AND day <= ? ORDER BY start").bind(from, to),
  ]);
  const sessioni = {};
  for (const x of r[5].results) (sessioni[x.day] ||= []).push({ inizio: x.start, fine: x.end, minuti: x.minuti, fc_media: x.fc_media, carico: x.trimp });
  const samples = {};
  for (const s of r[0].results) (samples[s.metric] ||= []).push({ ts: s.ts, ms: t(s.ts), v: s.value });
  const daily = {};
  for (const d of r[2].results) (daily[d.day] ||= {})[d.metric] = d.value;
  const checkin = {};
  for (const c of r[3].results) checkin[c.day] = c;
  const gym = {};
  for (const w of r[4].results) {
    const min = w.end ? (t(w.end) - t(w.start)) / 60e3 : null;
    // missing data (e.g. imported from Hevy/Strong): RPE 7 ("hard but not maximal"), about 3 minutes per set
    const minutes = min > 0 && min < 300 ? min : Math.min(180, (w.n || 0) * 3);
    if (minutes > 0) (gym[w.start.slice(0, 10)] ||= []).push(minutes * (w.rpe || 7));
  }
  return { samples, sleepRows: r[1].results, daily, checkin, gym, sessioni };
}

// Le fasi possono arrivare da più fonti (Watch, iPhone, altre app) e sovrapporsi: le fondo in una
// sola linea temporale senza sovrapposizioni, così ogni minuto conta una volta sola. Dove le fonti
// si sovrappongono vince la fase più informativa: profondo/REM/leggero > sonno generico > sveglio > a letto.
const PRIORITY = { deep: 6, rem: 5, core: 4, asleep: 3, awake: 2, inbed: 1 };
export function mergeStages(rows) {
  const iv = rows.map((r) => ({ s: t(r.start), e: t(r.end), stage: r.stage, start: r.start, end: r.end }))
    .filter((x) => Number.isFinite(x.s) && Number.isFinite(x.e) && x.e > x.s);
  if (!iv.length) return [];
  const cuts = [...new Set(iv.flatMap((x) => [x.s, x.e]))].sort((a, b) => a - b);
  // ISO string (con il fuso originale) per ogni istante di taglio
  const isoAt = new Map();
  for (const x of iv) { isoAt.set(x.s, x.start); isoAt.set(x.e, x.end); }
  iv.sort((a, b) => a.s - b.s);
  const out = [];
  let k = 0;
  const active = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i], b = cuts[i + 1];
    while (k < iv.length && iv[k].s <= a) active.push(iv[k++]);
    for (let j = active.length - 1; j >= 0; j--) if (active[j].e <= a) active.splice(j, 1);
    let best = null;
    for (const x of active) if (x.s <= a && x.e >= b && (!best || PRIORITY[x.stage] > PRIORITY[best])) best = x.stage;
    if (!best) continue;
    const last = out[out.length - 1];
    if (last && last.stage === best && last.endMs === a) { last.end = isoAt.get(b); last.endMs = b; }
    else out.push({ start: isoAt.get(a), end: isoAt.get(b), stage: best, startMs: a, endMs: b });
  }
  return out.map(({ start, end, stage }) => ({ start, end, stage }));
}

// Raggruppa le fasi in sessioni di sonno e le assegna al giorno del risveglio
function buildSessions(rawRows) {
  const rows = mergeStages(rawRows);
  const sessions = [];
  let cur = null;
  for (const r of rows) {
    const s = t(r.start), e = t(r.end);
    if (!cur || s - cur.endMs > GAP_MS) {
      cur = { startIso: r.start, startMs: s, endIso: r.end, endMs: e, min: { core: 0, deep: 0, rem: 0, awake: 0, asleep: 0, inbed: 0 } };
      sessions.push(cur);
    }
    if (e > cur.endMs) { cur.endMs = e; cur.endIso = r.end; }
    cur.min[r.stage] = (cur.min[r.stage] || 0) + (e - s) / 60e3;
  }
  const byDay = {};
  for (const s of sessions) {
    s.asleepMin = s.min.core + s.min.deep + s.min.rem + s.min.asleep;
    s.spanMin = (s.endMs - s.startMs) / 60e3;
    (byDay[s.endIso.slice(0, 10)] ||= []).push(s);
  }
  return byDay;
}

// Minuti dall'ora 18:00 del giorno prima (gestisce l'addormentamento dopo mezzanotte)
function bedtimeMinutes(iso) {
  const h = Number(iso.slice(11, 13)), m = Number(iso.slice(14, 16));
  let x = h * 60 + m;
  if (x < 18 * 60) x += 1440;
  return x - 18 * 60;
}

function inWindow(list, fromMs, toMs) {
  return (list || []).filter((s) => s.ms >= fromMs && s.ms <= toMs).map((s) => s.v);
}

// Metriche "grezze" di un giorno, senza confronto con la baseline
function rawDay(day, data, sessionsByDay) {
  const sessions = (sessionsByDay[day] || []).slice().sort((a, b) => b.asleepMin - a.asleepMin);
  const main = sessions[0] && sessions[0].asleepMin >= 120 ? sessions[0] : null;
  const napsMin = sessions.filter((s) => s !== main).reduce((a, s) => a + s.asleepMin, 0);

  let winFrom, winTo;
  if (main) { winFrom = main.startMs - 30 * 60e3; winTo = main.endMs; }
  else { winFrom = t(day + "T00:00:00+02:00"); winTo = t(day + "T09:00:00+02:00"); }

  const hrvNight = inWindow(data.samples.hrv, winFrom, winTo);
  // morning reading: within 60 minutes after waking up (e.g. a 1-minute Breathe session in bed).
  // Guided breathing raises HRV, so it is compared only with your other mornings, never with the night.
  const hrvMorning = main ? inWindow(data.samples.hrv, main.endMs, main.endMs + 60 * 60e3) : [];
  const hrvDay = (data.samples.hrv || []).filter((s) => s.ts.startsWith(day)).map((s) => s.v);
  // senza misure notturne uso le 24 h precedenti a mezzogiorno (il Watch misura l'HRV in momenti casuali)
  const hrvFallback = inWindow(data.samples.hrv, t(day + "T12:00:00+02:00") - DAY_MS, t(day + "T12:00:00+02:00"));
  // median, not mean: the Watch takes few readings per night and one odd value must not move the score
  const hrv = hrvNight.length ? median(hrvNight) : hrvFallback.length ? median(hrvFallback) : null;
  const fcrList = (data.samples.fcr || []).filter((s) => s.ts.startsWith(day));
  const fcr = fcrList.length ? fcrList[fcrList.length - 1].v : null;
  const resp = main ? mean(inWindow(data.samples.resp, winFrom, winTo)) : null;
  const spo2 = main ? inWindow(data.samples.spo2, winFrom, winTo) : [];

  let sleep = null;
  if (main) {
    const eff = main.asleepMin / main.spanMin;
    const quality = (main.min.deep + main.min.rem) / Math.max(main.asleepMin, 1);
    sleep = {
      inizio: main.startIso, fine: main.endIso,
      durata_min: Math.round(main.asleepMin), a_letto_min: Math.round(main.spanMin),
      fasi_min: { leggero: Math.round(main.min.core + main.min.asleep), profondo: Math.round(main.min.deep),
        rem: Math.round(main.min.rem), veglia: Math.round(main.min.awake) },
      efficienza: r1(eff * 100, 0),
      quota_profondo_rem: r1(quality * 100, 0),
      quota_profondo: r1((main.min.deep / Math.max(main.asleepMin, 1)) * 100, 0),
      quota_rem: r1((main.min.rem / Math.max(main.asleepMin, 1)) * 100, 0),
      pisolini_min: Math.round(napsMin),
      _bed: bedtimeMinutes(main.startIso),
      _wake: bedtimeMinutes(main.endIso),
      _midH: (18 + (bedtimeMinutes(main.startIso) + main.spanMin / 2) / 60) % 24, // ora locale del punto medio
      _contributi: {
        // AASM/NSF: 7-9 h raccomandate; pieno punteggio da 8 h, 0 sotto le 4 h
        durata: pw(main.asleepMin, [[240, 0], [420, 85], [480, 100]]),
        // NSF (Ohayon 2017): >= 85% buona qualità, <= 74% scarsa
        efficienza: pw(eff * 100, [[65, 0], [75, 50], [85, 85], [92, 100]]),
        // profondo: adulti 15-20% del sonno (Oura); REM: 20-25% (circa 1,5 h)
        profondo: pw((main.min.deep / Math.max(main.asleepMin, 1)) * 100, [[0, 0], [10, 60], [15, 100]]),
        rem: pw((main.min.rem / Math.max(main.asleepMin, 1)) * 100, [[0, 0], [15, 70], [20, 100]]),
      },
    };
  }
  // notte senza Watch: le ore dichiarate nel check-in del mattino (solo la durata è nota)
  const ck = data.checkin[day];
  if (!sleep && ck && ck.sonno_min) {
    sleep = { manuale: true, durata_min: ck.sonno_min, fasi_min: null, efficienza: null,
      _contributi: { durata: pw(ck.sonno_min, [[240, 0], [420, 85], [480, 100]]) } };
  }
  const d = data.daily[day] || {};
  return {
    giorno: day,
    notte: { hrv_ms: r1(hrv), hrv_misure: hrvNight.length || hrvFallback.length, hrv_fonte: hrvNight.length ? "notte" : hrvFallback.length ? "24h" : null, hrv_mattino: hrvMorning.length ? r1(median(hrvMorning)) : null, hrv_giorno_ms: r1(mean(hrvDay)), fcr_bpm: fcr, fc_notte_bpm: d.fc_notte ?? null,
      resp_rpm: r1(resp), spo2_media: r1(mean(spo2)), spo2_min: spo2.length ? Math.min(...spo2) : null },
    sonno: sleep,
    attivita: { passi: d.passi ?? null, kcal_attive: r1(d.kcal_attive, 0), kcal_riposo: r1(d.kcal_riposo, 0),
      dist_km: r1(d.dist_piedi, 2), piani: d.piani ?? null, trimp: d.trimp ?? null,
      // sessions detected from heart rate, with the likely sport (swim/bike distance of the day)
      sessioni: (data.sessioni[day] || []).map((x) => ({ ...x, sport: d.dist_nuoto ? "nuoto" : d.dist_bici ? "bici" : null })) },
    checkin: data.checkin[day] || null,
  };
}

// Personal baseline, robust to odd days: median and MAD (× 1.4826 ≈ standard deviation for normal data)
function baseline(values, floor) {
  if (values.length < MIN_BASELINE) return { insufficiente: true, n: values.length };
  const med = median(values), mad = median(values.map((v) => Math.abs(v - med))) * 1.4826;
  return { media: med, dev: Math.max(mad || std(values) || 0, floor), n: values.length };
}
// days tagged in the check-in as out of the ordinary (alcohol, illness, travel) stay out of the baseline
const EXCLUDE_TAGS = /alcol|malanno|viaggio/;
const tagged = (d) => EXCLUDE_TAGS.test(d.checkin?.tag || "");
// 7-day coefficient of variation of ln HRV (Plews): rising = the body is struggling to adapt
function hrvCv(days, idx) {
  const week = days.slice(Math.max(0, idx - 6), idx + 1);
  // only reliable values: the mornings if there are enough, otherwise nights with at least 2 readings
  const morn = week.map((d) => d.notte.hrv_mattino).filter((x) => x);
  const vals = morn.length >= 5 ? morn : week.filter((d) => d.notte.hrv_fonte === "notte" && d.notte.hrv_misure >= 2).map((d) => d.notte.hrv_ms);
  const ln = vals.filter((x) => x).map(Math.log);
  return ln.length >= 5 ? (std(ln) / mean(ln)) * 100 : null;
}
// How many HRV readings the Watch usually takes for you at night (median of the last 30 nights)
function usualReadings(prev) {
  const n = prev.slice(-30).filter((d) => d.notte.hrv_fonte === "notte").map((d) => d.notte.hrv_misure);
  return n.length >= 5 ? median(n) : 3;
}
// The score from its components: weighted mean, physiological cap, smoothing when the readings are few.
function scoreFrom(today, comp, prevScore) {
  const usable = Object.values(comp).filter((c) => c.punteggio != null);
  const wSum = usable.reduce((s, c) => s + c.peso, 0);
  if (!usable.length || (comp.hrv.punteggio == null && comp.fc_riposo.punteggio == null)) return { score: null, wSum };
  let score = usable.reduce((s, c) => s + c.peso * c.punteggio, 0) / wSum;
  // a good night or a good mood cannot hide a nervous system on alert: at most 20 points above HRV + resting HR
  const phys = [comp.hrv, comp.fc_riposo].filter((c) => c.punteggio != null);
  score = Math.min(score, phys.reduce((s, c) => s + c.peso * c.punteggio, 0) / phys.reduce((s, c) => s + c.peso, 0) + 20);
  // reliability compared with YOUR usual number of readings (the Watch takes 1-5 per night, it varies by person)
  const h = comp.hrv, hr = comp.fc_riposo.punteggio != null;
  const n = h.fonte === "mattino" ? 99 : h.fonte === "notte" ? h.misure : 0, typ = h.misure_tipiche ?? 3;
  const affidabilita = (n >= Math.max(2, typ) || h.fonte === "mattino") && hr ? "alta" : n >= 1 && (n >= typ || hr) ? "media" : "bassa";
  // few readings: a big jump is more likely noise than a real change → at most ±15 from yesterday
  if (affidabilita === "bassa" && prevScore != null) score = clamp(score, prevScore - 15, prevScore + 15);
  return { score: Math.round(clamp(score, 0, 100)), wSum, affidabilita };
}

// Sleep Regularity Index (Phillips et al. 2017): probabilità che a 24 h di distanza lo stato
// (sonno/veglia) sia lo stesso, minuto per minuto; SRI = 200·P − 100 (100 = perfettamente regolare).
function sri(masks) {
  const pairs = [];
  for (let i = 1; i < masks.length; i++) {
    const a = masks[i - 1], b = masks[i];
    if (!a || !b) continue;
    let same = 0;
    for (let m = 0; m < 1440; m++) if (a[m] === b[m]) same++;
    pairs.push(same / 1440);
  }
  return pairs.length >= 2 ? 200 * mean(pairs) - 100 : null;
}

// trasforma uno z-score (rispetto alla media personale) in un contributo 0-100: 60 = come al solito
const zScore = (z) => clamp(60 + 20 * clamp(z, -3, 2), 0, 100);

function finalize(days, idx, maskOf) {
  const today = days[idx];
  const prev = days.slice(Math.max(0, idx - BASELINE_DAYS), idx).filter((d) => !tagged(d));
  const week = days.slice(Math.max(0, idx - 6), idx + 1);

  // ---- punteggio del sonno (contributi stile Oura, soglie AASM/NSF) ----
  if (today.sonno && today.sonno.manuale) {
    // notte dichiarata nel check-in: conta solo la durata
    today.sonno.punteggio = Math.round(today.sonno._contributi.durata);
    today.sonno.contributi = { durata: today.sonno.punteggio };
  } else if (today.sonno) {
    const masks = week.map((d) => (d.sonno ? maskOf(d.giorno) : null));
    const s = sri(masks);
    const beds = week.map((d) => d.sonno && d.sonno._bed).filter((x) => x != null);
    const wakes = week.map((d) => d.sonno && d.sonno._wake).filter((x) => x != null);
    const sdBed = beds.length >= 3 ? std(beds) : null, sdWake = wakes.length >= 3 ? std(wakes) : null;
    const c = today.sonno._contributi;
    // regolarità: SRI se ci sono almeno 2 coppie di notti consecutive, altrimenti la costanza di orari (Oura)
    c.regolarita = s != null ? pw(s, [[40, 0], [60, 30], [73.8, 60], [81, 80], [86.3, 95], [90, 100]])
      : sdBed != null ? pw((sdBed + (sdWake ?? sdBed)) / 2, [[0, 100], [30, 85], [60, 60], [120, 0]]) : null;
    // orario: punto medio del sonno ideale tra le 00:00 e le 03:00 (Oura)
    const midH = today.sonno._midH;
    const fromIdeal = midH >= 0 && midH <= 3 ? 0 : midH > 3 && midH < 12 ? midH - 3 : midH >= 12 ? 24 - midH : 0;
    c.orario = pw(fromIdeal, [[0, 100], [1, 85], [2, 65], [4, 20], [6, 0]]);
    const W = { durata: 0.35, efficienza: 0.20, profondo: 0.10, rem: 0.10, regolarita: 0.15, orario: 0.10 };
    const parts = Object.entries(W).filter(([k]) => c[k] != null);
    const wSum = parts.reduce((a, [, w]) => a + w, 0);
    today.sonno.punteggio = Math.round(parts.reduce((a, [k, w]) => a + w * c[k], 0) / wSum);
    today.sonno.contributi = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v == null ? null : Math.round(v)]));
    today.sonno.sri = r1(s, 0);
    today.sonno.regolarita_min = r1(sdBed, 0);
  }

  // ---- bilancio di sonno: media delle ultime 14 notti rispetto al fabbisogno (Oura "Sleep balance") ----
  const last14 = days.slice(Math.max(0, idx - 13), idx + 1).filter((d) => d.sonno);
  const balance = last14.length >= 3 ? mean(last14.map((d) => d.sonno.durata_min)) - SLEEP_NEED_MIN : null;

  // ---- baseline personali (60 giorni, solo giorni precedenti) ----
  const vals = (f) => prev.map(f).filter((x) => x != null && Number.isFinite(x));
  const bHrv = baseline(vals((d) => (d.notte.hrv_ms ? Math.log(d.notte.hrv_ms) : null)), 0.08);
  const bFcr = baseline(vals((d) => d.notte.fcr_bpm), 2);
  // heart rate while asleep (ready at wake-up, like Oura/Whoop), compared only with other nights
  const bFcN = baseline(vals((d) => d.notte.fc_notte_bpm), 2);
  const bResp = baseline(vals((d) => d.notte.resp_rpm), 0.4);
  const bSpo2 = baseline(vals((d) => d.notte.spo2_media), 0.5);
  const cvToday = hrvCv(days, idx);
  const bCv = baseline(days.slice(Math.max(0, idx - BASELINE_DAYS), idx).map((_, j, arr) => hrvCv(days, idx - arr.length + j)).filter((x) => x != null), 0.3);

  const comp = {};
  // HRV: tonight compared with your baseline + the 7-day mean (changes within ±0.5 SD = negligible).
  // With few readings tonight the 7-day mean weighs more (Plews: the rolling mean is the robust signal).
  {
    const bMorning = baseline(vals((d) => (d.notte.hrv_mattino ? Math.log(d.notte.hrv_mattino) : null)), 0.08);
    const useM = today.notte.hrv_mattino != null && !bMorning.insufficiente;
    const series = useM ? (d) => d.notte.hrv_mattino : (d) => d.notte.hrv_ms;
    const b = useM ? bMorning : bHrv, v = series(today), ok = !b.insufficiente;
    const n = useM ? 3 : today.notte.hrv_fonte === "notte" ? today.notte.hrv_misure : 0;
    // weight of tonight: full when you have your usual number of readings, lower when fewer than usual
    const typ = usualReadings(prev);
    const wTonight = n >= 3 ? 0.6 : n >= Math.max(typ, 1) ? 0.5 : 0.3;
    let score = null, z = null;
    if (v != null && ok) {
      z = (Math.log(v) - b.media) / b.dev;
      const lnWeek = week.map(series).filter((x) => x).map(Math.log);
      let zt = 0;
      if (lnWeek.length >= 3) {
        const diff = mean(lnWeek) - b.media, swc = 0.5 * b.dev;
        zt = Math.abs(diff) <= swc ? 0 : (diff - Math.sign(diff) * swc) / b.dev;
      }
      score = lnWeek.length >= 3 ? wTonight * zScore(z) + (1 - wTonight) * zScore(zt) : zScore(z);
    }
    comp.hrv = { valore: v, unita: "ms", peso: n >= 2 ? 0.30 : n === 1 ? 0.24 : 0.20, misure: useM ? null : today.notte.hrv_misure, misure_tipiche: typ,
      fonte: useM ? "mattino" : today.notte.hrv_fonte, baseline: ok ? r1(Math.exp(b.media)) : null, z: r1(z, 2), punteggio: score, giorni_baseline: b.n,
      mancano: ok ? 0 : MIN_BASELINE - (b.n || 0), mattine: bMorning.n || 0,
      normale: ok ? [r1(Math.exp(b.media - 0.5 * b.dev)), r1(Math.exp(b.media + 0.5 * b.dev))] : null };
  }
  // FC a riposo: rispetto alla media a lungo termine (Oura: cala se 3-5 bpm sopra la media)
  {
    const night = today.notte.fc_notte_bpm != null && !bFcN.insufficiente;
    const b = night ? bFcN : bFcr, v = night ? today.notte.fc_notte_bpm : today.notte.fcr_bpm, ok = !b.insufficiente;
    const z = v != null && ok ? -(v - b.media) / b.dev : null;
    comp.fc_riposo = { valore: v, unita: "bpm", peso: 0.15, baseline: ok ? r1(b.media) : null, z: r1(z, 2), punteggio: z == null ? null : zScore(z), giorni_baseline: b.n,
      fonte: v == null ? null : night ? "notte" : "apple", mancano: ok ? 0 : MIN_BASELINE - (b.n || 0), notti_fc_sonno: bFcN.n || 0 };
  }
  // sonno della notte: il suo punteggio è già 0-100
  comp.sonno = { valore: today.sonno ? today.sonno.punteggio : null, unita: "punti", peso: 0.20, baseline: null, z: null, punteggio: today.sonno ? today.sonno.punteggio : null };
  // bilancio di sonno a 14 giorni
  comp.bilancio_sonno = { valore: balance == null ? null : Math.round(balance), unita: "min/notte", peso: 0.05, baseline: SLEEP_NEED_MIN,
    punteggio: balance == null ? null : pw(balance, [[-150, 0], [-120, 20], [-60, 65], [-30, 85], [0, 100]]), mancano: balance == null ? Math.max(1, 3 - last14.length) : 0 };
  // respirazione: conta solo l'aumento rispetto alla media (segnale precoce di stanchezza o malanno)
  {
    const v = today.notte.resp_rpm, ok = !bResp.insufficiente;
    const up = v != null && ok ? Math.max(0, (v - bResp.media) / bResp.dev) : null;
    comp.respirazione = { valore: v, unita: "resp/min", peso: 0.05, baseline: ok ? r1(bResp.media) : null, z: v != null && ok ? r1((v - bResp.media) / bResp.dev, 2) : null,
      punteggio: up == null ? null : clamp(70 - 25 * up, 0, 100), giorni_baseline: bResp.n, mancano: ok ? 0 : MIN_BASELINE - (bResp.n || 0) };
  }

  // HRV stability: 7-day coefficient of variation compared with yours (higher = worse)
  {
    const ok = cvToday != null && !bCv.insufficiente;
    const z = ok ? -(cvToday - bCv.media) / bCv.dev : null;
    comp.stabilita_hrv = { valore: r1(cvToday, 1), unita: "% CV", peso: 0.05, baseline: ok ? r1(bCv.media, 1) : null, z: r1(z, 2), punteggio: z == null ? null : zScore(z),
      mancano: ok ? 0 : Math.max(1, MIN_BASELINE - (bCv.n || 0)) };
  }
  // how you feel (check-in): energy, soreness, mood — subjective measures react early (Saw et al. 2016)
  {
    const c = today.checkin, parts = [];
    if (c?.energia) parts.push((c.energia - 1) * 25);
    if (c?.umore) parts.push((c.umore - 1) * 25);
    if (c?.dolori) parts.push((5 - c.dolori) * 25);
    comp.soggettivo = { valore: parts.length ? Math.round(mean(parts)) : null, unita: "punti", peso: 0.10, baseline: null, z: null, punteggio: parts.length ? mean(parts) : null };
  }
  // night oxygen saturation: only a drop below your usual counts (early sign of illness)
  {
    const v = today.notte.spo2_media, ok = !bSpo2.insufficiente;
    const down = v != null && ok ? Math.max(0, (bSpo2.media - v) / bSpo2.dev) : null;
    comp.ossigeno = { valore: v, unita: "%", peso: 0.03, baseline: ok ? r1(bSpo2.media) : null, z: v != null && ok ? r1((v - bSpo2.media) / bSpo2.dev, 2) : null, punteggio: down == null ? null : clamp(75 - 25 * down, 0, 100) };
  }
  const prevScore = days[idx - 1]?.recupero?.score ?? null;
  const { score, affidabilita } = scoreFrom(today, comp, prevScore);
  // days of personal baseline: HRV is the main signal (resting HR may arrive later or come from the night)
  const giorniDati = bHrv.n || 0;
  for (const c of Object.values(comp)) if (c.punteggio != null) c.punteggio = Math.round(c.punteggio);
  today.recupero = {
    score,
    stato: score == null ? "calibrazione" : score >= 67 ? "recuperato" : score >= 34 ? "parziale" : "basso",
    calibrazione: giorniDati < 14,
    // how much to trust today's score: HRV readings of the night and resting heart rate available
    affidabilita: score == null ? null : affidabilita,
    giorni_baseline: giorniDati,
    componenti: comp,
  };
  return today;
}

// ---- carico, allenamento consigliato, allarmi e fabbisogno di sonno (dopo il recupero) ----
const LOAD_LEVELS = [
  { min: 1.4, key: "dura", titolo: "Seduta dura", testo: "puoi spingere: intervalli in bici o a nuoto, pesi pesanti" },
  { min: 0.95, key: "normale", titolo: "Seduta normale", testo: "il tuo allenamento abituale, a intensità piena" },
  { min: 0.6, key: "leggera", titolo: "Seduta leggera", testo: "tecnica, nuoto o bici facili, pesi leggeri" },
  { min: 0, key: "riposo", titolo: "Riposo attivo", testo: "camminata, mobilità o stretching: oggi si recupera" },
];
function enrich(days, data, profile, from) {
  // session-RPE del giorno: check-in del giorno dopo ("cosa hai fatto ieri") e sedute di forza registrate
  const srpe = days.map((d, i) => {
    const next = data.checkin[addDays(d.giorno, 1)];
    const fromCheckin = next && next.rpe && next.durata_min && !/^riposo$/.test(next.attivita || "") ? next.rpe * next.durata_min : 0;
    const fromGym = (data.gym[d.giorno] || []).reduce((a, x) => a + x, 0);
    return Math.max(fromCheckin, fromGym) || null;
  });
  // fattore personale tra session-RPE e TRIMP (giorni con entrambi), altrimenti 2 (valore tipico)
  const ratios = days.map((d, i) => (srpe[i] && d.attivita.trimp > 20 ? srpe[i] / d.attivita.trimp : null)).filter((x) => x);
  ratios.sort((a, b) => a - b);
  const k = ratios.length >= 3 ? clamp(ratios[Math.floor(ratios.length / 2)], 1, 6) : 2;
  const load = days.map((d, i) => (d.attivita.trimp == null && !srpe[i] ? null : Math.round(Math.max(d.attivita.trimp || 0, srpe[i] ? srpe[i] / k : 0))));
  // personal sleep need: chosen in the profile, otherwise learned from the nights after which you woke up
  // recovered (score 67+): median of at least 8 such nights, kept between 7 and 9.5 hours
  const goodNights = days.filter((d) => d.sonno && !d.sonno.manuale && d.recupero?.score >= 67).map((d) => d.sonno.durata_min).sort((a, b) => a - b);
  const learned = goodNights.length >= 8 ? clamp(Math.round(goodNights[Math.floor(goodNights.length / 2)] / 5) * 5, 420, 570) : null;
  const need0 = profile.sonno_min || learned || DEFAULT_SLEEP_NEED;
  const needSource = profile.sonno_min ? "profilo" : learned ? "imparato" : "predefinito";

  days.forEach((d, i) => {
    if (d.giorno < from) return;
    // medie fino a ieri (oggi è ancora in corso)
    const win = (n) => load.slice(Math.max(0, i - n), i).filter((x) => x != null);
    const a7 = win(7), c28 = win(28);
    const acute = a7.length >= 4 ? mean(a7) : null, chronic = c28.length >= 14 ? mean(c28) : null;
    const ratio = acute != null && chronic ? acute / chronic : null;
    const stato = ratio == null ? "calibrazione" : ratio < 0.8 ? "scarico" : ratio <= 1.0 ? "mantenimento" : ratio <= 1.3 ? "costruzione" : ratio <= 1.5 ? "attenzione" : "eccesso";
    // ---- recovery, second step: activity contributors (like Oura's Readiness) and reading of the score ----
    {
      const comp = d.recupero.componenti;
      // yesterday's load vs your usual day: a very hard day lowers today's readiness
      const yRatio = chronic && load[i - 1] != null ? load[i - 1] / chronic : null;
      comp.attivita_ieri = { valore: load[i - 1] ?? null, unita: "carico", peso: 0.04, baseline: chronic ? Math.round(chronic) : null, z: null,
        punteggio: yRatio == null ? null : pw(yRatio, [[0, 85], [1, 85], [1.5, 70], [2, 50], [3, 25]]) };
      // activity balance: last 7 days vs last 28 (too little or too much both lower it)
      comp.bilancio_attivita = { valore: r1(ratio, 2), unita: "7/28 gg", peso: 0.03, baseline: null, z: null,
        punteggio: ratio == null ? null : pw(ratio, [[0.4, 60], [0.8, 90], [1.3, 90], [1.5, 65], [2, 35]]) };
      for (const k of ["attivita_ieri", "bilancio_attivita"]) if (comp[k].punteggio != null) comp[k].punteggio = Math.round(comp[k].punteggio);
      const prevScore = days[i - 1]?.recupero?.score ?? null;
      const sc = scoreFrom(d, comp, prevScore);
      const rec = d.recupero;
      if (sc.score != null) {
        rec.score = sc.score;
        rec.stato = sc.score >= 67 ? "recuperato" : sc.score >= 34 ? "parziale" : "basso";
        rec.affidabilita = sc.affidabilita;
        // uncertainty band and 3-day trend: one day is not a trend
        rec.incertezza = sc.affidabilita === "alta" ? 5 : sc.affidabilita === "media" ? 8 : 12;
        const last3 = [days[i - 2], days[i - 1], d].map((x) => x?.recupero?.score).filter((x) => x != null);
        rec.trend_3g = last3.length >= 2 ? Math.round(mean(last3)) : null;
        // what weighed most today: points above/below "as usual" (60) for each component
        const impacts = Object.entries(comp).filter(([, c]) => c.punteggio != null).map(([k, c]) => [k, (c.peso * (c.punteggio - 60)) / sc.wSum]);
        rec.spiegazione = impacts.sort((a, b) => a[1] - b[1]).filter(([, v]) => Math.abs(v) >= 1.5).slice(0, 3).map(([k, v]) => ({ componente: k, punti: Math.round(v) }));
        const tags = (d.checkin?.tag || "").split(",").filter(Boolean);
        if (tags.length) rec.etichette = tags;
        // estimate for tomorrow if tonight you sleep what you need (sleep score ~85): HRV and the rest unknown
        if (comp.sonno.punteggio != null && comp.sonno.punteggio < 85) {
          const gain = (comp.sonno.peso * (85 - comp.sonno.punteggio)) / sc.wSum;
          rec.domani_se_dormi = Math.round(clamp(sc.score + gain, 0, 100));
        }
      }
    }
    // fascia consigliata per oggi: recupero (verde/giallo/rosso) e rapporto acuto:cronico
    let target = null;
    if (chronic) {
      const sc = d.recupero.score;
      let [lo, hi] = sc == null ? [0.6, 1.1] : sc >= 67 ? [0.9, 1.5] : sc >= 34 ? [0.5, 1.0] : [0, 0.5];
      if (ratio != null && ratio > 1.3) hi = Math.min(hi, 0.8), lo = Math.min(lo, 0.4);   // già troppo: si scarica
      if (ratio != null && ratio < 0.8 && sc != null && sc >= 67) hi = Math.max(hi, 1.6);  // margine per costruire
      const lvl = LOAD_LEVELS.find((l) => hi >= l.min) || LOAD_LEVELS[3];
      target = { min: Math.round(lo * chronic), max: Math.round(hi * chronic), livello: lvl.key, titolo: lvl.titolo, testo: lvl.testo };
    }
    d.carico = { oggi: load[i], acuto: r1(acute, 0), cronico: r1(chronic, 0), rapporto: r1(ratio, 2), stato, consiglio: target,
      trimp: d.attivita.trimp, srpe: srpe[i], fattore_srpe: r1(k, 2), fc_max: hrMax(profile) };

    // allarmi: due giorni di fila con HRV bassa e FC a riposo o respirazione alte → stanchezza o malanno in arrivo
    const bad = (x) => x && x.recupero && x.recupero.componenti.hrv.z != null && x.recupero.componenti.hrv.z <= -1 &&
      ((x.recupero.componenti.fc_riposo.z != null && x.recupero.componenti.fc_riposo.z <= -1) || (x.recupero.componenti.respirazione.z != null && x.recupero.componenti.respirazione.z >= 1));
    const hrvLow = d.recupero.componenti.hrv.normale && days.slice(Math.max(0, i - 2), i + 1).every((x) => x.notte.hrv_ms != null && x.notte.hrv_ms < d.recupero.componenti.hrv.normale[0]);
    if (bad(d) && bad(days[i - 1])) d.allarme = { tipo: "malanno", titolo: "Segnali di stanchezza o di un malanno", testo: "Da due giorni HRV bassa e frequenza cardiaca (o respirazione) alta rispetto al tuo solito. Due giorni leggeri, sonno abbondante e idratazione; se ti senti male, fermati." };
    // HRV swinging much more than usual while its weekly mean drops: adaptation is not keeping up (Plews)
    else if (d.recupero.affidabilita !== "bassa" && d.recupero.componenti.stabilita_hrv?.z != null && d.recupero.componenti.stabilita_hrv.z <= -1.5 && d.recupero.componenti.hrv.z != null && d.recupero.componenti.hrv.z < 0)
      d.allarme = { tipo: "instabile", titolo: "HRV instabile", testo: "Questa settimana la tua HRV oscilla molto più del solito e la media cala: il corpo fa fatica ad assorbire il carico. Un paio di giorni facili e sonno regolare." };
    else if (hrvLow && ratio != null && ratio > 1.3) d.allarme = { tipo: "sovraccarico", titolo: "Stai accumulando fatica", testo: "Da tre giorni l'HRV è sotto il tuo intervallo normale e il carico è sopra il solito. Inserisci 2-3 giorni leggeri prima della prossima seduta dura." };

    // fabbisogno di sonno per stanotte (come Whoop: base + carico del giorno + recupero del debito)
    const last7 = days.slice(Math.max(0, i - 6), i + 1).filter((x) => x.sonno);
    const debt = last7.reduce((a, x) => a + Math.max(0, need0 - x.sonno.durata_min), 0);
    const strainAdd = chronic && load[i] != null ? clamp((load[i] / chronic - 1) * 30, 0, 45) : 0;
    const debtAdd = clamp(debt / 7, 0, 60);
    const needTonight = Math.round(need0 + strainAdd + debtAdd);
    // sveglia: dal profilo, altrimenti l'orario medio di risveglio delle ultime 14 notti registrate
    let wake = profile.sveglia ? Number(profile.sveglia.slice(0, 2)) * 60 + Number(profile.sveglia.slice(3)) : null;
    if (wake == null) {
      const ends = days.slice(Math.max(0, i - 13), i + 1).filter((x) => x.sonno && x.sonno.fine).map((x) => Number(x.sonno.fine.slice(11, 13)) * 60 + Number(x.sonno.fine.slice(14, 16)));
      if (ends.length >= 3) wake = Math.round(mean(ends));
    }
    const bed = wake == null ? null : (wake - needTonight - 15 + 1440 * 2) % 1440; // 15 minuti per addormentarsi
    d.sonno_stanotte = { fabbisogno_min: needTonight, base_min: need0, base_fonte: needSource, per_carico_min: Math.round(strainAdd), per_debito_min: Math.round(debtAdd), debito_7g_min: Math.round(debt),
      sveglia: wake == null ? null : `${String(Math.floor(wake / 60)).padStart(2, "0")}:${String(wake % 60).padStart(2, "0")}`,
      a_letto: bed == null ? null : `${String(Math.floor(bed / 60)).padStart(2, "0")}:${String(bed % 60).padStart(2, "0")}` };
  });
}

export async function computeHistory(db, endDay, nDays) {
  const start = addDays(endDay, -(nDays - 1));
  const from = addDays(start, -BASELINE_DAYS - 1);
  const data = await load(db, from, endDay);
  const sessionsByDay = buildSessions(data.sleepRows);
  const days = [];
  for (let d = from; d <= endDay; d = addDays(d, 1)) days.push(rawDay(d, data, sessionsByDay));
  // baseline e punteggi in ordine cronologico (la regolarità usa i giorni precedenti)
  // maschera minuto per minuto (mezzogiorno → mezzogiorno) degli intervalli di sonno, per il SRI
  const asleep = data.sleepRows.filter((r) => r.stage !== "awake" && r.stage !== "inbed").map((r) => [t(r.start), t(r.end)]);
  const maskCache = {};
  const maskOf = (day) => {
    if (maskCache[day]) return maskCache[day];
    const end = t(day + "T12:00:00Z"), start = end - DAY_MS, m = new Uint8Array(1440);
    for (const [s, e] of asleep) {
      if (e <= start || s >= end) continue;
      for (let i = Math.max(0, Math.floor((s - start) / 60e3)); i < Math.min(1440, Math.ceil((e - start) / 60e3)); i++) m[i] = 1;
    }
    return (maskCache[day] = m);
  };
  for (let i = 0; i < days.length; i++) finalize(days, i, maskOf);
  const profile = await getProfile(db);
  enrich(days, data, profile, start);
  const out = days.filter((d) => d.giorno >= start);
  for (const d of out) if (d.sonno) { delete d.sonno._bed; delete d.sonno._wake; delete d.sonno._midH; delete d.sonno._contributi; }
  return out;
}

export async function computeDay(db, day) {
  const h = await computeHistory(db, day, 1);
  return h[0];
}
